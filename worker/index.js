import { page } from "./ui.js";
import { collectDashboard, dashboardWeek, fetchSourceJson, SOURCE_ORIGINS } from "./metrics.js";
import { readWeeklyDemand } from "./demand.js";
import { HttpError, readSession, signIn, signOut, clearCookie, requireOrigin } from "./auth.js";
import { listIssues, createIssue, updateIssue, issuesMetric } from "./issues.js";
import { readOnlineOrders, ONLINE_ORDERS_FOLDER_URL, ONLINE_ORDERS_CSV_HEADERS } from "./online-orders.js";

const commonHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
};
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { ...commonHeaders, ...headers } }); }
async function issueInput(request) {
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError("Enter the issue details.");
  const maximum = 16_384;
  if (Number(request.headers.get("content-length")) > maximum) throw new HttpError("The issue note is too large.", 413);
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let size = 0, text = "";
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new HttpError("The issue note is too large.", 413); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw new HttpError("Enter valid issue details."); }
}
async function activeSession(request, env) {
  const session = await readSession(request, env);
  if (!session) throw new HttpError("Sign in with your Stock Take App password.", 401);
  try { await fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/inventory", { Cookie: session.stockroomCookie, Origin: SOURCE_ORIGINS.stockroom }); }
  catch (error) {
    if ([401, 403].includes(error?.status)) throw new HttpError("Your Stockroom session has ended. Sign in again.", 401);
    throw new HttpError("Stockroom access could not be checked. Please try again.", 503);
  }
  return session;
}
function notesUnavailable() { return { status: "unavailable", source: "Entered issue notes", asOf: null, note: "Customer issue notes could not be loaded. Please try again.", count: null, items: [] }; }
function onlineUnavailable() { return { status: "unavailable", source: "Online orders folder", asOf: null, note: "The online orders folder could not be read. Please try again.", orders: null, value: null, currency: "AUD", url: ONLINE_ORDERS_FOLDER_URL }; }
let pageHeaders;
async function htmlHeaders() {
  if (!pageHeaders) {
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const hashes = await Promise.all(scripts.map(async ([, script]) => {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script)));
      return `'sha256-${btoa(String.fromCharCode(...bytes))}'`;
    }));
    pageHeaders = { ...commonHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'self'; script-src ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com` };
  }
  return pageHeaders;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) return new Response(request.method === "HEAD" ? null : page, { headers: await htmlHeaders() });
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers: commonHeaders });
      if (url.pathname === "/robots.txt" && request.method === "GET") return new Response("User-agent: *\nDisallow: /\n", { headers: { ...commonHeaders, "Content-Type": "text/plain" } });
      if (url.pathname === "/online-orders-template.csv" && request.method === "GET") return new Response(ONLINE_ORDERS_CSV_HEADERS, { headers: { ...commonHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="online-orders-template.csv"' } });
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true });
      if (url.pathname === "/api/auth") {
        if (request.method === "GET") return json({ authenticated: Boolean(await readSession(request, env)) });
        if (request.method === "POST") return json({ authenticated: true }, 200, { "Set-Cookie": await signIn(request, env) });
        if (request.method === "DELETE") return json({ authenticated: false }, 200, { "Set-Cookie": await signOut(request, env) });
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST, DELETE" });
      }
      const issueMatch = url.pathname.match(/^\/api\/issues\/([A-Za-z0-9-]{1,80})$/);
      if (url.pathname === "/api/issues" || issueMatch) {
        const allowed = issueMatch ? ["PATCH"] : ["GET", "POST"];
        if (!allowed.includes(request.method)) return json({ error: "Method not allowed." }, 405, { Allow: allowed.join(", ") });
        if (request.method !== "GET") requireOrigin(request);
        await activeSession(request, env);
        if (request.method === "GET") return json(await listIssues(env.DB));
        const input = await issueInput(request);
        const item = request.method === "POST" ? await createIssue(env.DB, input) : await updateIssue(env.DB, issueMatch[1], input);
        return json({ ok: true, item }, request.method === "POST" ? 201 : 200);
      }
      if (url.pathname === "/api/dashboard") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const session = await readSession(request, env);
        if (!session) return json({ error: "Sign in with your Stock Take App password." }, 401, { "Set-Cookie": clearCookie(request) });
        let week;
        try { week = dashboardWeek(url.searchParams.get("week") || undefined); }
        catch { return json({ error: "Choose this week or an earlier Monday." }, 400); }
        const [data, demand, notes, online] = await Promise.all([
          collectDashboard({ weekStart: week.start, stockroomCookie: session.stockroomCookie, env }),
          readWeeklyDemand(week.start, env),
          listIssues(env.DB).then(issuesMetric).catch(notesUnavailable),
          readOnlineOrders(week.start, env).catch(onlineUnavailable),
        ]);
        data.metrics.demand = demand;
        data.metrics.issues = notes;
        data.metrics.online = online;
        data.sources = data.sources.map(source => source.id === "green" ? { ...source, status: data.metrics.green.status, note: data.metrics.green.note } : source.id === "issues" ? { id: "issues", label: "Customer issue notes", status: notes.status, asOf: notes.asOf, note: notes.note, url: null } : source.id === "online" ? { id: "online", label: "Online orders folder", status: online.status, asOf: online.asOf, note: online.note, url: ONLINE_ORDERS_FOLDER_URL } : source);
        data.sources.unshift({ id: "demand", label: "Weekly roast tally", status: demand.status, asOf: demand.asOf, note: demand.note, url: demand.url || null });
        return json(data);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error?.status === 401) return json({ error: error instanceof HttpError ? error.message : "Your Stockroom session has ended. Sign in again." }, 401, { "Set-Cookie": clearCookie(request) });
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      return json({ error: "The dashboard could not refresh. Please try again." }, 503);
    }
  },
};
