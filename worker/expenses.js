import { HttpError } from "./auth.js";
import { callGoogleBridge, isGoogleBridgeConfigured } from "./google-bridge.js";
import { mondayOf, sydneyDate } from "./metrics.js";

const SOURCE_URL = "https://docs.google.com/spreadsheets/d/1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik/edit#gid=0";
const MAX_AMOUNT = 100_000_000;
const MAX_PAYLOAD_BYTES = 128_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function monday(week) {
  const value = typeof week === "string" ? week : week?.start;
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed.getUTCDay() === 1 ? value : null;
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return new Date(time).toISOString();
}

function empty(weekStart, note, sourceCell = null) {
  return {
    value: null, currency: null, currencySymbol: "$", weekStart,
    status: "unavailable", note, sourceUrl: SOURCE_URL, sourceCell,
    sheetName: "Sheet1", asOf: null, items: [],
  };
}

function grid(value) {
  return Array.isArray(value) && value.length === 36 && value.every(row => Array.isArray(row) && row.length <= 23
    && row.every(cell => cell === null || typeof cell === "number" && Number.isFinite(cell)
      || typeof cell === "string" && cell.length <= 512 && !controlCharacters.test(cell)));
}

function headerParts(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!parts) return null;
  return { day: Number(parts[1]), month: Number(parts[2]), year: parts[3] ? Number(parts[3]) + (parts[3].length === 2 ? 2000 : 0) : null };
}

function headerDate(parts, year) {
  if (!parts || !Number.isSafeInteger(year) || year < 2000 || year > 2099) return null;
  const value = `${year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function columnForWeek(headers, weekStart) {
  const parts = headers.map(headerParts);
  const explicitYears = new Set(parts.filter(part => part?.year).map(part => part.year));
  const matches = [];
  for (let column = 2; column < headers.length; column++) {
    const part = parts[column];
    // A yearless displayed header is safe only when the sheet has an explicit,
    // unambiguous year. Never use its raw Sheets date serial or the viewer year.
    const year = part?.year ?? (explicitYears.size === 1 ? [...explicitYears][0] : null);
    if (headerDate(part, year) === weekStart) matches.push(column);
  }
  return matches.length === 1 ? matches[0] : -1;
}

function amount(value) {
  if (value === "" || value === null || value === undefined) return { blank: true };
  if (typeof value === "string") {
    const normalized = value.trim().replace(/^\$/, "").replace(/,/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Invalid expense amount.");
    value = Number(normalized);
  }
  if (!Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) throw new Error("Invalid expense amount.");
  return { blank: false, value };
}

export function parseExpenses(source, week) {
  const weekStart = monday(week);
  if (!weekStart) return empty(null, "Select a valid Monday for expenses.");
  if (!source || !grid(source.values) || source.numericValues !== undefined && !grid(source.numericValues)
    || source.sheetName !== undefined && source.sheetName !== "Sheet1" || source.range !== undefined && source.range !== "A1:W36") {
    return empty(weekStart, "The expense sheet reading is incomplete or invalid.");
  }
  const column = columnForWeek(source.values[0], weekStart);
  if (column < 0) return empty(weekStart, "The expense sheet has no unique displayed date for the selected Monday.");
  const sourceCell = `${String.fromCharCode(65 + column)}36`;
  try {
    const items = [];
    let sum = 0;
    for (let row = 2; row < 35; row++) {
      const value = amount((source.numericValues ?? source.values)[row]?.[column]);
      if (value.blank) continue;
      const name = source.values[row]?.[1];
      if (typeof name !== "string" || !name.trim()) throw new Error("An expense has no label.");
      items.push({ name: name.trim(), value: Math.round(value.value * 100) / 100 });
      sum += value.value;
    }
    // SUM(empty cells) is zero in a prepared future column. It is not evidence
    // that that week's expenses have been entered.
    if (!items.length) return empty(weekStart, "No expenses have been entered for the selected week.", sourceCell);
    const total = amount((source.numericValues ?? source.values)[35]?.[column]);
    if (total.blank || Math.round(total.value * 100) !== Math.round(sum * 100)) {
      return empty(weekStart, "The expense sheet total does not match its entered line items.", sourceCell);
    }
    const asOf = timestamp(source.asOf);
    return {
      value: Math.round(total.value * 100) / 100, currency: null, currencySymbol: "$", weekStart,
      status: "live", note: "Entered expenses from the selected week’s column in Cost Sheet Warehouse Expenses. Blank lines are omitted. The sheet does not specify a currency code.",
      sourceUrl: SOURCE_URL, sourceCell, sheetName: "Sheet1", asOf, items,
    };
  } catch {
    return empty(weekStart, "The expense sheet contains an invalid amount or missing item label.", sourceCell);
  }
}

export function validateExpenseReading(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["weekStart", "values", "numericValues", "asOf", "sheetName", "range"].includes(key))
    || !monday(input.weekStart) || !grid(input.values) || input.numericValues !== undefined && !grid(input.numericValues)
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new HttpError("Enter a valid expense sheet reading.");
  if (input.weekStart > mondayOf(sydneyDate(now))) throw new HttpError("Choose this week or an earlier Monday for the expense reading.");
  const asOf = input.asOf === undefined ? now.toISOString() : timestamp(input.asOf);
  if (!asOf || Date.parse(asOf) > now.getTime() + 5 * 60_000) throw new HttpError("Enter a valid expense reading time.");
  const payload = { weekStart: input.weekStart, values: input.values, asOf, sheetName: "Sheet1", range: "A1:W36" };
  if (input.numericValues !== undefined) payload.numericValues = input.numericValues;
  if (input.sheetName !== undefined && input.sheetName !== "Sheet1" || input.range !== undefined && input.range !== "A1:W36"
    || new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES
    || parseExpenses(payload, input.weekStart).status === "unavailable") throw new HttpError("The reading needs a matching Monday and a verified expense total.");
  return payload;
}

function recordedExpense(source, weekStart, capturedAt, now, bridgeFailed = false) {
  const value = parseExpenses(source, weekStart);
  if (value.status === "unavailable") return value;
  value.asOf ||= new Date(capturedAt).toISOString();
  const stale = now.getTime() - Date.parse(value.asOf) > STALE_MS;
  value.status = stale ? "stale" : "recorded";
  value.note = `${bridgeFailed ? "The live expense sheet could not be read. " : ""}Saved reading from the private expense sheet; it does not refresh automatically.${stale ? " This reading is more than 24 hours old." : ""} The sheet does not specify a currency code.`;
  return value;
}

export async function saveExpenseReading(db, input, now = new Date()) {
  const payload = validateExpenseReading(input, now);
  let row;
  try {
    row = await db.prepare(`INSERT INTO warehouse_expense_readings (week_start, payload_json, captured_at) VALUES (?, ?, ?)
      ON CONFLICT(week_start) DO UPDATE SET payload_json = excluded.payload_json, captured_at = excluded.captured_at
      WHERE excluded.captured_at >= warehouse_expense_readings.captured_at RETURNING week_start, captured_at`)
      .bind(payload.weekStart, JSON.stringify(payload), now.getTime()).first();
  } catch { throw new HttpError("The expense reading could not be saved. Try again.", 503); }
  if (!row) throw new HttpError("A newer expense reading has already been saved.", 409);
  return {
    ok: true, weekStart: row.week_start, asOf: new Date(row.captured_at).toISOString(),
    expenses: recordedExpense(payload, row.week_start, row.captured_at, now),
  };
}

export async function readExpenses({ db, env = {}, week, fresh = false, now = new Date(), fetcher = fetch } = {}) {
  const weekStart = monday(week);
  if (!weekStart || !(now instanceof Date) || !Number.isFinite(now.getTime())) return empty(weekStart, "Select a valid Monday for expenses.");
  let bridgeFailed = false;
  if (isGoogleBridgeConfigured(env)) {
    try {
      // Each bridge call reads the sheet again, including manual fresh reads.
      const source = await callGoogleBridge(env, { action: "expenses" }, { fetcher });
      if (!grid(source.values)) throw new Error("The expense bridge returned no grid.");
      const value = parseExpenses(source, weekStart);
      if (value.status === "live" && !value.asOf) throw new Error("Expense source time is missing.");
      if (value.asOf && Date.parse(value.asOf) > now.getTime() + 5 * 60_000) throw new Error("Future expense publication.");
      if (value.status === "live" && value.asOf && now.getTime() - Date.parse(value.asOf) > STALE_MS) {
        value.status = "stale";
        value.note += " This source reading is more than 24 hours old.";
      }
      return value;
    } catch { bridgeFailed = true; }
  }
  if (!db || typeof db.prepare !== "function") return empty(weekStart, "The private expense sheet is not connected and no saved reading is available.");
  try {
    const row = await db.prepare("SELECT payload_json, captured_at FROM warehouse_expense_readings WHERE week_start = ?").bind(weekStart).first();
    if (!row) return empty(weekStart, bridgeFailed ? "The live expense sheet could not be read and no saved reading exists for this week." : "No saved expense sheet reading exists for this week.");
    if (typeof row.payload_json !== "string" || row.payload_json.length > MAX_PAYLOAD_BYTES || !Number.isFinite(row.captured_at)
      || row.captured_at > now.getTime() + 5 * 60_000) throw new Error("Invalid saved expense reading.");
    const source = JSON.parse(row.payload_json);
    if (source.weekStart !== weekStart) throw new Error("Expense week mismatch.");
    return recordedExpense(source, weekStart, row.captured_at, now, bridgeFailed);
  } catch { return empty(weekStart, "The saved expense sheet reading could not be loaded."); }
}
