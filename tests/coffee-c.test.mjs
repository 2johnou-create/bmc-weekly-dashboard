import assert from "node:assert/strict";
import test from "node:test";
import { readCoffeeC } from "../worker/coffee-c.js";

const quotesUrl = "https://www.ice.com/marketdata/api/productguide/charting/contract-data?productId=580&hubId=728&mode=2";
const expiryUrl = "https://www.ice.com/api/productguide/spec/15/expiry/csv";
const expiry = '"CONTRACT SYMBOL","FTD","LTD","FND","LND","FDD","LDD","FSD"\n"=""Dec26""","01/02/2024","12/18/2026","11/19/2026","12/21/2026","12/01/2026","12/31/2026","12/21/2026",\n"=""Mar27""","04/01/2024","03/18/2027","02/18/2027","03/19/2027","03/01/2027","03/31/2027","03/19/2027",\n';
const now = new Date("2026-11-18T19:00:00Z");
const quote = { marketId: 12345, marketStrip: "Dec26", lastPrice: 123.45, lastTime: "11/18/2026 06:29 PM GMT", change: -1.25 };

function fixture(rows = [quote], overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(options.headers), ["Accept"]);
    if (url === expiryUrl) return new Response(expiry, { headers: { "content-type": "text/csv" } });
    assert.equal(url, quotesUrl);
    return overrides.response?.() ?? Response.json(rows);
  };
  return { fetcher, calls };
}

test("ICE Coffee C retains its exact contract, cents-per-pound unit and delayed source timestamp", async () => {
  const { fetcher, calls } = fixture();
  const result = await readCoffeeC({ now, fetcher });
  assert.equal(result.status, "delayed");
  assert.equal(result.price, quote.lastPrice);
  assert.equal(result.currency, "USD");
  assert.equal(result.unit, "US¢/lb");
  assert.equal(result.asOf, "2026-11-18T18:29:00.000Z");
  assert.equal(result.contract, "KCZ26 · Dec 2026");
  assert.equal(result.delayMinutes, 15);
  assert.equal(result.marketStatus, "unknown");
  assert.equal(result.change, null);
  assert.equal(result.changePercent, -1.25);
  assert.equal(result.sourceUrl, "https://www.ice.com/products/15/Coffee-C-Futures/data?marketId=12345");
  assert.match(result.note, /delayed at least 15 minutes/);
  assert.equal(calls.length, 2);
});

test("the benchmark rolls after the front contract's New York last-trading day", async () => {
  const rows = [
    { ...quote, lastTime: "12/18/2026 06:29 PM GMT" },
    { ...quote, marketId: 54321, marketStrip: "Mar27", lastPrice: 120, lastTime: "12/18/2026 06:29 PM GMT" },
  ];
  const { fetcher } = fixture(rows);
  const before = await readCoffeeC({ now: new Date("2026-12-19T04:59:50Z"), fetcher });
  assert.equal(before.contract, "KCZ26 · Dec 2026");
  const after = await readCoffeeC({ now: new Date("2026-12-19T05:00:10Z"), fetcher });
  assert.equal(after.contract, "KCH27 · Mar 2027");
  assert.equal(after.price, 120);
});

test("old quotes remain visibly stale and a failed refresh cannot look current", async () => {
  let failure = false;
  const { fetcher, calls } = fixture([quote], { response: () => failure ? Response.json({}, { status: 503 }) : Response.json([quote]) });
  const oldNow = new Date("2026-11-20T19:00:00Z");
  const first = await readCoffeeC({ now: oldNow, fetcher });
  assert.equal(first.status, "stale");
  assert.equal(first.asOf, "2026-11-18T18:29:00.000Z");
  const cached = await readCoffeeC({ now: new Date(oldNow.getTime() + 10_000), fetcher });
  assert.equal(cached.status, "stale");
  assert.equal(calls.length, 2);
  failure = true;
  const failed = await readCoffeeC({ now: new Date(oldNow.getTime() + 61_000), fetcher });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.price, null);
  assert.equal(failed.asOf, null);
});

test("missing, inconsistent and oversized source data never produce a quote", async () => {
  for (const rows of [[], [quote, quote], [{ ...quote, lastPrice: "123.45" }], [{ ...quote, lastPrice: -1 }], [{ ...quote, lastTime: "11/31/2026 06:29 PM GMT" }], [{ ...quote, lastTime: "11/19/2026 06:29 PM GMT" }], [{ ...quote, marketStrip: "Mar27" }]]) {
    const { fetcher } = fixture(rows);
    const result = await readCoffeeC({ now, fetcher });
    assert.equal(result.price, null);
    assert.equal(result.status, "unavailable");
  }
  for (const response of [
    () => new Response(null, { status: 302, headers: { Location: "https://other.test" } }),
    () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "128001" } }),
    () => new Response(" ".repeat(128001), { headers: { "content-type": "application/json" } }),
  ]) {
    const { fetcher } = fixture([quote], { response });
    assert.equal((await readCoffeeC({ now, fetcher })).price, null);
  }
});
