import assert from "node:assert/strict";
import test from "node:test";
import { parseExpenses, readExpenses, saveExpenseReading, validateExpenseReading } from "../worker/expenses.js";
import { callGoogleBridge, isGoogleBridgeConfigured } from "../worker/google-bridge.js";

const now = new Date("2026-11-18T21:00:00Z");
const weekStart = "2026-11-16";
const bridgeUrl = "https://script.google.com/macros/s/fixture_deployment_identifier_1234567890/exec";
const env = { GOOGLE_BRIDGE_URL: bridgeUrl, GOOGLE_BRIDGE_TOKEN: "fixture-token-only-32-characters-long" };
function fixture() {
  const values = Array.from({ length: 36 }, () => Array(23).fill(""));
  const numericValues = structuredClone(values);
  values[0][16] = "9/11/2026";
  values[0][17] = "16/11/2026";
  values[0][18] = "23/11/2026";
  // A Sheets serial can encode a different date under a copied US format.
  // The displayed DD/MM header, rather than this serial, is authoritative.
  numericValues[0][16] = 12345;
  values[4][1] = "Packaging";
  values[5][1] = "Supplies";
  values[4][16] = "$10.00";
  numericValues[4][16] = 10;
  values[35][16] = "$10.00";
  numericValues[35][16] = 10;
  values[4][17] = "$12.50";
  numericValues[4][17] = 12.5;
  values[5][17] = "$7.50";
  numericValues[5][17] = 7.5;
  values[35][17] = "$20.00";
  numericValues[35][17] = 20;
  values[35][18] = "$0.00";
  numericValues[35][18] = 0;
  return { values, numericValues, asOf: now.toISOString(), sheetName: "Sheet1", range: "A1:W36" };
}

function database(source = fixture(), capturedAt = now.getTime()) {
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...args) {
        calls.push({ sql, args });
        return { async first() { return source ? { payload_json: JSON.stringify({ ...source, weekStart }), captured_at: capturedAt } : null; } };
      } };
    },
  };
  return { db, calls };
}

test("expenses choose the exact displayed Monday and retain the verified total and item detail", () => {
  const result = parseExpenses(fixture(), { start: weekStart });
  assert.equal(result.status, "live");
  assert.equal(result.value, 20);
  assert.equal(result.currency, null);
  assert.equal(result.currencySymbol, "$");
  assert.equal(result.weekStart, weekStart);
  assert.equal(result.sourceCell, "R36");
  assert.equal(result.sheetName, "Sheet1");
  assert.equal(result.asOf, now.toISOString());
  assert.deepEqual(result.items, [{ name: "Packaging", value: 12.5 }, { name: "Supplies", value: 7.5 }]);
  assert.equal(parseExpenses(fixture(), "2026-11-09").value, 10);
});

test("displayed day/month dates override raw serials and yearless dates need a verified source year", () => {
  const source = fixture();
  source.values[0][17] = "2/11/2026";
  source.numericValues[0][17] = 99;
  assert.equal(parseExpenses(source, "2026-11-02").value, 20);
  source.values[0][17] = "2/11";
  assert.equal(parseExpenses(source, "2026-11-02").value, 20);
  source.values[0][17] = "3/11";
  assert.equal(parseExpenses(source, "2025-11-03").status, "unavailable");
  source.values[0][17] = "9/11/2026";
  assert.equal(parseExpenses(source, "2026-11-09").status, "unavailable");
});

test("a blank prepared column's formula zero is missing while an entered zero is a valid reading", () => {
  const source = fixture();
  assert.equal(parseExpenses(source, "2026-11-23").value, null);
  assert.match(parseExpenses(source, "2026-11-23").note, /No expenses have been entered/);
  source.values[4][18] = "$0.00";
  source.numericValues[4][18] = 0;
  const result = parseExpenses(source, "2026-11-23");
  assert.equal(result.status, "live");
  assert.equal(result.value, 0);
  assert.deepEqual(result.items, [{ name: "Packaging", value: 0 }]);
});

test("totals must match entered lines and malformed amounts cannot silently become zero", () => {
  const mismatch = fixture();
  mismatch.numericValues[35][17] = 21;
  assert.match(parseExpenses(mismatch, weekStart).note, /does not match/);
  for (const invalid of ["#REF!", "unknown", null, Infinity]) {
    const source = fixture();
    source.numericValues[35][17] = invalid;
    assert.equal(parseExpenses(source, weekStart).value, null);
  }
  const formatted = fixture();
  delete formatted.numericValues;
  assert.equal(parseExpenses(formatted, weekStart).value, 20);
  formatted.values[4][17] = "$1,200.25";
  formatted.values[5][17] = "-200.25";
  formatted.values[35][17] = "$1,000.00";
  assert.equal(parseExpenses(formatted, weekStart).value, 1000);
});

test("snapshot validation bounds the fixed range, dates, payload and known week data", () => {
  const source = fixture();
  const valid = validateExpenseReading({ ...source, weekStart }, now);
  assert.equal(valid.weekStart, weekStart);
  for (const input of [
    { ...source, weekStart: "2026-11-17" },
    { ...source, weekStart, sheetName: "Other" },
    { ...source, weekStart, range: "A1:Z1000" },
    { ...source, weekStart, token: "not-an-accepted-field" },
    { ...source, weekStart, asOf: "2026-11-19T21:00:00Z" },
    { ...source, weekStart: "2026-11-23" },
    { ...source, weekStart, values: [] },
  ]) assert.throws(() => validateExpenseReading(input, now));
});

test("snapshots read only the requested week and advertise recorded or stale evidence", async () => {
  const { db, calls } = database();
  const result = await readExpenses({ db, env: {}, week: { start: weekStart }, now });
  assert.equal(result.status, "recorded");
  assert.equal(result.value, 20);
  assert.match(result.note, /does not refresh automatically/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [weekStart]);
  const older = fixture();
  older.asOf = "2026-11-17T19:00:00Z";
  const oldDb = database(older).db;
  assert.equal((await readExpenses({ db: oldDb, week: weekStart, now })).status, "stale");
  assert.equal((await readExpenses({ db: database(null).db, week: weekStart, now })).value, null);
});

test("live expense reads are uncached and manual refresh adds no unsupported bridge fields", async () => {
  let calls = 0;
  const fetcher = async (target, options) => {
    calls++;
    assert.equal(target, bridgeUrl);
    const body = JSON.parse(options.body);
    assert.equal(body.action, "expenses");
    assert.equal(body.token, env.GOOGLE_BRIDGE_TOKEN);
    assert.equal(body.fresh, undefined);
    const source = fixture();
    if (calls === 2) {
      source.numericValues[5][17] = 17.5;
      source.numericValues[35][17] = 30;
    }
    return Response.json(source);
  };
  assert.equal((await readExpenses({ env, week: weekStart, now, fetcher })).value, 20);
  const refreshed = await readExpenses({ env, week: weekStart, now, fetcher, fresh: true });
  assert.equal(refreshed.value, 30);
  assert.equal(refreshed.status, "live");
  assert.ok(!JSON.stringify(refreshed).includes(env.GOOGLE_BRIDGE_TOKEN));
  assert.ok(!("values" in refreshed));
});

test("transport failure falls back honestly, but a live blank selected week never revives old data", async () => {
  const { db } = database();
  const fallback = await readExpenses({ db, env, week: weekStart, now, fetcher: async () => { throw new Error("network"); } });
  assert.equal(fallback.status, "recorded");
  assert.match(fallback.note, /live expense sheet could not be read/);
  const missing = await readExpenses({ db, env, week: "2026-11-23", now, fetcher: async () => Response.json(fixture()) });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.value, null);
});

test("snapshot saves parameterize verified source grids and refuse an older captured reading", async () => {
  let captured;
  const db = { prepare(sql) {
    assert.match(sql, /excluded\.captured_at >= warehouse_expense_readings\.captured_at/);
    return { bind(...args) { captured = args; return { async first() { return { week_start: args[0], captured_at: args[2] }; } }; } };
  } };
  const result = await saveExpenseReading(db, { ...fixture(), weekStart }, now);
  assert.equal(result.ok, true);
  assert.equal(result.weekStart, weekStart);
  assert.equal(result.asOf, now.toISOString());
  assert.equal(result.expenses.status, "recorded");
  assert.equal(result.expenses.value, 20);
  assert.equal(captured[0], weekStart);
  assert.equal(JSON.parse(captured[1]).weekStart, weekStart);
  assert.equal(captured[2], now.getTime());
  const conflict = { prepare() { return { bind() { return { async first() { return null; } }; } }; } };
  await assert.rejects(saveExpenseReading(conflict, { ...fixture(), weekStart }, now), error => error.status === 409);
});

test("Google ContentService redirect uses a separate GET without token, body or headers", async () => {
  let calls = 0;
  const fetcher = async (target, options) => {
    calls++;
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, "manual");
    if (calls === 1) {
      assert.equal(target, bridgeUrl);
      assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).token, env.GOOGLE_BRIDGE_TOKEN);
      return new Response(null, { status: 302, headers: { Location: "https://script.googleusercontent.com/macros/echo?user_content_key=fixture" } });
    }
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers, undefined);
    return Response.json({ ok: true });
  };
  assert.deepEqual(await callGoogleBridge(env, { action: "expenses" }, { fetcher }), { ok: true });
  assert.equal(calls, 2);
});

test("bridge configuration and redirects are tightly bounded and errors contain no token", async () => {
  await assert.rejects(callGoogleBridge(env, {action:"message"}, {fetcher:()=>assert.fail("Removed message actions must not contact Google")}));
  assert.equal(isGoogleBridgeConfigured(env), true);
  for (const config of [
    { ...env, GOOGLE_BRIDGE_TOKEN: "short" },
    { ...env, GOOGLE_BRIDGE_URL: "https://elsewhere.test/macros/s/fixture/exec" },
    { ...env, GOOGLE_BRIDGE_URL: `${bridgeUrl}?token=wrong` },
    { ...env, GOOGLE_BRIDGE_URL: bridgeUrl.replace("/exec", "/dev") },
  ]) assert.equal(isGoogleBridgeConfigured(config), false);
  for (const location of ["https://elsewhere.test/", "http://script.googleusercontent.com/", "https://script.googleusercontent.com.evil.test/", "https://user:password@script.googleusercontent.com/"]) {
    let calls = 0;
    await assert.rejects(callGoogleBridge(env, { action: "expenses" }, { fetcher: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { Location: location } });
    } }), error => !error.message.includes(env.GOOGLE_BRIDGE_TOKEN));
    assert.equal(calls, 1);
  }
  for (const response of [
    () => new Response("not JSON", { headers: { "content-type": "text/html" } }),
    () => new Response(" ".repeat(128001), { headers: { "content-type": "application/json" } }),
    () => Response.json({ error: "server error" }, { status: 503 }),
  ]) await assert.rejects(callGoogleBridge(env, { action: "expenses" }, { fetcher: async () => response() }));
});
