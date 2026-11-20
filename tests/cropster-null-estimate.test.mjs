import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { ingestCropsterSync, readCurrentCropster, validateCropsterObservation } from "../worker/cropster-reader.js";
import { saveCropsterReading } from "../worker/cropster.js";
import { sourceSyncSummary } from "../worker/source-sync.js";

const weekStart = "2026-11-16";
const now = new Date("2026-11-20T01:00:00.000Z");
const jobId = "11111111-2222-4333-8444-555555555555";
const fixture = (capturedAt = now) => ({
  schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville",
  weekStart, periodEnd: "2026-11-20", observedAt: capturedAt.toISOString(), productionObservedAt: capturedAt.toISOString(),
  production: { roastedKg: 200, scheduledKg: null, roastedValue: 2000, scheduledValue: 300 },
  scheduledBatches: { greenKg: 120, batches: 4 },
});
const ingest = (db, input, time = now) => ingestCropsterSync({ env: { DB: db }, weekStart, jobId, input, now: time });
const productionSource = result => sourceSyncSummary({ weekly: {
  generatedAt: now.toISOString(), metrics: { production: result.production }, cropsterRefresh: result.refresh,
} }).sources.find(source => source.id === "production");

test("unknown optional output estimate saves verified actual output and pending green batches without inventing a projection", async () => {
  const db = localDatabase(":memory:");
  try {
    const result = await ingest(db, fixture());
    assert.equal(result.refresh.status, "refreshed");
    assert.equal(result.refresh.fetched, true);
    assert.equal(result.refresh.scheduledBatchesFetched, true);
    assert.equal(result.production.roastedKg, 200);
    assert.equal(result.production.scheduledGreenKg, 120);
    assert.equal(result.production.scheduledBatchCount, 4);
    assert.equal(result.production.scheduledKg, null);
    assert.equal(result.production.totalKg, null);
    assert.equal(result.production.changePercent, null);
    assert.equal(result.production.value, 2300);
    assert.equal(result.production.asOf, now.toISOString());
    assert.match(result.production.note, /remaining roasted-output estimate is unavailable/);
    assert.match(result.production.note, /green input and batch count were verified/);
    assert.doesNotMatch(result.production.note, /Outstanding scheduled kilograms are unavailable/);
    assert.equal(productionSource(result).status, "partial");
    assert.match(productionSource(result).note, /roasted-output estimate is unavailable/);
    const row = await db.prepare("SELECT roasted_kg, scheduled_kg, scheduled_value FROM dashboard_cropster_readings").first();
    assert.deepEqual({ ...row }, { roasted_kg: 200, scheduled_kg: null, scheduled_value: 300 });
  } finally { db.close(); }
});

test("fresh website readback accepts the nullable estimate and a saved reread retains the exact verified capture", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, CROPSTER_READER_URL: "https://synthetic-reader.onrender.com", CROPSTER_READER_TOKEN: "synthetic-reader-token-123456789012345678901234" };
  const options = { env, weekStart, followingWeekStart: "2026-11-23", now };
  try {
    const result = await readCurrentCropster({ ...options, fresh: true, fetcher: async () => Response.json({
      schemaVersion: "1.0", status: "complete", weekStart, jobId, result: fixture(),
    }) });
    assert.equal(result.refresh.status, "refreshed");
    assert.equal(result.refresh.fetched, true);
    assert.equal(result.production.scheduledGreenKg, 120);
    const saved = await readCurrentCropster(options);
    assert.equal(saved.refresh.status, "saved");
    assert.equal(saved.production.asOf, now.toISOString());
    assert.equal(saved.production.scheduledKg, null);
    assert.equal(saved.production.scheduledGreenKg, 120);
    assert.equal(saved.production.totalKg, null);
  } finally { db.close(); }
});

test("nullable output requires an explicit null and verified pending batches while legacy numeric observations remain valid", () => {
  assert.equal(validateCropsterObservation(fixture(), weekStart, now).production.scheduledKg, null);
  for (const change of [
    input => { delete input.production.scheduledKg; },
    input => { input.production.scheduledKg = "unknown"; },
    input => { input.production.roastedKg = null; },
    input => { delete input.scheduledBatches; },
    input => { input.scheduledBatches = { greenKg: 120, batches: 0 }; },
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => validateCropsterObservation(input, weekStart, now));
  }
  const legacy = fixture();
  legacy.production.scheduledKg = 25;
  delete legacy.scheduledBatches;
  assert.equal(validateCropsterObservation(legacy, weekStart, now).production.scheduledKg, 25);
});

test("older nullable captures cannot replace newer actual or pending readings, and comparisons survive a new nullable capture", async () => {
  const db = localDatabase(":memory:");
  const prior = new Date(now.getTime() - 60_000);
  const later = new Date(now.getTime() + 60_000);
  try {
    await saveCropsterReading(db, { weekStart, roastedKg: 100, scheduledKg: 20,
      previousRoastedKg: 150, previousScheduledKg: 0, previousRoastedValue: 1500, previousScheduledValue: 0 }, weekStart, prior);
    const result = await ingest(db, fixture());
    assert.equal(result.production.previousKg, 150);
    assert.equal(result.production.roastedChangePercent, 33.3);
    const next = fixture(later);
    next.production.roastedKg = 220;
    next.production.scheduledKg = 15;
    next.scheduledBatches = { greenKg: 90, batches: 3 };
    await ingest(db, next, later);
    const old = await ingest(db, fixture(), later);
    assert.equal(old.refresh.fetched, false);
    assert.equal(old.refresh.scheduledBatchesFetched, false);
    assert.equal(old.production.asOf, later.toISOString());
    assert.equal(old.production.roastedKg, 220);
    assert.equal(old.production.scheduledKg, 15);
    assert.equal(old.production.totalKg, 235);
    assert.equal(old.production.scheduledGreenKg, 90);
  } finally { db.close(); }
});

test("optional missing costs also remain partial rather than marking known actual and raw schedule as failed", async () => {
  const db = localDatabase(":memory:");
  try {
    const input = fixture();
    input.production.scheduledKg = 25;
    input.production.roastedValue = null;
    input.production.scheduledValue = null;
    const result = await ingest(db, input);
    assert.equal(result.refresh.status, "refreshed");
    assert.equal(result.production.totalKg, 225);
    assert.equal(result.production.value, null);
    assert.equal(productionSource(result).status, "partial");
    input.production.roastedValue = 2000;
    input.production.scheduledValue = 300;
    const complete = await ingest(db, input);
    assert.equal(productionSource(complete).status, "updated");
  } finally { db.close(); }
});
