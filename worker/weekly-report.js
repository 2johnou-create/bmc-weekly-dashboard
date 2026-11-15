import { addDays, dashboardWeek, fetchSourceJson, mapNonCoffee, mapRoasting, SOURCE_ORIGINS } from "./metrics.js";
import { readGreenBuy } from "./green-buy.js";
import { readStockHistory, stockMonthEnds } from "./stock-history.js";

const dispatchPath = "/api/integrations/dashboard/weekly";

function settledValue(result, fallback = null) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function completedRoast(coffee, weekStart) {
  if (!coffee) return null;
  try {
    return mapRoasting(coffee, null, weekStart).roasted;
  } catch {
    return null;
  }
}

export function productionFromStockroom(coffee, weekStart) {
  const current = completedRoast(coffee, weekStart);
  const prior = completedRoast(coffee, addDays(weekStart, -7));
  const change = current?.status === "live" && prior?.status === "live" && prior.kg > 0
    ? Math.round((current.kg - prior.kg) * 1000 / prior.kg) / 10
    : null;
  return {
    status: current?.kg == null ? "unavailable" : "partial",
    source: "Stockroom roast records",
    totalKg: null,
    roastedKg: current?.kg ?? null,
    scheduledKg: null,
    previousKg: null,
    previousRoastedKg: prior?.kg ?? null,
    changePercent: null,
    roastedChangePercent: change,
    note: "Roasted figures are from Stockroom. Cropster schedule data, including Friday, is pending.",
    asOf: current?.asOf ?? null,
  };
}

async function readDispatch(weekStart, env, fetcher) {
  if (!env.DASHBOARD_DISPATCH_URL || !env.DISPATCH_READ_TOKEN) return null;
  const url = new URL(env.DASHBOARD_DISPATCH_URL);
  if (url.origin !== SOURCE_ORIGINS.dispatch || url.pathname !== dispatchPath || url.username || url.password) return null;
  url.searchParams.set("week", weekStart);
  const result = await fetchSourceJson(url.href, { Authorization: `Bearer ${env.DISPATCH_READ_TOKEN}` }, fetcher);
  if (result.sourceSystem !== "bmc-dispatch" || result.schemaVersion !== "1.0" || result.weekStart !== weekStart) return null;
  return result;
}

const orderCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function wholesaleDeliveryComparison(current, previous) {
  const count = source => source?.planStatus === "confirmed-weekly-import" ? orderCount(source.wholesale?.orders) : null;
  const orders = count(current);
  const previousOrders = count(previous);
  const completed = orderCount(current?.delivery?.deliveredOrders ?? current?.delivery?.orders);
  const previousCompleted = orderCount(previous?.delivery?.deliveredOrders ?? previous?.delivery?.orders);
  const status = orders !== null && previousOrders !== null ? "live" : current || previous ? "partial" : "unavailable";
  let note = "";
  if (orders === null) {
    note = current?.planStatus === "inherited-plan" ? "This week’s Dispatch plan is awaiting a confirmed import." : "This week’s Dispatch order total is unavailable.";
  } else if (previousOrders === null) {
    note = "The previous week has no confirmed Dispatch order total.";
  }
  return { orders, previousOrders, completed, previousCompleted, status, note, asOf: current?.sourceUpdatedAt ?? null };
}

function stockMetric(inventory, history) {
  let value;
  try { value = mapNonCoffee(inventory); }
  catch { value = { status: "unavailable", value: null, itemCount: null, note: "Stockroom inventory is unavailable." }; }
  const unavailableMonths = history.filter(month => month.value === null).length;
  const estimated = history.some(month => month.value !== null && month.status !== "live");
  const notes = [];
  if (estimated) notes.push("Month-end estimates use recorded quantities and current unit costs.");
  if (unavailableMonths) notes.push("A dash marks a month without enough history to calculate a value.");
  return {
    value: value.value,
    itemCount: value.itemCount,
    status: value.status,
    note: value.status === "live" ? "" : value.note,
    history,
    historyNote: notes.join(" "),
  };
}

export async function collectWeeklyReport({ weekStart, stockroomCookie, env, now = new Date(), fetcher = fetch }) {
  const week = dashboardWeek(weekStart, now);
  const previousWeek = addDays(week.start, -7);
  const stockroomHeaders = { Cookie: stockroomCookie, Origin: SOURCE_ORIGINS.stockroom };
  // Check Stockroom access before reading other business data.
  const inventory = await fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/inventory", stockroomHeaders, fetcher);
  const [coffee, green, history, dispatch, previousDispatch] = await Promise.allSettled([
    fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/coffee", stockroomHeaders, fetcher),
    readGreenBuy({ weekStart: week.start, env, now, fetcher }),
    readStockHistory({ inventory, stockroomCookie, now, fetcher }),
    readDispatch(week.start, env, fetcher),
    readDispatch(previousWeek, env, fetcher),
  ]);
  const production = productionFromStockroom(settledValue(coffee), week.start);
  const { greenBuy, greenForecast } = settledValue(green, {
    greenBuy: { status: "unavailable", value: null, kg: null, orders: null, note: "The Green Forecast purchase register is unavailable." },
    greenForecast: { status: "unavailable", value: null, month: null, note: "The Green Forecast purchase plan is unavailable." },
  });
  const stock = stockMetric(inventory, settledValue(history, stockMonthEnds(now).map(date => ({
    date, value: null, status: "unavailable", note: "The Stockroom movement history is unavailable.",
  }))));
  const wholesale = wholesaleDeliveryComparison(settledValue(dispatch), settledValue(previousDispatch));
  return {
    week,
    generatedAt: now.toISOString(),
    metrics: { production, greenBuy, greenForecast, stock, wholesale },
    sources: [
      { label: "Production", note: "Completed kilograms come from recorded Stockroom roasts. Cropster Schedule access is pending." },
      { label: "Green buy", note: "Green Forecast purchase register and monthly purchase forecast." },
      { label: "Stockroom", note: "Current value covers the non-coffee inventory. " + stock.historyNote },
      ...stock.history.filter(month => month.status === "partial" || month.status === "unavailable")
        .map(month => ({ label: month.date, note: month.note })),
      { label: "Wholesale deliveries", note: "Dispatch counts confirmed delivery orders. Completed handovers are recorded separately." },
    ],
  };
}
