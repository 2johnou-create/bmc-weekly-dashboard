import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { readJohnCheers, saveJohnCheers } from "../worker/john-cheers.js";

const now = new Date("2026-11-19T10:00:00.000Z");
const weekStart = "2026-11-16";
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const event = (number, occurredAt = now.toISOString()) => ({ id: id(number), occurredAt });

async function database(t) {
  const db = localDatabase(":memory:");
  t.after(() => db.close());
  await db.prepare(`CREATE TABLE IF NOT EXISTS warehouse_john_cheers (
    id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, week_start TEXT NOT NULL
  )`).run();
  return db;
}

test("cheers store only event IDs and times and expose genuine empty and saved counts", async t => {
  const db = await database(t);
  assert.deepEqual(await readJohnCheers(db, weekStart), { total: 0, weekStart, weekCount: 0 });
  const result = await saveJohnCheers(db, { events: [event(1), event(2)] }, now);
  assert.deepEqual(result, { ok: true, acknowledgedIds: [id(1), id(2)], total: 2, weekStart, weekCount: 2 });
  const { results } = await db.prepare("SELECT * FROM warehouse_john_cheers ORDER BY id").all();
  assert.equal(results.length, 2);
  assert.deepEqual(Object.keys(results[0]).sort(), ["id", "occurred_at", "received_at", "week_start"]);
  assert.equal(results[0].occurred_at, now.getTime());
  assert.equal(results[0].received_at, now.getTime());
});

test("unchanged retries acknowledge without incrementing or changing first server receipt", async t => {
  const db = await database(t);
  const payload = { events: [event(1)] };
  await saveJohnCheers(db, payload, now);
  const nextWeek = new Date("2026-11-23T10:00:00.000Z");
  const replay = await saveJohnCheers(db, payload, nextWeek);
  assert.equal(replay.total, 1);
  assert.equal(replay.weekStart, "2026-11-23");
  assert.equal(replay.weekCount, 0);
  assert.deepEqual(replay.acknowledgedIds, [id(1)]);
  const row = await db.prepare("SELECT received_at, week_start FROM warehouse_john_cheers WHERE id = ?").bind(id(1)).first();
  assert.equal(row.received_at, now.getTime());
  assert.equal(row.week_start, weekStart);
});

test("identical IDs within one batch count once while contradictory reported times reject the batch", async t => {
  const db = await database(t);
  const value = event(1);
  const result = await saveJohnCheers(db, { events: [value, { ...value }] }, now);
  assert.equal(result.total, 1);
  assert.deepEqual(result.acknowledgedIds, [id(1)]);
  await assert.rejects(saveJohnCheers(db, { events: [event(2), event(2, "2026-11-18T10:00:00.000Z")] }, now), error => error.status === 409);
  assert.equal((await readJohnCheers(db, weekStart)).total, 1);
});

test("a stored ID conflict blocks every new event in that same atomic insert", async t => {
  const db = await database(t);
  await saveJohnCheers(db, { events: [event(1)] }, now);
  await assert.rejects(saveJohnCheers(db, { events: [event(2), event(1, "2026-11-18T10:00:00.000Z")] }, now), error => error.status === 409);
  assert.equal((await readJohnCheers(db, weekStart)).total, 1);
  assert.equal(await db.prepare("SELECT id FROM warehouse_john_cheers WHERE id = ?").bind(id(2)).first(), null);
});

test("parallel identical submissions are idempotent and competing immutable batches cannot partially insert", async t => {
  const db = await database(t);
  const identical = await Promise.all([
    saveJohnCheers(db, { events: [event(1)] }, now),
    saveJohnCheers(db, { events: [event(1)] }, now),
  ]);
  assert.equal(identical.every(result => result.total === 1), true);
  const competing = await Promise.allSettled([
    saveJohnCheers(db, { events: [event(2), event(3)] }, now),
    saveJohnCheers(db, { events: [event(2, "2026-11-18T10:00:00.000Z"), event(4)] }, now),
  ]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  const rejected = competing.find(result => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  assert.equal((await readJohnCheers(db, weekStart)).total, 3);
  const { results } = await db.prepare("SELECT id FROM warehouse_john_cheers WHERE id IN (?, ?)").bind(id(3), id(4)).all();
  assert.equal(results.length, 1);
});

test("old offline events and skewed client clocks remain logged under the server-received week", async t => {
  const db = await database(t);
  const result = await saveJohnCheers(db, { events: [event(1, "2020-01-01T00:00:00.000Z"), event(2, "2100-12-31T23:59:59.999Z")] }, now);
  assert.equal(result.total, 2);
  assert.equal(result.weekCount, 2);
  const { results } = await db.prepare("SELECT week_start FROM warehouse_john_cheers").all();
  assert.equal(results.every(row => row.week_start === weekStart), true);
});

test("Sydney receipt-week boundaries use timezone-aware dates across daylight saving", async t => {
  const db = await database(t);
  const before = new Date("2026-10-04T12:59:59.000Z");
  const after = new Date("2026-10-04T13:00:00.000Z");
  const first = await saveJohnCheers(db, { events: [event(1)] }, before);
  const second = await saveJohnCheers(db, { events: [event(2)] }, after);
  assert.equal(first.weekStart, "2026-09-28");
  assert.equal(second.weekStart, "2026-10-05");
  assert.equal(second.weekCount, 1);
  assert.equal((await readJohnCheers(db, "2026-09-28")).weekCount, 1);
});

test("invalid IDs, impossible dates, identity fields and oversized batches are rejected before storage", async t => {
  const db = await database(t);
  const invalid = [
    null, {}, { events: [] }, { events: Array.from({ length: 26 }, (_, index) => event(index)) },
    { events: [event(1)], ip: "not-accepted" },
    { events: [{ ...event(1), person: "not-accepted" }] },
    { events: [{ ...event(1), id: "not-a-uuid" }] },
    { events: [event(1, "2026-11-31T10:00:00.000Z")] },
    { events: [event(1, "2026-11-19T10:00:00+00:00")] },
    { events: [event(1, "2019-12-31T23:59:59.999Z")] },
    { events: [event(1, "2101-01-01T00:00:00.000Z")] },
  ];
  for (const input of invalid) await assert.rejects(saveJohnCheers(db, input, now), error => error.status === 400);
  assert.equal((await readJohnCheers(db, weekStart)).total, 0);
});

test("twenty-five events use at most one hundred insert bindings", async t => {
  const db = await database(t);
  const bindings = [];
  const tracked = { prepare(sql) {
    const statement = db.prepare(sql);
    return { bind(...values) { bindings.push(values.length); return statement.bind(...values); } };
  } };
  const result = await saveJohnCheers(tracked, { events: Array.from({ length: 25 }, (_, index) => event(index)) }, now);
  assert.equal(result.total, 25);
  assert.equal(result.acknowledgedIds.length, 25);
  assert.equal(Math.max(...bindings), 100);
});

test("a database statement error rolls back the full insert and returns a fixed safe error", async t => {
  const db = await database(t);
  await db.prepare(`CREATE TRIGGER reject_fixture BEFORE INSERT ON warehouse_john_cheers WHEN NEW.id = '${id(2)}'
    BEGIN SELECT RAISE(ABORT, 'fixture-private-storage-details'); END`).run();
  await assert.rejects(saveJohnCheers(db, { events: [event(1), event(2)] }, now), error => error.status === 503 && !error.message.includes("fixture-private-storage-details"));
  assert.equal((await readJohnCheers(db, weekStart)).total, 0);
});

test("a lost acknowledgement can be retried without losing or duplicating an already saved cheer", async t => {
  const db = await database(t);
  let failOnce = true;
  const unreliable = { prepare(sql) {
    if (sql.startsWith("SELECT id, occurred_at") && failOnce) {
      failOnce = false;
      throw new Error("fixture transport failed after insert");
    }
    return db.prepare(sql);
  } };
  const payload = { events: [event(1)] };
  await assert.rejects(saveJohnCheers(unreliable, payload, now), error => error.status === 503);
  assert.equal((await readJohnCheers(db, weekStart)).total, 1);
  const replay = await saveJohnCheers(unreliable, payload, now);
  assert.equal(replay.total, 1);
  assert.deepEqual(replay.acknowledgedIds, [id(1)]);
});

test("missing or malformed counts remain unavailable instead of becoming a fabricated zero", async () => {
  for (const row of [null, { total: null, week_count: null }, { total: -1, week_count: 0 }, { total: 1, week_count: 2 }]) {
    const db = { prepare() { return { bind() { return { async first() { return row; } }; } }; } };
    await assert.rejects(readJohnCheers(db, weekStart), error => error.status === 503);
  }
  await assert.rejects(readJohnCheers(null, weekStart), error => error.status === 503);
  await assert.rejects(readJohnCheers({}, "2026-11-17"), error => error.status === 400);
});
