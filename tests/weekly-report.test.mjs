import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { collectWeeklyReport, wholesaleDeliveryComparison } from "../worker/weekly-report.js";

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
  assert.equal(reads.some(path => path === "/api/coffee" || path === "/api/coffee/production"), false);
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
