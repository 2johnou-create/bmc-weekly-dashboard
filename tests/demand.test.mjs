import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";
import { parseDriveFolderCandidates, parseWeeklyDemandWorkbook, readWeeklyDemand } from "../worker/demand.js";

const ID = "test_current_tally_123456789";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
const numeric = (ref, value, formula = "") => `<c r="${ref}">${formula ? `<f>${formula}</f>` : ""}<v>${value}</v></c>`;
function fixture({ serial = 46328, dateText = null, plan = 1255.75, tally = 1255.75, single = 40.25, olderNotes = false, omitTotal = false, demandCell, brownStockCells = "", shared = false, extraFiles = {} } = {}) {
  const label = shared ? '<c r="B2" t="s"><v>0</v></c>' : inline("B2", "Week commencing:");
  const date = dateText === null ? numeric("C2", serial) : '<c r="C2" t="s"><v>1</v></c>';
  const roastTally = `<worksheet><sheetData>${label}${date}${inline("B41", "BLEND TOTAL")}${omitTotal ? "" : numeric("J41", tally - single)}${inline("B67", "SINGLE ORIGIN TOTAL")}${omitTotal ? "" : numeric("J67", single)}${olderNotes ? inline("B76", "* Online: retail sales 5–11 Oct, subscriptions excluded.") : ""}</sheetData></worksheet>`;
  const savedDemand = demandCell ?? numeric("C18", plan, "SUM(C6:C17)");
  const roastPlan = `<worksheet><sheetData>${inline("C4", "Demand (kg)&#10;from tally")}${numeric("C17", single)}${omitTotal ? "" : savedDemand}${brownStockCells}</sheetData></worksheet>`;
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="1. Roast Tally" sheetId="1" r:id="rId1"/><sheet name="3. Roast Planning" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": roastTally,
    "xl/worksheets/sheet2.xml": roastPlan,
    ...(shared || dateText !== null ? { "xl/sharedStrings.xml": `<sst><si><r><t>Week </t></r><r><t>commencing:</t></r></si><si><t>${dateText || ""}</t></si></sst>` } : {}),
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
  for (const shared of [false, true]) assert.deepEqual(parseWeeklyDemandWorkbook(fixture({ shared }), "2026-11-02"), { kg: 1255.75, brownOnHandKg: null });
});

test("a verified explicit zero remains distinguishable from missing data", () => {
  assert.equal(parseWeeklyDemandWorkbook(fixture({ plan: 0, tally: 0, single: 0 }), "2026-11-02").kg, 0);
});

test("brown stock sums only D6:D17 and retains explicit zero", async () => {
  const brownStockCells = numeric("D5", 5000) + numeric("D6", 250.25) + '<c r="D8"/>' +
    numeric("D16", 0) + numeric("D17", 45.5, "D3") + numeric("D18", 8000);
  const { fetcher } = fakeFetch(fixture({ brownStockCells }));
  const demand = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(demand.kg, 1255.75);
  assert.equal(demand.brownOnHandKg, 295.75);
  assert.equal(parseWeeklyDemandWorkbook(fixture({ brownStockCells: numeric("D6", 0) }), "2026-11-02").brownOnHandKg, 0);
});

test("unreadable stock in the range leaves carry-forward input unavailable and preserves demand", () => {
  for (const invalidStock of ['<c r="D7" t="e"><v>#VALUE!</v></c>', '<c r="D7"><f>SUM(D1:D3)</f></c>', '<c r="D7" t="s"><v>99</v></c>']) {
    const parsed = parseWeeklyDemandWorkbook(fixture({ brownStockCells: numeric("D6", 300) + invalidStock }), "2026-11-02");
    assert.equal(parsed.brownOnHandKg, null);
    assert.equal(parsed.kg, 1255.75);
  }
});

test("older names still require a matching internal week", async () => {
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ serial: 46321 }), "2026-11-02"), /different week/);
  const { fetcher } = fakeFetch(fixture({ serial: 46321 }));
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.status, "unavailable");
  assert.equal(result.kg, null);
  assert.match(result.note, /date differs from its filename/);
  assert.ok(result.url.endsWith(`/${ID}/edit`));
});

test("an explicitly dated weekly Roast Tally uses C18 despite a copied date on another tab", async () => {
  const listing = folder([
    { id: ID, name: "ROAST TALLY 9 NOV 2026.xlsx", modified: 1794272400000 },
    { id: "other_tally_1234567890123456", name: "NEW ROAST TALLY 9TH NOV.xlsx", modified: 1794272400001 },
  ]);
  const { fetcher, calls } = fakeFetch(fixture({ dateText: "Monday 19 October 2026", plan: 987.65, tally: 500 }), { listing });
  const result = await readWeeklyDemand("2026-11-09", { fetch: fetcher });
  assert.equal(result.status, "live");
  assert.equal(result.kg, 987.65);
  assert.ok(calls[1].url.includes(ID));
  assert.match(result.note, /3\. Roast Planning!C18/);
  assert.ok(result.url.endsWith(`/${ID}/edit`));
});

test("two exact named files leave the demand unavailable without downloading either", async () => {
  const listing = folder([
    { id: ID, name: "ROAST TALLY 9 NOV 2026.xlsx" },
    { id: "duplicate_tally_12345678901234", name: "ROAST TALLY 9 NOV 2026.xlsx" },
  ]);
  const { fetcher, calls } = fakeFetch(fixture(), { listing });
  const result = await readWeeklyDemand("2026-11-09", { fetch: fetcher });
  assert.equal(result.kg, null);
  assert.match(result.note, /More than one/);
  assert.equal(calls.length, 1);
});

test("accepts a verified written Monday and rejects a copied date", () => {
  assert.equal(parseWeeklyDemandWorkbook(fixture({ dateText: "Monday 2 November 2026" }), "2026-11-02").kg, 1255.75);
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ dateText: "Monday 19 October 2026" }), "2026-11-02"), /different week/);
});

test("only uses the numeric saved C18 value, even when other totals disagree", () => {
  assert.equal(parseWeeklyDemandWorkbook(fixture({ tally: 1000 }), "2026-11-02").kg, 1255.75);
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ omitTotal: true }), "2026-11-02"), /C18/);
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ demandCell: '<c r="C18"><f>SUM(C6:C17)</f></c>' }), "2026-11-02"), /C18/);
  assert.throws(() => parseWeeklyDemandWorkbook(fixture({ demandCell: '<c r="C18" t="b"><v>1</v></c>' }), "2026-11-02"), /C18/);
});

test("uses the C18 result independently of other tab notes and retains source modification time", async () => {
  const { fetcher, calls } = fakeFetch(fixture({ olderNotes: true }));
  const result = await readWeeklyDemand("2026-11-02", { fetch: fetcher });
  assert.equal(result.status, "live");
  assert.equal(result.kg, 1255.75);
  assert.equal(result.asOf, "2026-11-04T00:18:26.817Z");
  assert.match(result.note, /3\. Roast Planning!C18/);
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

test("Manual demand refresh bypasses the TTL, leaves the folder URL exact and busts the file cache", async () => {
  let kg = 1255.75, available = true, calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    if (!available) return new Response(null, { status: 503 });
    const source = new URL(url);
    const isFolder = source.pathname.includes("/drive/folders/");
    if (options.headers["Cache-Control"]) {
      assert.equal(options.headers["Cache-Control"], "no-cache");
      assert.equal(options.headers.Pragma, "no-cache");
      assert.equal(source.searchParams.has("_refresh"), !isFolder);
    }
    return new Response(isFolder ? folder() : fixture({ plan: kg }));
  };
  const env = { fetch: fetcher, now: () => 100_000 };
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, 1255.75);
  kg = 1500;
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, 1255.75);
  assert.equal(calls, 2);
  assert.equal((await readWeeklyDemand("2026-11-02", { ...env, fresh: true })).kg, 1500);
  available = false;
  assert.equal((await readWeeklyDemand("2026-11-02", { ...env, fresh: true })).kg, null);
  const attempted = calls;
  assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, null);
  assert.ok(calls > attempted);
});

test("An older tally read cannot replace or clear the cache after a newer forced read", async () => {
  for (const olderFails of [false, true]) {
    const pending = Promise.withResolvers();
    const started = Promise.withResolvers();
    let files = 0;
    const fetcher = async url => {
      if (url.includes("/drive/folders/")) return new Response(folder());
      files++;
      if (files === 1) {
        started.resolve();
        await pending.promise;
        return olderFails ? new Response(null, { status: 503 }) : new Response(fixture());
      }
      return new Response(fixture({ plan: 1500 }));
    };
    const env = { fetch: fetcher, now: () => 100_000 };
    const older = readWeeklyDemand("2026-11-02", env);
    await started.promise;
    assert.equal((await readWeeklyDemand("2026-11-02", { ...env, fresh: true })).kg, 1500);
    pending.resolve();
    await older;
    assert.equal((await readWeeklyDemand("2026-11-02", env)).kg, 1500);
    assert.equal(files, 2);
  }
});
