import { HttpError } from "./auth.js";

export const CROPSTER_WEBSITE = "https://c-sar.cropster.com/app/";
const GREEN_LOCATION = "Marrickville";
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_KG = 1_000_000;
const MAX_AUD = 100_000_000;
const fields = {
  roastedKg: "roasted_kg",
  scheduledKg: "scheduled_kg",
  roastedValue: "roasted_value",
  scheduledValue: "scheduled_value",
  previousRoastedKg: "previous_roasted_kg",
  previousScheduledKg: "previous_scheduled_kg",
  previousRoastedValue: "previous_roasted_value",
  previousScheduledValue: "previous_scheduled_value",
  greenKg: "green_kg",
  greenValue: "green_value",
};
const legacyGreenColumns = new Set([fields.greenKg, fields.greenValue]);
const columns = ["week_start", ...Object.values(fields), "recorded_at"];
const productionColumns = columns.filter(column => !legacyGreenColumns.has(column));
const permitted = new Set(["weekStart", ...Object.keys(fields)]);

function captureMetadata(reading, now, status, note) {
  const stale = now.getTime() - reading.recorded_at > STALE_MS;
  return {
    source: "Cropster",
    status: stale ? "stale" : status,
    stale,
    asOf: new Date(reading.recorded_at).toISOString(),
    currency: "AUD",
    note: ["Read in Cropster and saved at the capture time shown. Dashboard Refresh reloads this saved reading; it does not fetch Cropster again.", note, stale && "This reading is over 24 hours old."].filter(Boolean).join(" "),
  };
}

function total(first, second) {
  return first === null || second === null ? null : first + second;
}

function percent(current, previous) {
  if (current === null || previous === null || previous <= 0) return null;
  const change = (current - previous) / previous * 1000;
  return Number.isFinite(change) ? Math.round(change) / 10 : null;
}

export function cropsterProduction(reading = null, now = new Date()) {
  if (reading) {
    const roastedKg = reading.roasted_kg;
    const scheduledKg = reading.scheduled_kg;
    const previousRoastedKg = reading.previous_roasted_kg;
    const previousScheduledKg = reading.previous_scheduled_kg;
    const totalKg = total(roastedKg, scheduledKg);
    const previousKg = total(previousRoastedKg, previousScheduledKg);
    const value = total(reading.roasted_value, reading.scheduled_value);
    const previousValue = total(reading.previous_roasted_value, reading.previous_scheduled_value);
    const complete = [totalKg, previousKg, value, previousValue].every(amount => amount !== null);
    const note = scheduledKg === null ? "The remaining roasted-output estimate is unavailable. Pending scheduled green input and batch count are reported separately when verified. Cost covers green coffee." :
      "Scheduled output and cost are estimates from Cropster. Cost covers green coffee.";
    return {
      ...captureMetadata(reading, now, complete ? "live" : "partial", note),
      totalKg,
      roastedKg,
      scheduledKg,
      previousKg,
      previousRoastedKg,
      previousScheduledKg,
      changePercent: percent(totalKg, previousKg),
      roastedChangePercent: percent(roastedKg, previousRoastedKg),
      value,
      roastedValue: reading.roasted_value,
      scheduledValue: reading.scheduled_value,
      previousValue,
      previousRoastedValue: reading.previous_roasted_value,
      previousScheduledValue: reading.previous_scheduled_value,
      valueChangePercent: percent(value, previousValue),
    };
  }

  return {
    source: "Cropster",
    status: "unavailable",
    stale: false,
    totalKg: null,
    roastedKg: null,
    scheduledKg: null,
    previousKg: null,
    previousRoastedKg: null,
    previousScheduledKg: null,
    changePercent: null,
    roastedChangePercent: null,
    value: null,
    roastedValue: null,
    scheduledValue: null,
    previousValue: null,
    previousRoastedValue: null,
    previousScheduledValue: null,
    valueChangePercent: null,
    currency: "AUD",
    asOf: null,
    note: "Sign in to Cropster to view completed roasts in the Production Report and scheduled roasts, including Friday, in Roasts → Schedule.",
  };
}

export function cropsterGreenInventory(reading = null, now = new Date()) {
  if (reading?.location === GREEN_LOCATION) {
    const { kg, value } = reading;
    return {
      ...captureMetadata(reading, now, value === null ? "partial" : "live", "Green Inventory Report, Marrickville only."),
      location: GREEN_LOCATION,
      kg,
      value,
      unpricedLots: null,
    };
  }

  return {
    source: "Cropster",
    location: GREEN_LOCATION,
    status: "unavailable",
    stale: false,
    kg: null,
    value: null,
    currency: "AUD",
    unpricedLots: null,
    asOf: null,
    note: "Save the Marrickville weight and value from Cropster’s Green Inventory Report.",
  };
}

function priorWeekProjection(followingReading) {
  if (!Number.isFinite(followingReading?.previous_roasted_kg)) return null;
  return {
    recorded_at: followingReading.recorded_at,
    roasted_kg: followingReading.previous_roasted_kg,
    scheduled_kg: followingReading.previous_scheduled_kg,
    roasted_value: followingReading.previous_roasted_value,
    scheduled_value: followingReading.previous_scheduled_value,
    previous_roasted_kg: null,
    previous_scheduled_kg: null,
    previous_roasted_value: null,
    previous_scheduled_value: null,
  };
}

async function readProduction(db, weekStart, followingWeekStart, now) {
  try {
    const { results } = await db.prepare(`SELECT ${productionColumns.join(", ")} FROM dashboard_cropster_readings
      WHERE week_start IN (?, ?)`).bind(weekStart, followingWeekStart).all();
    const selected = results.find(reading => reading.week_start === weekStart);
    const prior = selected ? null : priorWeekProjection(results.find(reading => reading.week_start === followingWeekStart));
    const production = cropsterProduction(selected || prior, now);
    if (prior) production.note += " This week was captured as the previous week in the following reading.";
    return production;
  } catch {
    return { ...cropsterProduction(), note: "Saved Cropster production could not be loaded. Try refreshing." };
  }
}

async function readGreenStock(db, now) {
  try {
    const reading = await db.prepare(`SELECT location, kg, value, recorded_at FROM dashboard_cropster_green_stock
      WHERE location = ?`).bind(GREEN_LOCATION).first();
    return cropsterGreenInventory(reading, now);
  } catch {
    return { ...cropsterGreenInventory(), note: "Saved Marrickville green stock could not be loaded. Try refreshing." };
  }
}

export async function readCropsterReadings({ db, weekStart, followingWeekStart, now = new Date() }) {
  if (!db || typeof db.prepare !== "function") return { production: cropsterProduction(), green: cropsterGreenInventory() };
  const [production, green] = await Promise.all([
    readProduction(db, weekStart, followingWeekStart, now),
    readGreenStock(db, now),
  ]);
  return { production, green };
}

export async function saveCropsterReading(db, input, currentWeekStart, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !permitted.has(key))) {
    throw new HttpError("Enter valid Cropster reading fields.");
  }
  if (typeof input.weekStart !== "string" || input.weekStart !== currentWeekStart) {
    throw new HttpError("A Cropster reading must use the current Sydney Monday.");
  }
  const amounts = Object.keys(fields).map(key => {
    const value = input[key];
    const required = key === "roastedKg" || (key === "greenKg" && Object.hasOwn(input, key));
    if ((value === null || value === undefined) && !required) return null;
    const maximum = key.endsWith("Kg") ? MAX_KG : MAX_AUD;
    if (!Number.isFinite(value) || value < 0 || value > maximum) throw new HttpError(`Enter a valid Cropster value for ${key}.`);
    return value;
  });

  let saved;
  try {
    // Legacy clients may still submit unscoped green values. Keep them separate from Marrickville.
    const submittedGreenColumns = new Set(
      ["greenKg", "greenValue"].filter(key => Object.hasOwn(input, key)).map(key => fields[key]),
    );
    const updates = columns.slice(1)
      .filter(column => !legacyGreenColumns.has(column) || submittedGreenColumns.has(column))
      .map(column => `${column} = excluded.${column}`);
    saved = await db.prepare(`INSERT INTO dashboard_cropster_readings (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(week_start) DO UPDATE SET ${updates.join(", ")}
      WHERE excluded.recorded_at >= dashboard_cropster_readings.recorded_at RETURNING week_start, recorded_at`)
      .bind(currentWeekStart, ...amounts, now.getTime()).first();
  } catch {
    throw new HttpError("The Cropster reading could not be saved. Try again.", 503);
  }
  if (!saved) throw new HttpError("A newer Cropster reading has already been saved.", 409);
  return { ok: true, weekStart: saved.week_start, asOf: new Date(saved.recorded_at).toISOString() };
}

export async function saveCropsterGreenStock(db, input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "kg" && key !== "value")) {
    throw new HttpError("Enter valid Marrickville green stock fields.");
  }
  const { kg, value = null } = input;
  if (!Number.isFinite(kg) || kg < 0 || kg > MAX_KG) throw new HttpError("Enter valid Marrickville green stock kilograms.");
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > MAX_AUD)) {
    throw new HttpError("Enter a valid Marrickville green stock value in AUD.");
  }

  let saved;
  try {
    saved = await db.prepare(`INSERT INTO dashboard_cropster_green_stock (location, kg, value, recorded_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(location) DO UPDATE SET kg = excluded.kg, value = excluded.value, recorded_at = excluded.recorded_at
      WHERE excluded.recorded_at >= dashboard_cropster_green_stock.recorded_at
      RETURNING location, kg, value, recorded_at`).bind(GREEN_LOCATION, kg, value, now.getTime()).first();
  } catch {
    throw new HttpError("The Marrickville green stock reading could not be saved. Try again.", 503);
  }
  if (!saved) throw new HttpError("A newer Marrickville green stock reading has already been saved.", 409);
  return { ok: true, location: saved.location, kg: saved.kg, value: saved.value, asOf: new Date(saved.recorded_at).toISOString() };
}
