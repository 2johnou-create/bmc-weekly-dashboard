import test from "node:test";
import assert from "node:assert/strict";
import { dashboardWeek, sydneyDate, mapNonCoffee, mapDemand, mapPacking, mapDeliverySummary, mapDispatchOrders, fetchSourceJson, collectDashboard, SOURCE_ORIGINS } from "../worker/metrics.js";

const week = "2026-11-02";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("Sydney week follows the local Monday around UTC and daylight-saving boundaries", () => {
  assert.equal(sydneyDate(new Date("2026-11-01T13:05:00Z")), "2026-11-02");
  assert.equal(dashboardWeek(undefined, new Date("2026-11-01T13:05:00Z")).start, week);
  assert.equal(dashboardWeek("2026-09-28", new Date("2026-10-04T13:05:00Z")).end, "2026-10-04");
  assert.throws(() => dashboardWeek("2026-02-30"));
  assert.throws(() => dashboardWeek("2026-11-03", new Date("2026-11-05T00:00:00Z")));
});

test("non-coffee valuation respects pieces per carton and reports missing prices", () => {
  const metric = mapNonCoffee({ items: [
    { category: "Cups & Lids", stock: 2, unitCost: .15, stockUnitQuantity: 1000, updatedAt: 1793577600000 },
    { category: "Packaging", stock: 40, unitCost: .5, stockUnitQuantity: 1 },
    { category: "Packaging", stock: 3, unitCost: null, stockUnitQuantity: 1 },
    { category: "Cleaning", stock: 0, unitCost: null, stockUnitQuantity: 1 },
  ] });
  assert.equal(metric.value, 320);
  assert.equal(metric.itemCount, 4);
  assert.equal(metric.categoryCount, 3);
  assert.equal(metric.unpricedItems, 1);
  assert.equal(metric.status, "partial");
  assert.deepEqual(metric.categories.find(row => row.name === "Packaging"), { name: "Packaging", value: 20, itemCount: 2, unpricedItems: 1 });
});

test("demand uses only the exact entered week and keeps planning separate from roast actuals", () => {
  const payload = { state: { recipes: [{ id: "liberty", active: true, finishedBatchKg: 25 }], demand: [{ recipeId: "liberty", weekStart: week, source: "Daily Mon-Fri batch entry", dailyBatches: { mon: 2, tue: 1, wed: 3, thu: 0, fri: 0 }, actualKg: 9999, forecastBatches: 200 }] } };
  assert.equal(mapDemand(payload, week).kg, 150);
  assert.equal(mapDemand(payload, "2026-11-09").kg, null);
  assert.equal(mapDemand(payload, "2026-11-09").status, "unavailable");
  assert.equal(mapDemand({ state: { recipes: [], demand: payload.state.demand } }, week).kg, null);
});

test("packing adapter retains measured kg/hour and flags incomplete timing coverage", () => {
  const result = mapPacking({ weekStart: week, now: 1793577600000, report: { packedKg: 250, kgPerHour: 50, kgPerPackingDay: 125, timedCoveragePercent: 40 } }, week);
  assert.equal(result.kgPerHour, 50);
  assert.equal(result.kgPerDay, 125);
  assert.equal(result.status, "partial");
  assert.throws(() => mapPacking({ weekStart: "2026-10-26", report: {} }, week));
});

test("zero timing coverage leaves packing speed unknown", () => {
  const result = mapPacking({weekStart:"2026-11-02", now:Date.now(), report:{packedKg:100, timedPackedKg:0, kgPerHour:0, kgPerPackingDay:50, timedCoveragePercent:0}}, "2026-11-02");
  assert.equal(result.kgPerHour, null);
  assert.equal(result.kgPerDay, 50);
  assert.equal(result.status, "partial");
});

test("unconfirmed wholesale plans leave order totals unknown", () => {
  const result = mapDispatchOrders({schemaVersion:"1.0",weekStart:"2026-11-02",planStatus:"inherited-plan",wholesale:{orders:null,clients:null},issues:{count:0,items:[]}}, "2026-11-02");
  assert.equal(result.wholesale.orders, null);
  assert.match(result.wholesale.note, /Confirm this week's/);
});

test("delivery metrics require matching weekly summary, preserve untimed orders and provisional counts", () => {
  const payload = { schemaVersion: "1.0", weekStart: week, planStatus: "inherited-plan", sourceUpdatedAt: "2026-11-03T01:00:00Z", wholesale: { orders: 12, clients: 10 }, issues: { count: 1, items: [{ label: "Partial handover", status: "Open" }] }, delivery: { shifts: 3, completedShifts: 2, orders: 8, avgMinutes: null, totalMinutes: null } };
  const result = mapDeliverySummary(payload, week);
  assert.equal(result.shifts, 3);
  assert.equal(result.avgMinutes, null);
  assert.equal(result.status, "partial");
  const { wholesale, issues } = mapDispatchOrders(payload, week);
  assert.equal(wholesale.orders, 12);
  assert.equal(wholesale.value, null);
  assert.equal(wholesale.status, "partial");
  assert.equal(issues, undefined);
  assert.match(result.note, /1 delivery exceptions/);
  assert.equal(mapDispatchOrders({ ...payload, planStatus: "confirmed-weekly-import" }, week).wholesale.status, "partial");
  assert.throws(() => mapDeliverySummary({ ...payload, weekStart: "2026-10-26" }, week));
  assert.throws(() => mapDeliverySummary({ ...payload, planStatus: "missing" }, week));
  assert.throws(() => mapDeliverySummary({ schemaVersion: "1.0", sourceSystem: "bmc-dispatch", weekStart: week, counts: { remainingWeek: 4 } }, week));
});

test("source fetch prevents redirects, arbitrary credential destinations and oversized responses", async () => {
  let called = false;
  await assert.rejects(fetchSourceJson("https://example.com/api", { Cookie: "secret" }, async () => { called = true; }), /not allowed/);
  assert.equal(called, false);
  await assert.rejects(fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/inventory`, {}, async () => new Response(null, { status: 302, headers: { location: "https://example.com" } })), /direct connection/);
  await assert.rejects(fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/inventory`, {}, async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "2000001" } })), /too large/);
  await assert.rejects(fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/inventory`, {}, async () => { throw new Error("cookie secret-value in a network error"); }), error => !error.message.includes("secret-value"));
});

test("revoked Stock Take sessions fail the entire dashboard even when Green can be read", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes("/api/inventory") ? json({}, 401) : json({ state: { stockLots: [] } });
  try {
    await assert.rejects(collectDashboard({ weekStart: week, stockroomCookie: "bmc_stockroom_session=revoked", password: "do-not-return", env: {} }), error => error.status === 401 && !error.message.includes("do-not-return"));
  } finally { globalThis.fetch = originalFetch; }
});

test("source failures remain unavailable and the operations dashboard reads roast output only from Cropster", async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/api/inventory") return json({ items: [{ category: "Packaging", stock: 4, unitCost: 2, stockUnitQuantity: 1 }] });
    return json({}, 503);
  };
  try {
    const result = await collectDashboard({ weekStart: week, stockroomCookie: "bmc_stockroom_session=valid", env: {} });
    assert.equal(result.metrics.nonCoffee.value, 8);
    assert.equal(result.metrics.roasted.kg, null);
    assert.equal(result.metrics.roasted.source, "Cropster");
    assert.equal(result.metrics.roastingRate.weekKg, null);
    assert.equal(result.metrics.green.kg, null);
    assert.equal(result.metrics.green.source, "Cropster");
    assert.equal(result.metrics.delivery.shifts, null);
    assert.equal(result.metrics.online.orders, null);
    assert.equal(result.metrics.issues.count, null);
    assert.equal(result.metrics.issues.note, "Choose the customer issue source.");
    assert.equal(result.metrics.online.note, "Choose the online order source.");
    assert.equal(result.metrics.demand.status, "unavailable");
    assert.equal(JSON.stringify(result).includes("bmc_stockroom_session"), false);
    assert.equal(paths.some(path => ["/api/coffee", "/api/coffee/production", "/api/roaster"].includes(path)), false);
  } finally { globalThis.fetch = originalFetch; }
});
