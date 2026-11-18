import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";
import { parseWorkbookSheet } from "../worker/demand.js";
import { parseContractsWorkbook } from "../worker/contracts.js";
import { readPurchases } from "../worker/purchases.js";

const ids = ["B", "C", "D", "F", "G", "H", "I"];
const inline = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
const numeric = (ref, value, style = 0) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
const blank = (ref, style) => `<c r="${ref}" s="${style}"/>`;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const months = Array.from({ length: 8 }, (_, index) => new Date(Date.UTC(2026, 5 + index, 1)).toISOString().slice(0, 7));
function dateLabel(month) {
  const [year, number] = month.split("-").map(Number);
  // Deliberately wrong serial year: the displayed month+day label is Jun26.
  return (Date.UTC(2024, number - 1, year % 100) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function workbook({ change, newMarker = true, display = "mmm d", extra = "", supplier = "Example supplier $1", calendar = "" } = {}) {
  const cells = new Map();
  cells.set("A4", inline("A4", "Obsolete plan"));
  cells.set("A6", inline("A6", "Jun2025"));
  cells.set("B6", inline("B6", "Obsolete supplier", 2));
  if (newMarker) cells.set("A26", inline("A26", "NEW"));
  cells.set("B26", inline("B26", "updated on 9/9/2026"));
  for (const [ref, value] of [["B27", "LIBERTY"], ["E27", "RHYTHM"], ["H27", "OH!"], ["I27", "DECAF"]]) cells.set(ref, inline(ref, value));
  const headers = ["Ethiopia", "Colombia/Honduras", "Brasil (shared)", "China", "Indonesia", "Peru", "Colombia"];
  for (let index = 0; index < ids.length; index++) {
    cells.set(ids[index] + "28", inline(ids[index] + "28", headers[index]));
    cells.set(ids[index] + "29", inline(ids[index] + "29", "2 bags month (9 tn month)"));
  }
  for (let index = 0; index < months.length; index++) {
    const row = index + 30;
    cells.set("A" + row, numeric("A" + row, dateLabel(months[index]), 1));
    for (const id of ids) cells.set(id + row, inline(id + row, supplier, 2));
  }
  cells.set("A45", inline("A45", "Supplier notes below calendar"));
  change?.(cells);
  const headersXml = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"].map((value, index) => inline(String.fromCharCode(66 + index) + "1", value)).join("");
  const styles = `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="${display}"/></numFmts><fills>
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6AA84F"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF93C47D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0000FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF00FF00" tint="0.5"/></patternFill></fill>
    </fills><cellXfs><xf fillId="0" numFmtId="0"/><xf fillId="0" numFmtId="164"/>
    <xf fillId="2" numFmtId="0"/><xf fillId="3" numFmtId="0"/><xf fillId="4" numFmtId="0"/>
    <xf fillId="5" numFmtId="0"/><xf fillId="6" numFmtId="0"/><xf fillId="7" numFmtId="0"/></cellXfs></styleSheet>`;
  return zipSync(Object.fromEntries(Object.entries({
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="CONTRACTS" sheetId="1" r:id="rId1"/><sheet name="ORDER PLAN" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData>" + [...cells.values()].join("") + extra + "</sheetData></worksheet>",
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData>" + headersXml + calendar + "</sheetData></worksheet>",
    "xl/styles.xml": styles,
  }).map(([name, xml]) => [name, strToU8(xml)])));
}

test("the NEW contract calendar follows displayed planning years rather than the underlying date year", () => {
  const value = parseContractsWorkbook(workbook());
  assert.equal(value.status, "live");
  assert.deepEqual(value.years, [2026, 2027]);
  assert.equal(value.sourceUpdatedLabel, "updated on 9/9/2026");
  assert.equal(value.asOf, null);
  assert.deepEqual(value.columns.map(column => column.id), ids);
  assert.deepEqual(value.columns[0].cells.map(cell => cell.month), months);
  assert.equal(value.columns[0].cells[0].sourceCell, "B30");
  assert.equal(value.columns[0].cells[0].text, "Example supplier $1");
  assert.deepEqual(value.columns[2].usedFor, ["Liberty", "Rhythm", "Single origins"]);
  assert.equal(value.columns[0].rateLabel, "2 bags month (9 tn month)");
  assert.ok(!("kg" in value.columns[0]));
  assert.ok(!JSON.stringify(value).includes("Obsolete supplier"));
});

test("only verified green text and red blank source cells establish coverage or gaps", () => {
  const value = parseContractsWorkbook(workbook({ change(cells) {
    cells.set("B30", blank("B30", 3));
    cells.set("C30", inline("C30", "Dark green example", 4));
    cells.set("D30", inline("D30", "Pale green example", 5));
    cells.set("F30", blank("F30", 2));
    cells.set("G30", inline("G30", "Red with text", 3));
    cells.set("H30", inline("H30", "Blue example", 6));
    cells.set("I30", blank("I30", 0));
    cells.set("I31", numeric("I31", 0, 2));
    cells.set("H31", inline("H31", "Unverified tint", 7));
  } }));
  assert.equal(value.status, "partial");
  assert.deepEqual(value.columns.map(column => column.cells[0].state), ["gap", "contracted", "contracted", "unknown", "unknown", "unknown", "unknown"]);
  assert.equal(value.columns[6].cells[1].state, "unknown");
  assert.equal(value.columns[5].cells[1].state, "unknown");
  assert.equal(value.columns[0].cells[0].text, "");
});

test("optional workbook formats include styled empty cells without changing ordinary cell objects", () => {
  const bytes = workbook({ change(cells) { cells.set("B30", blank("B30", 3)); } });
  const ordinary = parseWorkbookSheet(bytes, 0, "CONTRACTS");
  const styled = parseWorkbookSheet(bytes, 0, "CONTRACTS", { styles: true });
  assert.equal(ordinary.formats, undefined);
  assert.equal(styled.cells.has("B30"), false);
  assert.equal(styled.formats.get("B30").fillColor, "FF0000");
  assert.equal(styled.formats.get("A30").numberFormat, "mmm d");
  assert.deepEqual(styled.cells.get("A30"), ordinary.cells.get("A30"));
});

test("missing, duplicate, malformed or unanchored NEW calendars are unavailable", () => {
  const variants = [
    { newMarker: false },
    { extra: inline("A80", "NEW") + inline("B80", "updated on 10/9/2026") },
    { change(cells) { cells.set("B26", inline("B26", "updated recently")); } },
    { change(cells) { cells.set("B26", inline("B26", "updated on 31/2/2026")); } },
    { change(cells) { cells.set("B26", inline("B26", "updated on 9/9/2025")); } },
    { change(cells) { cells.set("A31", inline("A31", "Jun26")); } },
    { change(cells) { cells.delete("A31"); } },
    { change(cells) { cells.set("A31", inline("A31", "Jnn26")); } },
    { change(cells) { cells.set("B28", inline("B28", "Changed origin")); } },
    { display: "yyyy-mm-dd" },
  ];
  for (const variant of variants) {
    const result = parseContractsWorkbook(workbook(variant));
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.columns, []);
    assert.deepEqual(result.years, []);
  }
});

test("written month-year labels also require the same anchored consecutive sequence", () => {
  const bytes = workbook({ change(cells) {
    months.forEach((month, index) => {
      const [year, number] = month.split("-").map(Number);
      cells.set("A" + (30 + index), inline("A" + (30 + index), monthNames[number - 1] + String(year).slice(2)));
    });
  } });
  assert.equal(parseContractsWorkbook(bytes).status, "live");
  assert.deepEqual(parseContractsWorkbook(bytes).columns[0].cells.map(cell => cell.month), months);
});

test("the source update may move into the next calendar year while retaining earlier planning months", () => {
  const bytes = workbook({ change(cells) { cells.set("B26", inline("B26", "updated on 9/1/2027")); } });
  const value = parseContractsWorkbook(bytes);
  assert.equal(value.status, "live");
  assert.deepEqual(value.years, [2026, 2027]);
  assert.equal(value.columns[0].cells[0].month, "2026-06");
  assert.equal(value.sourceUpdatedLabel, "updated on 9/1/2027");
});

test("long unrelated supplier notes below the calendar do not invalidate the verified NEW block", () => {
  const bytes = workbook({ change(cells) { cells.set("A45", inline("A45", "Example supplier note ".repeat(30))); } });
  assert.equal(parseContractsWorkbook(bytes).status, "live");
});

test("one purchase download supplies contracts even when the purchase calendar cannot be parsed", async () => {
  const now = new Date("2026-11-19T00:00:00Z");
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(workbook()); };
  const value = await readPurchases({ now, fetcher });
  assert.equal(value.status, "unavailable");
  assert.equal(value.contracts.status, "live");
  assert.equal(value.contracts.asOf, now.toISOString());
  assert.equal(value.greenForecast.status, "unavailable");
  assert.equal(calls, 1);
  value.contracts.columns[0].cells.length = 0;
  const cached = await readPurchases({ now, fetcher });
  assert.equal(cached.contracts.columns[0].cells.length, 8);
  assert.equal(calls, 1);
});

test("bad contracts do not hide the purchase calendar and manual refresh replaces the full source", async () => {
  const now = new Date("2026-11-19T00:00:00Z");
  const calendar = inline("A2", "NOV") + inline("B2", "Example supplier") + inline("C2", "Example coffee") + inline("E2", "2026-11-19") + numeric("G2", 10);
  let supplier = "Example supplier $1", healthy = true, brokenContracts = true, calls = 0;
  const fetcher = async (_url, options) => {
    calls++;
    if (!healthy) return new Response(null, { status: 503 });
    if (calls > 1) assert.equal(options.headers["Cache-Control"], "no-cache");
    return new Response(workbook({ calendar, supplier, newMarker: !brokenContracts }));
  };
  const initial = await readPurchases({ now, fetcher });
  assert.equal(initial.events.length, 1);
  assert.equal(initial.contracts.status, "unavailable");
  brokenContracts = false;
  const fresh = await readPurchases({ now, fetcher, fresh: true });
  assert.equal(fresh.contracts.columns[0].cells[0].text, supplier);
  supplier = "Changed example supplier $2";
  assert.equal((await readPurchases({ now, fetcher })).contracts.columns[0].cells[0].text, "Example supplier $1");
  assert.equal((await readPurchases({ now, fetcher, fresh: true })).contracts.columns[0].cells[0].text, supplier);
  healthy = false;
  const failed = await readPurchases({ now, fetcher, fresh: true });
  assert.equal(failed.contracts.status, "unavailable");
  assert.equal(failed.contracts.asOf, null);
  assert.deepEqual(failed.contracts.columns, []);
  assert.equal(calls, 4);
});
