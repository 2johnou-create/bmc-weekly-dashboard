import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { sealSession } from "../worker/auth.js";
import { readCropsterReadings, saveCropsterGreenStock, saveCropsterReading } from "../worker/cropster.js";
import worker from "../worker/index.js";
import { addDays, dashboardWeek, SOURCE_ORIGINS } from "../worker/metrics.js";

const weekStart = "2026-11-16";
const now = new Date("2026-11-18T01:00:00Z");
const synthetic = {
  weekStart, roastedKg: 82.25, scheduledKg: 42.75, roastedValue: 1000.25, scheduledValue: 249.75,
  previousRoastedKg: 100, previousScheduledKg: 0, previousRoastedValue: 1250, previousScheduledValue: 0,
  greenKg: 240.025, greenValue: 3004.27,
};
const marrickville = { kg: 123.45, value: 1895.12 };
const read = (db, start = weekStart, time = now) => readCropsterReadings({ db, weekStart: start, followingWeekStart: addDays(start, 7), now: time });

test("migration preserves legacy production and never displays unscoped green stock as Marrickville", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bmc-cropster-test-"));
  const filename = join(directory, "fixture.sqlite");
  let db;
  try {
    const previousDb = new DatabaseSync(filename);
    const migrations = new URL("../drizzle/", import.meta.url);
    try {
      previousDb.exec("CREATE TABLE local_schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
      for (const file of readdirSync(migrations).filter(name => /^000[0-2]_.+\.sql$/.test(name)).sort()) {
        previousDb.exec(readFileSync(new URL(file, migrations), "utf8"));
        previousDb.prepare("INSERT INTO local_schema_migrations VALUES (?, ?)").run(file, now.getTime());
      }
      previousDb.prepare("INSERT INTO dashboard_cropster_readings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(...Object.values(synthetic), now.getTime());
    } finally { previousDb.close(); }

    db = localDatabase(filename);
    const { production, green } = await read(db);
    assert.equal(production.status, "live");
    assert.equal(production.roastedKg, synthetic.roastedKg);
    assert.equal(production.totalKg, 125);
    assert.equal(production.changePercent, 25);
    assert.equal(production.roastedChangePercent, -17.7);
    assert.equal(production.value, 1250);
    assert.equal(production.valueChangePercent, 0);
    assert.equal(green.location, "Marrickville");
    assert.equal(green.kg, null);
    assert.equal(green.value, null);
    assert.equal(green.asOf, null);
    assert.match(production.note, /Read in Cropster.*Cost covers green coffee/);
    assert.match(green.note, /Save the Marrickville weight and value/);
    assert.equal((await db.prepare("SELECT green_kg FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first()).green_kg, synthetic.greenKg);

    await assert.rejects(db.prepare("INSERT INTO dashboard_cropster_green_stock VALUES (?, ?, ?, ?)")
      .bind("All locations", 123, null, now.getTime()).run(), /CHECK constraint/);
    assert.deepEqual(await saveCropsterGreenStock(db, marrickville, now), {
      ok: true, location: "Marrickville", ...marrickville, asOf: now.toISOString(),
    });
    db.close();
    db = localDatabase(filename);

    const older = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    assert.equal((await read(db, weekStart, older)).production.status, "stale");
    assert.equal((await read(db, weekStart, older)).green.stale, true);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an exact week may use its previous-week figures from the next reading and keeps green current", async () => {
  const db = localDatabase(":memory:");
  try {
    const { greenKg, greenValue, ...production } = synthetic;
    await saveCropsterReading(db, production, weekStart, now);
    await saveCropsterGreenStock(db, marrickville, now);
    const previous = await read(db, "2026-11-09");
    assert.equal(previous.production.roastedKg, synthetic.previousRoastedKg);
    assert.equal(previous.production.totalKg, 100);
    assert.equal(previous.production.value, 1250);
    assert.equal(previous.production.previousRoastedKg, null);
    assert.equal(previous.production.changePercent, null);
    assert.match(previous.production.note, /following reading/);
    const earlier = await read(db, "2026-11-02");
    assert.equal(earlier.production.status, "unavailable");
    assert.equal(earlier.green.kg, marrickville.kg);
    assert.equal(earlier.green.value, marrickville.value);
    assert.equal(earlier.green.asOf, now.toISOString());
    assert.match(earlier.green.note, /Marrickville only/);
  } finally { db.close(); }
});

test("a current reading preserves unknown pieces and an older writer cannot replace it", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveCropsterReading(db, synthetic, weekStart, now);
    const received = new Date(now.getTime() + 1000);
    await saveCropsterGreenStock(db, marrickville, now);
    await saveCropsterReading(db, { weekStart, roastedKg: 0, previousRoastedKg: 0 }, weekStart, received);
    await assert.rejects(saveCropsterReading(db, synthetic, weekStart, now), error => error.status === 409);
    const legacy = await db.prepare("SELECT green_kg, green_value FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first();
    assert.equal(legacy.green_kg, synthetic.greenKg);
    assert.equal(legacy.green_value, synthetic.greenValue);
    assert.equal((await read(db, weekStart, received)).green.asOf, now.toISOString());

    await saveCropsterGreenStock(db, { kg: 0, value: 0 }, received);
    await assert.rejects(saveCropsterGreenStock(db, marrickville, now), error => error.status === 409);
    const { production, green } = await read(db, weekStart, received);
    assert.equal(production.roastedKg, 0);
    assert.equal(production.totalKg, null);
    assert.equal(production.scheduledKg, null);
    assert.equal(production.value, null);
    assert.equal(production.roastedChangePercent, null);
    assert.equal(green.kg, 0);
    assert.equal(green.value, 0);
    assert.equal(green.status, "live");
  } finally { db.close(); }
});

test("production and Marrickville stock survive an unrelated source table failure", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveCropsterReading(db, { weekStart, roastedKg: 82.25 }, weekStart, now);
    await saveCropsterGreenStock(db, { kg: 2 }, now);
    const without = badTable => ({ prepare(sql) { if (sql.includes(badTable)) throw new Error("Fixture failure"); return db.prepare(sql); } });
    const greenFailure = await read(without("dashboard_cropster_green_stock"));
    assert.equal(greenFailure.production.roastedKg, 82.25);
    assert.equal(greenFailure.green.kg, null);

    const productionFailure = await read(without("dashboard_cropster_readings"));
    assert.equal(productionFailure.production.roastedKg, null);
    assert.equal(productionFailure.green.kg, 2);
    assert.equal(productionFailure.green.value, null);
    assert.equal(productionFailure.green.status, "partial");
  } finally { db.close(); }
});

test("the capture route enforces the dashboard origin, Stockroom authentication and bounded input", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-cropster-test-session-secret-1234567890" };
  const origin = "https://dashboard.test";
  const endpoint = origin + "/api/cropster-readings";
  const current = dashboardWeek().start;
  const input = { ...synthetic, weekStart: current };
  const upstream = [];
  let authorised = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async address => {
    upstream.push(String(address));
    if (address === SOURCE_ORIGINS.stockroom + "/api/inventory") return Response.json({ items: [] }, { status: authorised ? 200 : 401 });
    return Response.json({}, { status: 503 });
  };

  try {
    const seal = await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_cropster_test_source_session");
    const cookie = seal.split(";")[0];
    const makePost = (body, headers = {}) => new Request(endpoint, {
      method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body,
    });
    assert.equal((await worker.fetch(new Request(endpoint), env)).status, 405);
    assert.equal((await worker.fetch(makePost("{}", { Origin: "https://other.test" }), env)).status, 403);
    assert.equal((await worker.fetch(makePost("{}", { Cookie: "" }), env)).status, 401);
    assert.equal(upstream.length, 0);
    assert.equal((await worker.fetch(makePost(JSON.stringify(input)), env)).status, 401);

    authorised = true;
    for (const body of [
      { ...input, password: "synthetic-secret" }, { ...input, asOf: now.toISOString() },
      { ...input, weekStart: addDays(current, -7) }, { ...input, roastedKg: "83" },
      { ...input, greenKg: null }, { ...input, scheduledKg: -1 }, { ...input, greenValue: 1_000_000_000 },
    ]) {
      assert.equal((await worker.fetch(makePost(JSON.stringify(body)), env)).status, 400);
    }
    assert.equal((await worker.fetch(makePost(" ".repeat(2049)), env)).status, 413);
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM dashboard_cropster_readings").first()).total, 0);

    const captured = await worker.fetch(makePost(JSON.stringify(input)), env);
    assert.equal(captured.status, 200);
    assert.match(captured.headers.get("cache-control"), /no-store/);
    const record = await captured.json();
    assert.deepEqual(Object.keys(record), ["ok", "weekStart", "asOf"]);

    const report = await (await worker.fetch(new Request(origin + "/api/weekly-report", { headers: { Cookie: cookie } }), env)).json();
    const details = await (await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: cookie } }), env)).json();
    assert.equal(report.metrics.production.roastedKg, input.roastedKg);
    assert.equal(report.metrics.production.asOf, record.asOf);
    assert.deepEqual(report.metrics.production, details.metrics.production);
    assert.deepEqual(report.metrics.green, details.metrics.green);
    assert.equal(report.metrics.green.kg, null);
    assert.equal(details.metrics.roasted.kg, input.roastedKg);
    assert.equal(details.metrics.roastingRate.kgPerDay, null);
    assert.ok(upstream.every(address => !/cropster\.com|bmc-green-forecast|\/api\/roaster/.test(address)));
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Marrickville-only stock capture validates access and stays out of historical reports", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-cropster-stockroom-test-session-secret-1234567" };
  const origin = "https://dashboard.test";
  const endpoint = origin + "/api/cropster-green-stock";
  let authorised = false;
  const upstream = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async address => {
    upstream.push(String(address));
    if (address === SOURCE_ORIGINS.stockroom + "/api/inventory") return Response.json({ items: [] }, { status: authorised ? 200 : 401 });
    return Response.json({}, { status: 503 });
  };

  try {
    const seal = await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_green_test_source_session");
    const cookie = seal.split(";")[0];
    const post = (body, headers = {}) => new Request(endpoint, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body });
    assert.equal((await worker.fetch(new Request(endpoint), env)).status, 405);
    assert.equal((await worker.fetch(post("{}", { Origin: "https://other.test" }), env)).status, 403);
    assert.equal((await worker.fetch(post("{}", { Cookie: "" }), env)).status, 401);
    assert.equal(upstream.length, 0);
    assert.equal((await worker.fetch(post(JSON.stringify(marrickville)), env)).status, 401);

    authorised = true;
    for (const invalid of [{}, { kg: null }, { kg: "1" }, { kg: -1 }, { kg: 1_000_001 }, { kg: 1, value: 100_000_001 }, { kg: 1, location: "All locations" }, { kg: 1, asOf: now.toISOString() }]) {
      assert.equal((await worker.fetch(post(JSON.stringify(invalid)), env)).status, 400);
    }
    assert.equal((await worker.fetch(post(" ".repeat(513)), env)).status, 413);
    const captured = await worker.fetch(post(JSON.stringify(marrickville)), env);
    assert.equal(captured.status, 200);
    assert.match(captured.headers.get("cache-control"), /no-store/);
    const saved = await captured.json();
    assert.deepEqual(saved, { ok: true, location: "Marrickville", ...marrickville, asOf: new Date(saved.asOf).toISOString() });
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM dashboard_cropster_readings").first()).total, 0);

    const earlier = addDays(dashboardWeek().start, -7);
    const report = await (await worker.fetch(new Request(origin + "/api/weekly-report", { headers: { Cookie: cookie } }), env)).json();
    const historical = await (await worker.fetch(new Request(origin + `/api/weekly-report?week=${earlier}`, { headers: { Cookie: cookie } }), env)).json();
    const details = await (await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: cookie } }), env)).json();
    assert.equal(report.metrics.green.location, saved.location);
    assert.equal(report.metrics.green.value, saved.value);
    assert.equal(report.metrics.green.asOf, saved.asOf);
    assert.deepEqual(report.metrics.green, details.metrics.green);
    assert.equal(historical.metrics.green.kg, null);
    assert.equal(historical.metrics.green.value, null);
    assert.equal(historical.metrics.green.asOf, null);
    assert.ok(upstream.every(address => !/cropster\.com|bmc-green-forecast|\/api\/roaster/.test(address)));
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
