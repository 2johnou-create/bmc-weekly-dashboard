import assert from "node:assert/strict";
import test from "node:test";
import { readDispatchStatus } from "../worker/weekly-report.js";

const now = new Date("2026-11-15T02:00:00Z");
const weekStart = "2026-11-09";
const env = {
  DASHBOARD_DISPATCH_URL: "https://bmc-dispatch-delivery.misty-jelly-1931.chatgpt.site/api/integrations/dashboard/weekly?through=friday",
  DISPATCH_READ_TOKEN: "test-only-dispatch-token",
};
const source = (extra = {}) => ({
  schemaVersion: "1.0", sourceSystem: "bmc-dispatch", weekStart,
  sourceUpdatedAt: "2026-11-15T01:59:00.000Z", planStatus: "confirmed-weekly-import",
  wholesale: { orders: 10, completedOrders: 7, pendingOrders: 3 },
  delivery: { deliveredOrders: 9 },
  clientCompletions: {
    count: 1, items: [{ clientId: "carryover-client", name: "Carryover Cafe", completedAt: "2026-11-15T00:00:00.000Z" }],
    latestCompletedAt: "2026-11-15T00:00:00.000Z", itemLimit: 50, truncated: false, status: "live", note: "",
  },
  ...extra,
});

test("Dispatch status makes exactly one no-store read and omits all prior-week fields", async () => {
  const calls = [];
  const report = await readDispatchStatus({ weekStart, env, now, fetcher: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(source());
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("week"), weekStart);
  assert.equal(calls[0].url.searchParams.has("through"), false);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-only-dispatch-token");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(report.weekStart, weekStart);
  assert.equal(report.generatedAt, now.toISOString());
  assert.equal(report.wholesale.orders, 10);
  assert.equal(report.wholesale.done, 7);
  assert.equal(report.wholesale.pending, 3);
  assert.equal(report.wholesale.completed, 9);
  assert.equal(report.wholesale.status, "live");
  assert.equal(report.wholesale.asOf, "2026-11-15T01:59:00.000Z");
  assert.equal(report.wholesale.completedClientCount, 1);
  assert.match(report.wholesale.completedClients[0].name, /Carryover Cafe/);
  assert.ok(!Object.keys(report.wholesale).some(key => key.startsWith("previous")));
  assert.doesNotMatch(report.wholesale.note, /previous week/);
  assert.ok(!JSON.stringify(report).includes(env.DISPATCH_READ_TOKEN));
});

test("historic status requests the same Friday cutoff as the complete report", async () => {
  const calls = [];
  const result = await readDispatchStatus({ weekStart, env, now: new Date("2026-11-18T03:00:00Z"), fetcher: async url => {
    calls.push(new URL(url));
    return Response.json(source({ periodEnd: "2026-11-13", clientCompletions: {
      count: 0, items: [], latestCompletedAt: null, itemLimit: 50, truncated: false, status: "live", note: "",
    } }));
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("through"), "friday");
  assert.equal(result.wholesale.done, 7);
  assert.equal(result.wholesale.completedClientCount, 0);
});

test("upstream failure, mismatched identity or cutoff clears current data to unknown without invented client names", async () => {
  for (const fetcher of [
    async () => { throw new Error("https://private.test?token=secret"); },
    async () => Response.json({ error: "private source information" }, { status: 401 }),
    async () => Response.json(source({ weekStart: "2026-11-02" })),
    async () => Response.json(source({ sourceSystem: "other-system" })),
    async () => Response.json(source({ periodEnd: "2026-11-13" })),
  ]) {
    const result = await readDispatchStatus({ weekStart, env, now, fetcher });
    assert.equal(result.wholesale.orders, null);
    assert.equal(result.wholesale.done, null);
    assert.equal(result.wholesale.completedClientCount, null);
    assert.equal(result.wholesale.completedClientsStatus, "unavailable");
    assert.deepEqual(result.wholesale.completedClients, []);
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.ok(!Object.keys(result.wholesale).some(key => key.startsWith("previous")));
  }
});

test("invalid weeks and unconfigured or wrong-host sources never trigger an upstream read", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("unexpected request"); };
  for (const selected of ["2026-11-10", "2026-11-16", "2026-02-30"]) {
    await assert.rejects(readDispatchStatus({ weekStart: selected, env, now, fetcher }), /Choose/);
  }
  for (const config of [{}, { ...env, DASHBOARD_DISPATCH_URL: "https://untrusted.test/api/integrations/dashboard/weekly" }]) {
    const result = await readDispatchStatus({ weekStart, env: config, now, fetcher });
    assert.equal(result.wholesale.completedClientCount, null);
  }
  assert.equal(calls, 0);
});
