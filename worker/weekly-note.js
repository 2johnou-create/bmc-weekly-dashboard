import { HttpError } from "./auth.js";

const maximumLines = 10;
const maximumLineLength = 240;
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;

function noteFromRow(weekStart, row) {
  if (!row) return { weekStart, lines: [], revision: 0, updatedAt: null };
  return {
    weekStart,
    lines: JSON.parse(row.lines_json),
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function readWeeklyNote(db, weekStart) {
  try {
    const row = await db.prepare("SELECT lines_json, revision, updated_at FROM dashboard_weekly_notes WHERE week_start = ?")
      .bind(weekStart).first();
    return noteFromRow(weekStart, row);
  } catch {
    throw new HttpError("The weekly note could not be loaded. Try refreshing.", 503);
  }
}

function validateEdit(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => key !== "lines" && key !== "expectedRevision")) {
    throw new HttpError("Enter valid weekly note details.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new HttpError("Load the weekly note before saving it.");
  }
  if (!Array.isArray(input.lines) || input.lines.some(line => typeof line !== "string" || controlCharacters.test(line))) {
    throw new HttpError("Enter one plain-text point per line.");
  }
  const lines = input.lines.map(line => line.trim()).filter(Boolean);
  if (lines.length > maximumLines || lines.some(line => line.length > maximumLineLength)) {
    throw new HttpError(`Use up to ${maximumLines} points with ${maximumLineLength} characters per point.`);
  }
  return lines;
}

export async function saveWeeklyNote(db, weekStart, input) {
  const lines = JSON.stringify(validateEdit(input));
  const { expectedRevision } = input;
  const updatedAt = Date.now();
  let row;
  try {
    const statement = expectedRevision === 0
      ? db.prepare(`INSERT INTO dashboard_weekly_notes (week_start, lines_json, revision, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(week_start) DO NOTHING RETURNING lines_json, revision, updated_at`).bind(weekStart, lines, updatedAt)
      : db.prepare(`UPDATE dashboard_weekly_notes SET lines_json = ?, revision = revision + 1, updated_at = ?
        WHERE week_start = ? AND revision = ? RETURNING lines_json, revision, updated_at`).bind(lines, updatedAt, weekStart, expectedRevision);
    row = await statement.first();
  } catch {
    throw new HttpError("The weekly note could not be saved. Try again.", 503);
  }
  if (!row) throw new HttpError("The weekly note changed on another device. Reload it before saving.", 409);
  return noteFromRow(weekStart, row);
}
