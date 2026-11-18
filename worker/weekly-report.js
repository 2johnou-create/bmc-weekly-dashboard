import { addDays, dashboardWeek, fetchSourceJson, isoTimestamp, mapNonCoffee, SOURCE_ORIGINS } from "./metrics.js";
import { CROPSTER_WEBSITE, readCropsterReadings } from "./cropster.js";
import { readWeeklyDemand } from "./demand.js";

const dispatchPath = "/api/integrations/dashboard/weekly";

function settledValue(result, fallback = null) {
  return result.status === "fulfilled" ? result.value : fallback;
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
const demandKg = value => Number.isFinite(value) && value >= 0 ? value : null;

function dispatchCounts(source) {
  const confirmed = source?.planStatus === "confirmed-weekly-import";
  const orders = confirmed ? orderCount(source.wholesale?.orders) : null;
  const completed = orderCount(source?.wholesale?.completedOrders);
  const pending = orderCount(source?.wholesale?.pendingOrders);
  const hasBreakdown = orders !== null && completed !== null && pending !== null && completed + pending === orders;
  return {
    orders,
    done: hasBreakdown || source?.planStatus === "inherited-plan" ? completed : null,
    pending: hasBreakdown ? pending : null,
  };
}

export function wholesaleDeliveryComparison(current, previous) {
  const { orders, done, pending } = dispatchCounts(current);
  const { orders: previousOrders, done: previousDone, pending: previousPending } = dispatchCounts(previous);
  const notes = [];
  if (orders === null) {
    notes.push(current?.planStatus === "inherited-plan" ? "Confirm this week’s order import in Dispatch." : "This week’s Dispatch order total is unavailable.");
  } else if (pending === null) {
    notes.push("The confirmed Dispatch plan does not have a matching done and pending count.");
  }
  if (orders !== null && previousOrders === null) notes.push("The previous week has no confirmed Dispatch order total.");
  const status = pending !== null && previousOrders !== null ? "live" :
    [orders, done, previousOrders, previousDone].some(value => value !== null) ? "partial" : "unavailable";
  return {
    orders,
    done,
    pending,
    previousOrders,
    previousDone,
    previousPending,
    completed: orderCount(current?.delivery?.deliveredOrders ?? current?.delivery?.orders),
    previousCompleted: orderCount(previous?.delivery?.deliveredOrders ?? previous?.delivery?.orders),
    status,
    note: notes.join(" "),
    asOf: isoTimestamp(current?.sourceUpdatedAt),
  };
}

export function weeklyDemandComparison(current, previous) {
  const kg = demandKg(current?.kg);
  const previousKg = demandKg(previous?.kg);
  const change = kg !== null && previousKg > 0 ? (kg - previousKg) / previousKg * 100 : null;
  const changePercent = Number.isFinite(change) ? Math.round(change * 10) / 10 : null;
  const notes = [];
  if (kg === null) notes.push(current?.note || "This week’s roast tally is unavailable.");
  if (previousKg === null) notes.push(previous?.weekMismatch
    ? "Last week’s tally has the wrong week commencing date."
    : "Last week’s verified roast tally is unavailable.");
  if (kg !== null && previousKg === 0) notes.push("Last week’s demand was zero, so there is no percentage comparison.");
  if (current?.status === "partial" || previous?.status === "partial") notes.push("Check the source notes on the roast tallies.");
  const status = kg !== null && previousKg !== null && current?.status === "live" && previous?.status === "live" ? "live" :
    kg !== null || previousKg !== null ? "partial" : "unavailable";
  return {
    kg,
    previousKg,
    changePercent,
    status,
    note: notes.join(" "),
    asOf: isoTimestamp(current?.asOf),
  };
}

function stockMetric(inventory) {
  try {
    const stock = mapNonCoffee(inventory);
    return { ...stock, note: stock.status === "live" ? "" : stock.note };
  } catch {
    return { status: "unavailable", value: null, itemCount: null, categoryCount: null, categories: [], unpricedItems: null, currency: "AUD", asOf: null, note: "Stockroom inventory is unavailable." };
  }
}

export async function collectWeeklyReport({ weekStart, stockroomCookie, env, now = new Date(), fetcher = fetch }) {
  const week = dashboardWeek(weekStart, now);
  const previousWeek = addDays(week.start, -7);
  const stockroomHeaders = { Cookie: stockroomCookie, Origin: SOURCE_ORIGINS.stockroom };
  // Check Stockroom access before reading other business data.
  const inventory = await fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/inventory", stockroomHeaders, fetcher);
  const demandOptions = { fetch: fetcher, now: () => now.getTime() };
  const [{ production, green }, [weekDemand, previousDemand, dispatch, previousDispatch]] = await Promise.all([
    readCropsterReadings({ db: env.DB, weekStart: week.start, followingWeekStart: addDays(week.start, 7), now }),
    Promise.allSettled([
      readWeeklyDemand(week.start, demandOptions),
      readWeeklyDemand(previousWeek, demandOptions),
      readDispatch(week.start, env, fetcher),
      readDispatch(previousWeek, env, fetcher),
    ]),
  ]);
  const currentTally = settledValue(weekDemand);
  const previousTally = settledValue(previousDemand);
  const demand = weeklyDemandComparison(currentTally, previousTally);
  const stock = stockMetric(inventory);
  const wholesale = wholesaleDeliveryComparison(settledValue(dispatch), settledValue(previousDispatch));
  return {
    week,
    generatedAt: now.toISOString(),
    metrics: { demand, production, green, stock, wholesale },
    sources: [
      { label: "This week’s roast tally", note: currentTally?.note || "Demand workbook is unavailable.", url: currentTally?.url, asOf: currentTally?.asOf },
      { label: "Last week’s roast tally", note: previousTally?.note || "Demand workbook is unavailable.", url: previousTally?.url, asOf: previousTally?.asOf },
      { label: "Cropster production", note: production.note, url: CROPSTER_WEBSITE, asOf: production.asOf },
      { label: "Cropster green inventory", note: green.note, url: CROPSTER_WEBSITE, asOf: green.asOf },
      { label: "Stockroom", note: "Current value covers the non-coffee inventory." },
      { label: "Dispatch", note: "Done counts completed primary orders. Scheduled and pending counts use confirmed weekly imports." },
    ],
  };
}
