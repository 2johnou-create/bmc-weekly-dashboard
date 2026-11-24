import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { localDatabase } from "../scripts/local-db.mjs";
import { addDays, dashboardWeek, sydneyDate } from "../worker/metrics.js";
import { saveCropsterReading } from "../worker/cropster.js";
import { saveCropsterFriday } from "../worker/cropster-friday.js";
import { saveLabCropster } from "../worker/roastery-lab.js";

const origin = "https://dashboard.test";
const readerHost = "synthetic-reader.onrender.com";
const token = "synthetic-source-sync-reader-token-123456789012345";
const writeToken = "synthetic-cropster-callback-writer-token-9876543210";
const week = () => dashboardWeek().start;

function observation(weekStart, pendingKg) {
  const observedAt = new Date().toISOString();
  const today = sydneyDate(new Date(observedAt));
  const [year, month] = today.split("-").map(Number);
  const months = [3, 2, 1].map(offset => new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7));
  return {
    schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville",
    weekStart, periodEnd: addDays(weekStart, 4), observedAt,
    productionObservedAt: observedAt, mondayObservedAt: observedAt, greenObservedAt: observedAt,
    production: { roastedKg: 200, scheduledKg: pendingKg, roastedValue: 2000, scheduledValue: pendingKg * 10 },
    mondayRoastedKg: 50, green: { location: "Marrickville", kg: 800, value: 8000 },
    labObservedAt: Object.fromEntries(["inventory", "recipes", "use", "loss"].map(part => [part, observedAt])),
    lab: {
      inventory: { asOf: today, allLocationsComplete: true, totalKg: 800,
        rows: [{ name: "Fixture coffee", location: "Marrickville", lotId: "PG-0001", kg: 800, pricePerKg: 10 }] },
      recipes: { asOf: today,
        rows: [{ name: "Liberty", signature: "Liberty", components: [{ name: "Fixture component", coffee: "Fixture coffee", profileGroupId: "fixture-group", percent: 100 }] }],
        runoutProfiles: [{ id: "fixture-group", name: "Fixture component", lotIds: ["PG-0001"], linksComplete: true, note: "Verified fixture website links." }],
        runoutLotNames: [{ lotId: "PG-0001", name: "Fixture coffee" }] },
      use: { months: months.map(month => ({ month, complete: true, kg: 100, bags: 2,
        rows: [{ name: "Fixture coffee", lotId: "PG-0001", kg: 100, bags: 2 }] })) },
      loss: { from: addDays(today, -7), asOf: today, rows: [{ name: "Liberty", greenKg: 100, roastedKg: 85, batches: 3 }] },
    },
  };
}

async function harness(action) {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-source-sync-session-key-1234567890123456789",
    CROPSTER_READER_URL: "https://" + readerHost, CROPSTER_READER_TOKEN: token, CROPSTER_SYNC_WRITE_TOKEN: writeToken };
  const previousFetch = globalThis.fetch;
  const state = { revoked: false, pendingKg: 40, jobId: crypto.randomUUID(), starts: 0, polls: 0, addresses: [], observation: null };
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(address); state.addresses.push(url);
    if (url.hostname === readerHost) {
      if (url.pathname === '/health') {
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.method, 'GET');
        return Response.json({status:'ok',service:'cropster-website-reader'});
      }
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, "manual");
      if (init.method === "POST") {
        assert.equal(url.pathname, "/v1/sync");
        const startBody=JSON.parse(init.body);
        assert.equal(startBody.weekStart,week());
        assert.match(startBody.requestId,/^[0-9a-f-]{36}$/);
        state.starts++;
        return Response.json({ schemaVersion: "1.0", status: "running", jobId: state.jobId, weekStart: week() }, { status: 202 });
      }
      assert.equal(init.method, "GET");
      assert.equal(url.pathname, "/v1/sync/" + state.jobId);
      state.polls++;
      if (state.readerGate) await state.readerGate;
      state.observation = state.readerObservation || observation(week(), state.pendingKg);
      return Response.json({ schemaVersion: "1.0", status: state.readerStatus || "complete", jobId: state.jobId, weekStart: week(), result: state.observation });
    }
    if (url.hostname === "bmc-stockroom.misty-jelly-1931.chatgpt.site" && url.pathname === "/api/inventory") {
      state.inventoryReads = (state.inventoryReads || 0) + 1;
      if (state.inventoryReads > 1 && state.inventoryFailureAfterAuth) return Response.json({}, {status: state.inventoryFailureAfterAuth});
      return Response.json(state.revoked ? {} : { items: [] }, { status: state.revoked ? 401 : 200 });
    }
    // Unavailable external feeds must produce a partial result rather than a false all-updated announcement.
    return Response.json({}, { status: 503 });
  };
  const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_source_sync_staff_session")).split(";")[0];
  const request = async (path, { method = "GET", authorized = true, requestOrigin = origin, authorization, body } = {}) => {
    // Skip the real five-second polling cadence in this routing fixture; the
    // coordinator's clock/backoff behavior has its own controlled-clock tests.
    if (method === 'GET' && path.startsWith('/api/source-sync?')) await db.prepare('UPDATE dashboard_source_jobs SET next_attempt_at = 0').run();
    const headers = new Headers();
    if (authorized) headers.set("Cookie", cookie);
    if (authorization) headers.set("Authorization", authorization);
    if (method === "POST") {
      if (requestOrigin !== null) headers.set("Origin", requestOrigin);
      headers.set("Content-Type", "application/json");
    }
    const response = await worker.fetch(new Request(origin + path, { method, headers,
      ...(method === "POST" ? { body: JSON.stringify(body ?? { weekStart: week() }) } : {}) }), env);
    return { status: response.status, body: await response.json() };
  };
  try { await action({ db, env, state, request }); }
  finally { globalThis.fetch = previousFetch; db.close(); }
}

test("source sync rejects unsigned, revoked and wrong-origin starts before contacting the website reader", async () => {
  await harness(async ({ state, request }) => {
    const unsigned = await request("/api/source-sync", { method: "POST", authorized: false });
    assert.equal(unsigned.status, 401);
    assert.equal(state.addresses.length, 0);
    const foreign = await request("/api/source-sync", { method: "POST", requestOrigin: "https://other.test" });
    assert.equal(foreign.status, 403);
    const absentOrigin = await request("/api/source-sync", { method: "POST", requestOrigin: null });
    assert.equal(absentOrigin.status, 403);
    assert.equal(state.addresses.length, 0);
    state.revoked = true;
    const revoked = await request("/api/source-sync", { method: "POST" });
    assert.equal(revoked.status, 401);
    assert.equal(state.starts, 0);
    assert.equal(state.polls, 0);
    assert.equal(state.addresses[0].pathname, "/api/inventory");
  });
});

test("a verified terminal reader outcome survives a finishing feed outage instead of leaving the client polling", async () => {
  for (const status of ["complete", "failed"]) await harness(async ({ state, request }) => {
    state.readerStatus = status;
    state.inventoryFailureAfterAuth = 503;
    const reply = await request("/api/source-sync?week=" + week() + "&jobId=" + state.jobId);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.status, status);
    assert.equal(reply.body.sourceSync.jobStatus, status);
    assert.equal(reply.body.sourceSync.status, "partial");
    assert.match(reply.body.sourceSync.message, /Other dashboard sources could not all be checked/);
    assert.equal(state.polls, 1);
  });
});

test("a finishing pass still reports revoked Stock Take access as authentication failure", async () => {
  await harness(async ({ state, request }) => {
    state.inventoryFailureAfterAuth = 401;
    const reply = await request("/api/source-sync?week=" + week() + "&jobId=" + state.jobId);
    assert.equal(reply.status, 401);
    assert.notEqual(reply.body.status, "complete");
  });
});

test("source sync rejects malformed job IDs and mismatched report jobs without a reader request", async () => {
  await harness(async ({ state, request }) => {
    for (const jobId of ["bad-id", "../other", ""]) {
      const reply = await request("/api/source-sync?week=" + week() + "&jobId=" + encodeURIComponent(jobId));
      assert.equal(reply.status, 400, jobId);
    }
    const unknownField = await request("/api/source-sync", { method: "POST", body: { weekStart: week(), selector: "arbitrary" } });
    assert.equal(unknownField.status, 400);
    const wrongWeek = addDays(week(), -7);
    for (const path of ["/api/weekly-report", "/api/warehouse", "/api/roastery-lab"]) {
      const reply = await request(path + "?sourceSyncJob=" + state.jobId + "&sourceSyncWeek=" + wrongWeek);
      assert.equal(reply.status, 400, path);
    }
    assert.equal(state.starts, 0);
    assert.equal(state.polls, 0);
  });
});

test("a started job polls to completion and saves current production, Monday, stock, Lab sections and diagnostic statuses", async () => {
  await harness(async ({ db, state, request }) => {
    const start = await request("/api/source-sync", { method: "POST" });
    assert.equal(start.status, 202);
    assert.equal(start.body.status, "running");
    assert.equal(start.body.jobId, state.jobId);
    assert.equal(state.starts, 1);
    assert.equal((await db.prepare("SELECT id FROM dashboard_source_sync_log").all()).results.length, 0);
    const complete = await request("/api/source-sync?week=" + week() + "&jobId=" + state.jobId);
    assert.equal(complete.status, 200);
    assert.equal(complete.body.status, "complete");
    assert.equal(complete.body.sourceSync.status, "partial");
    assert.doesNotMatch(complete.body.sourceSync.message, /All card sources updated/);
    const statuses = new Map(complete.body.sourceSync.sources.map(source => [source.id, source.status]));
    for (const id of ["production", "monday", "green", "lab-inventory", "lab-recipes", "lab-use", "lab-loss"]) assert.equal(statuses.get(id), "updated", id);
    for (const id of ["demand", "expenses", "planning"]) assert.ok(["failed", "not-connected"].includes(statuses.get(id)), id);
    const production = await db.prepare("SELECT roasted_kg, scheduled_kg, recorded_at FROM dashboard_cropster_readings WHERE week_start = ?").bind(week()).first();
    assert.equal(production.roasted_kg, 200);
    assert.equal(production.scheduled_kg, 40);
    assert.equal(production.recorded_at, Date.parse(state.observation.productionObservedAt));
    const monday = await db.prepare("SELECT roasted_kg, recorded_at FROM dashboard_cropster_monday WHERE week_start = ?").bind(week()).first();
    assert.equal(monday.roasted_kg, 50);
    assert.equal(monday.recorded_at, Date.parse(state.observation.mondayObservedAt));
    const green = await db.prepare("SELECT location, kg, value, recorded_at FROM dashboard_cropster_green_stock WHERE location = ?").bind("Marrickville").first();
    assert.equal(green.kg, 800);
    assert.equal(green.value, 8000);
    assert.equal(green.recorded_at, Date.parse(state.observation.greenObservedAt));
    const lab = await db.prepare("SELECT part, recorded_at FROM dashboard_roastery_lab_cropster").all();
    assert.deepEqual(lab.results.map(row => row.part).sort(), ["inventory", "loss", "recipes", "use"]);
    const log = await db.prepare("SELECT week_start, status, source_status_json FROM dashboard_source_sync_log WHERE id = ?").bind(state.jobId).first();
    assert.equal(log.week_start, week());
    assert.equal(log.status, "partial");
    assert.equal(JSON.parse(log.source_status_json).message, complete.body.sourceSync.message);
    assert.doesNotMatch(JSON.stringify(complete.body), /synthetic-source-sync-reader-token|synthetic_source_sync_staff_session/);
  });
});

test("repeated complete refreshes update changed source totals while preserving previous-week comparison columns", async () => {
  await harness(async ({ db, state, request }) => {
    await saveCropsterReading(db, { weekStart: week(), roastedKg: 100, scheduledKg: 60,
      previousRoastedKg: 150, previousScheduledKg: 10, previousRoastedValue: 1500, previousScheduledValue: 100 }, week(), new Date(Date.now() - 1000));
    for (const pending of [40, 15, 0]) {
      state.jobId = crypto.randomUUID(); state.pendingKg = pending;
      assert.equal((await request("/api/source-sync", { method: "POST" })).status, 202);
      const complete = await request("/api/source-sync?week=" + week() + "&jobId=" + state.jobId);
      assert.equal(complete.body.status, "complete");
      const stored = await db.prepare("SELECT * FROM dashboard_cropster_readings WHERE week_start = ?").bind(week()).first();
      assert.equal(stored.scheduled_kg, pending);
      assert.equal(stored.previous_roasted_kg, 150);
      assert.equal(stored.previous_scheduled_kg, 10);
      assert.equal(stored.previous_roasted_value, 1500);
      assert.equal(stored.previous_scheduled_value, 100);
    }
    assert.equal(state.starts, 3);
    assert.equal(state.polls, 3);
  });
});

test("historical source sync and historical report refresh retain Friday archives without starting the reader", async () => {
  await harness(async ({ db, state, request }) => {
    const previousWeek = addDays(week(), -7);
    await saveCropsterFriday(db, { weekStart: previousWeek, roastedKg: 900, roastedValue: 9000, greenKg: 5000, greenValue: 50000 });
    const sync = await request("/api/source-sync", { method: "POST", body: { weekStart: previousWeek } });
    assert.equal(sync.status, 200);
    assert.equal(sync.body.status, "archive");
    const report = await request("/api/weekly-report?week=" + previousWeek + "&refresh=1");
    assert.equal(report.status, 200);
    assert.equal(report.body.week.end, addDays(previousWeek, 4));
    assert.equal(report.body.metrics.production.roastedKg, 900);
    assert.equal(report.body.metrics.production.scheduledKg, null);
    assert.equal(report.body.metrics.green.kg, 5000);
    assert.equal(report.body.cropsterRefresh.mode, "friday-archive");
    assert.equal(state.starts, 0);
    assert.equal(state.polls, 0);
  });
});

test("all report pages expose the finished shared job's partial source statuses", async () => {
  await harness(async ({ state, request }) => {
    await request("/api/source-sync", { method: "POST" });
    const finished = await request("/api/source-sync?week=" + week() + "&jobId=" + state.jobId);
    assert.equal(finished.body.sourceSync.status, "partial");
    for (const path of ["/api/weekly-report", "/api/warehouse", "/api/roastery-lab"]) {
      const report = await request(path + "?sourceSyncJob=" + state.jobId + "&sourceSyncWeek=" + week());
      assert.equal(report.status, 200, path);
      assert.equal(report.body.sourceSync.status, "partial", path);
      assert.doesNotMatch(report.body.sourceSync.message, /All card sources updated/);
      assert.equal(report.body.sourceSync.sources.find(item => item.id === "planning").status, "failed", path);
    }
    assert.equal(state.starts, 1);
  });
});

test("polling a finalized job reuses its diagnostic result while still checking current staff authorization", async () => {
  await harness(async ({ state, request }) => {
    await request("/api/source-sync", { method: "POST" });
    const url = "/api/source-sync?week=" + week() + "&jobId=" + state.jobId;
    const first = await request(url);
    assert.equal(first.body.status, "complete");
    const previousReads = state.addresses.length;
    const cached = await request(url);
    assert.equal(cached.status, 200);
    assert.deepEqual(cached.body.sourceSync, first.body.sourceSync);
    const newReads = state.addresses.slice(previousReads);
    assert.equal(newReads.length, 1);
    assert.equal(newReads[0].hostname, "bmc-stockroom.misty-jelly-1931.chatgpt.site");
    assert.equal(newReads[0].pathname, "/api/inventory");
    assert.equal(state.starts, 1);
    assert.equal(state.polls, 1);
    state.revoked = true;
    const revoked = await request(url);
    assert.equal(revoked.status, 401);
    assert.equal(state.polls, 1);
  });
});

test('a manual click racing completion starts its keyed follow-up instead of trusting the older terminal log',async()=>{
  await harness(async({db,state,request})=>{
    const first=await request('/api/source-sync',{method:'POST'});const clientId=first.body.jobId;
    let release;state.readerGate=new Promise(resolve=>{release=resolve;});
    const url='/api/source-sync?week='+week()+'&jobId='+clientId;
    const polling=request(url);
    while(state.polls===0)await new Promise(resolve=>setImmediate(resolve));
    const joined=await request('/api/source-sync',{method:'POST'});assert.equal(joined.body.status,'running');
    release();const olderComplete=await polling;
    assert.equal(olderComplete.body.status,'running');
    const row=await db.prepare('SELECT phase, manual_request_id FROM dashboard_source_jobs').first();
    assert.equal(row.phase,'reading');assert.ok(row.manual_request_id);
    state.readerGate=null;state.jobId=crypto.randomUUID();
    const followup=await request(url);
    assert.equal(followup.body.status,'running');assert.equal(followup.body.jobId,clientId);assert.equal(state.starts,2);
    const stored=await db.prepare('SELECT reader_job_id, manual_request_id FROM dashboard_source_jobs').first();
    assert.equal(stored.reader_job_id,state.jobId);assert.equal(stored.manual_request_id,null);
  });
});

test("the Cropster callback requires its dedicated writer key even when a staff session is valid", async () => {
  await harness(async ({ db, env, state, request }) => {
    const body = { schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), result: observation(week(), 25) };
    for (const authorization of [undefined, "Bearer " + token, "Bearer wrong-writer-token"]) {
      const denied = await request("/api/integrations/cropster", { method: "POST", authorization, body });
      assert.equal(denied.status, 401);
    }
    delete env.CROPSTER_SYNC_WRITE_TOKEN;
    const unconfigured = await request("/api/integrations/cropster", { method: "POST", authorization: "Bearer " + writeToken, body });
    assert.equal(unconfigured.status, 401);
    assert.equal(state.addresses.length, 0);
    assert.equal((await db.prepare("SELECT week_start FROM dashboard_cropster_readings").all()).results.length, 0);
  });
});

test("the writer rejects a historical or mismatched week before changing current readings", async () => {
  await harness(async ({ db, state, request }) => {
    const priorWeek = addDays(week(), -7);
    const prior = await request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken,
      body: { schemaVersion: "1.0", jobId: state.jobId, weekStart: priorWeek, result: observation(priorWeek, 25) } });
    assert.equal(prior.status, 400);
    const mismatched = await request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken,
      body: { schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), result: observation(priorWeek, 25) } });
    assert.ok(mismatched.status >= 400 && mismatched.status < 600);
    assert.equal(state.addresses.length, 0);
    assert.equal((await db.prepare("SELECT week_start FROM dashboard_cropster_readings").all()).results.length, 0);
  });
});

test("a server callback persists source sections without a visitor cookie and acknowledges retries idempotently", async () => {
  await harness(async ({ db, state, request }) => {
    const result = observation(week(), 25);
    const body = { schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), result };
    const send = () => request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken, body });
    const first = await send();
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.status, "partial");
    assert.equal(first.body.sourceSync.jobStatus, "complete");
    assert.ok(first.body.sourceSync.sources.every(item => Object.keys(item).every(key => ["id", "label", "status", "asOf", "note"].includes(key))));
    const before = await db.prepare("SELECT * FROM dashboard_cropster_readings WHERE week_start = ?").bind(week()).first();
    assert.equal(before.scheduled_kg, 25);
    assert.equal(before.recorded_at, Date.parse(result.productionObservedAt));
    const firstParts = await db.prepare("SELECT part, data_json, recorded_at FROM dashboard_roastery_lab_cropster ORDER BY part").all();
    assert.equal(firstParts.results.length, 4);
    const second = await send();
    assert.equal(second.status, 200);
    assert.equal(second.body.ok, true);
    const after = await db.prepare("SELECT * FROM dashboard_cropster_readings WHERE week_start = ?").bind(week()).first();
    assert.deepEqual(after, before);
    assert.deepEqual((await db.prepare("SELECT part, data_json, recorded_at FROM dashboard_roastery_lab_cropster ORDER BY part").all()).results, firstParts.results);
    assert.equal((await db.prepare("SELECT week_start FROM dashboard_cropster_readings").all()).results.length, 1);
    assert.equal((await db.prepare("SELECT week_start FROM dashboard_cropster_monday").all()).results.length, 1);
    assert.equal((await db.prepare("SELECT location FROM dashboard_cropster_green_stock").all()).results.length, 1);
    const logs = (await db.prepare("SELECT status, source_status_json FROM dashboard_source_sync_log WHERE id = ?").bind(state.jobId).all()).results;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, "partial");
    const summary = JSON.parse(logs[0].source_status_json);
    assert.doesNotMatch(summary.message, /All card sources updated/);
    assert.equal(summary.sources.find(item => item.id === "planning").status, "failed");
    for (const part of ["inventory", "recipes", "use", "loss"]) assert.equal(summary.sources.find(item => item.id === "lab-" + part).status, "updated");
    assert.equal(state.starts, 0);
    assert.equal(state.polls, 0);
    assert.ok(state.addresses.every(url => url.hostname !== "bmc-stockroom.misty-jelly-1931.chatgpt.site"));
    assert.doesNotMatch(JSON.stringify(first.body), /synthetic-cropster-callback-writer-token|synthetic-source-sync-reader-token/);
  });
});

test("a callback preserves legacy planned replacements when their provenance cannot safely be separated", async () => {
  await harness(async ({ db, state, request }) => {
    const incoming = observation(week(), 25);
    const legacy = structuredClone(incoming.lab.recipes);
    legacy.runoutProfiles[0].lotIds.push("PG-0002");
    legacy.runoutProfiles[0].note = "Cropster links plus approved planned replacement from CONTRACTS.";
    await saveLabCropster(db, { recipes: legacy }, new Date(Date.now() - 1000));
    const before = await db.prepare("SELECT data_json, recorded_at FROM dashboard_roastery_lab_cropster WHERE part = ?").bind("recipes").first();
    const saved = await request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken,
      body: { schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), result: incoming } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.status, "partial");
    assert.equal(saved.body.sourceSync.jobStatus, "complete");
    const after = await db.prepare("SELECT data_json, recorded_at FROM dashboard_roastery_lab_cropster WHERE part = ?").bind("recipes").first();
    assert.deepEqual(after, before);
    assert.deepEqual(JSON.parse(after.data_json).runoutProfiles[0].lotIds, ["PG-0001", "PG-0002"]);
    const log = await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log WHERE id = ?").bind(state.jobId).first();
    const statuses = new Map(JSON.parse(log.source_status_json).sources.map(item => [item.id, item.status]));
    assert.equal(statuses.get("lab-recipes"), "failed");
    for (const part of ["inventory", "use", "loss"]) assert.equal(statuses.get("lab-" + part), "updated");
    assert.ok(state.addresses.every(url => url.hostname !== "bmc-stockroom.misty-jelly-1931.chatgpt.site"));
  });
});

test("checkpoint callbacks verify the authoritative job and save progress before completion", async () => {
  await harness(async ({ db, state, request }) => {
    const partial = observation(week(), 20);
    partial.lab = { inventory: partial.lab.inventory };
    partial.labObservedAt = { inventory: partial.labObservedAt.inventory };
    state.readerObservation = partial;
    state.readerStatus = "running";
    const send = body => request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken, body });
    const first = await send({ schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), status: "running", result: observation(week(), 60) });
    assert.equal(first.status, 200);
    assert.equal(state.polls, 1);
    assert.equal((await db.prepare("SELECT scheduled_kg FROM dashboard_cropster_readings").first()).scheduled_kg, 20);
    assert.equal((await db.prepare("SELECT part FROM dashboard_roastery_lab_cropster").all()).results.length, 1);
    const progress = JSON.parse((await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log").first()).source_status_json);
    assert.equal(progress.jobStatus, "running");
    assert.equal(progress.sources.find(source => source.id === "production").status, "updated");
    assert.equal(progress.sources.find(source => source.id === "lab-recipes").status, "pending");
    assert.ok(state.addresses.every(url => url.hostname === readerHost));

    const complete = observation(week(), 20);
    complete.productionObservedAt = partial.productionObservedAt;
    state.readerObservation = complete;
    state.readerStatus = "complete";
    // The callback sent for an older checkpoint can arrive after the job ends.
    const finished = await send({ schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), status: "running", result: partial });
    assert.equal(finished.status, 200);
    assert.equal((await db.prepare("SELECT part FROM dashboard_roastery_lab_cropster").all()).results.length, 4);
    assert.equal((await db.prepare("SELECT recorded_at FROM dashboard_cropster_readings").first()).recorded_at, Date.parse(partial.productionObservedAt));
    const finishedLog = (await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log").first()).source_status_json;
    assert.equal(JSON.parse(finishedLog).jobStatus, "complete");
    const polls = state.polls;
    await send({ schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), status: "running", result: partial });
    assert.equal(state.polls, polls);
    assert.equal((await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log").first()).source_status_json, finishedLog);
  });
});

test("a failed background job retains its verified sections and terminal status", async () => {
  await harness(async ({ db, state, request }) => {
    state.readerObservation = observation(week(), 15);
    state.readerObservation.lab = {};
    state.readerStatus = "failed";
    const saved = await request("/api/integrations/cropster", { method: "POST", authorized: false, requestOrigin: null,
      authorization: "Bearer " + writeToken,
      body: { schemaVersion: "1.0", jobId: state.jobId, weekStart: week(), status: "failed", result: state.readerObservation } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.status, "partial");
    assert.equal((await db.prepare("SELECT scheduled_kg FROM dashboard_cropster_readings").first()).scheduled_kg, 15);
    const log = JSON.parse((await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log").first()).source_status_json);
    assert.equal(log.jobStatus, "failed");
    assert.match(log.message, /stopped/);
    assert.equal(log.sources.find(source => source.id === "lab-recipes").status, "failed");
  });
});

test("a failed sync check does not retry the reader or block the other report feeds", async () => {
  for (const path of ["/api/weekly-report", "/api/warehouse", "/api/roastery-lab"]) {
    await harness(async ({ state, request }) => {
      const report = await request(path + "?refresh=1&sourceSyncCheckUnavailable=1&sourceSyncJob=" + state.jobId + "&sourceSyncWeek=" + week());
      assert.equal(report.status, 200, path);
      assert.equal(state.starts, 0, path);
      assert.equal(state.polls, 0, path);
      assert.ok(state.addresses.some(url => url.hostname === "bmc-stockroom.misty-jelly-1931.chatgpt.site"), path);
      assert.ok(state.addresses.some(url => url.hostname !== readerHost && url.hostname !== "bmc-stockroom.misty-jelly-1931.chatgpt.site"), path);
      assert.doesNotMatch(report.body.sourceSync.message, /All card sources updated/);
      const before = state.addresses.length;
      state.revoked = true;
      const denied = await request(path + "?refresh=1&sourceSyncCheckUnavailable=1");
      assert.equal(denied.status, 401, path);
      assert.ok(state.addresses.slice(before).every(url => url.hostname === "bmc-stockroom.misty-jelly-1931.chatgpt.site"));
    });
  }
});

test('the pull worker owns and persists its checkpoint without contacting Render', async () => {
  await harness(async ({db,env,state,request})=>{
    env.CROPSTER_RUNNER_ENABLED='true';
    env.CROPSTER_RUNNER_TOKEN='synthetic-runner-token-1234567890123456789';
    const path='/api/integrations/cropster-runner';
    const runnerId=crypto.randomUUID();
    const send=(body,key=env.CROPSTER_RUNNER_TOKEN)=>request(path,{method:'POST',authorized:false,
      authorization:'Bearer '+key,body:{runnerId,...body}});
    assert.equal((await send({action:'claim',force:true},'wrong')).status,401);
    const result=await request('/api/source-sync',{method:'POST'});
    assert.equal(result.body.status,'running');
    assert.match(result.body.note,/queued/);
    const first=await send({action:'claim',force:true});
    assert.equal(first.body.job.jobId,result.body.jobId);
    assert.equal((await send({action:'claim',force:true})).body.job.jobId,result.body.jobId);
    assert.equal((await send({action:'claim',runnerId:crypto.randomUUID()})).body.job,null);
    const jobId=first.body.job.jobId;
    assert.equal((await send({action:'heartbeat',jobId,runnerId:crypto.randomUUID()})).status,409);
    assert.equal((await send({action:'heartbeat',jobId})).status,200);
    const capture={...observation(week(),40),scheduledBatches:{greenKg:40,batches:2}};
    const checkpoint=await send({action:'checkpoint',jobId,result:capture});
    assert.equal(checkpoint.status,200);
    assert.equal((await db.prepare("SELECT green_kg FROM dashboard_cropster_scheduled_batches WHERE week_start=?").bind(week()).first()).green_kg,40);
    const finished=await send({action:'complete',jobId,result:capture});
    assert.equal(finished.status,200);
    assert.equal(finished.body.status,'complete');
    assert.equal((await send({action:'complete',jobId,result:capture})).status,200);
    assert.equal((await db.prepare('SELECT phase FROM dashboard_source_jobs WHERE id=?').bind(jobId).first()).phase,'complete');
    assert.equal(state.starts,0);
    assert.equal(state.polls,0);
  });
});
