import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { sourceSyncSummary, saveSourceSyncLog, readSourceSyncLog } from "../worker/source-sync.js";

test("readable partial app data is distinguished from a failed connection", () => {
  const summary = sourceSyncSummary({ weekly: { generatedAt: "2026-11-20T00:00:00Z", metrics: {
    stock: { status: "partial", asOf: "2026-11-15T00:00:00Z", note: "Two stocked items need prices." },
    wholesale: { status: "partial", note: "The current plan is provisional." },
  } } });
  assert.equal(summary.status, "partial");
  assert.equal(summary.sources.find(source => source.id === "stocktake").status, "partial");
  assert.equal(summary.sources.find(source => source.id === "dispatch").status, "partial");
  assert.match(summary.sources.find(source => source.id === "stocktake").note, /need prices/);
  assert.doesNotMatch(summary.message, /All card sources updated/);
});

test("late progress and transport failures cannot regress a completed sync log", async () => {
  const db = localDatabase(":memory:");
  const id = crypto.randomUUID(), week = "2026-11-16", now = new Date("2026-11-20T00:00:00Z");
  const base = { status: "partial", sources: [], message: "Fixture progress." };
  try {
    await saveSourceSyncLog(db, id, week, { ...base, jobStatus: "running" }, now);
    await saveSourceSyncLog(db, id, week, { ...base, jobStatus: "complete", message: "Fixture complete." }, new Date(+now + 100));
    for (const jobStatus of ["running", "failed"]) await saveSourceSyncLog(db, id, week, { ...base, jobStatus }, new Date(+now + 200));
    assert.equal((await readSourceSyncLog(db, id, week)).jobStatus, "complete");
    assert.equal((await readSourceSyncLog(db, id, week)).message, "Fixture complete.");
    // Legacy reports do not carry a browser job status, but still update normally.
    const legacy = crypto.randomUUID();
    await saveSourceSyncLog(db, legacy, week, base, now);
    await saveSourceSyncLog(db, legacy, week, { ...base, message: "Fixture changed." }, new Date(+now + 100));
    assert.equal((await readSourceSyncLog(db, legacy, week)).message, "Fixture changed.");
  } finally { db.close(); }
});
