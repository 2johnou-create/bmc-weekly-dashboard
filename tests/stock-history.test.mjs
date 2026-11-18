import assert from "node:assert/strict";
import test from "node:test";
import { readFridayStock, readStockHistory, stockMonthEnds } from "../worker/stock-history.js";

const now = new Date("2026-11-15T01:00:00.000Z");
const header = "Record Type,Date,Entity Type,Entity / SKU,Change Qty,Result Qty,Reason,Roasted KG,Remaining KG,Packed Qty,Packed KG,Notes,Recorded At";
const cookie = "stockroom_admin_session=synthetic-session";

function movement(id, delta, result, timestamp, entity = "inventory") {
  return `Stock movement,2026-01-01,${entity},${id},${delta},${result},stocktake,,,,,"a quoted, multiline\nstocktake remark",${timestamp}`;
}

function reportFetcher(rowsByMonth, seen = []) {
  return async (url, options) => {
    const address = new URL(url);
    assert.equal(address.origin, "https://bmc-stockroom.misty-jelly-1931.chatgpt.site");
    assert.equal(address.pathname, "/api/admin/export/monthly");
    assert.equal(options.headers.Cookie, cookie);
    assert.equal(options.redirect, "manual");
    const month = address.searchParams.get("month");
    seen.push(month);
    if (rowsByMonth[month] === null) return new Response("Unavailable", { status: 503 });
    const body = [header, ...(rowsByMonth[month] || [])].join("\r\n");
    return new Response("\uFEFF" + body, { headers: { "content-type": "text/csv; charset=utf-8" } });
  };
}

test("last three completed months follow Sydney's date and roll across December", () => {
  assert.deepEqual(stockMonthEnds(now), ["2026-10-31", "2026-09-30", "2026-08-31"]);
  assert.deepEqual(stockMonthEnds(new Date("2026-12-31T13:00:00.000Z")), ["2026-12-31", "2026-11-30", "2026-10-31"]);
});

test("stock balances use Sydney's close, not the UTC month or event-date label", async () => {
  const reports = {
    "2026-08": [
      movement("cups", 2, 7, "2026-08-31T14:00:00.000Z"), // First instant of Sep 1 in Sydney.
    ],
    "2026-09": [
      movement("cups", 1, 8, "2026-09-30T13:59:59.999Z"), // Last instant of Sep 30 in Sydney.
      movement("cups", -2, 6, "2026-09-30T14:00:00.000Z"),
    ],
    "2026-10": [
      movement("cups", 1, 7, "2026-10-31T12:59:59.999Z"), // DST, one hour earlier in UTC.
      movement("cups", 3, 10, "2026-10-31T13:00:00.000Z"),
      movement("roast", 30, 500, "2026-10-31T14:00:00.000Z", "coffee"),
    ],
    "2026-11": [movement("box", 2, 2, "2026-11-01T03:00:00.000Z")],
  };
  const inventory = { items: [
    { id: "cups", stock: 10, unitCost: 0.2, stockUnitQuantity: 50 },
    { id: "box", stock: 2, unitCost: 60, category: "Packaging" },
  ] };
  const seen = [];
  const history = await readStockHistory({ inventory, stockroomCookie: cookie, now, fetcher: reportFetcher(reports, seen) });
  assert.deepEqual(seen.sort(), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(history.map(({ date, value, status }) => [date, value, status]), [
    ["2026-10-31", 70, "estimated"], ["2026-09-30", 80, "estimated"], ["2026-08-31", 50, "estimated"],
  ]);
  assert.match(history[0].note, /catalogue prices/);
  assert.doesNotMatch(JSON.stringify(history), /stocktake remark|cups|roast|synthetic/);
});

test("a failed monthly export leaves only dependent closes unavailable", async () => {
  const inventory = { items: [{ id: "coffee-bags", stock: 100, unitCost: 0.2 }] };
  const fetcher = reportFetcher({ "2026-09": null });
  const history = await readStockHistory({ inventory, stockroomCookie: cookie, now, fetcher });
  assert.deepEqual(history.map(row => [row.status, row.value]), [["estimated", 20], ["unavailable", null], ["unavailable", null]]);
});

test("movement mismatches and missing prices yield a known-value subtotal", async () => {
  const inventory = { items: [
    { id: "bags", stock: 20, unitCost: 3 },
    { id: "labels", stock: 15, unitCost: 1 },
    { id: "unpriced", stock: 4, unitCost: null },
  ] };
  const fetcher = reportFetcher({ "2026-11": [movement("labels", 3, 12, "2026-11-01T04:00:00.000Z")] });
  const history = await readStockHistory({ inventory, stockroomCookie: cookie, now, fetcher });
  assert.deepEqual(history.map(row => [row.status, row.value]), [["partial", 60], ["partial", 60], ["partial", 60]]);
  assert.match(history[0].note, /2 items need/);
});

test("reports read after the inventory snapshot cannot roll back a newer movement", async () => {
  const inventory = { items: [{ id: "bags", stock: 20, unitCost: 3, updatedAt: Date.parse("2026-11-01T04:00:00.000Z") }] };
  const fetcher = reportFetcher({ "2026-11": [
    movement("bags", 5, 20, "2026-11-01T04:00:00.000Z"),
    movement("bags", 3, 23, "2026-11-01T04:01:00.000Z"),
  ] });
  const history = await readStockHistory({ inventory, stockroomCookie: cookie, now, fetcher });
  assert.deepEqual(history.map(row => [row.status, row.value]), [["estimated", 45], ["estimated", 45], ["estimated", 45]]);
});

test("Friday stock rolls back movements after Sydney close and uses current catalogue prices and stock units", async () => {
  const date = "2026-10-30";
  const inventory = { items: [{ id: "cups", category: "Cups & Lids", stock: 10, unitCost: 0.2, stockUnitQuantity: 50, updatedAt: Date.parse("2026-11-01T00:00:00.005Z") }] };
  const reports = {
    "2026-10": [
      movement("cups", 1, 5, "2026-10-30T12:59:59.999Z"), // Friday's last millisecond in Sydney.
      movement("cups", 3, 8, "2026-10-30T13:00:00.000Z"),
      movement("cups", 4, 24, "2026-10-31T03:00:00.000Z", "coffee"),
    ],
    "2026-11": [
      movement("cups", 2, 10, "2026-11-01T00:00:00.005Z"),
      movement("cups", 6, 16, "2026-11-01T03:00:00.000Z"), // Newer than the current quantity anchor.
    ],
  };
  const seen = [];
  const stock = await readFridayStock({ date, inventory, stockroomCookie: cookie, now: new Date("2026-10-31T23:59:59.999Z"), fetcher: reportFetcher(reports, seen) });
  assert.equal(stock.snapshotDate, date);
  assert.equal(stock.status, "estimated");
  assert.equal(stock.value, 50);
  assert.deepEqual(stock.categories.map(({ name, value }) => ({ name, value })), [{ name: "Cups & Lids", value: 50 }]);
  assert.match(stock.note, /today's catalogue prices and stock units/);
  assert.deepEqual(seen.sort(), ["2026-10", "2026-11"], "include the UTC month reached by the saved current quantity");
  assert.doesNotMatch(JSON.stringify(stock), /stocktake remark|synthetic/);
});

test("Friday stock distinguishes an incomplete period from a known-value subtotal", async () => {
  const options = { date: "2026-11-13", inventory: { items: [{ id: "bags", stock: 20, unitCost: 3 }, { id: "unpriced", stock: 4, unitCost: null }] }, stockroomCookie: cookie, now };
  const missing = await readFridayStock({ ...options, fetcher: reportFetcher({ "2026-11": null }) });
  assert.equal(missing.value, null);
  assert.equal(missing.status, "unavailable");
  assert.match(missing.note, /incomplete/);

  const partial = await readFridayStock({ ...options, fetcher: reportFetcher({ "2026-11": [] }) });
  assert.equal(partial.value, 60);
  assert.equal(partial.unpricedItems, 1);
  assert.equal(partial.status, "partial");
  assert.match(partial.note, /Known-value subtotal/);

  const seen = [];
  const invalid = await readFridayStock({ ...options, date: "2026-11-12", fetcher: reportFetcher({}, seen) });
  assert.equal(invalid.value, null);
  assert.equal(invalid.status, "unavailable");
  assert.deepEqual(seen, []);
});
