import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { sealSession } from "../worker/auth.js";
import worker from "../worker/index.js";
import { addDays, dashboardWeek, SOURCE_ORIGINS } from "../worker/metrics.js";
import { readWeeklyNote, saveWeeklyNote } from "../worker/weekly-note.js";

const weekStart = "2026-11-16";
const earlierWeek = "2026-11-09";

test("weekly notes use the additive migration and survive week changes and a database reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bmc-weekly-note-test-"));
  const filename = join(directory, "fixtures.sqlite");
  let db = localDatabase(filename);
  try {
    const empty = await readWeeklyNote(db, weekStart);
    assert.deepEqual(empty, { weekStart, lines: [], revision: 0, updatedAt: null });
    const note = await saveWeeklyNote(db, weekStart, { expectedRevision: 0, lines: ["  Check carton counts  ", " ", "Review Friday plan"] });
    assert.deepEqual(note.lines, ["Check carton counts", "Review Friday plan"]);
    assert.equal(note.revision, 1);
    assert.equal(new Date(note.updatedAt).toISOString(), note.updatedAt);
    await saveWeeklyNote(db, earlierWeek, { expectedRevision: 0, lines: ["Review prior-week totals"] });
    db.close();
    db = localDatabase(filename);

    assert.deepEqual(await readWeeklyNote(db, weekStart), note);
    assert.deepEqual((await readWeeklyNote(db, earlierWeek)).lines, ["Review prior-week totals"]);
    const cleared = await saveWeeklyNote(db, weekStart, { expectedRevision: note.revision, lines: [] });
    assert.deepEqual(cleared.lines, []);
    assert.equal(cleared.revision, 2);
    assert.equal((await readWeeklyNote(db, earlierWeek)).revision, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("two editors cannot overwrite the same loaded revision", async () => {
  const db = localDatabase(":memory:");
  try {
    for (const expectedRevision of [0, 1]) {
      const edits = ["First device", "Second device"].map(line => saveWeeklyNote(db, weekStart, { expectedRevision, lines: [line] }));
      const results = await Promise.allSettled(edits);
      const saved = results.filter(result => result.status === "fulfilled");
      const failed = results.filter(result => result.status === "rejected");
      assert.equal(saved.length, 1);
      assert.equal(failed.length, 1);
      assert.equal(failed[0].reason.status, 409);
      assert.deepEqual(await readWeeklyNote(db, weekStart), saved[0].value);
    }
  } finally { db.close(); }
});

test("note API verifies live access, validates week and text, and keeps saved text out of public HTML", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-weekly-note-test-source-secret-1234567890" };
  const origin = "https://dashboard.test";
  const current = dashboardWeek().start;
  const earlier = addDays(current, -7);
  const endpoint = origin + "/api/weekly-note";
  const originalFetch = globalThis.fetch;
  let active = false;
  let authChecks = 0;
  globalThis.fetch = async address => {
    assert.equal(address, `${SOURCE_ORIGINS.stockroom}/api/inventory`);
    authChecks++;
    return Response.json({ items: [] }, { status: active ? 200 : 401 });
  };

  try {
    const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_note_source_session_123456")).split(";")[0];
    const get = (query = "", authenticated = true) => worker.fetch(new Request(endpoint + query, { headers: authenticated ? { Cookie: cookie } : {} }), env);
    const put = (query, body, headers = {}) => worker.fetch(new Request(endpoint + query, {
      method: "PUT", body, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", ...headers },
    }), env);
    assert.equal((await worker.fetch(new Request(endpoint, { method: "POST" }), env)).status, 405);
    assert.equal((await get(`?week=${current}`, false)).status, 401);
    assert.equal((await put(`?week=${current}`, "{}", { Origin: "https://other.test" })).status, 403);
    assert.equal(authChecks, 0);
    const revoked = await get(`?week=${current}`);
    assert.equal(revoked.status, 401);
    assert.equal(authChecks, 1);

    active = true;
    for (const query of ["?week=", "?week=2026-02-30", "?week=2099-01-05", `?week=${current}&week=${earlier}`]) assert.equal((await get(query)).status, 400);
    assert.equal((await put("", "{}")).status, 400);
    for (const invalid of [
      { lines: ["hello"], expectedRevision: "0" },
      { lines: ["hello"], expectedRevision: -1 },
      { lines: ["hello"], expectedRevision: 0, weekStart: earlier },
      { lines: ["embedded\nline"], expectedRevision: 0 },
      { lines: Array.from({ length: 11 }, () => "point"), expectedRevision: 0 },
      { lines: ["x".repeat(241)], expectedRevision: 0 },
    ]) assert.equal((await put(`?week=${current}`, JSON.stringify(invalid))).status, 400);
    assert.equal((await put(`?week=${current}`, " ".repeat(16_385))).status, 413);
    assert.deepEqual(await (await get()).json(), { weekStart: current, lines: [], revision: 0, updatedAt: null });

    const lines = ["<script>Saved synthetic weekly note</script>"];
    const captured = await put(`?week=${current}`, JSON.stringify({ lines, expectedRevision: 0 }));
    assert.equal(captured.status, 200);
    assert.match(captured.headers.get("cache-control"), /no-store/);
    assert.deepEqual((await captured.json()).lines, lines);
    assert.equal((await put(`?week=${current}`, JSON.stringify({ lines: ["Stale draft"], expectedRevision: 0 }))).status, 409);
    assert.deepEqual((await (await get(`?week=${current}`)).json()).lines, lines);
    assert.deepEqual((await (await get(`?week=${earlier}`)).json()).lines, []);
    assert.doesNotMatch(await (await worker.fetch(new Request(origin), env)).text(), /Saved synthetic weekly note/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
