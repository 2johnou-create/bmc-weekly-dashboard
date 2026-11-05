import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";
import { parseDriveFolderCandidates, parseWeeklyDemandWorkbook, readWeeklyDemand } from "../worker/demand.js";

const ID = "test_current_tally_123456789";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
const numeric = (ref, value, formula = "") => `<c r="${ref}">${formula ? `<f>${formula}</f>` : ""}<v>${value}</v></c>`;
function fixture({ serial = 46328, plan = 1255.75, tally = 1255.75, single = 40.25, olderNotes = false, omitTotal = false, shared = false, extraFiles = {} } = {}) {
  const label = shared ? '<c r="B2" t="s"><v>0</v></c>' : inline("B2", "Week commencing:");
  const roastTally = `<worksheet><sheetData>${label}${numeric("C2", serial)}${inline("B41", "BLEND TOTAL")}${omitTotal ? "" : numeric("J41", tally - single)}${inline("B67", "SINGLE ORIGIN TOTAL")}${omitTotal ? "" : numeric("J67", single)}${olderNotes ? inline("B76", "* Online: retail sales 5–11 Oct, subscriptions excluded.") : ""}</sheetData></worksheet>`;
  const roastPlan = `<worksheet><sheetData>${inline("B4", "Blend / Origin")}${inline("C4", "Demand (kg)&#10;from tally")}${inline("B5", "Liberty")}${numeric("C5", plan - single)}${inline("B6", "Single origin")}${numeric("C6", single)}${omitTotal ? "" : numeric("C17", plan, "SUM(C5:C16)")}</sheetData></worksheet>`;
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="1. Roast Tally" sheetId="1" r:id="rId1"/><sheet name="3. Roast Planning" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": roastTally,
    "xl/worksheets/sheet2.xml": roastPlan,
    ...(shared ? { "xl/sharedStrings.xml": '<sst><si><r><t>Week </t></r><r><t>commencing:</t></r></si></sst>' } : {}),
    ...extraFiles,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
}
function folder(files = [{ id: ID, name: "NEW ROAST TALLY 2ND NOV.xlsx", modified: 1793751506817 }]) {
  const rows = files.map(file => [file.id, [], file.name, file.mime || MIME, null, null, null, null, null, 0, file.modified]);
  const escaped = JSON.stringify([rows, null]).replace(/./g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `<script>window['_DRIVE_ivd'] = '${escaped}';</script>`;
}
function fakeFetch(workbook, { listing = folder(), redirect = null } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/drive/folders/")) return new Response(listing, { headers: { "content-type": "text/html" } });
    if (redirect) return new Response(null, { status: 302, headers: { location: redirect } });
    return new Response(workbook, { headers: { "content-type": "application/octet-stream" } });
  };
  return { fetcher, calls };
}

test("public folder discovery selects the requested week and excludes templates", () => {
  const result = parseDriveFolderCandidates(folder([
    { id: ID, name: "NEW ROAST TALLY 2ND NOV.xlsx", modified: 1793751506817 },
    { id: "old_tally_12345678901234567", name: "combined_roast_tally_26th October.xlsx", modified: 1793751506818 },
    { id: "template_tally_12345678901", name: "ROAST TALLY TEMPLATE 2ND NOV.xlsx", modified: 1793751506819 },
  ]), "2026-11-02");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, ID);
  assert.equal(result[0].modified, "2026-11-04T00:18:26.817Z");
});

test("HTML discovery fallback decodes file title entities", () => {
  const result = parseDriveFolderCandidates(`<div data-id="${ID}" data-tooltip="ROAST TALLY 2ND NOV &amp; EXPORT.xlsx Microsoft Excel">`, "2026-11-02");
  assert.equal(result[0].name, "ROAST TALLY 2ND NOV & EXPORT.xlsx");
});

test("reads verified exact-week demand from a workbook with shared or inline text", () => {
  for (const shared of [false, true]) assert.deepEqual(parseWeeklyDemandWorkbook(fixture({ shared }), "2026-11-02"), { kg: 1255.75, olderChannelNotes: false });
});

test("a verified explicit zero remains distinguishable from missing data", () => {
  assert.equal(parseWeeklyDemandWorkbook(fixture({ plan: 0, tally: 0, single: 0 }), "2026-11-02").kg, 0);
});

test("a matching filename cannot bypass the workbook's internal week", async () => {
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ serial: 46321 }), "2026-11-02"), /different week/);
  const { fetcher } = fakeFetch(fixture({ serial: 46321 }));
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.status, "unavailable");
  assert.equal(result.kg, null);
});

test("does not treat missing or inconsistent totals as demand", () => {
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ omitTotal: true }), "2026-11-02"), /missing/);
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ tally: 1000 }), "2026-11-02"), /disagree/);
});

test("flags copied channel reference dates and retains source modification time", async () => {
  const { fetcher, calls } = fakeFetch(fixture({ olderNotes: true }));
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.status, "partial");
  assert.equal(result.kg, 1255.75);
  assert.equal(result.asOf, "2026-11-04T00:18:26.817Z");
  assert.match(result.note, /outside this week/);
  assert.equal(calls[1].options.redirect, "manual");
  assert.equal(calls[1].options.headers.Authorization, undefined);
});

test("does not follow an untrusted source redirect", async () => {
  const { fetcher, calls } = fakeFetch(fixture(), { redirect: "https://untrusted.example/download" });
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.kg, null);
  assert.ok(calls.every(call => !call.url.includes("untrusted.example")));
});

test("supports a native Google Sheet export through Google's verified download host", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes("/drive/folders/")) return new Response(folder([{ id: ID, name: "ROAST TALLY 2ND NOV", mime: "application/vnd.google-apps.spreadsheet", modified: 1793751506817 }]));
    if (url.startsWith("https://docs.google.com/")) return new Response(null, { status: 302, headers: { location: `https://doc-00-14-sheets.googleusercontent.com/export/verified/${ID}?format=xlsx` } });
    return new Response(fixture());
  };
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.kg, 1255.75);
  assert.ok(calls.some(url => url.startsWith("https://doc-00-14-sheets.googleusercontent.com/")));
});

test("rejects expanded archive entries before decompression", () => {
  const bytes = fixture({ extraFiles: { "xl/worksheets/sheet3.xml": "a".repeat(2_000_001) } });
  assert.ok(bytes.length < 20_000);
  assert.throws(() => parseWeeklyDemandWorkbook(bytes, "2026-11-02"), /too large/);
});

test("never carries a previous week's total into a week with no file", async () => {
  const { fetcher } = fakeFetch(fixture());
  const result = await readWeeklyDemand("2026-11-09", { fetch: fetcher });
  assert.equal(result.status, "unavailable");
  assert.equal(result.kg, null);
});

test("refreshes after the short cache window without serving failed reads as fresh", async () => {
  let clock = 100_000, available = true, calls = 0;
  const fetcher = async url => {
    calls++;
    if (!available) return new Response(null, { status: 503 });
    return new Response(url.includes("/drive/folders/") ? folder() : fixture());
  };
  const env = { fetch: fetcher, now: () => clock };
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, 1255.75);
  const firstCalls = calls;
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, 1255.75);
  assert.equal(calls, firstCalls);
  clock += 55_001; available = false;
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, null);
});
