import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";

const env = { SESSION_SECRET: "synthetic-worker-test-secret-at-least-thirty-two-characters" };
const origin = "https://dashboard.test";

test("public page contains no operational snapshot and CSP permits only its exact script", async () => {
  const response = await worker.fetch(new Request(origin), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const html = await response.text();
  assert.match(html, /Stock Take App password/);
  assert.doesNotMatch(html, /bmc123|SESSION_SECRET|bmc_stockroom_session=/);
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script))).toString("base64");
    assert.ok(response.headers.get("content-security-policy").includes(`'sha256-${hash}'`));
    new Function(script);
  }
});

test("unauthenticated and tampered sessions cannot trigger source reads", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No external requests allowed"); };
  try {
    for (const cookie of ["", "bmc_weekly_session=forged-session"]) {
      const response = await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: cookie } }), env);
      assert.equal(response.status, 401);
      assert.deepEqual(Object.keys(await response.json()), ["error"]);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("valid sessions still cannot request invalid or future reporting weeks", async () => {
  const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_source_session_123456789")).split(";")[0];
  for (const date of ["2026-02-31", "2026-11-03", "2099-01-05"]) {
    const response = await worker.fetch(new Request(origin + "/api/dashboard?week=" + date, { headers: { Cookie: cookie } }), env);
    assert.equal(response.status, 400);
  }
});

test("auth endpoints do not accept cross-origin mutations or unsupported methods", async () => {
  assert.equal((await worker.fetch(new Request(origin + "/api/auth", { method: "DELETE", headers: {Origin:"https://other.test"} }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(origin + "/api/dashboard", { method: "POST" }), env)).status, 405);
  const response = await worker.fetch(new Request(origin + "/api/auth"), env);
  assert.deepEqual(await response.json(), {authenticated:false});
});
