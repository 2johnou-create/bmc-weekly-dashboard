import { createServer } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ReaderError, safeFailure } from "./errors.mjs";
import { weekRange } from "./dates.mjs";
import { createBrowserReader } from "./browser.mjs";
import { callbackConfiguration, deliverCapture } from "./callback.mjs";

const MAX_BODY = 512;
const json = (body, status = 200, extra = {}) => Response.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...extra },
});

export function readConfiguration(env) {
  const email = env.CROPSTER_EMAIL, password = env.CROPSTER_PASSWORD, token = env.CROPSTER_READER_TOKEN;
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)
    || typeof password !== "string" || !password.length || password.length > 1024
    || typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new ReaderError("CONFIGURATION_REQUIRED");
  const timeoutMs = Number(env.CROPSTER_READER_TIMEOUT_MS || 180000);
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 180000
    || !Number.isInteger(port) || port < 1 || port > 65535
    || env.CHROMIUM_SANDBOX !== undefined && !["true", "false"].includes(env.CHROMIUM_SANDBOX)) throw new ReaderError("CONFIGURATION_REQUIRED");
  const profileKeys = { libertyBlend: "CROPSTER_LIBERTY_BLEND_ID", rhythmBlend: "CROPSTER_RHYTHM_BLEND_ID", ohGroup: "CROPSTER_OH_GROUP_ID", decafGroup: "CROPSTER_DECAF_GROUP_ID" };
  const profileIds = Object.fromEntries(Object.entries(profileKeys).map(([key, name]) => [key, env[name] || null]));
  if (Object.values(profileIds).some(id => id !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(id))) throw new ReaderError("CONFIGURATION_REQUIRED");
  return { email, password, token, port, timeoutMs, profileIds, callback: callbackConfiguration(env), chromiumSandbox: env.CHROMIUM_SANDBOX === "true" };
}

function authorised(request, token) {
  const received = request.headers.get("authorization") || "";
  if (received.length > 512 || !received.startsWith("Bearer ")) return false;
  const digest = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received.slice(7)), digest(token));
}

async function readBody(request, allowScope = false) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new ReaderError("INVALID_REQUEST", 400);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new ReaderError("INVALID_REQUEST", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new ReaderError("INVALID_REQUEST", 400);
  let size = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new ReaderError("INVALID_REQUEST", 400); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  let input;
  try { input = JSON.parse(text + decoder.decode()); }
  catch { throw new ReaderError("INVALID_REQUEST", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !Object.hasOwn(input, "weekStart") || Object.keys(input).some(key => !["weekStart", ...(allowScope ? ["scope"] : [])].includes(key))
    || input.scope !== undefined && !["weekly", "all"].includes(input.scope)) throw new ReaderError("INVALID_REQUEST", 400);
  return input;
}

export function createHandler({ reader, token, now = () => new Date(), log = () => {}, callback = null, fetcher = fetch, sleep }) {
  let inFlight = null;
  const jobs = new Map();
  const TTL = 10 * 60 * 1000, MAX_JOBS = 10;
  const cleanJobs = (reserveSlot = false) => {
    for (const [id, job] of jobs) if (job.status !== "running" && now().getTime() - job.finishedAt >= TTL) jobs.delete(id);
    while (jobs.size > MAX_JOBS - (reserveSlot ? 1 : 0)) {
      const oldest = [...jobs].find(([, job]) => job.status !== "running");
      if (!oldest) break;
      jobs.delete(oldest[0]);
    }
  };
  const run = (weekStart, scope) => {
    if (inFlight && (inFlight.weekStart !== weekStart || inFlight.scope !== scope)) throw new ReaderError("CROPSTER_READER_BUSY");
    if (!inFlight) {
      const job = { weekStart, scope, promise: null };
      job.promise = Promise.resolve().then(() => reader.read(weekStart, { scope })).finally(() => {
        if (inFlight === job) inFlight = null;
      });
      inFlight = job;
    }
    return inFlight.promise;
  };
  const jobResponse = job => ({
    schemaVersion: "1.0", jobId: job.id, weekStart: job.weekStart, status: job.status,
    ...(job.status === "complete" ? { result: job.result } : {}),
    ...(job.status === "failed" ? { error: job.error } : {}),
    ...(job.delivery ? { delivery: job.delivery } : {}),
  });
  return async request => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return request.method === "GET"
      ? json({ status: "ok", service: "cropster-website-reader" })
      : json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "GET" });
    const statusMatch = pathname.match(/^\/v1\/sync\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/);
    if (!["/v1/weekly", "/v1/sync"].includes(pathname) && !statusMatch) return json({ error: { code: "NOT_FOUND" } }, 404);
    if (!authorised(request, token)) return json({ error: { code: "UNAUTHORISED" } }, 401);
    if (statusMatch) {
      if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "GET" });
      cleanJobs();
      const job = jobs.get(statusMatch[1]);
      return job ? json(jobResponse(job)) : json({ error: { code: "JOB_NOT_FOUND" } }, 404);
    }
    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "POST" });
    const started = now().getTime();
    try {
      const input = await readBody(request, pathname === "/v1/weekly");
      const range = weekRange(input.weekStart, now());
      if (pathname === "/v1/sync") {
        cleanJobs();
        const existing = [...jobs.values()].find(job => job.weekStart === range.weekStart && job.status === "running");
        if (existing) return json(jobResponse(existing), 202);
        cleanJobs(true);
        if (jobs.size >= MAX_JOBS) throw new ReaderError("CROPSTER_READER_BUSY");
        const promise = run(range.weekStart, "all");
        const job = { id: randomUUID(), weekStart: range.weekStart, status: "running", createdAt: now().getTime() };
        jobs.set(job.id, job);
        // Attach failure handling immediately; no rejected background promise can
        // leak raw browser errors or terminate the process.
        void promise.then(async result => {
          job.status = "complete"; job.result = result; job.finishedAt = now().getTime();
          log({ event: "reader_sync", status: "complete", durationMs: job.finishedAt - job.createdAt });
          job.delivery = await deliverCapture(callback, { schemaVersion: "1.0", jobId: job.id, weekStart: job.weekStart, result }, { fetcher, ...(sleep ? { sleep } : {}) });
        }, error => {
          job.status = "failed"; job.error = safeFailure(error).code; job.finishedAt = now().getTime();
          log({ event: "reader_sync", status: "failed", code: job.error, durationMs: job.finishedAt - job.createdAt });
        }).catch(() => { job.delivery = "failed"; });
        return json(jobResponse(job), 202);
      }
      const result = await run(range.weekStart, input.scope || "weekly");
      log({ event: "reader_result", status: "ok", durationMs: now().getTime() - started });
      return json(result);
    } catch (error) {
      const failure = safeFailure(error);
      log({ event: "reader_result", status: "error", code: failure.code, durationMs: now().getTime() - started });
      return json({ error: { code: failure.code } }, failure.status);
    }
  };
}

export function startService(env = process.env) {
  const configuration = readConfiguration(env);
  const reader = createBrowserReader(configuration);
  const handler = createHandler({ reader, token: configuration.token, callback: configuration.callback, log: event => process.stdout.write(JSON.stringify(event) + "\n") });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const options = { method: incoming.method, headers };
      if (!["GET", "HEAD"].includes(incoming.method)) { options.body = incoming; options.duplex = "half"; }
      const response = await handler(new Request("http://reader" + incoming.url, options));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      outgoing.end('{"error":{"code":"CROPSTER_UNAVAILABLE"}}');
    }
  });
  server.requestTimeout = 190000;
  server.headersTimeout = 10000;
  server.listen(configuration.port, "0.0.0.0", () => process.stdout.write('{"event":"reader_listening"}\n'));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await reader.close();
    server.closeAllConnections();
  };
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
  return { server, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { startService(); }
  catch { process.stderr.write('{"event":"reader_start_failed","code":"CONFIGURATION_REQUIRED"}\n'); process.exitCode = 1; }
}
