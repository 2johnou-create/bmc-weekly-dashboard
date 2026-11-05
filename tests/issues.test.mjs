import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HttpError } from "../worker/auth.js";
import { listIssues, createIssue, updateIssue, issuesMetric } from "../worker/issues.js";

const schema = `CREATE TABLE dashboard_issues (
  id TEXT PRIMARY KEY NOT NULL,
  issue_date TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  order_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
)`;
const now = Date.parse("2026-11-04T13:05:00Z"); // 5 November in Sydney.
function adapter(sqlite, observed = []) {
  return {
    prepare(sql) {
      observed.push(sql);
      let bindings = [];
      return {
        bind(...values) { bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...bindings) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
      };
    },
  };
}
function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const observed = [];
  return { sqlite, db: adapter(sqlite, observed), observed };
}
function input(overrides = {}) {
  return { id: randomUUID(), issueDate: "2026-11-05", customer: "Example Cafe", orderReference: "WS-100", note: "One carton was missing at handover.", ...overrides };
}
const statusError = status => error => error instanceof HttpError && error.status === status;

test("issue lifecycle persists notes, revisions and resolution state without deleting history", async t => {
  const { db, sqlite, observed } = database(t);
  assert.equal((await listIssues(db)).count, 0);
  const created = await createIssue(db, input(), now);
  assert.equal(created.status, "open");
  assert.equal(created.revision, 1);
  assert.equal(created.createdAt, now);
  assert.equal(created.updatedAt, now);
  assert.equal(created.resolvedAt, null);
  const edited = await updateIssue(db, created.id, { expectedRevision: 1, action: "edit", note: "Replacement carton arranged." }, now + 1000);
  assert.equal(edited.note, "Replacement carton arranged.");
  assert.equal(edited.customer, created.customer);
  assert.equal(edited.createdAt, now);
  assert.equal(edited.revision, 2);
  const resolved = await updateIssue(db, created.id, { expectedRevision: 2, action: "resolve" }, now + 2000);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedAt, now + 2000);
  assert.equal((await listIssues(db)).count, 0);
  assert.equal((await listIssues(db)).total, 1);
  const reopened = await updateIssue(db, created.id, { expectedRevision: 3, action: "reopen" }, now + 3000);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.revision, 4);
  assert.equal((await listIssues(db)).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM dashboard_issues").get().count, 1);
  assert.equal(observed.some(sql => /\bDELETE\b|\bCREATE\b|\bALTER\b/i.test(sql)), false);
});

test("create retries are idempotent and never reopen or overwrite an existing issue", async t => {
  const { db } = database(t);
  const details = input();
  const original = await createIssue(db, details, now);
  assert.deepEqual(await createIssue(db, details, now + 1000), original);
  const resolved = await updateIssue(db, original.id, { expectedRevision: 1, action: "resolve" }, now + 2000);
  assert.deepEqual(await createIssue(db, details, now + 3000), resolved);
  await assert.rejects(createIssue(db, { ...details, note: "Different note using the same request ID." }, now + 4000), statusError(409));
  const listed = await listIssues(db);
  assert.equal(listed.total, 1);
  assert.equal(listed.count, 0);
  assert.equal(listed.items[0].note, details.note);
  assert.equal(listed.items[0].status, "resolved");
});

test("simultaneous edits use revision comparison so one stale edit cannot overwrite the other", async t => {
  const { db } = database(t);
  const created = await createIssue(db, input(), now);
  const outcomes = await Promise.allSettled([
    updateIssue(db, created.id, { expectedRevision: 1, action: "edit", note: "First device update." }, now + 1000),
    updateIssue(db, created.id, { expectedRevision: 1, action: "edit", note: "Second device update." }, now + 1001),
  ]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(item => item.status === "rejected").reason.status, 409);
  const item = (await listIssues(db)).items[0];
  assert.equal(item.revision, 2);
  assert.equal(item.note, outcomes.find(result => result.status === "fulfilled").value.note);
  await assert.rejects(updateIssue(db, item.id, { expectedRevision: 1, action: "resolve" }, now + 2000), statusError(409));
  assert.equal((await listIssues(db)).items[0].status, "open");
});

test("current issues span weeks and the preview includes only five open notes", async t => {
  const { db } = database(t);
  const older = await createIssue(db, input({ issueDate: "2026-08-03", note: "Older issue remains open." }), now - 1000);
  for (let index = 0; index < 6; index++) await createIssue(db, input({ note: `Open issue ${index}` }), now + index);
  const resolved = await createIssue(db, input({ note: "Resolved issue must not enter the open preview." }), now + 100);
  await updateIssue(db, resolved.id, { expectedRevision: 1, action: "resolve" }, now + 200);
  const listed = await listIssues(db);
  assert.equal(listed.count, 7);
  assert.equal(listed.total, 8);
  assert.equal(listed.items[0].status, "open");
  assert.equal(listed.items.at(-1).status, "resolved");
  assert.ok(listed.items.some(item => item.id === older.id));
  const metric = issuesMetric(listed);
  assert.equal(metric.count, 7);
  assert.equal(metric.items.length, 5);
  assert.ok(metric.items.every(item => item.status === "Open"));
  assert.equal(metric.items.some(item => item.id === resolved.id), false);
  assert.match(metric.note, /across all weeks/);
  assert.equal(metric.source, "Entered issue notes");
});

test("bounded lists retain the full open count even when more than 200 issues exist", async t => {
  const { db, sqlite } = database(t);
  const insert = sqlite.prepare("INSERT INTO dashboard_issues (id,issue_date,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?)");
  for (let index = 0; index < 205; index++) insert.run(randomUUID(), "2026-11-05", `Issue ${index}`, "open", now, now + index);
  insert.run(randomUUID(), "2026-11-05", "Newer resolved issue", "resolved", now, now + 1000);
  const result = await listIssues(db);
  assert.equal(result.items.length, 200);
  assert.equal(result.count, 205);
  assert.equal(result.total, 206);
  assert.equal(result.hasMore, true);
  assert.ok(result.items.every(item => item.status === "open"));
  assert.equal(result.items[0].note, "Issue 204");
});

test("validation checks real dates, Sydney future dates, lengths and control characters", async t => {
  const { db } = database(t);
  const invalid = [
    input({ id: "not-a-uuid" }),
    input({ issueDate: "2026-02-30" }),
    input({ issueDate: "2026-11-06" }),
    input({ issueDate: "2026-1-5" }),
    input({ note: " \n\t " }),
    input({ note: "x".repeat(2001) }),
    input({ customer: "x".repeat(121) }),
    input({ orderReference: "x".repeat(101) }),
    input({ customer: "Customer\nAnother" }),
    input({ orderReference: "Order\u007f" }),
    input({ note: "Hidden\u0000control" }),
    input({ note: "Hidden\u001bcontrol" }),
    input({ status: "resolved" }),
  ];
  for (const details of invalid) await assert.rejects(createIssue(db, details, now), statusError(400));
  const valid = await createIssue(db, input({ customer: "x".repeat(120), orderReference: "r".repeat(100), note: "n".repeat(2000) }), now);
  assert.equal(valid.issueDate, "2026-11-05");
  const multiline = await createIssue(db, input({ note: "First line.\r\nSecond line.\tDetails." }), now);
  assert.equal(multiline.note, "First line.\nSecond line.\tDetails.");
  assert.equal((await listIssues(db)).total, 2);
});

test("SQL, HTML and private-looking strings remain note data rather than executable input", async t => {
  const { db, observed, sqlite } = database(t);
  const privateText = "<script>alert('customer')</script> '; DROP TABLE dashboard_issues; -- contact: private@example.test";
  const created = await createIssue(db, input({ note: privateText, customer: "O'Brien Cafe", orderReference: "WS-' OR 1=1 --" }), now);
  assert.equal(created.note, privateText);
  const listed = await listIssues(db);
  assert.equal(listed.items[0].note, privateText);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM dashboard_issues").get().count, 1);
  assert.equal(observed.some(sql => sql.includes(privateText) || sql.includes("O'Brien")), false);
  const metric = issuesMetric(listed);
  assert.equal(metric.items[0].note, privateText);
  assert.ok(metric.items[0].label.length <= 160);
});

test("updates cannot edit status fields, delete issues, use missing revisions or silently create records", async t => {
  const { db } = database(t);
  const created = await createIssue(db, input(), now);
  const invalid = [
    { expectedRevision: 0, action: "resolve" },
    { action: "resolve" },
    { expectedRevision: 1, action: "delete" },
    { expectedRevision: 1, action: "edit", status: "resolved" },
    { expectedRevision: 1, action: "edit" },
    { expectedRevision: 1, action: "edit", issueDate: "2026-11-06" },
    { expectedRevision: 1, action: "edit", note: "" },
    { expectedRevision: 1, action: "resolve", note: "Hidden edit" },
  ];
  for (const update of invalid) await assert.rejects(updateIssue(db, created.id, update, now), statusError(400));
  await assert.rejects(updateIssue(db, randomUUID(), { expectedRevision: 1, action: "resolve" }, now), statusError(404));
  const unchanged = (await listIssues(db)).items[0];
  assert.equal(unchanged.status, "open");
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.note, created.note);
});

test("notes remain available after reopening the SQLite database", async () => {
  const folder = mkdtempSync(join(tmpdir(), "dashboard-issue-tests-"));
  const file = join(folder, "issues.sqlite");
  let first, reopened;
  try {
    first = new DatabaseSync(file);
    first.exec(schema);
    const created = await createIssue(adapter(first), input(), now);
    first.close(); first = null;
    reopened = new DatabaseSync(file);
    const result = await listIssues(adapter(reopened));
    assert.equal(result.items[0].id, created.id);
    assert.equal(result.items[0].note, created.note);
    assert.equal(result.count, 1);
  } finally { if (first) first.close(); if (reopened) reopened.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("unavailable databases fail with fixed errors that exclude private diagnostics", async () => {
  await assert.rejects(listIssues(undefined), statusError(503));
  const broken = { prepare() { throw new Error("secret database connection private-customer@example.test"); } };
  for (const operation of [() => listIssues(broken), () => createIssue(broken, input(), now), () => updateIssue(broken, randomUUID(), { expectedRevision: 1, action: "resolve" }, now)]) {
    await assert.rejects(operation(), error => error instanceof HttpError && error.status === 503 && !/secret|private-customer/.test(error.message));
  }
});
