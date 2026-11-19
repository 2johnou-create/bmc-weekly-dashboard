import assert from "node:assert/strict";
import test from "node:test";
import { createHandler, readConfiguration } from "../src/server.mjs";
import { ReaderError } from "../src/errors.mjs";
import { currentMonday, weekRange } from "../src/dates.mjs";

const token = "synthetic_reader_token_12345678901234567890";
const now = () => new Date("2026-02-05T00:00:00Z");
const request = (body = { weekStart: "2026-02-02" }, bearer = token) => new Request("https://reader.test/v1/weekly", {
  method: "POST", headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("configuration accepts only bounded runtime secrets and a bounded timeout", () => {
  const config = { CROPSTER_EMAIL: "reader@example.test", CROPSTER_PASSWORD: "synthetic-only", CROPSTER_READER_TOKEN: token };
  assert.equal(readConfiguration(config).timeoutMs, 600000);
  assert.equal(readConfiguration({ ...config, CROPSTER_READER_TIMEOUT_MS: "600000" }).timeoutMs, 600000);
  for (const field of ["CROPSTER_EMAIL", "CROPSTER_PASSWORD", "CROPSTER_READER_TOKEN"]) assert.throws(() => readConfiguration({ ...config, [field]: "" }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => readConfiguration({ ...config, CROPSTER_READER_TIMEOUT_MS: "999999" }), /CONFIGURATION_REQUIRED/);
});

test("health and rejected requests cannot invoke a browser or reveal business data", async () => {
  let calls = 0;
  const handler = createHandler({ token, now, reader: { read() { calls++; return {}; } } });
  const health = await handler(new Request("https://reader.test/health"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "cropster-website-reader" });
  assert.equal((await handler(request(undefined, "wrong"))).status, 401);
  assert.equal((await handler(request({ weekStart: "2026-02-02", url: "https://elsewhere.test" }))).status, 400);
  assert.equal((await handler(request({ weekStart: "2026-01-26" }))).status, 400);
  assert.equal((await handler(request({ weekStart: "2026-02-03" }))).status, 400);
  assert.equal(calls, 0);
});

test("simultaneous same-week refreshes share one live job; a subsequent refresh runs again", async () => {
  let calls = 0, resolve;
  const handler = createHandler({ token, now, reader: { read() { calls++; return new Promise(done => { resolve = done; }); } } });
  const first = handler(request()), second = handler(request());
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
  const observation = { weekStart: "2026-02-02", observedAt: now().toISOString(), production: { roastedKg: 20, scheduledKg: 5 } };
  resolve(observation);
  for (const response of await Promise.all([first, second])) assert.deepEqual(await response.json(), observation);
  const third = handler(request());
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 2);
  resolve(observation);
  assert.equal((await third).status, 200);
});

test("errors and logs contain safe codes instead of credentials, URLs or page bodies", async () => {
  const logs = [];
  const handler = createHandler({ token, now, log: event => logs.push(event), reader: { read() { throw new Error("synthetic-secret https://private.test/ token=bad"); } } });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "CROPSTER_UNAVAILABLE" } });
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-secret|private\.test|token=/);
  const controlled = createHandler({ token, now, reader: { read() { throw new ReaderError("CROPSTER_CHANGED_DURING_READ"); } } });
  assert.equal((await controlled(request())).status, 503);
});

test("oversized bodies and alternative methods are rejected", async () => {
  const handler = createHandler({ token, now, reader: { read() { throw new Error("must not run"); } } });
  assert.equal((await handler(request({ weekStart: "x".repeat(1000) }))).status, 400);
  const get = new Request("https://reader.test/v1/weekly", { headers: { Authorization: "Bearer " + token } });
  assert.equal((await handler(get)).status, 405);
});

test("Sydney current week remains correct across UTC midnight and daylight-saving dates", () => {
  assert.equal(currentMonday(new Date("2026-10-04T14:30:00Z")), "2026-10-05");
  assert.equal(weekRange("2026-02-02", now()).periodEnd, "2026-02-06");
  assert.throws(() => weekRange("2026-02-30", now()), /INVALID_REPORTING_WEEK/);
});

const syncRequest = () => new Request("https://reader.test/v1/sync", {
  method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: "2026-02-02" }),
});
const statusRequest = id => new Request("https://reader.test/v1/sync/" + id, { headers: { Authorization: "Bearer " + token } });

test("asynchronous sync starts immediately, coalesces, exposes only its authorised status, and runs a new job after completion", async () => {
  let resolve, calls = 0;
  const handler = createHandler({ token, now, reader: { read(week, options) { calls++; assert.equal(options.scope, "all"); return new Promise(done => { resolve = done; }); } } });
  const firstResponse = await handler(syncRequest());
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  assert.match(first.jobId, /^[a-f0-9-]{36}$/);
  assert.equal(first.status, "running");
  assert.equal((await (await handler(syncRequest())).json()).jobId, first.jobId);
  assert.equal(calls, 1);
  assert.equal((await handler(new Request("https://reader.test/v1/sync/" + first.jobId))).status, 401);
  assert.equal((await (await handler(statusRequest(first.jobId))).json()).status, "running");
  const result = { production: { roastedKg: 20, scheduledKg: 5 }, observedAt: now().toISOString() };
  resolve(result);
  await new Promise(done => setImmediate(done));
  const completed = await (await handler(statusRequest(first.jobId))).json();
  assert.equal(completed.status, "complete");
  assert.deepEqual(completed.result, result);
  const next = await (await handler(syncRequest())).json();
  assert.notEqual(next.jobId, first.jobId);
  assert.equal(calls, 2);
  resolve(result);
  await new Promise(done => setImmediate(done));
});

test("failed async jobs return only safe codes and expire after ten minutes", async () => {
  let time = now().getTime();
  const handler = createHandler({ token, now: () => new Date(time), reader: { read() { throw new Error("secret-credential-and-page-body"); } } });
  const job = await (await handler(syncRequest())).json();
  await new Promise(done => setImmediate(done));
  const failed = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "CROPSTER_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(failed), /secret-credential/);
  time += 600001;
  assert.equal((await handler(statusRequest(job.jobId))).status, 404);
});

test("async history has a bounded ten-job capacity and evicts oldest completed jobs", async () => {
  let counter = 0;
  const handler = createHandler({ token, now, reader: { read() { return { sequence: ++counter }; } } });
  const ids = [];
  for (let index = 0; index < 11; index++) {
    ids.push((await (await handler(syncRequest())).json()).jobId);
    await new Promise(done => setImmediate(done));
  }
  assert.equal((await handler(statusRequest(ids[0]))).status, 404);
  assert.equal((await handler(statusRequest(ids[1]))).status, 200);
  assert.equal((await handler(statusRequest(ids[10]))).status, 200);
});

test("job diagnostics expose only fixed stage metadata and safe errors", async () => {
  const logs = [];
  let finish;
  const handler = createHandler({ token, now, log: event => logs.push(event), reader: { async read(week, { onProgress }) {
    onProgress({ stage: "https://secret.example.test/password", state: "failed", phase: "parse", code: "BAD" });
    onProgress({ stage: "weekly_monday", state: "failed", phase: "parse", code: "CROPSTER_TABLE_INCOMPLETE", pageBody: "private figures and password", url: "https://private.test" });
    await new Promise(resolve => { finish = resolve; });
    throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  } } });
  const job = await (await handler(syncRequest())).json();
  await new Promise(resolve => setImmediate(resolve));
  const state = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(state.progress.stage, "weekly_monday");
  assert.equal(state.progress.code, "CROPSTER_TABLE_INCOMPLETE");
  assert.equal(state.failures.length, 1);
  assert.doesNotMatch(JSON.stringify([state, logs]), /secret\.example|private figures|password|private\.test|pageBody/);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await (await handler(statusRequest(job.jobId))).json()).status, "failed");
});
