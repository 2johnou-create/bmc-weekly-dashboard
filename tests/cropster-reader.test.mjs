import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { saveCropsterReading, saveCropsterGreenStock } from "../worker/cropster.js";
import { readCurrentCropster, validateCropsterObservation } from "../worker/cropster-reader.js";
import { collectWeeklyReport } from "../worker/weekly-report.js";

const weekStart = "2026-11-16";
const now = new Date("2026-11-20T01:00:00Z");
const priorCapture = new Date("2026-11-19T01:00:00Z");
const token = "synthetic-cropster-reader-token-only-123456";
const jobId = "11111111-2222-4333-8444-555555555555";
const reply = result => ({ schemaVersion: "1.0", status: "complete", jobId, weekStart, result });
const fixture = () => ({ schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville",
  weekStart, periodEnd: "2026-11-20", observedAt: now.toISOString(),
  production: { roastedKg: 200, scheduledKg: 40, roastedValue: 2000, scheduledValue: 400 },
  green: { location: "Marrickville", kg: 800, value: 8000 } });
const envFor = db => ({ DB: db, CROPSTER_READER_URL: "https://synthetic-reader.onrender.com", CROPSTER_READER_TOKEN: token });
const options = (db, fetcher, extra = {}) => ({ env: envFor(db), weekStart, followingWeekStart: "2026-11-23", now, fetcher, fresh: true, ...extra });
async function seed(db) {
  await saveCropsterReading(db, { weekStart, roastedKg: 100, scheduledKg: 60, roastedValue: 1000, scheduledValue: 600,
    previousRoastedKg: 150, previousScheduledKg: 0, previousRoastedValue: 1500, previousScheduledValue: 0 }, weekStart, priorCapture);
  await saveCropsterGreenStock(db, { kg: 900, value: 9000 }, priorCapture);
}

test("verified prior-week source observations replace comparisons while omitted observations retain them", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  const reading = fixture();
  reading.previousProduction = { weekStart: "2026-11-09", periodEnd: "2026-11-13", roastedKg: 175, roastedValue: 1700, scheduledKg: 0, scheduledValue: 0 };
  reading.previousProductionObservedAt = now.toISOString();
  try {
    const result = await readCurrentCropster(options(db, async () => Response.json(reply(reading))));
    assert.equal(result.production.previousKg, 175);
    assert.equal(result.production.previousValue, 1700);
    assert.equal(result.refresh.previousFetched, true);
    const next = await readCurrentCropster(options(db, async () => Response.json(reply(fixture()))));
    assert.equal(next.production.previousKg, 175);
    assert.equal(next.refresh.previousFetched, false);
  } finally { db.close(); }
});

test("approved server-side classification preserves plan/history separately from fresh Cropster links", async () => {
  const db = localDatabase(":memory:");
  const reading = fixture();
  reading.lab = { recipes: { asOf: "2026-11-20", rows: [{ name: "Fixture blend", signature: "Liberty", components: [{ name: "Fixture ingredient", coffee: "Fixture coffee", percent: 100, profileGroupId: "group-A" }] }],
    runoutProfiles: [{ id: "group-A", name: "Fixture ingredient", lotIds: ["PG-CURRENT"], linksComplete: true }], runoutLotNames: [] } };
  const env = { ...envFor(db), CROPSTER_PROFILE_ASSIGNMENTS_JSON: JSON.stringify({ "group-A": { plannedLotIds: ["PG-PLAN"], historicalLotIds: ["PG-HISTORY"] } }) };
  try {
    const result = await readCurrentCropster(options(db, async () => Response.json(reply(reading)), { env }));
    assert.equal(result.refresh.labParts.recipes.status, "updated");
    const row = await db.prepare("SELECT data_json FROM dashboard_roastery_lab_cropster WHERE part = ?").bind("recipes").first();
    const group = JSON.parse(row.data_json).runoutProfiles[0];
    assert.deepEqual(group.cropsterLotIds, ["PG-CURRENT"]);
    assert.deepEqual(group.plannedLotIds, ["PG-PLAN"]);
    assert.deepEqual(group.historicalLotIds, ["PG-HISTORY"]);
    assert.deepEqual(group.lotIds, ["PG-CURRENT", "PG-PLAN", "PG-HISTORY"]);
  } finally { db.close(); }
});

test("Refresh re-reads changing website observations, saves source time, and preserves comparison figures", async () => {
  const db = localDatabase(":memory:");
  await seed(db);
  let pending = 40, calls = 0;
  const fetcher = async (url, init) => {
    calls++;
    assert.equal(url, "https://synthetic-reader.onrender.com/v1/sync");
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(init.body), { weekStart });
    const reading = fixture(); reading.production.scheduledKg = pending;
    return Response.json(reply(reading));
  };
  try {
    const first = await readCurrentCropster(options(db, fetcher));
    assert.equal(first.production.scheduledKg, 40);
    assert.equal(first.production.totalKg, 240);
    assert.equal(first.production.previousKg, 150);
    assert.equal(first.production.previousValue, 1500);
    assert.equal(first.production.asOf, now.toISOString());
    assert.equal(first.green.kg, 800);
    assert.equal(first.refresh.fetched, true);
    assert.equal(first.refresh.greenFetched, true);
    assert.equal(first.refresh.status, "refreshed");
    assert.doesNotMatch(first.production.note, /does not fetch Cropster again/);
    pending = 0;
    const second = await readCurrentCropster(options(db, fetcher));
    assert.equal(second.production.scheduledKg, 0);
    assert.equal(second.production.totalKg, 200);
    assert.equal(calls, 2);
    const automatic = await readCurrentCropster(options(db, fetcher, { fresh: false }));
    assert.equal(calls, 2);
    assert.equal(automatic.production.scheduledKg, 0);
    assert.equal(automatic.refresh.status, "saved");
    assert.equal(automatic.refresh.fetched, false);
  } finally { db.close(); }
});

test("a failed website read retains the original saved values and capture time without leaking the error", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  try {
    const result = await readCurrentCropster(options(db, async () => { throw new Error("sensitive-source-detail"); }));
    assert.equal(result.refresh.status, "failed");
    assert.equal(result.refresh.fetched, false);
    assert.equal(result.production.scheduledKg, 60);
    assert.equal(result.production.asOf, priorCapture.toISOString());
    assert.equal(result.green.asOf, priorCapture.toISOString());
    assert.doesNotMatch(JSON.stringify(result), /sensitive-source-detail|synthetic-cropster-reader-token/);
  } finally { db.close(); }
});

test("a missing green observation retains its own original date while production updates", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  const reading = fixture(); reading.green = null; reading.greenObservedAt = null;
  reading.mondayRoastedKg = null; reading.mondayObservedAt = null;
  try {
    const result = await readCurrentCropster(options(db, async () => Response.json(reply(reading))));
    assert.equal(result.production.scheduledKg, 40);
    assert.equal(result.production.asOf, now.toISOString());
    assert.equal(result.green.kg, 900);
    assert.equal(result.green.asOf, priorCapture.toISOString());
    assert.equal(result.refresh.greenFetched, false);
    assert.match(result.refresh.note, /Green stock keeps its original capture time/);
  } finally { db.close(); }
});

test("concurrent manual refreshes share one website capture and persistence operation", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  let resolveRead, calls = 0;
  const result = new Promise(resolve => { resolveRead = resolve; });
  const fetcher = async () => { calls++; await result; return Response.json(reply(fixture())); };
  try {
    const first = readCurrentCropster(options(db, fetcher));
    const second = readCurrentCropster(options(db, fetcher));
    assert.equal(calls, 1);
    resolveRead();
    const reports = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.ok(reports.every(report => report.refresh.fetched && report.production.scheduledKg === 40));
  } finally { db.close(); }
});

test("a newer saved reading wins over an older browser capture", async () => {
  const db = localDatabase(":memory:");
  const newer = new Date(now.getTime() + 30_000);
  await saveCropsterReading(db, { weekStart, roastedKg: 250, scheduledKg: 10 }, weekStart, newer);
  try {
    const result = await readCurrentCropster(options(db, async () => Response.json(reply(fixture()))));
    assert.equal(result.refresh.fetched, false);
    assert.equal(result.production.roastedKg, 250);
    assert.equal(result.production.scheduledKg, 10);
    assert.equal(result.production.asOf, newer.toISOString());
  } finally { db.close(); }
});

test("observations reject wrong weeks, scope, timestamps and quantities rather than inventing zero", () => {
  const invalid = [
    value => { value.weekStart = "2026-11-09"; }, value => { value.periodEnd = "2026-11-22"; },
    value => { value.location = "All locations"; }, value => { value.sourceSystem = "other"; },
    value => { value.observedAt = priorCapture.toISOString(); }, value => { value.observedAt = "2026-11-20T05:00:00Z"; },
    value => { value.production.scheduledKg = null; }, value => { value.production.scheduledKg = "40"; },
    value => { value.production.roastedKg = -1; }, value => { delete value.production.roastedValue; },
    value => { value.green.location = "IAC"; }, value => { value.green.value = Infinity; },
  ];
  for (const mutate of invalid) { const value = fixture(); mutate(value); assert.throws(() => validateCropsterObservation(value, weekStart, now)); }
  const zero = fixture(); zero.production.scheduledKg = 0; zero.production.scheduledValue = 0;
  assert.equal(validateCropsterObservation(zero, weekStart, now).production.scheduledKg, 0);
});

test("a slow background capture keeps each section's actual observation time", () => {
  const value = fixture();
  const sectionTime = new Date(Date.parse(value.observedAt) - 1_800_000).toISOString();
  value.greenObservedAt = sectionTime;
  value.mondayObservedAt = sectionTime;
  const result = validateCropsterObservation(value, weekStart, now);
  assert.equal(result.greenObservedAt.toISOString(), sectionTime);
  assert.equal(result.mondayObservedAt.toISOString(), sectionTime);
  value.greenObservedAt = new Date(Date.parse(value.observedAt) - 1_860_001).toISOString();
  assert.throws(() => validateCropsterObservation(value, weekStart, now));
});

test("running and failed jobs can persist verified checkpoints without claiming completion", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  try {
    for (const status of ["running", "failed"]) {
      const reading = fixture();
      reading.production.scheduledKg = status === "running" ? 25 : 20;
      const result = await readCurrentCropster(options(db, async () => Response.json({ ...reply(reading), status })));
      assert.equal(result.refresh.status, status === "running" ? "pending" : "failed");
      assert.equal(result.refresh.readerStatus, status);
      assert.equal(result.refresh.accepted, true);
      assert.equal(result.refresh.fetched, true);
      assert.equal(result.production.scheduledKg, reading.production.scheduledKg);
      assert.equal(result.refresh.labParts.recipes.status, status === "running" ? "pending" : "failed");
      assert.doesNotMatch(result.refresh.note, /all.*updated/i);
    }
  } finally { db.close(); }
});

test("newer independent sections survive an older production checkpoint", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  const newer = new Date(now.getTime() + 30_000);
  await saveCropsterReading(db, { weekStart, roastedKg: 250, scheduledKg: 10, roastedValue: 2500, scheduledValue: 100 }, weekStart, newer);
  const reading = fixture();
  reading.lab = { inventory: { asOf: "2026-11-20", allLocationsComplete: true, totalKg: 800,
    rows: [{ name: "Fixture coffee", location: "Marrickville", lotId: "PG-0001", kg: 800, pricePerKg: 10 }] } };
  try {
    const result = await readCurrentCropster(options(db, async () => Response.json({ ...reply(reading), status: "running" })));
    assert.equal(result.refresh.status, "pending");
    assert.equal(result.refresh.fetched, false);
    assert.equal(result.refresh.accepted, true);
    assert.equal(result.production.roastedKg, 250);
    assert.equal(result.production.asOf, newer.toISOString());
    assert.equal(result.green.kg, 800);
    assert.equal(result.green.asOf, now.toISOString());
    assert.equal(result.refresh.labParts.inventory.status, "updated");
    assert.equal((await db.prepare("SELECT recorded_at FROM dashboard_roastery_lab_cropster WHERE part = 'inventory'").first()).recorded_at, now.getTime());
  } finally { db.close(); }
});

test("slow running jobs retain a verified older checkpoint and its actual capture dates", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  const reading = fixture();
  reading.observedAt = new Date(now.getTime() - 600_000).toISOString();
  try {
    assert.throws(() => validateCropsterObservation(reading, weekStart, now));
    const result = await readCurrentCropster(options(db, async () => Response.json({ ...reply(reading), status: "running" })));
    assert.equal(result.refresh.status, "pending");
    assert.equal(result.refresh.readerStatus, "running");
    assert.equal(result.production.scheduledKg, 40);
    assert.equal(result.production.asOf, reading.observedAt);
    assert.equal(result.green.asOf, reading.observedAt);
    const expired = await readCurrentCropster(options(db, async () => Response.json({}, { status: 404 }), { jobId }));
    assert.equal(expired.refresh.status, "failed");
    assert.equal(expired.refresh.readerStatus, "expired");
    assert.equal(expired.production.asOf, reading.observedAt);
  } finally { db.close(); }
});

test("the reader connection uses Worker-supported redirect handling and never follows credentialed redirects", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  let calls = 0;
  const workerFetch = async (_url, init) => {
    calls++;
    if (init.redirect === "error") throw new TypeError("Worker runtime does not implement redirect error mode.");
    assert.equal(init.redirect, "manual");
    return calls === 1 ? Response.json(reply(fixture())) : new Response(null, { status: 302, headers: { Location: "https://other.invalid/" } });
  };
  try {
    const live = await readCurrentCropster(options(db, workerFetch));
    assert.equal(live.refresh.fetched, true);
    const redirected = await readCurrentCropster(options(db, workerFetch));
    assert.equal(calls, 2);
    assert.equal(redirected.refresh.fetched, false);
    assert.equal(redirected.production.asOf, now.toISOString());
  } finally { db.close(); }
});

test("invalid bridge configuration and oversized replies do not change saved readings", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  try {
    const configResult = await readCurrentCropster(options(db, () => { assert.fail("must not send credentials"); },
      { env: { ...envFor(db), CROPSTER_READER_URL: "https://unapproved.test" } }));
    assert.equal(configResult.refresh.status, "failed");
    assert.equal(configResult.production.scheduledKg, 60);
    const oversized = await readCurrentCropster(options(db, async () => new Response("x".repeat(360_000), { headers: { "Content-Type": "application/json" } })));
    assert.equal(oversized.refresh.fetched, false);
    assert.equal(oversized.production.asOf, priorCapture.toISOString());
  } finally { db.close(); }
});

test("current-week report verifies Stockroom before reading Cropster and skips it for historical weeks", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  const calls = [];
  const fetcher = async (address, init) => {
    const url = new URL(address); calls.push(url.hostname);
    if (url.pathname === "/api/inventory") return Response.json({ items: [] });
    if (url.hostname === "synthetic-reader.onrender.com") return Response.json(reply(fixture()));
    return new Response(null, { status: 503 });
  };
  try {
    const result = await collectWeeklyReport({ env: envFor(db), weekStart, now, fresh: true, stockroomCookie: "synthetic", fetcher });
    assert.equal(calls[0], "bmc-stockroom.misty-jelly-1931.chatgpt.site");
    assert.equal(result.metrics.production.scheduledKg, 40);
    assert.equal(result.cropsterRefresh.fetched, true);
    calls.length = 0;
    await collectWeeklyReport({ env: envFor(db), weekStart: "2026-11-09", now, fresh: true, stockroomCookie: "synthetic", fetcher });
    assert.ok(!calls.includes("synthetic-reader.onrender.com"));
    let bridgeRead = false;
    await assert.rejects(collectWeeklyReport({ env: envFor(db), weekStart, now, fresh: true, stockroomCookie: "synthetic", fetcher: async address => {
      if (new URL(address).hostname === "synthetic-reader.onrender.com") bridgeRead = true;
      return Response.json({}, { status: 401 });
    } }));
    assert.equal(bridgeRead, false);
  } finally { db.close(); }
});

test("a transient production readback failure preserves comparison columns and cannot announce a fresh displayed reading", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  let failReadback = true;
  const wrapped = { ...db, prepare(sql) {
    if (failReadback && sql.startsWith("SELECT week_start, roasted_kg")) {
      failReadback = false;
      throw new Error("Synthetic production readback unavailable");
    }
    return db.prepare(sql);
  } };
  try {
    const result = await readCurrentCropster(options(wrapped, async () => Response.json(reply(fixture()))));
    assert.equal(result.refresh.status, "failed");
    assert.equal(result.refresh.fetched, false);
    assert.equal(result.production.roastedKg, null);
    assert.match(result.refresh.note, /saved but could not be loaded/);
    const persisted = await db.prepare("SELECT roasted_kg, scheduled_kg, previous_roasted_kg, previous_scheduled_kg, previous_roasted_value, previous_scheduled_value FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first();
    assert.equal(persisted.roasted_kg, 200);
    assert.equal(persisted.scheduled_kg, 40);
    assert.equal(persisted.previous_roasted_kg, 150);
    assert.equal(persisted.previous_scheduled_kg, 0);
    assert.equal(persisted.previous_roasted_value, 1500);
    assert.equal(persisted.previous_scheduled_value, 0);
    const recovered = await readCurrentCropster(options(wrapped, () => assert.fail("A readback retry must not start another website job"), { fresh: false }));
    assert.equal(recovered.production.roastedKg, 200);
    assert.equal(recovered.production.previousRoastedKg, 150);
    assert.equal(recovered.production.asOf, now.toISOString());
  } finally { db.close(); }
});

test("a green-stock readback failure retains production success but identifies green stock as unavailable", async () => {
  const db = localDatabase(":memory:"); await seed(db);
  let failReadback = true;
  const wrapped = { ...db, prepare(sql) {
    if (failReadback && sql.startsWith("SELECT location, kg, value, recorded_at")) {
      failReadback = false;
      throw new Error("Synthetic green-stock readback unavailable");
    }
    return db.prepare(sql);
  } };
  try {
    const result = await readCurrentCropster(options(wrapped, async () => Response.json(reply(fixture()))));
    assert.equal(result.refresh.fetched, true);
    assert.equal(result.refresh.status, "refreshed");
    assert.equal(result.refresh.greenFetched, false);
    assert.equal(result.production.scheduledKg, 40);
    assert.equal(result.green.kg, null);
    assert.match(result.refresh.note, /Green stock could not be loaded/);
    const persisted = await db.prepare("SELECT kg FROM dashboard_cropster_green_stock WHERE location = ?").bind("Marrickville").first();
    assert.equal(persisted.kg, 800);
  } finally { db.close(); }
});
