import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { createIssue, listIssues } from "../worker/issues.js";
import { sydneyDate } from "../worker/metrics.js";
import { localDatabase } from "../scripts/local-db.mjs";

const origin = "https://dashboard-issue-test.example";
const secret = "synthetic-integration-session-key-01234567890123456789";
const sourceCookie = "bmc_stockroom_session=synthetic_source_session_for_issue_tests";
async function cookie(env) { return (await sealSession(new Request(origin), env, sourceCookie)).split(";")[0]; }

test("the real generated migration applies once and saved notes survive preview database reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-migration-tests-"));
  const filename = join(directory, "issues.sqlite");
  let db;
  try {
    db = localDatabase(filename);
    const original = await createIssue(db, { id: crypto.randomUUID(), issueDate: sydneyDate(), note: "Saved using the generated deployment schema." });
    db.close(); db = null;
    db = localDatabase(filename);
    const result = await listIssues(db);
    assert.equal(result.count, 1);
    assert.equal(result.items[0].id, original.id);
    assert.equal(result.items[0].note, original.note);
    const migrations = await db.prepare("SELECT COUNT(*) AS count FROM local_schema_migrations").first();
    assert.ok(migrations.count >= 1);
    await assert.rejects(db.prepare("UPDATE dashboard_issues SET status = 'deleted' WHERE id = ?").bind(original.id).run(), /CHECK constraint failed/);
  } finally { if (db) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("a revoked Stockroom session cannot disclose saved notes through the dashboard aggregate", async () => {
  const db = localDatabase(":memory:");
  const env = { SESSION_SECRET: secret, DB: db };
  const originalFetch = globalThis.fetch;
  const privateMarker = "PRIVATE-ISSUE-NOTE-ONLY-FOR-TEST";
  await createIssue(db, { id: crypto.randomUUID(), issueDate: sydneyDate(), note: privateMarker });
  globalThis.fetch = async url => new URL(url).pathname === "/api/inventory" ? Response.json({ error: "Unauthorized" }, { status: 401 }) : Response.json({ error: "Unavailable" }, { status: 503 });
  try {
    const response = await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: await cookie(env) } }), env);
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.equal(body.includes(privateMarker), false);
    assert.deepEqual(Object.keys(JSON.parse(body)), ["error"]);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});

test("issue reads and writes fail closed when live Stockroom access cannot be checked", async () => {
  const db = localDatabase(":memory:");
  const env = { SESSION_SECRET: secret, DB: db };
  const originalFetch = globalThis.fetch;
  const privateMarker = "PRIVATE-EXISTING-ISSUE-ONLY-FOR-TEST";
  const original = await createIssue(db, { id: crypto.randomUUID(), issueDate: sydneyDate(), note: privateMarker });
  globalThis.fetch = async () => Response.json({ error: "private upstream diagnostics" }, { status: 503 });
  try {
    const headers = { Cookie: await cookie(env), Origin: origin, "Content-Type": "application/json" };
    const requests = [
      new Request(origin + "/api/issues", { headers }),
      new Request(origin + "/api/issues", { method: "POST", headers, body: JSON.stringify({ id: crypto.randomUUID(), issueDate: sydneyDate(), note: "Must not be created without source authorization." }) }),
      new Request(origin + "/api/issues/" + original.id, { method: "PATCH", headers, body: JSON.stringify({ expectedRevision: 1, action: "resolve" }) }),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, env);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.equal(body.includes(privateMarker), false);
      assert.equal(body.includes("private upstream diagnostics"), false);
    }
    const result = await listIssues(db);
    assert.equal(result.total, 1);
    assert.equal(result.count, 1);
    assert.equal(result.items[0].revision, 1);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
