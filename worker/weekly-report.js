import { addDays, dashboardWeek, fetchSourceJson, isoTimestamp, mapNonCoffee, SOURCE_ORIGINS } from "./metrics.js";
import { CROPSTER_WEBSITE, readCropsterReadings } from "./cropster.js";
import { readCropsterMonday } from "./cropster-monday.js";
import { readCropsterFriday } from "./cropster-friday.js";
import { readWeeklyDemand } from "./demand.js";
import { readFridayStock } from "./stock-history.js";

const dispatchPath = "/api/integrations/dashboard/weekly";

function settledValue(result, fallback = null) {
  return result.status === "fulfilled" ? result.value : fallback;
}

async function readDispatch(weekStart, env, fetcher, throughFriday = false) {
  if (!env.DASHBOARD_DISPATCH_URL || !env.DISPATCH_READ_TOKEN) return null;
  const url = new URL(env.DASHBOARD_DISPATCH_URL);
  if (url.origin !== SOURCE_ORIGINS.dispatch || url.pathname !== dispatchPath || url.username || url.password) return null;
  url.searchParams.set("week", weekStart);
  if (throughFriday) url.searchParams.set("through", "friday");
  else url.searchParams.delete("through");
  const result = await fetchSourceJson(url.href, { Authorization: `Bearer ${env.DISPATCH_READ_TOKEN}` }, fetcher);
  if (result.sourceSystem !== "bmc-dispatch" || result.schemaVersion !== "1.0" || result.weekStart !== weekStart) return null;
  if (throughFriday && result.periodEnd !== addDays(weekStart, 4)) return null;
  return result;
}

const orderCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const demandKg = value => Number.isFinite(value) && value >= 0 ? value : null;

function dispatchCounts(source) {
  const confirmed = source?.planStatus === "confirmed-weekly-import";
  const inherited = source?.planStatus === "inherited-plan";
  const orders = confirmed ? orderCount(source.wholesale?.orders) : null;
  const completed = orderCount(source?.wholesale?.completedOrders);
  const pending = orderCount(source?.wholesale?.pendingOrders);
  const hasBreakdown = orders !== null && completed !== null && pending !== null && completed + pending === orders;
  const scheduled = orderCount(source?.wholesale?.scheduledOrders);
  const scheduledPending = orderCount(source?.wholesale?.scheduledPendingOrders);
  const provisional = inherited && scheduled !== null && completed !== null &&
    scheduledPending !== null && completed + scheduledPending === scheduled;
  return {
    orders,
    done: hasBreakdown || inherited ? completed : null,
    pending: hasBreakdown ? pending : null,
    scheduledOrders: provisional ? scheduled : orders,
    scheduledPendingOrders: provisional ? scheduledPending : hasBreakdown ? pending : null,
    provisional,
  };
}

export function wholesaleDeliveryComparison(current, previous) {
  const { orders, done, pending, scheduledOrders, scheduledPendingOrders, provisional } = dispatchCounts(current);
  const { orders: previousOrders, done: previousDone, pending: previousPending } = dispatchCounts(previous);
  const notes = [];
  if (orders === null) {
    if (provisional) notes.push(current.periodEnd
      ? "The saved schedule covers Monday to Friday. The weekly import was unconfirmed by Friday."
      : "The saved schedule covers the entire Sydney week. Scheduled and pending counts are provisional until the weekly import is confirmed in Dispatch.");
    else notes.push(current?.planStatus === "inherited-plan" ? "Confirm this week’s order import in Dispatch." : "This week’s Dispatch order total is unavailable.");
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
    scheduledOrders,
    scheduledPendingOrders,
    provisional,
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

export function weeklyDemandComparison(current, previous, mondayReading = null) {
  const kg = demandKg(current?.kg);
  const previousKg = demandKg(previous?.kg);
  const brownOnHandKg = demandKg(current?.brownOnHandKg);
  const mondayRoastedKg = demandKg(mondayReading?.kg);
  const carryForwardKg = brownOnHandKg === null || mondayRoastedKg === null
    ? null : (Math.round(brownOnHandKg * 100) - Math.round(mondayRoastedKg * 100)) / 100;
  const carryForwardNote = brownOnHandKg === null ? "Brown stock in 3. Roast Planning!D6:D17 is unavailable."
    : mondayRoastedKg === null ? "A completed Monday roast reading from Cropster is needed."
    : "Brown stock from 3. Roast Planning!D6:D17 less Monday’s completed Cropster roast output.";
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
    carryForwardKg,
    carryForwardNote,
    brownOnHandKg,
    mondayRoastedKg,
    changePercent,
    status,
    note: notes.join(" "),
    asOf: isoTimestamp(current?.asOf),
  };
}

function stockMetric(inventory) {
  try {
    return mapNonCoffee(inventory);
  } catch {
    return { status: "unavailable", value: null, itemCount: null, categoryCount: null, categories: [], unpricedItems: null, currency: "AUD", asOf: null, note: "Stockroom inventory is unavailable." };
  }
}

export async function collectWeeklyReport({ weekStart, stockroomCookie, env, now = new Date(), fetcher = fetch, fresh = false }) {
  const week = dashboardWeek(weekStart, now);
  const previousWeek = addDays(week.start, -7);
  const historical = !week.isCurrent;
  if (historical) {
    week.end = addDays(week.start, 4);
    const dateLabel = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" });
    const label = date => dateLabel.format(new Date(date + "T00:00:00Z"));
    week.label = `${label(week.start)} – ${label(week.end)} ${week.end.slice(0, 4)}`;
  }
  const stockroomHeaders = { Cookie: stockroomCookie, Origin: SOURCE_ORIGINS.stockroom };
  // Check Stockroom access before reading other business data.
  const inventory = await fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/inventory", stockroomHeaders, fetcher);
  const demandOptions = { fetch: fetcher, now: () => now.getTime(), fresh };
  const [{ production, green }, mondayReading, stock, [weekDemand, previousDemand, dispatch, previousDispatch]] = await Promise.all([
    historical ? readCropsterFriday(env.DB, week.start) : readCropsterReadings({ db: env.DB, weekStart: week.start, followingWeekStart: addDays(week.start, 7), now }),
    readCropsterMonday({ db: env.DB, weekStart: week.start }),
    historical ? readFridayStock({ date: week.end, inventory, stockroomCookie, now, fetcher }) : stockMetric(inventory),
    Promise.allSettled([
      readWeeklyDemand(week.start, demandOptions),
      readWeeklyDemand(previousWeek, demandOptions),
      readDispatch(week.start, env, fetcher, historical),
      readDispatch(previousWeek, env, fetcher, true),
    ]),
  ]);
  const currentTally = settledValue(weekDemand);
  const previousTally = settledValue(previousDemand);
  const demand = weeklyDemandComparison(currentTally, previousTally, mondayReading);
  const wholesale = wholesaleDeliveryComparison(settledValue(dispatch), settledValue(previousDispatch));
  const greenReport = new URL("/apps/lots/inventory-report/location", CROPSTER_WEBSITE);
  if (historical) greenReport.searchParams.set("reportDates", JSON.stringify([null, week.end]));
  return {
    week,
    generatedAt: now.toISOString(),
    metrics: { demand, production, green, stock, wholesale },
    sources: [
      { label: "This week’s roast tally", note: currentTally?.note || "Demand workbook is unavailable.", url: currentTally?.url, asOf: currentTally?.asOf },
      { label: "Last week’s roast tally", note: previousTally?.note || "Demand workbook is unavailable.", url: previousTally?.url, asOf: previousTally?.asOf },
      { label: "Monday’s completed roasts", note: mondayReading ? "Read in Cropster." : "Save the completed output from Cropster’s Monday production report.", url: new URL(`/apps/roast/production-report?dateFrom=${week.start}&dateTo=${week.start}`, CROPSTER_WEBSITE).href, asOf: mondayReading?.asOf },
      { label: "Cropster production", note: production.note, url: CROPSTER_WEBSITE, asOf: production.asOf },
      { label: "Cropster green inventory · Marrickville", note: green.note, url: greenReport.href, asOf: green.asOf },
      { label: "Stock Take App", note: historical ? stock.note : "Current non-coffee value uses every active item’s saved stock count.", url: SOURCE_ORIGINS.stockroom },
      { label: "Dispatch", note: historical ? "Selected week’s schedules and completed handovers through Friday." : "This week’s schedule covers all seven days. Done counts completed primary orders.", url: SOURCE_ORIGINS.dispatch },
    ],
  };
}
