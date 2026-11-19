import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localDatabase } from "../scripts/local-db.mjs";
import { ingestCropsterSync, readCurrentCropster, validateCropsterObservation } from "../worker/cropster-reader.js";
import { saveCropsterReading } from "../worker/cropster.js";
import { readCropsterScheduledBatches, saveCropsterScheduledBatches, validateCropsterScheduledBatches } from "../worker/cropster-scheduled-batches.js";
import { weeklyPage } from "../worker/weekly-ui.js";
import { warehousePage } from "../worker/warehouse-ui.js";

const weekStart = "2026-11-16";
const now = new Date("2026-11-20T01:00:00.000Z");
const jobId = "11111111-2222-4333-8444-555555555555";
const scheduledBatches = {greenKg: 120, batches: 4};
const observation = (capturedAt = now, scheduled = scheduledBatches) => ({
  schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville", weekStart, periodEnd: "2026-11-20",
  observedAt: capturedAt.toISOString(), productionObservedAt: capturedAt.toISOString(),
  production: {roastedKg: 200, scheduledKg: 25, roastedValue: 2000, scheduledValue: 300}, scheduledBatches: scheduled,
});
const ingest = (db, input, time = now) => ingestCropsterSync({env: {DB: db}, weekStart, jobId, input, now: time});

test("pending green batch totals persist separately and never replace the estimated roasted-output calculation", async () => {
  const db = localDatabase(":memory:");
  try {
    const result = await ingest(db, observation());
    assert.equal(result.refresh.scheduledBatchesFetched, true);
    assert.equal(result.production.scheduledGreenKg, 120);
    assert.equal(result.production.scheduledBatchCount, 4);
    assert.equal(result.production.scheduledKg, 25);
    assert.equal(result.production.totalKg, 225);
    assert.equal(result.production.value, 2300);
    const row = await db.prepare("SELECT * FROM dashboard_cropster_scheduled_batches").first();
    assert.deepEqual({...row}, {week_start: weekStart, green_kg: 120, batches: 4, recorded_at: now.getTime()});
  } finally {db.close();}
});

test("scheduled totals cover the week and do not expire merely because the Sydney day changes", async () => {
  const db = localDatabase(":memory:");
  const monday = new Date("2026-11-16T12:59:00.000Z");
  try {
    await ingest(db, observation(monday), monday);
    const tuesday = new Date("2026-11-16T13:01:00.000Z");
    const result = await readCurrentCropster({env: {DB: db}, weekStart, followingWeekStart: "2026-11-23", now: tuesday});
    assert.equal(result.production.scheduledGreenKg, 120);
    assert.equal(result.production.scheduledBatchCount, 4);
    assert.equal(result.production.asOf, monday.toISOString());
    assert.equal(await readCropsterScheduledBatches(db, "2026-11-23"), null);
  } finally {db.close();}
});

test("verified empty pending batches remain zero, while older payloads remain unknown rather than using the output estimate", async () => {
  const db = localDatabase(":memory:");
  try {
    const result = await ingest(db, observation(now, {greenKg: 0, batches: 0}));
    assert.equal(result.production.scheduledGreenKg, 0);
    assert.equal(result.production.scheduledBatchCount, 0);
    const later = new Date(now.getTime() + 60_000);
    const legacy = observation(later);
    delete legacy.scheduledBatches;
    assert.equal(validateCropsterObservation(legacy, weekStart, later).scheduledBatches, null);
    const old = await ingest(db, legacy, later);
    assert.equal(old.production.scheduledGreenKg, null);
    assert.equal(old.production.scheduledBatchCount, null);
    assert.equal(old.production.scheduledKg, 25);
    assert.equal(old.production.totalKg, 225);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM dashboard_cropster_scheduled_batches").first()).count, 1);
  } finally {db.close();}
});

test("late older source results cannot restore batch totals from an obsolete production capture", async () => {
  const db = localDatabase(":memory:");
  const later = new Date(now.getTime() + 60_000);
  try {
    await ingest(db, observation());
    await ingest(db, observation(later, {greenKg: 90, batches: 3}), later);
    const old = await ingest(db, observation(now, {greenKg: 900, batches: 30}), later);
    assert.equal(old.refresh.scheduledBatchesFetched, false);
    assert.equal(old.production.scheduledGreenKg, 90);
    assert.equal(old.production.scheduledBatchCount, 3);
    assert.equal(old.production.asOf, later.toISOString());
    await assert.rejects(saveCropsterScheduledBatches(db, scheduledBatches, weekStart, now), {status: 409});
  } finally {db.close();}
});

test("the scheduled-batch write requires an exact registered production capture, including a newer-write race", async () => {
  const db = localDatabase(":memory:");
  try {
    await assert.rejects(saveCropsterScheduledBatches(db, scheduledBatches, weekStart, now), {status: 409});
    await saveCropsterReading(db, {weekStart, roastedKg: 200, scheduledKg: 25}, weekStart, now);
    const later = new Date(now.getTime() + 1);
    await saveCropsterReading(db, {weekStart, roastedKg: 210, scheduledKg: 20}, weekStart, later);
    await assert.rejects(saveCropsterScheduledBatches(db, scheduledBatches, weekStart, now), {status: 409});
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM dashboard_cropster_scheduled_batches").first()).count, 0);
  } finally {db.close();}
});

test("malformed pending totals are rejected without day-specific constraints or guessed batch counts", () => {
  assert.deepEqual(validateCropsterScheduledBatches(scheduledBatches, weekStart, now), scheduledBatches);
  assert.equal(validateCropsterScheduledBatches(null, weekStart, now), null);
  for (const input of [
    {greenKg: -1, batches: 4}, {greenKg: "120", batches: 4}, {greenKg: 1_000_001, batches: 4},
    {greenKg: 120, batches: 0}, {greenKg: 0, batches: 4}, {greenKg: 120, batches: 1.5},
    {greenKg: 120, batches: "4"}, {greenKg: 120, batches: -1}, {greenKg: 120},
    {...scheduledBatches, unsupported: "value"},
  ]) assert.throws(() => validateCropsterScheduledBatches(input, weekStart, now), {status: 400});
  assert.throws(() => validateCropsterScheduledBatches(scheduledBatches, "2026-11-17", now), {status: 400});
});

test("the additive weekly migration preserves production and creates no fabricated scheduled batch rows", async () => {
  const directory = mkdtempSync(join(tmpdir(), "weekly-cropster-batches-"));
  const filename = join(directory, "test.sqlite");
  const migrations = new URL("../drizzle/", import.meta.url);
  try {
    const previous = new DatabaseSync(filename);
    previous.exec("CREATE TABLE local_schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    for (const file of readdirSync(migrations).filter(name => /^000\d_.+\.sql$/.test(name)).sort()) {
      previous.exec(readFileSync(new URL(file, migrations), "utf8"));
      previous.prepare("INSERT INTO local_schema_migrations VALUES (?, ?)").run(file, now.getTime());
    }
    previous.prepare("INSERT INTO dashboard_cropster_readings(week_start, roasted_kg, scheduled_kg, recorded_at) VALUES (?, ?, ?, ?)").run(weekStart, 200, 25, now.getTime());
    previous.close();
    let db = localDatabase(filename);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM dashboard_cropster_scheduled_batches").first()).count, 0);
    assert.equal((await db.prepare("SELECT roasted_kg FROM dashboard_cropster_readings").first()).roasted_kg, 200);
    await saveCropsterScheduledBatches(db, scheduledBatches, weekStart, now);
    db.close();
    db = localDatabase(filename);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM local_schema_migrations WHERE filename = '0010_cropster_scheduled_batches.sql'").first()).count, 1);
    assert.deepEqual(await readCropsterScheduledBatches(db, weekStart), {...scheduledBatches, asOf: now.toISOString()});
    db.close();
  } finally {rmSync(directory, {recursive: true, force: true});}
});

function renderedProduction(production, isCurrent = true) {
  const source = weeklyPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = source.indexOf("    function scheduledBatchValues(");
  const end = source.indexOf("    function renderGreen(", start);
  const elements = new Map();
  const el = id => {if (!elements.has(id)) elements.set(id, {textContent: "", hidden: false}); return elements.get(id);};
  const prelude = `const {el} = deps;
    const set = (id, text) => {el(id).textContent = text;};
    const format = value => Number.isFinite(value) ? String(value) : '—';
    const weight = value => format(value) + ' kg', money = format, detailKg = {}, detailCurrency = {}, amount = {format};
    const comparison = () => '', statusText = () => '';
    const weightHeadline = set, renderComparison = (id, text, fallback) => set(id, text || fallback);
    const showText = set, sourceText = () => '', weekRange = () => '', cropsterProductionUrl = () => '', changeWeek = value => value;
  `;
  const render = new Function("deps", prelude + source.slice(start, end) + "; return renderProduction;")({el});
  render(production, {start: weekStart, end: "2026-11-22", isCurrent}, "previous week");
  return el;
}

test("one weekly card shows pending green batches while its estimate is confined to expected-output math and detail", () => {
  const production = {roastedKg: 200, scheduledKg: 25, totalKg: 225, value: 2300, asOf: now.toISOString(), scheduledGreenKg: 120, scheduledBatchCount: 4};
  const el = renderedProduction(production);
  assert.equal(el("productionKg").textContent, 225);
  assert.equal(el("productionTotalLabel").textContent, "Expected roasted output this week");
  assert.equal(el("roastedKg").textContent, "200 kg");
  assert.equal(el("scheduledKg").textContent, "120 kg green");
  assert.equal(el("scheduledBatchCount").textContent, "4 pending batches");
  assert.equal(el("scheduledDetailKg").textContent, "25 kg");
  assert.equal(renderedProduction({...production, scheduledGreenKg: null, scheduledBatchCount: null})("scheduledKg").textContent, "Unavailable");
  assert.equal(renderedProduction(production, false)("productionPair").hidden, true);
  assert.doesNotMatch(weeklyPage, /Today's scheduled batches/);
  assert.match(weeklyPage, /pending green input from Cropster Scheduled batches, Monday to Friday, excluding roasted batches/);
});

test("Warehouse displays the same raw pending schedule and never substitutes the estimated output", () => {
  const source = warehousePage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = source.indexOf("    function scheduledBatchValues(");
  const end = source.indexOf("    function overviewPanel(", start);
  const select = new Function(source.slice(start, end) + "; return scheduledBatchValues;")();
  assert.deepEqual(select({scheduledGreenKg: 120, scheduledBatchCount: 4, scheduledKg: 25}), {greenKg: 120, batches: 4});
  assert.equal(select({scheduledKg: 25}), null);
  assert.deepEqual(select({scheduledGreenKg: 0, scheduledBatchCount: 0}), {greenKg: 0, batches: 0});
  assert.doesNotMatch(warehousePage, /Today's scheduled batches/);
});
