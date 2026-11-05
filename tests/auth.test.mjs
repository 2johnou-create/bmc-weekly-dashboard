import test from "node:test";
import assert from "node:assert/strict";
import { HttpError, readSession, sealSession, signIn, signOut } from "../worker/auth.js";

const origin = "https://weekly-dashboard.example";
const stockroomOrigin = "https://bmc-stockroom.misty-jelly-1931.chatgpt.site";
const env = { SESSION_SECRET: "synthetic-session-key-for-auth-tests-only-0123456789" };
// The source creates 32 random bytes encoded as unpadded base64url (43 characters).
const token = Buffer.from(Array.from({ length: 32 }, (_, index) => index * 7 % 256)).toString("base64url");
const sourceCookie = `bmc_stockroom_session=${token}`;
const loginPassword = "synthetic-staff-password";
const cookieHeader = setCookie => setCookie.split(";")[0];
const request = (path = "/api/session", options = {}) => new Request(origin + path, options);
const loginRequest = (extra = {}) => request("/api/session", { method: "POST", headers: { Origin: origin, "content-type": "application/json", "cf-connecting-ip": "test-login", ...extra.headers }, body: extra.body ?? JSON.stringify({ password: loginPassword }) });
const safeError = (status, secret = loginPassword) => error => error instanceof HttpError && error.status === status && !error.message.includes(secret) && !error.message.includes(token) && !error.message.includes(env.SESSION_SECRET);

test("session cookie encrypts the source token and has browser protections", async () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  const first = await sealSession(request(), env, sourceCookie, now);
  const second = await sealSession(request(), env, sourceCookie, now);
  assert.notEqual(first, second, "Every seal must use a fresh nonce");
  assert.equal(first.includes(token), false);
  assert.equal(first.includes(sourceCookie), false);
  assert.equal(first.includes(loginPassword), false);
  for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/", "Max-Age=43200"]) assert.ok(first.includes(attribute));
  const session = await readSession(request("/api/dashboard", { headers: { Cookie: cookieHeader(first) } }), env, now + 1000);
  assert.equal(session.stockroomCookie, sourceCookie);
  assert.equal(session.expiresAt, now + 43_200_000);
});

test("modified, expired, wrong-origin and wrong-key sessions cannot authenticate", async () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  const original = cookieHeader(await sealSession(request(), env, sourceCookie, now));
  const index = original.indexOf("=") + 30;
  const tampered = original.slice(0, index) + (original[index] === "A" ? "B" : "A") + original.slice(index + 1);
  assert.equal(await readSession(request("/", { headers: { Cookie: tampered } }), env, now), null);
  assert.equal(await readSession(request("/", { headers: { Cookie: original } }), env, now + 43_200_000), null);
  assert.equal(await readSession(new Request("https://another-dashboard.example/", { headers: { Cookie: original } }), env, now), null);
  assert.equal(await readSession(request("/", { headers: { Cookie: original } }), { SESSION_SECRET: "another-synthetic-session-key-01234567890123456789" }, now), null);
  assert.equal(await readSession(request("/", { headers: { Cookie: "bmc_weekly_session=not-base64!" } }), env, now), null);
  assert.equal(await readSession(request("/", { headers: { Cookie: "bmc_weekly_session=" + "A".repeat(4097) } }), env, now), null);
});

test("missing session configuration fails closed without exposing credentials", async () => {
  await assert.rejects(sealSession(request(), {}, sourceCookie), safeError(503));
  await assert.rejects(sealSession(request(), { SESSION_SECRET: "short" }, sourceCookie), safeError(503));
  const cookie = cookieHeader(await sealSession(request(), env, sourceCookie));
  await assert.rejects(readSession(request("/", { headers: { Cookie: cookie } }), {}), safeError(503));
  let calls = 0;
  await assert.rejects(signIn(loginRequest(), {}, async () => { calls++; }), safeError(503));
  assert.equal(calls, 0);
});

test("login and logout require the exact dashboard origin before any upstream request", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("must not be reached"); };
  await assert.rejects(signIn(loginRequest({ headers: { Origin: "https://outside.example" } }), env, fetcher), safeError(403));
  await assert.rejects(signIn(request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: loginPassword }) }), env, fetcher), safeError(403));
  await assert.rejects(signOut(request("/api/session", { method: "DELETE", headers: { Origin: "https://outside.example" } }), env, fetcher), safeError(403));
  assert.equal(calls, 0);
});

test("login rejects oversized, malformed and incorrectly typed bodies before forwarding", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error("must not be reached"); };
  const invalid = [
    loginRequest({ headers: { "content-type": "text/plain" } }),
    loginRequest({ headers: { "content-length": "1025" } }),
    loginRequest({ body: JSON.stringify({ password: "x".repeat(257) }) }),
    loginRequest({ body: JSON.stringify({ password: "é".repeat(1200) }) }),
    loginRequest({ body: JSON.stringify({ password: 123 }) }),
    loginRequest({ body: JSON.stringify({ password: "" }) }),
    loginRequest({ body: "{malformed" }),
    loginRequest({ body: "null" }),
  ];
  for (const candidate of invalid) await assert.rejects(signIn(candidate, env, fetcher), safeError(400));
  assert.equal(calls, 0);
});

test("successful login forwards only to Stockroom and accepts its actual token format", async () => {
  assert.equal(token.length, 43);
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, stockroomOrigin + "/api/auth/login");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Origin, stockroomOrigin);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { password: loginPassword });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("{}", { headers: { "set-cookie": `${sourceCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
  };
  const result = await signIn(loginRequest(), env, fetcher);
  assert.equal(calls, 1);
  assert.equal(result.includes(token), false);
  assert.equal(result.includes(loginPassword), false);
  const session = await readSession(request("/api/dashboard", { headers: { Cookie: cookieHeader(result) } }), env);
  assert.equal(session.stockroomCookie, sourceCookie);
});

test("incorrect passwords and missing source sessions never return an authenticated cookie", async () => {
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-incorrect" } }), env, async () => new Response(JSON.stringify({ password: loginPassword, token }), { status: 401 })), safeError(401));
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-missing-cookie" } }), env, async () => new Response("{}")), safeError(503));
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-invalid-cookie" } }), env, async () => new Response("{}", { headers: { "set-cookie": "bmc_stockroom_session=short; Path=/" } })), safeError(503));
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-redirect" } }), env, async () => new Response(null, { status: 302, headers: { location: "https://outside.example", "set-cookie": sourceCookie } })), safeError(503));
});

test("upstream errors do not expose source tokens, submitted passwords or server secrets", async () => {
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-network-error" } }), env, async () => { throw new Error(`${loginPassword} ${token} ${env.SESSION_SECRET}`); }), safeError(503));
});

test("repeated failed sign-ins are bounded before more source password attempts", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 401 }); };
  for (let index = 0; index < 8; index++) await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-throttled" } }), env, fetcher), safeError(401));
  await assert.rejects(signIn(loginRequest({ headers: { "cf-connecting-ip": "test-throttled" } }), env, fetcher), safeError(429));
  assert.equal(calls, 8);
});

test("logout revokes the source session before returning the browser cookie clear", async () => {
  const sessionCookie = cookieHeader(await sealSession(request(), env, sourceCookie));
  let upstreamRevoked = false;
  const result = await signOut(request("/api/session", { method: "DELETE", headers: { Origin: origin, Cookie: sessionCookie } }), env, async (url, options) => {
    assert.equal(url, stockroomOrigin + "/api/auth/logout");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Cookie, sourceCookie);
    assert.equal(options.headers.Origin, stockroomOrigin);
    upstreamRevoked = true;
    return new Response("{}");
  });
  assert.equal(upstreamRevoked, true);
  assert.match(result, /^bmc_weekly_session=;/);
  assert.match(result, /Max-Age=0/);
  assert.equal(result.includes(token), false);
});

test("failed revocation is reported safely and a guest logout clears without a source call", async () => {
  const sessionCookie = cookieHeader(await sealSession(request(), env, sourceCookie));
  const logoutRequest = () => request("/api/session", { method: "DELETE", headers: { Origin: origin, Cookie: sessionCookie } });
  await assert.rejects(signOut(logoutRequest(), env, async () => { throw new Error(`${loginPassword} ${token}`); }), safeError(503));
  await assert.rejects(signOut(logoutRequest(), env, async () => new Response("private diagnostic", { status: 503 })), safeError(503));
  let calls = 0;
  const guest = await signOut(request("/api/session", { method: "DELETE", headers: { Origin: origin } }), env, async () => { calls++; });
  assert.equal(calls, 0);
  assert.match(guest, /Max-Age=0/);
});
