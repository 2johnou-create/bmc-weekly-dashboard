import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter, settlesWithin } from "../src/runtime-limits.mjs";
import { createBrowserReader, captureTimestamps, requireCredentialOrigin } from "../src/browser.mjs";
import { ReaderError } from "../src/errors.mjs";

const now = () => new Date("2026-02-05T00:00:00Z");
const configuration = { email: "synthetic@example.test", password: "synthetic-private-value", chromiumSandbox: false };

test("final section and overall timestamps share one instant even when the clock advances on each read", () => {
  let calls = 0;
  const timestamps = captureTimestamps(() => new Date(Date.UTC(2026, 1, 5) + calls++));
  assert.equal(calls, 1);
  assert.equal(timestamps.productionObservedAt, timestamps.observedAt);
  assert.ok(Date.parse(timestamps.productionObservedAt) <= Date.parse(timestamps.observedAt));
});

test("credentials may only be typed into the exact HTTPS Cropster login origin and path", () => {
  assert.doesNotThrow(() => requireCredentialOrigin("https://c-sar.cropster.com/app/login?redirectPath=report"));
  for (const address of ["https://untrusted.example.test/app/login", "https://c-sar.cropster.com.example.test/app/login", "http://c-sar.cropster.com/app/login", "https://name:pass@c-sar.cropster.com/app/login", "https://c-sar.cropster.com/app/", "invalid"]) {
    assert.throws(() => requireCredentialOrigin(address), /CROPSTER_AUTH_REQUIRED/);
  }
});

test("cancelled limiters reject queued work immediately without starting it", async () => {
  const limit = createLimiter(1);
  let release, calls = 0;
  const active = limit(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const queued = limit(() => { calls++; });
  const rejected = assert.rejects(queued, /CROPSTER_TIMEOUT/);
  await new Promise(resolve => setImmediate(resolve));
  limit.cancel(new ReaderError("CROPSTER_TIMEOUT"));
  await rejected;
  assert.equal(calls, 1);
  await assert.rejects(limit(() => { calls++; }), /CROPSTER_TIMEOUT/);
  release();
  await active;
  assert.equal(calls, 1);
});

test("a hung cleanup settles within its fixed bound", async () => {
  assert.equal(await settlesWithin(() => new Promise(() => {}), 10), false);
  assert.equal(await settlesWithin(() => Promise.reject(new Error("already closed")), 10), true);
});

test("the capture deadline rejects even if browser launch never settles", async () => {
  const events = [], started = Date.now();
  const reader = createBrowserReader({ ...configuration, timeoutMs: 25 }, { now, launch: () => new Promise(() => {}), cleanupTimeoutMs: 10 });
  await assert.rejects(reader.read("2026-02-02", { onProgress: event => events.push(event) }), /CROPSTER_TIMEOUT/);
  assert.ok(Date.now() - started < 300, "Deadline must not wait for the browser operation");
  assert.ok(events.some(event => event.stage === "browser_launch" && event.state === "running"));
  assert.ok(events.some(event => event.phase === "deadline" && event.code === "CROPSTER_TIMEOUT"));
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private-value|synthetic@example/);
  await reader.close();
});

test("a hung page close cannot hold the capture or browser reset indefinitely", async () => {
  const never = () => new Promise(() => {});
  const page = {
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
    goto: async () => {}, waitForFunction: async () => {},
    locator: () => ({ isVisible: async () => false }), close: never,
  };
  const context = { route: async () => {}, newPage: async () => page };
  const browser = { isConnected: () => true, newContext: async () => context, close: never };
  const events = [], started = Date.now();
  const reader = createBrowserReader({ ...configuration, timeoutMs: 1000 }, { now, launch: async () => browser, cleanupTimeoutMs: 10 });
  await assert.rejects(reader.read("2026-02-02", { onProgress: event => events.push(event) }), /CROPSTER_CLEANUP_TIMEOUT/);
  assert.ok(Date.now() - started < 300);
  assert.ok(events.some(event => event.stage === "cleanup" && event.code === "CROPSTER_CLEANUP_TIMEOUT"));
  await reader.close();
});
