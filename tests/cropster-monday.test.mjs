import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { sealSession } from "../worker/auth.js";
import { readCropsterMonday, saveCropsterMonday } from "../worker/cropster-monday.js";
import { saveCropsterReading } from "../worker/cropster.js";
import worker from "../worker/index.js";
import { addDays, dashboardWeek, SOURCE_ORIGINS } from "../worker/metrics.js";

test("Monday's reading is durable and independent of the weekly Cropster snapshot", async () => {
  const weekStart = "2026-11-16";
  const capturedAt = new Date("2026-11-18T01:00:00Z");
  const next = new Date(capturedAt.getTime() + 1000);
  const directory = mkdtempSync(join(tmpdir(), "bmc-monday-test-"));
  const filename = join(directory, "fixture.sqlite");
  let db = localDatabase(filename);
  try {
    assert.equal(await readCropsterMonday({ db, weekStart }), null);
    await saveCropsterReading(db, { weekStart, roastedKg: 400, greenKg: 20 }, weekStart, capturedAt);
    await saveCropsterMonday(db, { weekStart, roastedKg: 123.45 }, weekStart, capturedAt);
    assert.equal((await db.prepare("SELECT roasted_kg FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first()).roasted_kg, 400);

    db.close();
    db = localDatabase(filename);
    await saveCropsterReading(db, { weekStart, roastedKg: 528, greenKg: 24 }, weekStart, next);
    assert.deepEqual(await readCropsterMonday({ db, weekStart }), { kg: 123.45, asOf: capturedAt.toISOString() });
    assert.equal(await readCropsterMonday({ db, weekStart: addDays(weekStart, -7) }), null);

    await saveCropsterMonday(db, { weekStart, roastedKg: 0 }, weekStart, next);
    await assert.rejects(saveCropsterMonday(db, { weekStart, roastedKg: 120 }, weekStart, capturedAt), error => error.status === 409);
    assert.deepEqual(await readCropsterMonday({ db, weekStart }), { kg: 0, asOf: next.toISOString() });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Monday capture route requires a live Stockroom session and validates current-week inputs", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-monday-test-session-secret-1234567890" };
  const origin = "https://dashboard.test";
  const endpoint = origin + "/api/cropster-monday";
  const current = dashboardWeek().start;
  const originalFetch = globalThis.fetch;
  let authorised = false;
  let reads = 0;
  globalThis.fetch = async url => {
    assert.equal(url, `${SOURCE_ORIGINS.stockroom}/api/inventory`);
    reads++;
    return Response.json({ items: [] }, { status: authorised ? 200 : 401 });
  };

  try {
    const seal = await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_monday_test_source_session");
    const cookie = seal.split(";")[0];
    const makePost = (body, headers = {}) => new Request(endpoint, {
      method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body,
    });
    const input = { weekStart: current, roastedKg: 123.45 };
    const getResponse = await worker.fetch(new Request(endpoint), env);
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("Allow"), "POST");
    assert.equal((await worker.fetch(makePost("{}", { Origin: "https://other.test" }), env)).status, 403);
    assert.equal((await worker.fetch(makePost("{}", { Cookie: "" }), env)).status, 401);
    assert.equal(reads, 0);
    assert.equal((await worker.fetch(makePost(JSON.stringify(input)), env)).status, 401);
    assert.equal(reads, 1);

    authorised = true;
    for (const invalid of [
      { ...input, weekStart: addDays(current, -7) }, { ...input, weekStart: addDays(current, 7) },
      { ...input, roastedKg: -1 }, { ...input, roastedKg: "123.45" }, { weekStart: current },
      { ...input, captureTime: "2026-11-18T01:00:00Z" },
    ]) assert.equal((await worker.fetch(makePost(JSON.stringify(invalid)), env)).status, 400);
    assert.equal((await worker.fetch(makePost(" ".repeat(513)), env)).status, 413);
    assert.equal(await readCropsterMonday({ db, weekStart: current }), null);

    const response = await worker.fetch(makePost(JSON.stringify(input)), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    const saved = await response.json();
    assert.deepEqual(Object.keys(saved), ["ok", "weekStart", "asOf"]);
    assert.equal(saved.ok, true);
    assert.equal(saved.weekStart, current);
    assert.deepEqual(await readCropsterMonday({ db, weekStart: current }), { kg: 123.45, asOf: saved.asOf });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
