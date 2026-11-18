import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { saveLabCropster } from "../worker/roastery-lab.js";
import { saveWeeklyNote } from "../worker/weekly-note.js";
import { collectWarehouse } from "../worker/warehouse-report.js";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";

const now = new Date("2026-11-19T03:00:00Z");
const weekStart = "2026-11-16";
const cookie = "bmc_stockroom_session=synthetic_warehouse_source_session";
const expiry = '"CONTRACT SYMBOL","FTD","LTD"\n"=""Dec26""","01/02/2024","12/18/2026"\n';

function purchaseWorkbook() {
  const cell = (address, value) => `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const headers = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"];
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="ORDER PLAN" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData>" + headers.map((title, index) => cell(String.fromCharCode(66 + index) + "1", title)).join("") +
      cell("B2", "Synthetic supplier") + cell("C2", "Example coffee") + cell("D2", "EST") + cell("E2", "2026-11-23") + '<c r="G2"><v>100</v></c></sheetData></worksheet>',
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
}

function sourceFetcher({ authorized = true, packingWeek = weekStart, coverage = 50, failure = false } = {}) {
  const calls = [];
  const fetcher = async (address, options) => {
    const url = new URL(address);
    calls.push(url);
    assert.equal(options.redirect, "manual");
    if (url.hostname === "bmc-stockroom.misty-jelly-1931.chatgpt.site") {
      assert.equal(options.headers.Cookie, cookie);
      assert.equal(options.headers.Origin, url.origin);
      if (url.pathname === "/api/inventory") return Response.json({ items: [{ category: "Packaging", stock: 4, unitCost: 2 }] }, { status: authorized ? 200 : 401 });
      assert.equal(url.pathname, "/api/coffee/packing-timer");
      assert.equal(url.searchParams.get("week"), weekStart);
      return Response.json({
        weekStart: packingWeek, now: now.getTime(), activeTimer: { operatorName: "PRIVATE_OPERATOR_NAME" },
        report: { packedKg: 200, kgPerHour: 50, kgPerPackingDay: 100, timedCoveragePercent: coverage },
      });
    }
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    if (failure) return Response.json({}, { status: 503 });
    if (url.hostname === "www.ice.com") {
      if (url.pathname.endsWith("/expiry/csv")) return new Response(expiry, { headers: { "Content-Type": "text/csv" } });
      return Response.json([{ marketStrip: "Dec26", marketId: 12345, lastPrice: 200, lastTime: "11/18/2026 06:29 PM GMT", change: 0 }]);
    }
    if (url.hostname === "docs.google.com" && url.pathname.includes("1q-R7UP0ilUTbWoXY87rpaMYIrxZGZ6cqoBQIUHBvrF8")) return new Response(purchaseWorkbook());
    return Response.json({}, { status: 503 });
  };
  return { fetcher, calls };
}

test("warehouse verifies Stockroom access before supplemental feeds or the business database", async () => {
  const { fetcher, calls } = sourceFetcher({ authorized: false });
  const db = { prepare() { assert.fail("Business records must not be read before authorization"); } };
  await assert.rejects(collectWarehouse({ env: { DB: db }, stockroomCookie: cookie, now, fetcher }), error => error.status === 401);
  assert.deepEqual(calls.map(url => url.pathname), ["/api/inventory"]);
});

test("warehouse uses the current weekly report and measured packing alongside the existing Lab and note", async () => {
  const db = localDatabase(":memory:");
  const { fetcher } = sourceFetcher();
  try {
    await saveLabCropster(db, { inventory: { asOf: "2026-11-18", totalKg: 20, rows: [{ name: "Example coffee", location: "Roastery", kg: 20, pricePerKg: 10 }] } }, now);
    await saveWeeklyNote(db, weekStart, { lines: ["Synthetic weekly note"], expectedRevision: 0 });
    const result = await collectWarehouse({ env: { DB: db }, stockroomCookie: cookie, now, fetcher });
    assert.deepEqual(Object.keys(result), ["weekly", "lab", "packing", "notes", "generatedAt"]);
    assert.equal(result.weekly.week.start, weekStart);
    assert.equal(result.weekly.week.isCurrent, true);
    assert.equal(result.weekly.metrics.stock.value, 8);
    assert.equal(result.lab.consumption.stockTotalKg, 20);
    assert.equal(result.lab.coffeeC.price, 200);
    assert.equal(result.lab.coffeeC.status, "delayed");
    assert.equal(result.lab.purchases.events[0].date, "2026-11-23");
    assert.equal(result.lab.purchases.events[0].currency, null);
    assert.equal(result.packing.kgPerHour, 50);
    assert.equal(result.packing.kgPerDay, 100);
    assert.equal(result.packing.packedKg, 200);
    assert.equal(result.packing.timedCoveragePercent, 50);
    assert.equal(result.packing.status, "partial");
    assert.deepEqual(result.notes.lines, ["Synthetic weekly note"]);
    assert.equal(result.generatedAt, now.toISOString());
    assert.doesNotMatch(JSON.stringify(result), /synthetic_warehouse_source_session|PRIVATE_OPERATOR_NAME|activeTimer/);
  } finally { db.close(); }
});

test("supplemental failures remain isolated and missing notes cannot look like a loaded empty note", async () => {
  const databaseFailure = { prepare() { throw new Error("PRIVATE_DATABASE_ERROR"); } };
  const { fetcher } = sourceFetcher({ failure: true, packingWeek: "2026-11-09" });
  const result = await collectWarehouse({ env: { DB: databaseFailure }, stockroomCookie: cookie, now, fetcher });
  assert.equal(result.weekly.metrics.stock.value, 8);
  assert.equal(result.lab.source.status, "unavailable");
  assert.equal(result.lab.consumption.averageKg, null);
  assert.equal(result.lab.prices.highlights[0].pricePerKg, null);
  assert.equal(result.lab.settings.revision, null);
  assert.equal(result.lab.settings.status, "unavailable");
  assert.equal(result.lab.coffeeC.status, "unavailable");
  assert.equal(result.lab.purchases.status, "unavailable");
  assert.equal(result.packing.status, "unavailable");
  assert.equal(result.packing.packedKg, null);
  assert.equal(result.notes.status, "unavailable");
  assert.equal(result.notes.revision, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DATABASE_ERROR/);
});

test("zero timer coverage keeps packing weight available while hourly performance stays unknown", async () => {
  const db = localDatabase(":memory:");
  try {
    const { fetcher } = sourceFetcher({ coverage: 0 });
    const result = await collectWarehouse({ env: { DB: db }, stockroomCookie: cookie, now, fetcher });
    assert.equal(result.packing.packedKg, 200);
    assert.equal(result.packing.kgPerHour, null);
    assert.equal(result.packing.status, "partial");
    assert.equal(result.lab.coffeeC.price, 200);
    assert.deepEqual(result.notes.lines, []);
    assert.equal(result.notes.revision, 0);
    assert.equal(result.notes.status, undefined);
  } finally { db.close(); }
});
