import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { readCropsterFriday, saveCropsterFriday } from "../worker/cropster-friday.js";
import { localDatabase } from "../scripts/local-db.mjs";

const now = new Date("2026-11-18T08:00:00Z");
const weekStart = "2026-11-09";

test("stores Friday production and Marrickville stock independently for the selected week", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveCropsterFriday(db, { weekStart: "2026-11-02", roastedKg: 100, roastedValue: 1000 }, now);
    await saveCropsterFriday(db, { weekStart, roastedKg: 150, roastedValue: 1600 }, now);
    await saveCropsterFriday(db, { weekStart, greenKg: 250, greenValue: 3500 }, now);
    const archive = await readCropsterFriday(db, weekStart);
    assert.equal(archive.production.snapshotDate, "2026-11-13");
    assert.equal(archive.production.roastedKg, 150);
    assert.equal(archive.production.previousRoastedKg, 100);
    assert.equal(archive.production.changePercent, 50);
    assert.equal(archive.production.valueChangePercent, 60);
    assert.equal(archive.production.scheduledKg, null);
    assert.equal(archive.green.snapshotDate, "2026-11-13");
    assert.equal(archive.green.location, "Marrickville");
    assert.equal(archive.green.value, 3500);
    assert.equal((await readCropsterFriday(db, "2026-11-02")).green.kg, null);
    await saveCropsterFriday(db, { weekStart, greenKg: 0, greenValue: 0 }, now);
    assert.equal((await readCropsterFriday(db, weekStart)).green.kg, 0);
    assert.equal((await readCropsterFriday(db, weekStart)).production.roastedKg, 150);
  } finally { db.close(); }
});

test("validates historical weeks and refuses readings older than the saved capture", async () => {
  const db = localDatabase(":memory:");
  try {
    for (const invalid of [
      { weekStart: "2026-11-16", greenKg: 1 }, { weekStart: "2026-11-10", greenKg: 1 },
      { weekStart, greenValue: 1 }, { weekStart, roastedKg: -1 }, { weekStart, greenKg: "1" },
    ]) await assert.rejects(saveCropsterFriday(db, invalid, now), { status: 400 });
    await saveCropsterFriday(db, { weekStart, greenKg: 2 }, now);
    await assert.rejects(saveCropsterFriday(db, { weekStart, greenKg: 3 }, new Date(now - 1000)), { status: 409 });
    assert.equal((await readCropsterFriday(db, weekStart)).green.kg, 2);
  } finally { db.close(); }
});

test("Friday captures require same-origin authenticated POSTs", async () => {
  const url = "https://dashboard.test/api/cropster-friday";
  assert.equal((await worker.fetch(new Request(url), {})).status, 405);
  assert.equal((await worker.fetch(new Request(url, {
    method: "POST", headers: { Origin: "https://dashboard.test" },
  }), {})).status, 401);
  assert.equal((await worker.fetch(new Request(url, {
    method: "POST", headers: { Origin: "https://another.test" },
  }), {})).status, 403);
});
