import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/server.mjs";
import { createRefreshControl } from "../src/refresh-control.mjs";

const token = "synthetic_reader_token_12345678901234567890";
const now = () => new Date("2026-02-05T00:00:00Z");
const post = () => new Request("https://reader.test/v1/sync", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: "2026-02-02" }) });
const get = id => new Request("https://reader.test/v1/sync/" + id, { headers: { Authorization: "Bearer " + token } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("refresh control coalesces clicks and cannot seal while a recheck remains requested", () => {
  const control = createRefreshControl();
  assert.equal(control.request(), true);
  assert.equal(control.request(), true);
  assert.equal(control.sealIfIdle(), false);
  assert.equal(control.take(), true);
  assert.equal(control.take(), false);
  assert.equal(control.sealIfIdle(), true);
  assert.equal(control.request(), false);
});

test("only explicit joined POSTs queue a recheck; ordinary polling does not create capture work", async () => {
  let options, release, calls = 0;
  const handler = createHandler({ token, now, reader: { read(_week, supplied) { options = supplied; calls++; return new Promise(resolve => { release = resolve; }); } } });
  const first = await (await handler(post())).json();
  await flush();
  for (let index = 0; index < 4; index++) assert.equal((await (await handler(get(first.jobId))).json()).weeklyRefreshPending, false);
  assert.equal(options.refreshControl.hasPending(), false);
  for (let index = 0; index < 4; index++) {
    const joined = await (await handler(post())).json();
    assert.equal(joined.jobId, first.jobId);
    assert.equal(joined.weeklyRefreshPending, true);
  }
  assert.equal(calls, 1);
  options.refreshControl.take(); options.refreshControl.sealIfIdle();
  release({ production: { scheduledKg: 8 } });
  await flush();
  assert.equal((await (await handler(get(first.jobId))).json()).status, "complete");
});

test("a POST racing a sealed terminal capture starts one new job behind cleanup instead of joining stale results", async () => {
  const releases = [], controls = [];
  let calls = 0;
  const handler = createHandler({ token, now, reader: { read(_week, { refreshControl }) {
    calls++; controls.push(refreshControl); refreshControl.take(); refreshControl.sealIfIdle();
    return new Promise(resolve => releases.push(resolve));
  } } });
  const first = await (await handler(post())).json();
  await flush();
  assert.equal(calls, 1);
  const next = await (await handler(post())).json();
  assert.notEqual(next.jobId, first.jobId);
  const joined = await (await handler(post())).json();
  assert.equal(joined.jobId, next.jobId);
  assert.equal(calls, 1, "A queued successor must not start a second browser capture during cleanup");
  releases[0]({ production: { scheduledKg: 1 } });
  await flush();
  assert.equal(calls, 2);
  assert.equal(controls[1].hasPending(), false);
  assert.equal((await (await handler(get(first.jobId))).json()).status, "complete");
  releases[1]({ production: { scheduledKg: 2 } });
  await flush();
  const completed = await (await handler(get(next.jobId))).json();
  assert.equal(completed.status, "complete");
  assert.equal(completed.result.production.scheduledKg, 2);
});

test("the server cannot report complete if a reader returns with an explicit refresh unconsumed", async () => {
  let release;
  const handler = createHandler({ token, now, reader: { read() { return new Promise(resolve => { release = resolve; }); } } });
  const first = await (await handler(post())).json();
  await flush();
  await handler(post());
  release({ production: { scheduledKg: 1 } });
  await flush();
  const failed = await (await handler(get(first.jobId))).json();
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "CROPSTER_REFRESH_PENDING");
});
