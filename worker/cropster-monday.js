import { HttpError } from "./auth.js";

const maximumKg = 1_000_000;

export async function readCropsterMonday({ db, weekStart }) {
  if (!db || typeof db.prepare !== "function") return null;

  try {
    const row = await db.prepare("SELECT roasted_kg, recorded_at FROM dashboard_cropster_monday WHERE week_start = ?").bind(weekStart).first();
    return row ? { kg: row.roasted_kg, asOf: new Date(row.recorded_at).toISOString() } : null;
  } catch {
    return null;
  }
}

export async function saveCropsterMonday(db, input, currentWeekStart, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "weekStart" && key !== "roastedKg")) {
    throw new HttpError("Enter valid Cropster Monday reading fields.");
  }
  if (typeof input.weekStart !== "string" || input.weekStart !== currentWeekStart) {
    throw new HttpError("A Monday reading must use the current Sydney Monday.");
  }
  if (!Number.isFinite(input.roastedKg) || input.roastedKg < 0 || input.roastedKg > maximumKg) {
    throw new HttpError("Enter valid completed roast kilograms for Monday.");
  }

  let saved;
  try {
    saved = await db.prepare(`INSERT INTO dashboard_cropster_monday (week_start, roasted_kg, recorded_at) VALUES (?, ?, ?)
      ON CONFLICT(week_start) DO UPDATE SET roasted_kg = excluded.roasted_kg, recorded_at = excluded.recorded_at
      WHERE excluded.recorded_at >= dashboard_cropster_monday.recorded_at RETURNING week_start, recorded_at`)
      .bind(currentWeekStart, input.roastedKg, now.getTime()).first();
  } catch {
    throw new HttpError("The Cropster Monday reading could not be saved. Try again.", 503);
  }
  if (!saved) throw new HttpError("A newer Cropster Monday reading has already been saved.", 409);
  return { ok: true, weekStart: saved.week_start, asOf: new Date(saved.recorded_at).toISOString() };
}
