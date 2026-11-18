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
  assert.equal(metric.scheduledOrders, 40);
  assert.equal(metric.scheduledPendingOrders, 28);
  assert.equal(metric.provisional, false);
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

test("an inherited Dispatch plan shows a reconciled full-week schedule as provisional", () => {
  const current = { planStatus: "inherited-plan", wholesale: {
    orders: null, pendingOrders: null, scheduledOrders: 25, scheduledPendingOrders: 17, completedOrders: 8,
  } };
  const metric = wholesaleDeliveryComparison(current, null);
  assert.equal(metric.orders, null);
  assert.equal(metric.pending, null);
  assert.equal(metric.scheduledOrders, 25);
  assert.equal(metric.scheduledPendingOrders, 17);
  assert.equal(metric.done, 8);
  assert.equal(metric.provisional, true);
  assert.match(metric.note, /entire Sydney week/);

  const broken = wholesaleDeliveryComparison({ ...current, wholesale: { ...current.wholesale, scheduledPendingOrders: 20 } }, null);
  assert.equal(broken.provisional, false);
  assert.equal(broken.scheduledOrders, null);
  assert.equal(broken.scheduledPendingOrders, null);
  assert.equal(broken.done, 8);

  const empty = wholesaleDeliveryComparison({ ...current, wholesale: { scheduledOrders: 0, scheduledPendingOrders: 0, completedOrders: 0 } }, null);
  assert.equal(empty.provisional, true);
  assert.equal(empty.scheduledOrders, 0);
  assert.equal(empty.scheduledPendingOrders, 0);
});

const clientCompletionSource = (clientCompletions, extra = {}) => ({
  weekStart: week,
  planStatus: "confirmed-weekly-import",
  wholesale: { orders: 3, completedOrders: 1, pendingOrders: 2, clients: 3 },
  clientCompletions: {
    count: 1,
    items: [{ clientId: "stable-client-1", name: "Test Coffee", completedAt: "2026-11-11T23:00:00.000Z" }],
    latestCompletedAt: "2026-11-11T23:00:00.000Z", itemLimit: 50, truncated: false, status: "live", note: "",
    ...clientCompletions,
  },
  ...extra,
});

test("completed clients use the dedicated completion feed without exposing source identifiers or contacts", () => {
  const source = clientCompletionSource({ items: [{
    clientId: "stable-client-1", name: "Test Coffee", completedAt: "2026-11-11T23:00:00.000Z",
    address: "private address", email: "private@example.test", completedOrders: 500,
  }] });
  const metric = wholesaleDeliveryComparison(source, null);
  assert.equal(metric.orders, 3);
  assert.equal(metric.done, 1);
  assert.equal(metric.completedClientCount, 1);
  assert.equal(metric.completedClientsStatus, "live");
  assert.deepEqual(metric.completedClients, [{ name: "Test Coffee", completedAt: "2026-11-11T23:00:00.000Z" }]);
  assert.equal(metric.completedClientsTruncated, false);
  assert.ok(!JSON.stringify(metric).includes("stable-client-1"));
  assert.ok(!JSON.stringify(metric).includes("private"));

  const withoutFeed = wholesaleDeliveryComparison({ ...source, clientCompletions: undefined }, null);
  assert.equal(withoutFeed.orders, 3);
  assert.equal(withoutFeed.done, 1);
  assert.equal(withoutFeed.completedClientCount, null);
  assert.equal(withoutFeed.completedClientsStatus, "unavailable");
  assert.deepEqual(withoutFeed.completedClients, []);
});

test("client counts retain known partial totals and distinguish a verified zero from unavailable", () => {
  const partial = wholesaleDeliveryComparison(clientCompletionSource({
    status: "partial", note: "Known completed clients only; an old handover date is missing.",
  }), null);
  assert.equal(partial.completedClientCount, 1);
  assert.equal(partial.completedClientsStatus, "partial");
  assert.match(partial.completedClientsNote, /Known completed clients/);
  const zero = wholesaleDeliveryComparison(clientCompletionSource({ count: 0, items: [], latestCompletedAt: null }), null);
  assert.equal(zero.completedClientCount, 0);
  assert.equal(zero.completedClientsStatus, "live");
  const unavailable = wholesaleDeliveryComparison(clientCompletionSource({ status: "unavailable", count: null }), null);
  assert.equal(unavailable.completedClientCount, null);
  assert.deepEqual(unavailable.completedClients, []);
});

test("the completed-client total can exceed the bounded detail list", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    clientId: `client-${index}`, name: `Coffee ${index}`, completedAt: "2026-11-12T01:00:00.000Z",
  }));
  const metric = wholesaleDeliveryComparison(clientCompletionSource({ count: 77, items, truncated: true }), null);
  assert.equal(metric.completedClientCount, 77);
  assert.equal(metric.completedClients.length, 50);
  assert.equal(metric.completedClientsTruncated, true);
  assert.equal(metric.completedClientsStatus, "live");
});

test("duplicate identities, unsafe names and out-of-period completions cannot become a trusted client count", () => {
  const valid = { clientId: "same-client", name: "Safe Cafe", completedAt: "2026-11-11T23:00:00.000Z" };
  for (const invalidItem of [
    { ...valid },
    { ...valid, clientId: "", name: "Other Cafe" },
    { ...valid, clientId: "next-client", name: "x".repeat(161) },
    { ...valid, clientId: "next-client", name: "Cafe\nprivate phone" },
    { ...valid, clientId: "next-client", completedAt: "2026-11-08T12:59:59.999Z" },
    { ...valid, clientId: "next-client", completedAt: "2026-11-15T13:00:00.000Z" },
    { ...valid, clientId: "next-client", completedAt: "2026-11-11" },
  ]) {
    const metric = wholesaleDeliveryComparison(clientCompletionSource({ count: 2, items: [valid, invalidItem] }), null);
    assert.equal(metric.completedClientCount, null);
    assert.equal(metric.completedClientsStatus, "partial");
    assert.deepEqual(metric.completedClients, [{ name: "Safe Cafe", completedAt: valid.completedAt }]);
    assert.match(metric.completedClientsNote, /total is unknown/);
  }
});

test("Sydney completion boundaries include Sunday for live weeks and stop on Friday for historical weeks", () => {
  const sunday = { clientId: "sun", name: "Sunday Cafe", completedAt: "2026-11-15T12:59:59.999Z" };
  const live = wholesaleDeliveryComparison(clientCompletionSource({ items: [sunday] }), null);
  assert.equal(live.completedClientCount, 1);
  const friday = wholesaleDeliveryComparison(clientCompletionSource({ items: [sunday] }, { periodEnd: "2026-11-13" }), null);
  assert.equal(friday.completedClientCount, null);
  assert.deepEqual(friday.completedClients, []);
  const start = { ...sunday, completedAt: "2026-11-08T13:00:00.000Z" };
  assert.equal(wholesaleDeliveryComparison(clientCompletionSource({ items: [start] }), null).completedClientCount, 1);
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

test("carry-forward uses current brown stock less Monday's completed output", () => {
  const current = { status: "live", kg: 550, brownOnHandKg: 310.8 };
  const previous = { status: "live", kg: 500, brownOnHandKg: 900 };
  const comparison = weeklyDemandComparison(current, previous, { kg: 150.42 });
  assert.equal(comparison.carryForwardKg, 160.38);
  assert.equal(comparison.changePercent, 10);
  assert.equal(comparison.brownOnHandKg, 310.8);
  assert.equal(comparison.mondayRoastedKg, 150.42);
  assert.equal(weeklyDemandComparison(current, previous, { kg: 310.8 }).carryForwardKg, 0);
  assert.equal(weeklyDemandComparison(current, previous, { kg: 313 }).carryForwardKg, -2.2);
  assert.equal(weeklyDemandComparison(current, previous, { kg: 0 }).carryForwardKg, 310.8);
  assert.equal(weeklyDemandComparison(current, previous).carryForwardKg, null);
  assert.equal(weeklyDemandComparison({ ...current, brownOnHandKg: null }, previous, { kg: 150.42 }).carryForwardKg, null);
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
      return Response.json({ items: [
        { category: "Packaging", stock: 4, unitCost: 2, updatedAt: "2026-07-01T00:00:00Z" },
        { category: "Packaging", stock: 3, unitCost: 1.03, updatedAt: "2026-11-14T00:00:00Z" },
      ] });
    }
    if (pathname === "/api/roaster") {
      greenForecastRead = true;
    }
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers["x-green-password"], undefined);
    return Response.json({}, { status: 503 });
  } });
  assert.deepEqual(Object.keys(report.metrics), ["demand", "production", "green", "stock", "wholesale", "expenses"]);
  assert.equal(greenForecastRead, false);
  assert.equal(report.metrics.green.kg, null);
  assert.equal(report.metrics.green.value, null);
  assert.equal(report.metrics.green.source, "Cropster");
  assert.equal(report.metrics.stock.value, 11.09);
  assert.deepEqual(report.metrics.stock.categories, [{ name: "Packaging", itemCount: 2, value: 11.09, unpricedItems: 0 }]);
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

test("past reports use a closed Friday span and require matching Dispatch cutoff data", async () => {
  const dispatch = [];
  const report = await collectWeeklyReport({
    weekStart: week,
    stockroomCookie: "local-test-session",
    now: new Date("2026-11-18T03:00:00Z"),
    env: {
      DASHBOARD_DISPATCH_URL: "https://bmc-dispatch-delivery.misty-jelly-1931.chatgpt.site/api/integrations/dashboard/weekly",
      DISPATCH_READ_TOKEN: "fixture-read-token",
    },
    fetcher: async address => {
      const url = new URL(address);
      if (url.pathname === "/api/inventory") return Response.json({ items: [{ id: "fixture", stock: 10, unitCost: 5 }] });
      if (url.pathname === "/api/integrations/dashboard/weekly") {
        const selected = url.searchParams.get("week");
        dispatch.push([selected, url.searchParams.get("through")]);
        return Response.json({
          sourceSystem: "bmc-dispatch", schemaVersion: "1.0", weekStart: selected,
          periodEnd: selected === week ? "2026-11-13" : "2026-11-08",
          planStatus: "confirmed-weekly-import",
          wholesale: { orders: 10, completedOrders: 7, pendingOrders: 3 },
          clientCompletions: {
            count: 1, items: [{ clientId: "carryover-client", name: "Friday Coffee", completedAt: "2026-11-13T03:00:00.000Z" }],
            latestCompletedAt: "2026-11-13T03:00:00.000Z", itemLimit: 50, truncated: false, status: "live", note: "",
          },
        });
      }
      return new Response(null, { status: 503 });
    },
  });
  assert.equal(report.week.end, "2026-11-13");
  assert.equal(report.week.label, "9 Nov – 13 Nov 2026");
  assert.deepEqual(dispatch.sort(), [["2026-11-02", "friday"], [week, "friday"]]);
  assert.equal(report.metrics.wholesale.done, 7);
  assert.equal(report.metrics.wholesale.completedClientCount, 1);
  assert.deepEqual(report.metrics.wholesale.completedClients, [{ name: "Friday Coffee", completedAt: "2026-11-13T03:00:00.000Z" }]);
  assert.equal(report.metrics.wholesale.previousOrders, null);
  assert.equal(report.metrics.green.snapshotDate, "2026-11-13");
  assert.equal(report.metrics.stock.value, null);
});
