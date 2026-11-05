// Server-only adapters. Source credentials and raw operational records never leave this module.
export const SOURCE_ORIGINS = Object.freeze({
  stockroom: "https://bmc-stockroom.misty-jelly-1931.chatgpt.site",
  green: "https://bmc-green-forecast.misty-jelly-1931.chatgpt.site",
  dispatch: "https://bmc-dispatch-delivery.misty-jelly-1931.chatgpt.site",
});
const MAX_SOURCE_BYTES = 2_000_000;
const TIME_ZONE = "Australia/Sydney";
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonnegative = value => finite(value) !== null && value >= 0 ? value : null;
const rounded = value => value === null ? null : Math.round(value * 100) / 100;
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const shortText = (value, fallback = "") => typeof value === "string" ? value.trim().slice(0, 180) : fallback;

function rows(value, limit = 2500) {
  if (!Array.isArray(value) || value.length > limit || value.some(row => !object(row))) throw new Error("The source returned an unexpected record list.");
  return value;
}
export function isoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function latest(values) { return values.map(isoTimestamp).filter(Boolean).sort().at(-1) || null; }
export function sydneyDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function addDays(value, days) {
  if (!validDate(value) || !Number.isInteger(days)) throw new Error("Choose a valid date.");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function mondayOf(value) {
  if (!validDate(value)) throw new Error("Choose a valid date.");
  return addDays(value, -((new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7));
}
export function dashboardWeek(weekStart, now = new Date()) {
  const current = mondayOf(sydneyDate(now));
  const start = weekStart || current;
  if (!validDate(start) || mondayOf(start) !== start || start > current) throw new Error("Choose this week or an earlier Monday.");
  const end = addDays(start, 6);
  const labelDate = value => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`));
  return { start, end, label: `${labelDate(start)} – ${labelDate(end)} ${end.slice(0, 4)}`, isCurrent: start === current, timeZone: TIME_ZONE };
}
function base(source, asOf, note = "", status = "live") { return { status, source, asOf: isoTimestamp(asOf), note }; }
function unavailable(source, fields, note) { return { ...base(source, null, note, "unavailable"), ...fields }; }

export async function fetchSourceJson(url, headers = {}, fetcher = fetch) {
  const parsed = new URL(url);
  if (!Object.values(SOURCE_ORIGINS).includes(parsed.origin) || parsed.username || parsed.password || parsed.protocol !== "https:") throw new Error("The source connection is not allowed.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(parsed.href, { headers: { Accept: "application/json", ...headers }, redirect: "manual", signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { const error = new Error("Source access needs reconnecting."); error.status = response.status; throw error; }
      if (response.status >= 300 && response.status < 400) throw new Error("The source requires a direct connection.");
      throw new Error("The source is temporarily unavailable.");
    }
    if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) throw new Error("The source response is too large.");
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("The source did not return data.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The source returned no data.");
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("The source response is too large."); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("The source returned unreadable data."); }
    if (!object(data)) throw new Error("The source returned an unexpected data format.");
    return data;
  } catch (error) {
    // Only our fixed messages may enter the response; fetch errors can include URLs or headers.
    const safe = ["Source access needs reconnecting.", "The source requires a direct connection.", "The source is temporarily unavailable.", "The source response is too large.", "The source did not return data.", "The source returned no data.", "The source returned unreadable data.", "The source returned an unexpected data format."];
    const safeError = new Error(safe.includes(error?.message) ? error.message : "The source could not be reached. Try refreshing.");
    if (error?.status === 401 || error?.status === 403) safeError.status = error.status;
    throw safeError;
  } finally { clearTimeout(timeout); }
}

export function mapNonCoffee(payload) {
  const items = rows(payload?.items, 1500);
  const categories = new Map();
  let value = 0, unpricedItems = 0, invalid = 0;
  for (const item of items) {
    const categoryName = shortText(item.category, "Uncategorised") || "Uncategorised";
    const group = categories.get(categoryName) || { name: categoryName, itemCount: 0, value: 0, unpricedItems: 0 };
    group.itemCount++;
    const stock = nonnegative(item.stock), cost = nonnegative(item.unitCost);
    const units = nonnegative(item.stockUnitQuantity) ?? ((categoryName === "Cups & Lids" || categoryName === "Food Packaging") && nonnegative(item.packSize) > 0 ? item.packSize : 1);
    if (stock === null || units <= 0) { invalid++; unpricedItems++; group.unpricedItems++; }
    else if (stock > 0 && cost === null) { unpricedItems++; group.unpricedItems++; }
    else { const amount = stock * (cost ?? 0) * units; group.value += amount; value += amount; }
    categories.set(categoryName, group);
  }
  const asOf = latest(items.map(item => item.updatedAt));
  return { ...base("stockroom", asOf, `${unpricedItems ? `${unpricedItems} items need a price or valid quantity. Known value shown. ` : ""}Current non-coffee stock; coffee is excluded.${invalid ? " Some quantities need review." : ""}`, unpricedItems ? "partial" : "live"), value: rounded(value), itemCount: items.length, categoryCount: categories.size, categories: [...categories.values()].map(group => ({ ...group, value: rounded(group.value) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), unpricedItems, currency: "AUD" };
}

export function mapGreen(payload) {
  const state = object(payload?.state);
  if (!state) throw new Error("Green stock data is unavailable.");
  const lots = rows(state.stockLots, 2500);
  let kg = 0, value = 0, unpricedLots = 0, invalid = 0;
  for (const lot of lots) {
    const quantity = nonnegative(lot.remainingKg), price = nonnegative(lot.pricePerKg);
    if (quantity === null) { invalid++; continue; }
    kg += quantity;
    if (quantity > 0 && price === null) unpricedLots++;
    else value += quantity * (price ?? 0);
  }
  return { ...base("green", payload.sourceUpdatedAtUtc || payload.updatedAt, `Current physical stock lots; supplier contract balances are excluded.${unpricedLots || invalid ? " Known totals shown; some lots need review." : ""} Source update time is not provided.`, unpricedLots || invalid ? "partial" : "live"), kg: rounded(kg), value: rounded(value), currency: "AUD", unpricedLots: unpricedLots + invalid };
}

export function mapDemand(payload, weekStart) {
  const state = object(payload?.state);
  if (!state) throw new Error("Weekly demand data is unavailable.");
  const demand = rows(state.demand, 5000).filter(item => item.weekStart === weekStart);
  if (!demand.length) return unavailable("green", { kg: null }, "No demand has been entered for this week.");
  const recipes = new Map(rows(state.recipes, 1000).map(recipe => [recipe.id, recipe]));
  let kg = 0, invalid = 0, active = 0;
  for (const item of demand) {
    const recipe = recipes.get(item.recipeId);
    if (!recipe) { invalid++; continue; }
    if (recipe.active === false) continue;
    active++;
    const batchKg = nonnegative(recipe.finishedBatchKg);
    const dailyValues = object(item.dailyBatches) ? ["mon", "tue", "wed", "thu", "fri"].map(day => nonnegative(item.dailyBatches[day])) : [];
    const daily = dailyValues.length === 5 && dailyValues.every(value => value !== null) ? dailyValues.reduce((sum, value) => sum + value, 0) : null;
    if (item.source === "Daily Mon-Fri batch entry") {
      if (daily === null || batchKg === null) { invalid++; continue; }
      kg += daily * batchKg;
      continue;
    }
    const batches = daily || nonnegative(item.forecastBatches) || nonnegative(item.orderedBatches) || nonnegative(item.actualBatches);
    if (batches !== null && batches > 0 && batchKg !== null) kg += batches * batchKg;
    else {
      const explicit = nonnegative(item.forecastKg) || nonnegative(item.orderedKg) || nonnegative(item.actualKg);
      if (explicit !== null) kg += explicit;
      else if ([item.forecastKg, item.orderedKg, item.actualKg, item.forecastBatches, item.orderedBatches, item.actualBatches, daily].some(value => value === 0)) kg += 0;
      else invalid++;
    }
  }
  if (!active) return unavailable("green", { kg: null }, "No valid active recipe demand has been entered for this week.");
  return { ...base("green", payload.sourceUpdatedAtUtc || payload.updatedAt, "Entered demand for this week, before forecast buffers. Planned demand is separate from actual roasting." + (invalid ? " Some demand rows need review." : ""), invalid ? "partial" : "live"), kg: invalid === demand.length ? null : rounded(kg) };
}

export function mapRoasting(coffeePayload, productionPayload, weekStart) {
  const batches = rows(coffeePayload?.batches, 5000);
  const end = addDays(weekStart, 7);
  const byDay = Array.from({ length: 7 }, (_, index) => ({ date: addDays(weekStart, index), kg: 0 }));
  const days = new Map(byDay.map(day => [day.date, day]));
  let invalid = 0;
  for (const batch of batches) {
    if (!validDate(batch.roastDate) || batch.roastDate < weekStart || batch.roastDate >= end || batch.mergedIntoBatchId || batch.archivedAt) continue;
    const kg = nonnegative(batch.roastedKg);
    if (kg === null) invalid++;
    else days.get(batch.roastDate).kg += kg;
  }
  const total = byDay.reduce((sum, day) => sum + day.kg, 0);
  const daysRoasted = byDay.filter(day => day.kg > 0).length;
  let note = "Recorded roast batches; archived and merged entries are excluded.";
  const archivedInWeek = rows(coffeePayload?.archivedBatches || [], 5000).filter(batch => validDate(batch.roastDate) && batch.roastDate >= weekStart && batch.roastDate < end && !batch.mergedIntoBatchId).length;
  if (archivedInWeek) { invalid++; note += ` ${archivedInWeek} archived roast records also exist for this week, so this total is incomplete.`; }
  if (productionPayload) {
    if (productionPayload.weekStart !== weekStart) throw new Error("The production report returned a different week.");
    const reportTotal = rows(productionPayload.roastRows, 1500).reduce((sum, row) => sum + (nonnegative(row.kilograms) ?? 0), 0);
    if (Math.abs(reportTotal - total) > 0.02) { invalid++; note += " Roast records changed during refresh; refresh to reconcile."; }
  }
  const asOf = latest(batches.map(batch => batch.createdAt));
  const knownTotal = archivedInWeek && total === 0 ? null : rounded(total);
  return { roasted: { ...base("stockroom", asOf, note, invalid ? "partial" : "live"), kg: knownTotal }, roastingRate: { ...base("stockroom", asOf, "Kilograms per recorded roasting day; this is output, not kilograms per labour hour." + (archivedInWeek ? " Archived records are excluded; this week's output is incomplete." : invalid ? " Some records need review." : ""), invalid ? "partial" : "live"), weekKg: knownTotal, kgPerDay: daysRoasted > 0 ? rounded(total / daysRoasted) : null, days: archivedInWeek && !daysRoasted ? null : daysRoasted, byDay: byDay.map(day => ({ ...day, kg: knownTotal === null ? null : rounded(day.kg) })) } };
}

export function mapPacking(payload, weekStart) {
  if (payload?.weekStart !== weekStart || !object(payload.report)) throw new Error("Packing rates are unavailable for this week.");
  const report = payload.report;
  const packedKg = nonnegative(report.packedKg), kgPerHour = nonnegative(report.kgPerHour), kgPerDay = nonnegative(report.kgPerPackingDay), coverage = nonnegative(report.timedCoveragePercent);
  if (packedKg === null) throw new Error("Packing quantities are unavailable.");
  return { ...base("stockroom", payload.now, "Hourly rate uses timer-linked kilograms and active time, with breaks excluded. Daily rate uses days with recorded packing." + (coverage !== null && coverage < 100 ? ` ${Math.min(100, coverage)}% of packed kilograms were timed.` : ""), kgPerHour === null || coverage === null || coverage < 100 ? "partial" : "live"), kgPerHour, kgPerDay, packedKg, timedCoveragePercent: coverage === null ? null : Math.min(100, coverage) };
}

// Accept only a bounded weekly summary, never the broad staff Dispatch API.
export function mapDeliverySummary(payload, weekStart) {
  if (payload?.weekStart !== weekStart || (payload.sourceSystem && payload.sourceSystem !== "bmc-dispatch") || payload.schemaVersion !== "1.0" || payload.planStatus === "missing") throw new Error("A matching weekly delivery summary is unavailable.");
  const delivery = object(payload.delivery) || object(payload.deliveryMetrics);
  if (!delivery) throw new Error("Delivery shifts and timing are not supplied by this feed.");
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  const shifts = count(delivery.shifts), completedShifts = count(delivery.completedShifts), orders = count(delivery.orders);
  const avgMinutes = nonnegative(delivery.avgMinutes), totalMinutes = nonnegative(delivery.totalMinutes);
  const incomplete = [shifts, completedShifts, orders].some(value => value === null) || (orders > 0 && avgMinutes === null) || payload.planStatus === "inherited-plan" || payload.truncated === true;
  const exceptions = count(payload.issues?.count);
  return { ...base("dispatch", payload.sourceUpdatedAt || payload.sourceUpdatedAtUtc, "Recorded delivery shifts and measured completed orders; breaks excluded." + (payload.planStatus === "inherited-plan" ? " The order plan is inherited and needs confirmation." : "") + (delivery.timedOrders !== undefined ? ` ${count(delivery.timedOrders) ?? 0} orders have timing.` : "") + (exceptions !== null ? ` ${exceptions} delivery exceptions are recorded in Dispatch.` : ""), incomplete ? "partial" : "live"), shifts, completedShifts, orders, avgMinutes: rounded(avgMinutes), totalMinutes: rounded(totalMinutes) };
}

export function mapDispatchOrders(payload, weekStart) {
  if (payload?.schemaVersion !== "1.0" || payload.weekStart !== weekStart || payload.planStatus === "missing" || !object(payload.wholesale)) throw new Error("A matching weekly order summary is unavailable.");
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  const orders = count(payload.wholesale.orders), clients = count(payload.wholesale.clients);
  if (orders === null || clients === null) throw new Error("Weekly order counts are incomplete.");
  const provisional = payload.planStatus === "inherited-plan" || payload.truncated === true;
  const asOf = payload.sourceUpdatedAt || payload.sourceUpdatedAtUtc;
  return {
    wholesale: { ...base("dispatch", asOf, "Ordered wholesale delivery jobs only. Collection and postal orders are not included, and order values are not recorded in Dispatch." + (provisional ? " Inherited plan; confirm the weekly import." : ""), "partial"), orders, clients, value: null, currency: "AUD" },
  };
}

export async function collectDashboard({ weekStart, stockroomCookie, password, env = {} }) {
  const now = new Date();
  const week = dashboardWeek(weekStart, now);
  const metrics = {
    demand: unavailable("green", { kg: null }, "Weekly demand is not connected."),
    roasted: unavailable("stockroom", { kg: null }, "Roast records are unavailable."),
    green: unavailable("green", { kg: null, value: null, currency: "AUD", unpricedLots: null }, "Green stock is unavailable."),
    nonCoffee: unavailable("stockroom", { value: null, itemCount: null, categoryCount: null, categories: [], unpricedItems: null, currency: "AUD" }, "Non-coffee stock is unavailable."),
    wholesale: unavailable("wholesale", { orders: null, clients: null, value: null, currency: "AUD" }, "A confirmed wholesale order ledger is not connected."),
    online: unavailable("online", { orders: null, value: null, currency: "AUD" }, "Choose the online order source."),
    issues: unavailable("issues", { count: null, items: [] }, "Choose the customer issue source."),
    roastingRate: unavailable("stockroom", { weekKg: null, kgPerDay: null, days: null, byDay: [] }, "Roast records are unavailable."),
    packingRate: unavailable("stockroom", { kgPerHour: null, kgPerDay: null, packedKg: null, timedCoveragePercent: null }, "Packing rates are unavailable."),
    delivery: unavailable("dispatch", { shifts: null, completedShifts: null, orders: null, avgMinutes: null, totalMinutes: null }, "The weekly delivery summary is not connected."),
  };
  const sources = [];
  const results = await Promise.allSettled([
    fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/inventory`, { Cookie: stockroomCookie || "", Origin: SOURCE_ORIGINS.stockroom }),
    fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/coffee`, { Cookie: stockroomCookie || "", Origin: SOURCE_ORIGINS.stockroom }),
    fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/coffee/production?week=${week.start}&month=${week.start.slice(0, 7)}`, { Cookie: stockroomCookie || "", Origin: SOURCE_ORIGINS.stockroom }),
    fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/coffee/packing-timer?week=${week.start}`, { Cookie: stockroomCookie || "", Origin: SOURCE_ORIGINS.stockroom }),
    fetchSourceJson(`${SOURCE_ORIGINS.green}/api/roaster`, { "x-green-password": env.SOURCE_GREEN_PASSWORD || password || "" }),
    env.DASHBOARD_DISPATCH_URL && env.DISPATCH_READ_TOKEN ? fetchSourceJson(`${env.DASHBOARD_DISPATCH_URL}${env.DASHBOARD_DISPATCH_URL.includes("?") ? "&" : "?"}week=${week.start}`, { Authorization: `Bearer ${env.DISPATCH_READ_TOKEN}` }) : Promise.reject(new Error("The weekly delivery summary is not connected.")),
  ]);
  if (results[0].status === "rejected" && [401, 403].includes(results[0].reason?.status)) {
    const error = new Error("Your Stock Take session has expired. Sign in again.");
    error.status = 401;
    throw error;
  }
  const safeMap = (keys, action, failureNote) => {
    try { action(); } catch { for (const key of keys) metrics[key] = { ...metrics[key], status: "unavailable", note: failureNote }; }
  };
  if (results[0].status === "fulfilled") safeMap(["nonCoffee"], () => { metrics.nonCoffee = mapNonCoffee(results[0].value); }, "The inventory source returned incomplete data.");
  if (results[1].status === "fulfilled") safeMap(["roasted", "roastingRate"], () => Object.assign(metrics, mapRoasting(results[1].value, results[2].status === "fulfilled" ? results[2].value : null, week.start)), "The roast source returned incomplete data.");
  if (results[3].status === "fulfilled") safeMap(["packingRate"], () => { metrics.packingRate = mapPacking(results[3].value, week.start); }, "The packing source returned incomplete data.");
  if (results[4].status === "fulfilled") {
    safeMap(["green"], () => { metrics.green = mapGreen(results[4].value); }, "The green stock source returned incomplete data.");
    safeMap(["demand"], () => { metrics.demand = mapDemand(results[4].value, week.start); }, "The demand source returned incomplete data.");
  }
  if (results[5].status === "fulfilled") {
    safeMap(["delivery"], () => { metrics.delivery = mapDeliverySummary(results[5].value, week.start); }, "This feed does not supply matching weekly shifts and timing.");
    safeMap(["wholesale"], () => Object.assign(metrics, mapDispatchOrders(results[5].value, week.start)), "This feed does not supply matching weekly order counts.");
  }
  for (const [id, label, keys, url] of [
    ["stockroom", "Stock Take App", ["nonCoffee", "roasted", "packingRate"], SOURCE_ORIGINS.stockroom],
    ["green", "Green Forecast", ["green", "demand"], SOURCE_ORIGINS.green],
    ["dispatch", "Dispatch", ["delivery"], SOURCE_ORIGINS.dispatch],
    ["wholesale", "Wholesale delivery jobs", ["wholesale"], SOURCE_ORIGINS.dispatch],
    ["online", "Online orders", ["online"], null],
    ["issues", "Customer issues", ["issues"], null],
  ]) {
    const values = keys.map(key => metrics[key]);
    const available = values.filter(value => value.status !== "unavailable");
    const status = !available.length ? "unavailable" : available.length !== values.length || values.some(value => value.status === "partial") ? "partial" : "live";
    sources.push({ id, label, status, asOf: latest(values.map(value => value.asOf)), note: status === "unavailable" ? values[0].note : available.length !== values.length ? "Some information could not be read. Refresh to retry." : id === "green" ? "Current saved green stock; source update time is not provided." : "Read from the live app on refresh.", url });
  }
  return { week, generatedAt: now.toISOString(), metrics, sources };
}
