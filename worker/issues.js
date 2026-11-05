import { HttpError } from "./auth.js";

const ISSUE_COLUMNS = "id, issue_date, customer, order_reference, note, status, revision, created_at, updated_at, resolved_at";
const ISSUE_LIMIT = 200;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const plainControls = /[\u0000-\u001f\u007f-\u009f]/;
const noteControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function database(db) {
  if (!db || typeof db.prepare !== "function") throw new HttpError("Customer issue notes are being configured. Please try again shortly.", 503);
  return db;
}
function inputObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError("Enter valid customer issue details.");
}
function allowedFields(input, allowed) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new HttpError("The customer issue update contains an unsupported field.");
}
function issueId(id) {
  if (typeof id !== "string" || !uuidPattern.test(id)) throw new HttpError("A valid issue reference is required.");
  return id.toLowerCase();
}
function currentSydneyDate(now) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(now)) throw new HttpError("The issue time is unavailable.");
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const value = name => parts.find(part => part.type === name).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function issueDate(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError("Choose a valid issue date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError("Choose a valid issue date.");
  if (value > currentSydneyDate(now)) throw new HttpError("The issue date cannot be in the future.");
  return value;
}
function text(value, field, maximum, notes = false, optional = false) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || (notes ? noteControls : plainControls).test(value)) throw new HttpError(`Enter valid ${field}.`);
  const normalised = (notes ? value.replace(/\r\n?/g, "\n") : value).trim();
  if (normalised.length > maximum) throw new HttpError(`${field[0].toUpperCase() + field.slice(1)} must be ${maximum} characters or fewer.`);
  if (notes && !normalised) throw new HttpError("Enter an issue note.");
  return normalised;
}
function mapIssue(row) {
  if (!row) return null;
  return { id: row.id, issueDate: row.issue_date, customer: row.customer, orderReference: row.order_reference, note: row.note, status: row.status, revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at) };
}
async function safeOperation(operation, message) {
  try { return await operation(); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(message, 503); }
}

/** Current issues across all weeks. Schema creation belongs to the deployment migration. */
export async function listIssues(db) {
  const store = database(db);
  return safeOperation(async () => {
    const [result, counts] = await Promise.all([
      store.prepare(`SELECT ${ISSUE_COLUMNS} FROM dashboard_issues ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC, id ASC LIMIT ?`).bind(ISSUE_LIMIT).all(),
      store.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count FROM dashboard_issues").first(),
    ]);
    const items = result.results.map(mapIssue);
    const total = Number(counts?.total || 0);
    return { items, count: Number(counts?.open_count || 0), asOf: new Date().toISOString(), total, hasMore: total > items.length };
  }, "Customer issue notes could not be loaded. Please try again.");
}

export async function createIssue(db, input, now = Date.now()) {
  const store = database(db);
  inputObject(input);
  allowedFields(input, ["id", "issueDate", "customer", "orderReference", "note"]);
  const id = issueId(input.id);
  const fields = { issueDate: issueDate(input.issueDate, now), customer: text(input.customer, "customer name", 120, false, true), orderReference: text(input.orderReference, "order reference", 100, false, true), note: text(input.note, "issue note", 2000, true) };
  return safeOperation(async () => {
    const inserted = await store.prepare(`INSERT INTO dashboard_issues (id, issue_date, customer, order_reference, note, status, revision, created_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, 'open', 1, ?, ?, NULL) ON CONFLICT(id) DO NOTHING RETURNING ${ISSUE_COLUMNS}`)
      .bind(id, fields.issueDate, fields.customer, fields.orderReference, fields.note, now, now).first();
    if (inserted) return mapIssue(inserted);
    const existing = mapIssue(await store.prepare(`SELECT ${ISSUE_COLUMNS} FROM dashboard_issues WHERE id = ?`).bind(id).first());
    if (!existing) throw new Error("Issue insert did not return a record.");
    if (existing.issueDate !== fields.issueDate || existing.customer !== fields.customer || existing.orderReference !== fields.orderReference || existing.note !== fields.note) throw new HttpError("This issue reference was already used with different details. Refresh before trying again.", 409);
    return existing;
  }, "The customer issue note could not be saved. Please try again.");
}

export async function updateIssue(db, id, input, now = Date.now()) {
  const store = database(db);
  const validId = issueId(id);
  inputObject(input);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new HttpError("Refresh the issue before updating it.");
  if (!["edit", "resolve", "reopen"].includes(input.action)) throw new HttpError("Choose a valid issue action.");
  allowedFields(input, input.action === "edit" ? ["expectedRevision", "action", "issueDate", "customer", "orderReference", "note"] : ["expectedRevision", "action"]);
  currentSydneyDate(now);
  const edits = {};
  if (input.action === "edit") {
    if (!["issueDate", "customer", "orderReference", "note"].some(field => Object.hasOwn(input, field))) throw new HttpError("Enter an issue detail to update.");
    if (Object.hasOwn(input, "issueDate")) edits.issueDate = issueDate(input.issueDate, now);
    if (Object.hasOwn(input, "customer")) edits.customer = text(input.customer, "customer name", 120);
    if (Object.hasOwn(input, "orderReference")) edits.orderReference = text(input.orderReference, "order reference", 100);
    if (Object.hasOwn(input, "note")) edits.note = text(input.note, "issue note", 2000, true);
  }
  return safeOperation(async () => {
    const existing = mapIssue(await store.prepare(`SELECT ${ISSUE_COLUMNS} FROM dashboard_issues WHERE id = ?`).bind(validId).first());
    if (!existing) throw new HttpError("The customer issue was not found. Refresh the issue list.", 404);
    if (existing.revision !== input.expectedRevision) throw new HttpError("This issue changed on another device. Refresh before updating it.", 409);
    const fields = { ...existing, ...edits };
    const status = input.action === "resolve" ? "resolved" : input.action === "reopen" ? "open" : existing.status;
    const resolvedAt = input.action === "resolve" ? now : input.action === "reopen" ? null : existing.resolvedAt;
    const updated = await store.prepare(`UPDATE dashboard_issues SET issue_date = ?, customer = ?, order_reference = ?, note = ?, status = ?, revision = revision + 1, updated_at = ?, resolved_at = ? WHERE id = ? AND revision = ? RETURNING ${ISSUE_COLUMNS}`)
      .bind(fields.issueDate, fields.customer, fields.orderReference, fields.note, status, now, resolvedAt, validId, input.expectedRevision).first();
    if (!updated) throw new HttpError("This issue changed on another device. Refresh before updating it.", 409);
    return mapIssue(updated);
  }, "The customer issue note could not be updated. Please try again.");
}

export function issuesMetric(result) {
  const items = result.items.filter(item => item.status === "open").slice(0, 5).map(item => {
    const identity = [item.customer, item.orderReference].filter(Boolean).join(" · ");
    const excerpt = item.note.replace(/\s+/g, " ").trim();
    const label = `${identity ? identity + ": " : ""}${excerpt}`.slice(0, 160);
    return { id: item.id, label, status: "Open", note: item.note, issueDate: item.issueDate, customer: item.customer, orderReference: item.orderReference, revision: item.revision, updatedAt: item.updatedAt };
  });
  return { status: "live", source: "Entered issue notes", asOf: result.asOf, count: result.count, items, note: "Current open issues across all weeks. Entered and managed in this dashboard." };
}
