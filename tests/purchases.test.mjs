import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";
import { parseGreenForecastWorkbook, parsePurchaseWorkbook, readPurchases } from "../worker/purchases.js";

const inline = (ref, value) => '<c r="' + ref + '" t="inlineStr"><is><t>' + value + '</t></is></c>';
const numeric = (ref, value) => '<c r="' + ref + '"><v>' + value + '</v></c>';

function workbook({ sheetName = "ORDER PLAN", rows = "", forecastHeader = false } = {}) {
  const header = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"];
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="' + sheetName + '" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData>" + header.map((label, index) => inline(String.fromCharCode(66 + index) + "1", label)).join("") + (forecastHeader ? inline("I1", "Monthly Predicted Spend") : "") + rows + "</sheetData></worksheet>",
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
}

const currentRows = inline("A2", "NOV") + inline("B2", "Example supplier") + inline("C2", "6x Example Brazil&#10;8x Example Peru") +
  inline("D2", "ordered") + numeric("E2", 46345) + numeric("F2", 46405) + numeric("G2", 1200.45) +
  inline("B3", "Other supplier") + inline("D3", "EST") + numeric("E3", 46356) + numeric("G3", 1350) +
  inline("B4", "Others") + inline("C4", "Gift Box Singles of 5x 10gk") + inline("D4", "EST") + numeric("E4", 46335);

test("Purchase calendar uses placed-order dates and preserves unspecified quantities and currency", () => {
  const data = parsePurchaseWorkbook(workbook({ rows: currentRows }), "2026-11-19");
  assert.equal(data.events.length, 2);
  assert.equal(data.status, "live");
  const [ordered, planned] = data.events;
  assert.equal(ordered.date, "2026-11-19");
  assert.equal(ordered.dueDate, "2027-01-18");
  assert.equal(ordered.kind, "ordered");
  assert.equal(ordered.coffee, "6x Example Brazil\n8x Example Peru");
  assert.equal(ordered.kg, null);
  assert.equal(ordered.bags, null);
  assert.equal(ordered.value, 1200.45);
  assert.equal(ordered.currency, null);
  assert.equal(ordered.currencySymbol, "$");
  assert.equal(planned.date, "2026-11-30");
  assert.equal(planned.kind, "upcoming");
  assert.equal(planned.coffee, "");
});

test("A date without a year resolves only within a month with one recorded year", () => {
  const rows = inline("A2", "OCT") + inline("B2", "Example supplier") + numeric("E2", 46301) +
    inline("B3", "Example supplier") + inline("C3", "10x Example coffee (@20kg / bag)") + inline("E3", "11th-Oct");
  const resolved = parsePurchaseWorkbook(workbook({ rows }), "2026-11-19");
  assert.equal(resolved.events[1].date, "2026-10-11");
  assert.equal(resolved.events[1].kg, 200);
  assert.equal(resolved.events[1].bags, 10);
  const ambiguous = parsePurchaseWorkbook(workbook({ rows: rows + inline("B4", "Example supplier") + inline("E4", "2025-10-10") }), "2026-11-19");
  assert.equal(ambiguous.events.some(row => row.kg === 200), false);
  assert.equal(ambiguous.status, "partial");
});

test("A renamed second tab fails safely and unresolved old dates are disclosed", () => {
  assert.throws(() => parsePurchaseWorkbook(workbook({ sheetName: "Copy", rows: currentRows })), /order or name changed/);
  const data = parsePurchaseWorkbook(workbook({ rows: currentRows + inline("B5", "Old supplier") + inline("E5", "invoice reference") }));
  assert.equal(data.status, "partial");
  assert.match(data.note, /missing or invalid order dates/);
});

test("A cached purchase calendar refreshes from the live sheet and never serves an expired failure as fresh", async () => {
  let healthy = true;
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    assert.match(url, /export\?format=xlsx$/);
    return healthy ? new Response(workbook({ rows: currentRows })) : new Response(null, { status: 503 });
  };
  const now = new Date("2026-11-19T00:00:00Z");
  const initial = await readPurchases({ now, fetcher });
  initial.events.length = 0;
  const cached = await readPurchases({ now: new Date(now.getTime() + 1_000), fetcher });
  assert.equal(cached.events.length, 2);
  assert.equal(calls, 1);
  healthy = false;
  const failed = await readPurchases({ now: new Date(now.getTime() + 60_000), fetcher });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.asOf, null);
  assert.deepEqual(failed.events, []);
});

test("Manual purchase refresh bypasses the TTL and cannot revive the old calendar after a failure", async () => {
  const now = new Date("2026-11-19T00:00:00Z");
  let value = 1200.45, available = true, calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    const fresh = new URL(url).searchParams.has("_refresh");
    if (fresh) {
      assert.equal(options.headers["Cache-Control"], "no-cache");
      assert.equal(options.headers.Pragma, "no-cache");
    }
    return available ? new Response(workbook({ rows: currentRows.replace("1200.45", String(value)) })) : new Response(null, { status: 503 });
  };
  assert.equal((await readPurchases({ now, fetcher })).events[0].value, 1200.45);
  value = 1500;
  assert.equal((await readPurchases({ now, fetcher })).events[0].value, 1200.45);
  assert.equal(calls, 1);
  assert.equal((await readPurchases({ now: new Date(now.getTime() + 1000), fetcher, fresh: true })).events[0].value, 1500);
  available = false;
  assert.equal((await readPurchases({ now: new Date(now.getTime() + 2000), fetcher, fresh: true })).status, "unavailable");
  assert.equal((await readPurchases({ now: new Date(now.getTime() + 3000), fetcher })).status, "unavailable");
  assert.equal(calls, 4);
});

test("An older purchase request cannot replace or delete a newer forced result", async () => {
  for (const olderFails of [false, true]) {
    const pending = Promise.withResolvers();
    const now = new Date("2026-11-19T00:00:00Z");
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls === 1) {
        await pending.promise;
        return olderFails ? new Response(null, { status: 503 }) : new Response(workbook({ rows: currentRows }));
      }
      return new Response(workbook({ rows: currentRows.replace("1200.45", "1500") }));
    };
    const older = readPurchases({ now, fetcher });
    const newer = await readPurchases({ now: new Date(now.getTime() + 1000), fetcher, fresh: true });
    assert.equal(newer.events[0].value, 1500);
    pending.resolve();
    await older;
    assert.equal((await readPurchases({ now: new Date(now.getTime() + 2000), fetcher })).events[0].value, 1500);
    assert.equal(calls, 2);
  }
});

const forecastRows = inline("A2", "NOV") + inline("E2", "2025-11-03") + numeric("I3", 10) +
  inline("A4", "NOV") + inline("E4", "2026-11-02") + '<c r="I5"><f>SUM(G4:G5)</f><v>200.25</v></c>' +
  inline("A6", "DEC") + inline("E6", "2026-12-01") + numeric("I7", 300.75) +
  inline("A8", "JAN") + inline("E8", "2027-01-04") + numeric("I9", 400);

test("The monthly forecast uses the recorded column I total for the verified month and year", () => {
  const bytes = workbook({ rows: forecastRows, forecastHeader: true });
  const november = parseGreenForecastWorkbook(bytes, "2026-11-19");
  assert.equal(november.value, 200.25);
  assert.equal(november.status, "live");
  assert.equal(november.month, "2026-11");
  assert.equal(november.monthLabel, "November 2026");
  assert.equal(november.sourceCell, "I5");
  assert.equal(november.currency, null);
  assert.equal(november.currencySymbol, "$");
  assert.match(november.note, /Includes ordered and EST/);
  assert.equal(parseGreenForecastWorkbook(bytes, "2025-11-19").value, 10);
  assert.equal(parseGreenForecastWorkbook(bytes, "2026-12-19").value, 300.75);
  assert.equal(parseGreenForecastWorkbook(bytes, "2027-01-19").value, 400);
  assert.equal(parseGreenForecastWorkbook(bytes, "2027-11-19").value, null);
});

test("Blank, missing and ambiguous forecast cells never become zero or a sum of column G", () => {
  const cases = [
    inline("A2", "NOV") + inline("E2", "2026-11-02") + numeric("G2", 100),
    inline("A2", "NOV") + numeric("I3", 100),
    inline("A2", "NOV") + inline("E2", "2025-11-02") + inline("E3", "2026-11-02") + numeric("I4", 100),
    inline("A2", "NOV") + inline("E2", "2026-11-02") + numeric("I3", 100) + numeric("I4", 200),
    forecastRows + inline("A10", "NOV") + inline("E10", "2026-11-09") + numeric("I11", 500),
    inline("A2", "NOV") + inline("E2", "2026-11-02") + '<c r="I3"><f>SUM(G2:G3)</f></c>',
  ];
  for (const rows of cases) {
    const report = parseGreenForecastWorkbook(workbook({ rows, forecastHeader: true }), "2026-11-19");
    assert.equal(report.status, "unavailable");
    assert.equal(report.value, null);
  }
  const zero = inline("A2", "NOV") + inline("E2", "2026-11-02") + numeric("I3", 0);
  assert.equal(parseGreenForecastWorkbook(workbook({ rows: zero, forecastHeader: true }), "2026-11-19").value, 0);
});

test("Forecast coverage is independent of the calendar and flags out-of-month dates", async () => {
  const rows = inline("A2", "NOV") + inline("E2", "2026-11-02") + inline("E3", "2026-12-02") + numeric("I4", 100);
  const result = await readPurchases({ now: new Date("2026-11-19T00:00:00Z"), fetcher: async () => new Response(workbook({ rows, forecastHeader: true })) });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.events, []);
  assert.equal(result.greenForecast.value, 100);
  assert.equal(result.greenForecast.status, "partial");
  assert.equal(result.greenForecast.asOf, "2026-11-19T00:00:00.000Z");
  assert.match(result.greenForecast.note, /outside the labelled month/);
});

test("Sydney month rollover rechecks the source within the normal cache TTL", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(workbook({ rows: forecastRows, forecastHeader: true })); };
  const before = await readPurchases({ now: new Date("2026-11-30T12:59:50Z"), fetcher });
  assert.equal(before.greenForecast.month, "2026-11");
  assert.equal(before.greenForecast.value, 200.25);
  const after = await readPurchases({ now: new Date("2026-11-30T13:00:10Z"), fetcher });
  assert.equal(after.greenForecast.month, "2026-12");
  assert.equal(after.greenForecast.value, 300.75);
  assert.equal(calls, 2);
});

test("Manual refresh reloads the recorded monthly total without reviving a failed forecast", async () => {
  let value = "200.25", healthy = true, calls = 0;
  const fetcher = async () => {
    calls++;
    return healthy ? new Response(workbook({ rows: forecastRows.replace("200.25", value), forecastHeader: true })) : new Response(null, { status: 503 });
  };
  const now = new Date("2026-11-19T00:00:00Z");
  assert.equal((await readPurchases({ now, fetcher })).greenForecast.value, 200.25);
  value = "210.25";
  assert.equal((await readPurchases({ now, fetcher })).greenForecast.value, 200.25);
  assert.equal((await readPurchases({ now, fetcher, fresh: true })).greenForecast.value, 210.25);
  healthy = false;
  const failed = await readPurchases({ now, fetcher, fresh: true });
  assert.equal(failed.greenForecast.value, null);
  assert.equal(failed.greenForecast.status, "unavailable");
  assert.equal(calls, 3);
});
