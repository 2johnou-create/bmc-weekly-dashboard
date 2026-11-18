import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { collectWeeklyReport, weeklyDemandComparison, wholesaleDeliveryComparison } from "../worker/weekly-report.js";

const week = "2026-11-09";
const now = new Date("2026-11-15T02:00:00Z");

test("the report leaves production blank when Cropster is disconnected", async () => {
  const reads = [];
  const report = await collectWeeklyReport({ weekStart: week, stockroomCookie: "stockroom-test-session", env: {}, now, fetcher: async address => {
    const path = new URL(address).pathname;
    reads.push(path);
    if (path === "/api/inventory") return Response.json({ items: [] });
    return Response.json({}, { status: 503 });
  } });
  const production = report.metrics.production;
  assert.equal(production.source, "Cropster");
  assert.equal(production.roastedKg, null);
  assert.equal(production.previousRoastedKg, null);
  assert.equal(production.roastedChangePercent, null);
  assert.equal(production.totalKg, null);
  assert.equal(production.changePercent, null);
  assert.equal(production.value, null);
  assert.equal(production.previousValue, null);
  assert.equal(production.valueChangePercent, null);
  assert.equal(reads.some(path => path === "/api/coffee" || path === "/api/coffee/production"), false);
});

test("Dispatch handovers never populate the confirmed order fields", () => {
  const metric = wholesaleDeliveryComparison(
    { planStatus: "inherited-plan", wholesale: { orders: 50 }, delivery: { deliveredOrders: 12 } },
    { planStatus: "confirmed-weekly-import", wholesale: { orders: 30, clients: null }, delivery: { deliveredOrders: 25 } },
  );
  assert.equal(metric.orders, null);
  assert.equal(metric.completed, 12);
  assert.equal(metric.done, null);
  assert.equal(metric.pending, null);
  assert.equal(metric.previousOrders, 30);
});

test("Dispatch done and pending reconcile with the confirmed primary order count", () => {
  const previous = { planStatus: "confirmed-weekly-import", wholesale: { orders: 30, completedOrders: 27, pendingOrders: 3 } };
  const current = { planStatus: "confirmed-weekly-import", wholesale: { orders: 40, completedOrders: 12, pendingOrders: 28 }, delivery: { deliveredOrders: 50 } };
  const metric = wholesaleDeliveryComparison(current, previous);
  assert.equal(metric.orders, 40);
  assert.equal(metric.done, 12);
  assert.equal(metric.pending, 28);
  assert.equal(metric.previousDone, 27);
  assert.equal(metric.previousPending, 3);
  assert.equal(metric.status, "live");

  const inherited = wholesaleDeliveryComparison({ ...current, planStatus: "inherited-plan" }, previous);
  assert.equal(inherited.done, 12);
  assert.equal(inherited.orders, null);
  assert.equal(inherited.pending, null);
  assert.equal(inherited.status, "partial");

  const inconsistent = wholesaleDeliveryComparison({ ...current, wholesale: { ...current.wholesale, pendingOrders: 29 } }, previous);
  assert.equal(inconsistent.orders, 40);
  assert.equal(inconsistent.done, null);
  assert.equal(inconsistent.pending, null);
});

test("demand uses the previous verified tally as its baseline", () => {
  const tally = kg => ({ status: "live", kg });
  assert.equal(weeklyDemandComparison(tally(110), tally(100)).changePercent, 10);
  assert.equal(weeklyDemandComparison(tally(75), tally(100)).changePercent, -25);
  assert.equal(weeklyDemandComparison(tally(0), tally(100)).changePercent, -100);
  assert.equal(weeklyDemandComparison(tally(100), tally(0)).changePercent, null);
  assert.equal(weeklyDemandComparison(tally(100), null).changePercent, null);
  assert.equal(weeklyDemandComparison(tally(100), { kg: 70, status: "partial" }).status, "partial");
});

test("the landing report reads protected Stockroom totals and requires a Cropster reading for green stock", async () => {
  const stockroomCookie = "stockroom-test-session";
  const greenPassword = "green-password-test";
  let greenForecastRead = false;
  const report = await collectWeeklyReport({ weekStart: week, stockroomCookie, env: { SOURCE_GREEN_PASSWORD: greenPassword }, now, fetcher: async (address, { headers }) => {
    const { pathname } = new URL(address);
    if (pathname === "/api/inventory") {
      assert.equal(headers.Cookie, stockroomCookie);
      assert.equal(headers["x-green-password"], undefined);
      return Response.json({ items: [{ category: "Packaging", stock: 4, unitCost: 2 }] });
    }
    if (pathname === "/api/roaster") {
      greenForecastRead = true;
    }
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers["x-green-password"], undefined);
    return Response.json({}, { status: 503 });
  } });
  assert.deepEqual(Object.keys(report.metrics), ["demand", "production", "green", "stock", "wholesale"]);
  assert.equal(greenForecastRead, false);
  assert.equal(report.metrics.green.kg, null);
  assert.equal(report.metrics.green.value, null);
  assert.equal(report.metrics.green.source, "Cropster");
  assert.equal(report.metrics.stock.value, 8);
  assert.deepEqual(report.metrics.stock.categories, [{ name: "Packaging", itemCount: 1, value: 8, unpricedItems: 0 }]);
  assert.ok(!JSON.stringify(report).includes(greenPassword));
  assert.ok(!JSON.stringify(report).includes(stockroomCookie));
});

test("weekly report checks the Stockroom session before reading the other sources", async () => {
  const url = "https://dashboard.test/api/weekly-report";
  const env = { SESSION_SECRET: "test-secret-1234567890-test-secret-1234567890" };
  const request = new Request(url);
  assert.equal((await worker.fetch(request, env)).status, 401);
  const cookie = (await sealSession(request, env, "bmc_stockroom_session=source-session-for-test")).split(";")[0];
  const authenticated = new Request(url + "?week=2026-11-10", { headers: { Cookie: cookie } });
  assert.equal((await worker.fetch(authenticated, env)).status, 400);

  const reads = [];
  await assert.rejects(collectWeeklyReport({ weekStart: week, stockroomCookie: cookie, env, now, fetcher: async address => {
    reads.push(new URL(address).pathname);
    return Response.json({}, { status: 401 });
  } }), error => error.status === 401);
  assert.deepEqual(reads, ["/api/inventory"]);
});
