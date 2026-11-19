import assert from "node:assert/strict";
import test from "node:test";
import { callbackConfiguration, deliverCapture } from "../src/callback.mjs";
import { createHandler } from "../src/server.mjs";

const token = "synthetic_callback_token_12345678901234567890";
const env = { DASHBOARD_SYNC_URL: "https://example.synthetic.chatgpt.site/api/integrations/cropster", DASHBOARD_SYNC_TOKEN: token };
const payload = { schemaVersion: "1.0", jobId: "synthetic-job", weekStart: "2026-02-02", result: { production: { roastedKg: 20, scheduledKg: 5 } } };

test("callback destination requires paired runtime values and a fixed HTTPS ingestion route", () => {
  assert.equal(callbackConfiguration({}), null);
  assert.equal(callbackConfiguration({ DASHBOARD_SYNC_URL: "", DASHBOARD_SYNC_TOKEN: "" }), null);
  assert.equal(callbackConfiguration(env).url, env.DASHBOARD_SYNC_URL);
  for (const address of [
    "http://example.synthetic.chatgpt.site/api/integrations/cropster", "https://example.test/api/integrations/cropster",
    env.DASHBOARD_SYNC_URL + "?token=bad", env.DASHBOARD_SYNC_URL + "#fragment", env.DASHBOARD_SYNC_URL.replace("/cropster", "/other"),
    env.DASHBOARD_SYNC_URL.replace("https://", "https://name:pass@"),
  ]) assert.throws(() => callbackConfiguration({ ...env, DASHBOARD_SYNC_URL: address }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => callbackConfiguration({ DASHBOARD_SYNC_URL: env.DASHBOARD_SYNC_URL }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => callbackConfiguration({ DASHBOARD_SYNC_TOKEN: token }), /CONFIGURATION_REQUIRED/);
  assert.equal(callbackConfiguration({ ...env, DASHBOARD_SYNC_URL: "https://dashboard.example.test/api/integrations/cropster", DASHBOARD_SYNC_HOST: "dashboard.example.test" }).url, "https://dashboard.example.test/api/integrations/cropster");
});

test("callback sends one authenticated fixed payload and requires an explicit JSON save acknowledgement", async () => {
  let calls = 0;
  const result = await deliverCapture(callbackConfiguration(env), payload, { fetcher: async (address, options) => {
    calls++;
    assert.equal(address, env.DASHBOARD_SYNC_URL);
    assert.equal(options.redirect, "manual");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + token);
    assert.deepEqual(JSON.parse(options.body), payload);
    return Response.json({ ok: true });
  } });
  assert.equal(result, "saved");
  assert.equal(calls, 1);
});

test("redirect and unauthorised responses never forward a token to another endpoint", async () => {
  for (const status of [302, 307, 401, 403]) {
    let calls = 0;
    const result = await deliverCapture(callbackConfiguration(env), payload, { fetcher: async address => {
      calls++; assert.equal(address, env.DASHBOARD_SYNC_URL);
      return new Response(null, { status, headers: { Location: "https://untrusted.example.test/" } });
    }, sleep: async () => { throw new Error("must not retry"); } });
    assert.equal(result, "failed");
    assert.equal(calls, 1);
  }
});

test("temporary failures make at most three attempts with bounded backoff and no raw error disclosure", async () => {
  const delays = []; let calls = 0;
  const result = await deliverCapture(callbackConfiguration(env), payload, {
    fetcher: async () => { calls++; throw new Error("secret-token private-url raw-page-body"); },
    sleep: async delay => { delays.push(delay); },
  });
  assert.equal(result, "failed");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|private-url|raw-page-body/);
  assert.equal(await deliverCapture(null, payload), "not-configured");
});

test("a completed capture remains pollable even while callback delivery is pending or fails", async () => {
  const logs = []; let completeDelivery;
  const handler = createHandler({
    reader: { read: async () => payload.result }, token, callback: callbackConfiguration(env),
    now: () => new Date("2026-02-05T00:00:00Z"), log: event => logs.push(event), sleep: async () => {},
    fetcher: async () => new Promise(resolve => { completeDelivery = resolve; }),
  });
  const start = await handler(new Request("https://reader.test/v1/sync", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: payload.weekStart }) }));
  const job = await start.json();
  await new Promise(resolve => setImmediate(resolve));
  const status = () => handler(new Request("https://reader.test/v1/sync/" + job.jobId, { headers: { Authorization: "Bearer " + token } }));
  const pendingDelivery = await (await status()).json();
  assert.equal(pendingDelivery.status, "complete");
  assert.deepEqual(pendingDelivery.result, payload.result);
  completeDelivery(new Response(null, { status: 401 }));
  await new Promise(resolve => setImmediate(resolve));
  const failedDelivery = await (await status()).json();
  assert.equal(failedDelivery.status, "complete");
  assert.equal(failedDelivery.delivery, "failed");
  assert.deepEqual(failedDelivery.result, payload.result);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic_callback_token|roastedKg|scheduledKg/);
});
