import { HttpError } from "./auth.js";
import { cropsterGreenInventory, cropsterProduction } from "./cropster.js";
import { addDays, dashboardWeek } from "./metrics.js";

const productionColumns = ["roasted_kg", "roasted_value", "production_read_at"];
const greenColumns = ["green_kg", "green_value", "green_read_at"];
const fields = new Set(["weekStart", "roastedKg", "roastedValue", "greenKg", "greenValue"]);
const columns = ["week_start", ...productionColumns, ...greenColumns];
const capturedAt = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const comparison = (current, previous) => previous > 0 ? Math.round((current - previous) / previous * 1000) / 10 : null;

export async function readCropsterFriday(db, weekStart) {
  const friday = addDays(weekStart, 4);
  const production = { ...cropsterProduction(), snapshotDate: friday, note: "A Monday–Friday Cropster production reading is needed for this week." };
  const green = { ...cropsterGreenInventory(), snapshotDate: friday, note: "A Marrickville snapshot from Cropster is needed for this Friday." };
  if (!db?.prepare) return { production, green };

  const previousWeek = addDays(weekStart, -7);
  let rows;
  try {
    ({ results: rows } = await db.prepare(`SELECT ${columns.join(", ")} FROM dashboard_cropster_friday
      WHERE week_start IN (?, ?)`).bind(weekStart, previousWeek).all());
  } catch {
    return { production, green };
  }
  const current = rows.find(row => row.week_start === weekStart);
  const previous = rows.find(row => row.week_start === previousWeek);
  if (Number.isFinite(current?.roasted_kg)) {
    const previousKg = previous?.roasted_kg ?? null;
    const previousValue = previous?.roasted_value ?? null;
    Object.assign(production, {
      status: current.roasted_value === null ? "partial" : "live",
      asOf: capturedAt(current.production_read_at),
      totalKg: current.roasted_kg,
      roastedKg: current.roasted_kg,
      previousKg,
      previousRoastedKg: previousKg,
      changePercent: comparison(current.roasted_kg, previousKg),
      value: current.roasted_value,
      roastedValue: current.roasted_value,
      previousValue,
      previousRoastedValue: previousValue,
      valueChangePercent: current.roasted_value === null ? null : comparison(current.roasted_value, previousValue),
      note: "Completed Cropster production through Friday. The value is the recorded green coffee cost.",
    });
  }
  if (Number.isFinite(current?.green_kg)) {
    Object.assign(green, {
      status: current.green_value === null ? "partial" : "live",
      kg: current.green_kg,
      value: current.green_value,
      asOf: capturedAt(current.green_read_at),
      note: "Cropster Green Inventory Report, Marrickville snapshot for the selected Friday.",
    });
  }
  return { production, green };
}

function quantity(value, maximum) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new HttpError("Enter a valid Cropster quantity or value.");
  return value;
}

export async function saveCropsterFriday(db, input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key))) {
    throw new HttpError("Enter a valid Friday Cropster reading.");
  }
  let week;
  try {
    if (typeof input.weekStart !== "string" || !input.weekStart) throw new Error();
    week = dashboardWeek(input.weekStart, now);
    if (week.isCurrent) throw new Error();
  } catch {
    throw new HttpError("Select a previous Sydney reporting week.");
  }
  const hasProduction = input.roastedKg != null;
  const hasGreen = input.greenKg != null;
  if ((!hasProduction && !hasGreen) || (!hasProduction && input.roastedValue != null) || (!hasGreen && input.greenValue != null)) {
    throw new HttpError("Enter a recorded weight for each Cropster value you save.");
  }
  const date = now.getTime();
  const roastedKg = hasProduction ? quantity(input.roastedKg, 1_000_000) : null;
  const greenKg = hasGreen ? quantity(input.greenKg, 1_000_000) : null;
  const roastedValue = input.roastedValue == null ? null : quantity(input.roastedValue, 100_000_000);
  const greenValue = input.greenValue == null ? null : quantity(input.greenValue, 100_000_000);
  const updatedColumns = [...(hasProduction ? productionColumns : []), ...(hasGreen ? greenColumns : [])];
  let saved;
  try {
    saved = await db.prepare(`INSERT INTO dashboard_cropster_friday (${columns.join(", ")})
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(week_start) DO UPDATE SET
      ${updatedColumns.map(column => `${column} = excluded.${column}`).join(", ")}
      WHERE max(coalesce(production_read_at, 0), coalesce(green_read_at, 0)) <= ? RETURNING week_start`)
      .bind(week.start, roastedKg, roastedValue, hasProduction ? date : null, greenKg, greenValue, hasGreen ? date : null, date).first();
  } catch {
    throw new HttpError("The Friday Cropster reading could not be saved. Try again.", 503);
  }
  if (!saved) throw new HttpError("A newer Friday Cropster reading has already been saved.", 409);
  return { ok: true, weekStart: week.start, snapshotDate: addDays(week.start, 4) };
}
