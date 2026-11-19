import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/server.mjs";
import { ReaderError } from "../src/errors.mjs";

const token = "synthetic_checkpoint_token_12345678901234567890";
const time = "2026-02-05T00:00:00.000Z";
const callback = { url: "https://example.synthetic.chatgpt.site/api/integrations/cropster", token };
const source = () => ({ schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville", weekStart: "2026-02-02", periodEnd: "2026-02-06", observedAt: time, productionObservedAt: time, production: { roastedKg: 20, scheduledKg: 5 }, lab: { inventory: { asOf: "2026-02-05", rows: [] } }, labObservedAt: { inventory: time } });
const startRequest = () => new Request("https://reader.test/v1/sync", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: "2026-02-02" }) });
const statusRequest = id => new Request("https://reader.test/v1/sync/" + id, { headers: { Authorization: "Bearer " + token } });

test("running checkpoints are immutable and authoritative before their awaited callbacks, without deadlocking status reads", async () => {
  let continueRead, handler;
  const posts = [], logs = [];
  const checkpoint = source();
  handler = createHandler({
    token, callback, now: () => new Date(time), log: event => logs.push(event),
    reader: { async read(week, { onCapture }) {
      await onCapture(checkpoint);
      checkpoint.production.roastedKg = 999;
      await new Promise(resolve => { continueRead = resolve; });
      return { ...source(), lab: { ...source().lab, use: { months: [] } }, labObservedAt: { inventory: time, use: time } };
    } },
    fetcher: async (address, options) => {
      const body = JSON.parse(options.body);
      posts.push(body);
      const authoritative = await (await handler(statusRequest(body.jobId))).json();
      assert.equal(authoritative.status, body.status);
      assert.deepEqual(authoritative.result, body.result);
      return Response.json({ ok: true });
    },
  });
  const job = await (await handler(startRequest())).json();
  await new Promise(resolve => setImmediate(resolve));
  const partial = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(partial.status, "running");
  assert.equal(partial.result.production.roastedKg, 20);
  assert.equal(partial.result.lab.use, undefined);
  assert.equal(partial.checkpointDelivery, "saved");
  assert.equal(partial.delivery, undefined);
  continueRead();
  await new Promise(resolve => setImmediate(resolve));
  const completed = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(completed.status, "complete");
  assert.ok(completed.result.lab.use);
  assert.equal(completed.delivery, "saved");
  assert.deepEqual(posts.map(post => post.status), ["running", "complete"]);
  assert.doesNotMatch(JSON.stringify(logs), /roastedKg|scheduledKg|synthetic_checkpoint_token/);
});

test("terminal failure retains and delivers the verified checkpoint, refreshing only its overall receipt time", async () => {
  let clock = Date.parse(time), handler;
  const posts = [];
  handler = createHandler({
    token, callback, now: () => new Date(clock),
    reader: { async read(week, { onCapture }) {
      await onCapture(source());
      clock += 20 * 60000;
      throw new ReaderError("CROPSTER_TIMEOUT", 504);
    } },
    fetcher: async (address, options) => {
      const body = JSON.parse(options.body);
      posts.push(body);
      const authoritative = await (await handler(statusRequest(body.jobId))).json();
      assert.equal(authoritative.status, body.status);
      assert.deepEqual(authoritative.result, body.result);
      return Response.json({ ok: true });
    },
  });
  const job = await (await handler(startRequest())).json();
  await new Promise(resolve => setImmediate(resolve));
  const failed = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "CROPSTER_TIMEOUT");
  assert.equal(failed.result.production.roastedKg, 20);
  assert.equal(failed.result.productionObservedAt, time);
  assert.equal(failed.result.labObservedAt.inventory, time);
  assert.equal(failed.result.observedAt, "2026-02-05T00:20:00.000Z");
  assert.equal(failed.delivery, "saved");
  assert.deepEqual(posts.map(post => post.status), ["running", "failed"]);
});

test("a failed checkpoint delivery does not discard the result or pretend that the whole capture completed", async () => {
  let release;
  const handler = createHandler({
    token, callback, now: () => new Date(time),
    reader: { async read(week, { onCapture }) { await onCapture(source()); await new Promise(resolve => { release = resolve; }); return source(); } },
    fetcher: async () => new Response(null, { status: 401 }),
  });
  const job = await (await handler(startRequest())).json();
  await new Promise(resolve => setImmediate(resolve));
  const partial = await (await handler(statusRequest(job.jobId))).json();
  assert.equal(partial.status, "running");
  assert.equal(partial.checkpointDelivery, "failed");
  assert.equal(partial.result.production.roastedKg, 20);
  release();
  await new Promise(resolve => setImmediate(resolve));
});
