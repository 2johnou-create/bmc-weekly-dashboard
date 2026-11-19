import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { saveCropsterGreenStock, saveCropsterReading } from "../worker/cropster.js";
import { saveCropsterFriday } from "../worker/cropster-friday.js";
import { collectWeeklyReport } from "../worker/weekly-report.js";
import { weeklyPage } from "../worker/weekly-ui.js";
import { warehousePage } from "../worker/warehouse-ui.js";

const captured = new Date("2026-11-18T01:00:00.000Z");
const checked = new Date("2026-11-20T01:00:00.000Z");
const weekStart = "2026-11-16";

function sourceReader(reads) {
  return async address => {
    const url = new URL(address);
    reads.push(url);
    return url.pathname === "/api/inventory"
      ? Response.json({ items: [] })
      : Response.json({}, { status: 503 });
  };
}

test("manual current-week Refresh reports saved Cropster observations without advancing capture times", async () => {
  const db = localDatabase(":memory:");
  const reads = [];
  try {
    await saveCropsterReading(db, {
      weekStart, roastedKg: 100, scheduledKg: 25, roastedValue: 1000, scheduledValue: 250,
      previousRoastedKg: 90, previousScheduledKg: 0, previousRoastedValue: 900, previousScheduledValue: 0,
    }, weekStart, captured);
    await saveCropsterGreenStock(db, { kg: 500, value: 5000 }, captured);
    const report = await collectWeeklyReport({ weekStart, stockroomCookie: "synthetic", env: { DB: db }, now: checked, fresh: true, fetcher: sourceReader(reads) });
    assert.equal(report.generatedAt, checked.toISOString());
    assert.deepEqual(report.cropsterRefresh, {
      mode: "saved-readings", fetched: false,
      productionAsOf: captured.toISOString(), greenAsOf: captured.toISOString(),
      note: "Cropster was not fetched again. Roasted, scheduled and green stock figures use saved readings.",
    });
    assert.equal(report.metrics.production.scheduledKg, 25);
    assert.equal(report.metrics.production.totalKg, 125);
    assert.equal(report.metrics.production.asOf, captured.toISOString());
    assert.equal(report.metrics.green.asOf, captured.toISOString());
    assert.match(report.metrics.production.note, /saved at the capture time shown.*does not fetch Cropster again/);
    assert.match(report.sources.find(source => source.label === "Cropster production").note, /does not fetch Cropster again/);
    assert.equal(reads.some(url => /(^|\.)cropster\.com$/.test(url.hostname)), false);
    const saved = await db.prepare("SELECT recorded_at, scheduled_kg FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first();
    assert.equal(saved.recorded_at, captured.getTime());
    assert.equal(saved.scheduled_kg, 25);
  } finally { db.close(); }
});

test("historical Refresh retains the selected Friday archive rather than substituting current Cropster readings", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveCropsterFriday(db, { weekStart: "2026-11-09", roastedKg: 80, roastedValue: 800, greenKg: 200, greenValue: 2000 }, captured);
    await saveCropsterReading(db, { weekStart, roastedKg: 100, scheduledKg: 25 }, weekStart, checked);
    const report = await collectWeeklyReport({ weekStart: "2026-11-09", stockroomCookie: "synthetic", env: { DB: db }, now: checked, fresh: true, fetcher: sourceReader([]) });
    assert.equal(report.week.end, "2026-11-13");
    assert.equal(report.metrics.production.roastedKg, 80);
    assert.equal(report.metrics.production.scheduledKg, null);
    assert.equal(report.metrics.green.kg, 200);
    assert.equal(report.cropsterRefresh.mode, "friday-archive");
    assert.equal(report.cropsterRefresh.fetched, false);
    assert.equal(report.cropsterRefresh.productionAsOf, captured.toISOString());
    assert.match(report.cropsterRefresh.note, /saved Friday archive/);
  } finally { db.close(); }
});

function freshnessRenderer(page, nextFunction, formatter) {
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf("    function cropsterRefreshText(report) {");
  const end = script.indexOf("    function " + nextFunction, start);
  assert.ok(start >= 0 && end > start, "The displayed freshness formatter must exist");
  return new Function(formatter, script.slice(start, end) + "; return cropsterRefreshText;")(value => value || "");
}

test("both dashboard UIs disclose the missing automatic Cropster sync without claiming a completed source refresh", () => {
  const renderers = [
    freshnessRenderer(weeklyPage, "statusText", "formatTimestamp"),
    freshnessRenderer(warehousePage, "makeClockMarks", "date"),
  ];
  const report = { week: { isCurrent: true }, cropsterRefresh: { mode: "saved-readings", fetched: false } };
  for (const render of renderers) {
    assert.equal(render(report), "Cropster: saved readings · automatic sync not connected.");
    assert.equal(render({}), "Cropster: saved readings · automatic sync not connected.");
  }
  assert.match(renderers[0]({ week: { isCurrent: false } }), /saved Friday archive/);
  for (const page of [weeklyPage, warehousePage]) {
    assert.doesNotMatch(page, /Refresh complete\./);
    assert.match(page, /Dashboard rechecked/);
    assert.match(page, /Cropster was not fetched again\./);
    assert.match(page, /cropsterRefreshText\(/);
  }
});

test("expanded source lines use original Cropster capture timestamps rather than the dashboard check time", () => {
  const metric = { source: "Cropster", asOf: captured.toISOString(), generatedAt: checked.toISOString() };
  const weeklyScript = weeklyPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const weeklyStart = weeklyScript.indexOf("    function sourceText(metric, fallback) {");
  const weeklyEnd = weeklyScript.indexOf("    function cropsterRefreshText", weeklyStart);
  const weeklySource = new Function("formatTimestamp", "sourceNames", weeklyScript.slice(weeklyStart, weeklyEnd) + "; return sourceText;")(value => value || "", {});
  const warehouseScript = warehousePage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const warehouseStart = warehouseScript.indexOf('    function source(metric = {}, label = "Source", url) {');
  const warehouseEnd = warehouseScript.indexOf("    function metricNote", warehouseStart);
  const fakeNode = (tag, text = "") => ({ text, append(...values) { this.text += values.map(value => typeof value === "object" ? value.text : value).join(""); } });
  const warehouseSource = new Function("date", "node", warehouseScript.slice(warehouseStart, warehouseEnd) + "; return source;")(value => value || "", fakeNode);
  for (const text of [weeklySource(metric, "Cropster"), warehouseSource(metric, "Cropster saved reading").text]) {
    assert.match(text, /captured/);
    assert.ok(text.includes(captured.toISOString()));
    assert.ok(!text.includes(checked.toISOString()));
  }
});
