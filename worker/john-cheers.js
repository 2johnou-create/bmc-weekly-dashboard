import { HttpError } from "./auth.js";
import { mondayOf, sydneyDate, validDate } from "./metrics.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const countsSql = "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN week_start = ? THEN 1 ELSE 0 END), 0) AS week_count FROM warehouse_john_cheers";
const unavailable = () => new HttpError("John’s cheer log is temporarily unavailable. Please try again.", 503);

function database(db) {
  if (!db || typeof db.prepare !== "function") throw unavailable();
  return db;
}

function reportedTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new HttpError("Each cheer needs a valid reported time.");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value || time < Date.UTC(2020, 0, 1) || time >= Date.UTC(2101, 0, 1)) {
    throw new HttpError("Each cheer needs a valid reported time between 2020 and 2100.");
  }
  return time;
}

function eventsFrom(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "events")
    || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 25) throw new HttpError("Send between 1 and 25 cheer events.");
  const events = new Map();
  const acknowledgedIds = new Set();
  for (const event of input.events) {
    if (!event || typeof event !== "object" || Array.isArray(event) || Object.keys(event).some(key => key !== "id" && key !== "occurredAt")
      || typeof event.id !== "string" || !uuid.test(event.id)) throw new HttpError("Each cheer needs a valid event reference and reported time.");
    const id = event.id.toLowerCase();
    const occurredAt = reportedTime(event.occurredAt);
    if (events.has(id) && events.get(id).occurredAt !== occurredAt) throw new HttpError("A cheer reference was already used with a different reported time.", 409);
    events.set(id, { id, occurredAt });
    acknowledgedIds.add(event.id);
  }
  return { events: [...events.values()], acknowledgedIds: [...acknowledgedIds] };
}

function summary(row, weekStart) {
  if (!row || !Number.isSafeInteger(row.total) || row.total < 0 || !Number.isSafeInteger(row.week_count)
    || row.week_count < 0 || row.week_count > row.total) throw unavailable();
  return { total: row.total, weekStart, weekCount: row.week_count };
}

export async function readJohnCheers(db, weekStart) {
  if (!validDate(weekStart) || mondayOf(weekStart) !== weekStart) throw new HttpError("Choose a valid Sydney Monday for the cheer count.");
  const store = database(db);
  try {
    return summary(await store.prepare(countsSql).bind(weekStart).first(), weekStart);
  } catch { throw unavailable(); }
}

export async function saveJohnCheers(db, input, now = new Date()) {
  const { events, acknowledgedIds } = eventsFrom(input);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getUTCFullYear() < 2020 || now.getUTCFullYear() > 2100) throw unavailable();
  const store = database(db);
  const receivedAt = now.getTime();
  const weekStart = mondayOf(sydneyDate(now));
  const placeholders = events.map(() => "(?, ?, ?, ?)").join(", ");
  const parameters = events.flatMap(event => [event.id, event.occurredAt, receivedAt, weekStart]);
  let saved, counts;
  try {
    // The guard and insert are one atomic statement. An immutable-ID conflict
    // blocks every new event in the batch, including under concurrent retries.
    const result = await store.prepare(`WITH incoming(id, occurred_at, received_at, week_start) AS (VALUES ${placeholders})
      INSERT INTO warehouse_john_cheers (id, occurred_at, received_at, week_start)
      SELECT incoming.id, incoming.occurred_at, incoming.received_at, incoming.week_start FROM incoming
      WHERE NOT EXISTS (
        SELECT 1 FROM incoming AS proposed JOIN warehouse_john_cheers AS existing ON existing.id = proposed.id
        WHERE existing.occurred_at <> proposed.occurred_at
      ) ON CONFLICT(id) DO NOTHING`).bind(...parameters).run();
    if (result?.success === false) throw unavailable();
    saved = await store.prepare(`SELECT id, occurred_at FROM warehouse_john_cheers WHERE id IN (${events.map(() => "?").join(", ")})`)
      .bind(...events.map(event => event.id)).all();
    if (saved?.success === false || !Array.isArray(saved?.results)) throw unavailable();
  } catch { throw unavailable(); }
  const byId = new Map(saved.results.map(event => [event.id, event.occurred_at]));
  if (events.some(event => byId.has(event.id) && byId.get(event.id) !== event.occurredAt)) {
    throw new HttpError("A cheer reference was already used with a different reported time.", 409);
  }
  if (events.some(event => !byId.has(event.id))) throw unavailable();
  // Counts share one SQL snapshot. Reads can follow other successful clicks,
  // while acknowledgement always refers only to this request's verified IDs.
  counts = await readJohnCheers(store, weekStart);
  return { ok: true, acknowledgedIds, ...counts };
}
