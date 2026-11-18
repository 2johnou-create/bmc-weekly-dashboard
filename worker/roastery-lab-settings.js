import { HttpError } from "./auth.js";
import { validDate } from "./metrics.js";

const releaseLimit = 12;
const blockedCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

function settingsFromRow(row) {
  if (!row) return { releases: [], qa: "", revision: 0, updatedAt: null };
  return {
    releases: JSON.parse(row.releases_json),
    qa: row.qa,
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function readLabSettings(db) {
  try {
    return settingsFromRow(await db.prepare(
      "SELECT releases_json, qa, revision, updated_at FROM dashboard_roastery_lab_settings WHERE id = 'lab'",
    ).first());
  } catch {
    throw new HttpError("Release and QA notes could not be loaded. Try refreshing.", 503);
  }
}

function validateEdit(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["releases", "qa", "expectedRevision"].includes(key))) {
    throw new HttpError("Enter valid release and QA details.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new HttpError("Load the current notes before saving changes.");
  }
  if (!Array.isArray(input.releases) || input.releases.length > releaseLimit) {
    throw new HttpError(`Add up to ${releaseLimit} upcoming releases.`);
  }
  if (typeof input.qa !== "string" || input.qa.length > 4_000 || blockedCharacters.test(input.qa.replace(/\r\n/g, "\n"))) {
    throw new HttpError("Use up to 4,000 characters of plain text for QA status.");
  }
  return input.releases.map(row => {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.length > 120 || /[\r\n\t]/.test(row.name) ||
        blockedCharacters.test(row.name)) throw new HttpError("Enter a coffee name for each release.");
    const date = row.date === "" || row.date == null ? null : row.date;
    if (date !== null && !validDate(date)) throw new HttpError("Enter a valid release date.");
    return { name: row.name.trim(), date };
  });
}

export async function saveLabSettings(db, input) {
  const releases = JSON.stringify(validateEdit(input));
  const qa = input.qa.replace(/\r\n/g, "\n").trim();
  const updatedAt = Date.now();
  const { expectedRevision } = input;
  let row;
  try {
    const statement = expectedRevision === 0
      ? db.prepare(`INSERT INTO dashboard_roastery_lab_settings (id, releases_json, qa, revision, updated_at)
        VALUES ('lab', ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING RETURNING releases_json, qa, revision, updated_at`)
        .bind(releases, qa, updatedAt)
      : db.prepare(`UPDATE dashboard_roastery_lab_settings SET releases_json = ?, qa = ?, revision = revision + 1,
        updated_at = ? WHERE id = 'lab' AND revision = ? RETURNING releases_json, qa, revision, updated_at`)
        .bind(releases, qa, updatedAt, expectedRevision);
    row = await statement.first();
  } catch {
    throw new HttpError("Release and QA notes could not be saved. Try again.", 503);
  }
  if (!row) throw new HttpError("The notes changed on another device. Review the latest version before saving.", 409);
  return settingsFromRow(row);
}
