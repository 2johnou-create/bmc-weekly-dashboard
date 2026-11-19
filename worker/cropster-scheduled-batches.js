import { HttpError } from "./auth.js";
import { mondayOf, validDate } from "./metrics.js";

const fields = new Set(["greenKg", "batches"]);

export function validateCropsterScheduledBatches(input, weekStart, capturedAt) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(field => !fields.has(field)) ||
      !(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() < 0 ||
      !validDate(weekStart) || mondayOf(weekStart) !== weekStart ||
      !Number.isFinite(input.greenKg) || input.greenKg < 0 || input.greenKg > 1_000_000 ||
      !Number.isSafeInteger(input.batches) || input.batches < 0 || input.batches > 100_000 ||
      (input.greenKg === 0) !== (input.batches === 0)) {
    throw new HttpError("Use verified pending green batches for the selected Cropster week.");
  }
  return { greenKg: input.greenKg, batches: input.batches };
}

export async function saveCropsterScheduledBatches(db, input, weekStart, capturedAt) {
  const scheduled = validateCropsterScheduledBatches(input, weekStart, capturedAt);
  if (!scheduled) return false;
  let saved;
  try {
    saved = await db.prepare(`INSERT INTO dashboard_cropster_scheduled_batches
      (week_start, green_kg, batches, recorded_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM dashboard_cropster_readings WHERE week_start = ? AND recorded_at = ?
      ) ON CONFLICT(week_start) DO UPDATE SET green_kg = excluded.green_kg,
        batches = excluded.batches, recorded_at = excluded.recorded_at
      WHERE excluded.recorded_at >= dashboard_cropster_scheduled_batches.recorded_at RETURNING recorded_at`)
      .bind(weekStart, scheduled.greenKg, scheduled.batches, capturedAt.getTime(), weekStart, capturedAt.getTime()).first();
  } catch {
    throw new HttpError("The weekly Cropster scheduled batches could not be saved.", 503);
  }
  if (!saved) throw new HttpError("A newer production capture has replaced these scheduled batches.", 409);
  return true;
}

export async function readCropsterScheduledBatches(db, weekStart) {
  if (!validDate(weekStart) || mondayOf(weekStart) !== weekStart) return null;
  try {
    const row = await db.prepare(`SELECT s.green_kg, s.batches, s.recorded_at
      FROM dashboard_cropster_scheduled_batches s JOIN dashboard_cropster_readings r
        ON r.week_start = s.week_start AND r.recorded_at = s.recorded_at
      WHERE s.week_start = ?`).bind(weekStart).first();
    if (!row) return null;
    const capturedAt = new Date(row.recorded_at);
    const scheduled = validateCropsterScheduledBatches({greenKg: row.green_kg, batches: row.batches}, weekStart, capturedAt);
    return { ...scheduled, asOf: capturedAt.toISOString() };
  } catch { return null; }
}
