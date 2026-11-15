import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { collectWeeklyReport, productionFromStockroom, wholesaleDeliveryComparison } from "../worker/weekly-report.js";

const week = "2026-11-09";
const now = new Date("2026-11-15T02:00:00Z");

test("production includes Friday and only compares like-for-like recorded roast totals", () => {
  const production = productionFromStockroom({ batches: [
    { roastDate: "2026-11-06", roastedKg: 80 },
    { roastDate: "2026-11-09", roastedKg: 50 },
    { roastDate: "2026-11-13", roastedKg: 70 },
    { roastDate: "2026-11-16", roastedKg: 100 },
  ] }, week);
  assert.equal(production.roastedKg, 120);
  assert.equal(production.previousRoastedKg, 80);
  assert.equal(production.roastedChangePercent, 50);
  assert.equal(production.totalKg, null);
  assert.equal(production.changePercent, null);
});

test("Dispatch handovers never populate the confirmed order fields", () => {
  const metric = wholesaleDeliveryComparison(
    { planStatus: "inherited-plan", wholesale: { orders: 50 }, delivery: { deliveredOrders: 12 } },
    { planStatus: "confirmed-weekly-import", wholesale: { orders: 30, clients: null }, delivery: { deliveredOrders: 25 } },
  );
  assert.equal(metric.orders, null);
  assert.equal(metric.completed, 12);
  assert.equal(metric.previousOrders, 30);
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
