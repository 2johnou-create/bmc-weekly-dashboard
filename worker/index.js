import { page } from "./ui.js";
import { weeklyPage } from "./weekly-ui.js";
import { roasteryLabPage } from "./roastery-lab-ui.js";
import { warehousePage } from "./warehouse-ui.js";
import { collectWarehouse } from "./warehouse-report.js";
import { collectWeeklyReport, readDispatchStatus } from "./weekly-report.js";
import { collectDashboard, dashboardWeek, fetchSourceJson, SOURCE_ORIGINS, sydneyDate } from "./metrics.js";
import { saveCropsterGreenStock, saveCropsterReading } from "./cropster.js";
import { saveCropsterFriday } from "./cropster-friday.js";
import { brandLogo } from "./brand-logo.js";
import { saveCropsterMonday } from "./cropster-monday.js";
import { readWeeklyDemand } from "./demand.js";
import { HttpError, readSession, signIn, signOut, clearCookie, requireOrigin } from "./auth.js";
import { listIssues, createIssue, updateIssue, issuesMetric } from "./issues.js";
import { readWeeklyNote, saveWeeklyNote } from "./weekly-note.js";
import { readRoasteryLab, saveLabCropster, mergeGreenCoverage } from "./roastery-lab.js";
import { saveLabSettings } from "./roastery-lab-settings.js";
import { readCoffeeC } from "./coffee-c.js";
import { readPurchases } from "./purchases.js";
import { saveExpenseReading } from "./expenses.js";
import { readJohnCheers, saveJohnCheers } from "./john-cheers.js";
import { readOnlineOrders, ONLINE_ORDERS_FOLDER_URL, ONLINE_ORDERS_CSV_HEADERS } from "./online-orders.js";

const commonHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
};
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { ...commonHeaders, ...headers } }); }
async function jsonInput(request, { maximum, missing, invalid, tooLarge }) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(missing);
  if (Number(request.headers.get("content-length")) > maximum) throw new HttpError(tooLarge, 413);
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let size = 0, text = "";
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new HttpError(tooLarge, 413); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw new HttpError(invalid); }
}
const issueBody = { maximum: 16_384, missing: "Enter the issue details.", invalid: "Enter valid issue details.", tooLarge: "The issue note is too large." };
const weeklyNoteBody = { maximum: 16_384, missing: "Enter the weekly note.", invalid: "Enter valid weekly note details.", tooLarge: "The weekly note is too large." };
const cropsterBody = { maximum: 2_048, missing: "Enter the Cropster reading.", invalid: "Enter a valid Cropster reading.", tooLarge: "The Cropster reading is too large." };
const cropsterSmallBody = { ...cropsterBody, maximum: 512 };
const labSettingsBody = { maximum: 32_768, missing: "Enter release or QA details.", invalid: "Enter valid release and QA details.", tooLarge: "The release and QA notes are too large." };
const labCropsterBody = { ...cropsterBody, maximum: 350_000, tooLarge: "The Cropster report is too large." };
const expenseBody = { maximum: 100_000, missing: "Enter a verified sheet reading.", invalid: "Enter a valid sheet reading.", tooLarge: "The sheet reading is too large." };
const cheerBody = { maximum: 8_192, missing: "The cheer log needs valid events.", invalid: "The cheer log needs valid events.", tooLarge: "The cheer batch is too large." };
const documents = new Map([["/", weeklyPage], ["/details", page], ["/roastery-lab", roasteryLabPage], ["/warehouse", warehousePage]]);
const warehouseAsset = typeof __WAREHOUSE_SCENE__ === "string" ? __WAREHOUSE_SCENE__ : null;
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
async function roasteryReport(env, { fresh = false } = {}) {
  const now = new Date();
  const [data, coffeeC, purchases] = await Promise.all([
    readRoasteryLab(env.DB, now), readCoffeeC({ now, fresh }), readPurchases({ now, fresh }),
  ]);
  return {
    ...data,
    consumption: { ...data.consumption, coverage: mergeGreenCoverage(data.consumption, data.prices, purchases.contracts, sydneyDate(now)) },
    coffeeC, purchases, generatedAt: now.toISOString(),
  };
}
function notesUnavailable() { return { status: "unavailable", source: "Entered issue notes", asOf: null, note: "Customer issue notes could not be loaded. Please try again.", count: null, items: [] }; }
function onlineUnavailable() { return { status: "unavailable", source: "Online orders folder", asOf: null, note: "The online orders folder could not be read. Please try again.", orders: null, value: null, currency: "AUD", url: ONLINE_ORDERS_FOLDER_URL }; }
const pageHeaders = new Map();
async function htmlHeaders(document) {
  if (!pageHeaders.has(document)) {
    const scripts = [...document.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const hashes = await Promise.all(scripts.map(async ([, script]) => {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script)));
      return `'sha256-${btoa(String.fromCharCode(...bytes))}'`;
    }));
    const modules = document === warehousePage ? "'self' " : "";
    pageHeaders.set(document, { ...commonHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'self'; script-src ${modules}${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com` });
  }
  return pageHeaders.get(document);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const fresh = url.searchParams.get("refresh") === "1";
    try {
      if (documents.has(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
        const document = documents.get(url.pathname);
        return new Response(request.method === "HEAD" ? null : document, { headers: await htmlHeaders(document) });
      }
      if (url.pathname === "/warehouse-scene.js" && ["GET", "HEAD"].includes(request.method)) {
        if (!warehouseAsset) return json({ error: "Build the warehouse scene before opening this preview." }, 503);
        return new Response(request.method === "HEAD" ? null : warehouseAsset, { headers: {
          ...commonHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate",
        } });
      }
      if (url.pathname === "/bmc-logo.png" && ["GET", "HEAD"].includes(request.method)) {
        return new Response(request.method === "HEAD" ? null : brandLogo, { headers: {
          ...commonHeaders, "Content-Type": "image/png", "Cache-Control": "public, max-age=86400",
        } });
      }
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
        const input = await jsonInput(request, issueBody);
        const item = request.method === "POST" ? await createIssue(env.DB, input) : await updateIssue(env.DB, issueMatch[1], input);
        return json({ ok: true, item }, request.method === "POST" ? 201 : 200);
      }
      if (["/api/cropster-readings", "/api/cropster-monday", "/api/cropster-green-stock", "/api/cropster-friday"].includes(url.pathname)) {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        requireOrigin(request);
        const receivedAt = new Date();
        await activeSession(request, env);
        const input = await jsonInput(request, url.pathname === "/api/cropster-readings" ? cropsterBody : cropsterSmallBody);
        if (url.pathname === "/api/cropster-green-stock") return json(await saveCropsterGreenStock(env.DB, input, receivedAt));
        if (url.pathname === "/api/cropster-friday") return json(await saveCropsterFriday(env.DB, input, receivedAt));
        const week = dashboardWeek(undefined, receivedAt);
        const save = url.pathname === "/api/cropster-monday" ? saveCropsterMonday : saveCropsterReading;
        return json(await save(env.DB, input, week.start, receivedAt));
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
          readWeeklyDemand(week.start, { ...env, fresh }),
          listIssues(env.DB).then(issuesMetric).catch(notesUnavailable),
          readOnlineOrders(week.start, { ...env, fresh }).catch(onlineUnavailable),
        ]);
        data.metrics.demand = demand;
        data.metrics.issues = notes;
        data.metrics.online = online;
        data.sources = data.sources.map(source => source.id === "issues" ? { id: "issues", label: "Customer issue notes", status: notes.status, asOf: notes.asOf, note: notes.note, url: null } : source.id === "online" ? { id: "online", label: "Online orders folder", status: online.status, asOf: online.asOf, note: online.note, url: ONLINE_ORDERS_FOLDER_URL } : source);
        data.sources.unshift({ id: "demand", label: "Weekly roast tally", status: demand.status, asOf: demand.asOf, note: demand.note, url: demand.url || null });
        return json(data);
      }
      if (url.pathname === "/api/weekly-report") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const session = await readSession(request, env);
        if (!session) throw new HttpError("Sign in with your Stock Take App password.", 401);
        let week;
        try { week = dashboardWeek(url.searchParams.get("week") || undefined); }
        catch { throw new HttpError("Choose this week or an earlier Monday."); }
        try {
          return json(await collectWeeklyReport({ weekStart: week.start, stockroomCookie: session.stockroomCookie, env, fresh }));
        } catch (error) {
          if ([401, 403].includes(error?.status)) throw new HttpError("Your Stockroom session has ended. Sign in again.", 401);
          throw new HttpError("Stockroom could not verify your access. Try Refresh.", 503);
        }
      }
      if (url.pathname === "/api/dispatch-status") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        await activeSession(request, env);
        let week;
        try { week = dashboardWeek(url.searchParams.get("week") || undefined); }
        catch { throw new HttpError("Choose this week or an earlier Monday."); }
        return json(await readDispatchStatus({ weekStart: week.start, env }));
      }
      if (url.pathname === "/api/warehouse") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const session = await readSession(request, env);
        if (!session) throw new HttpError("Sign in with your Stock Take App password.", 401);
        try {
          return json(await collectWarehouse({ env, stockroomCookie: session.stockroomCookie, fresh }));
        } catch (error) {
          if ([401, 403].includes(error?.status)) throw new HttpError("Your Stockroom session has ended. Sign in again.", 401);
          throw error;
        }
      }
      if (url.pathname === "/api/expenses/readings") {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        requireOrigin(request);
        await activeSession(request, env);
        return json(await saveExpenseReading(env.DB, await jsonInput(request, expenseBody), new Date()));
      }
      if (url.pathname === "/api/john-cheers") {
        if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
        if (request.method === "POST") requireOrigin(request);
        await activeSession(request, env);
        const now = new Date();
        if (request.method === "GET") return json(await readJohnCheers(env.DB, dashboardWeek(undefined, now).start));
        return json(await saveJohnCheers(env.DB, await jsonInput(request, cheerBody), now));
      }
      if (url.pathname === "/api/weekly-note") {
        if (!["GET", "PUT"].includes(request.method)) return json({ error: "Method not allowed." }, 405, { Allow: "GET, PUT" });
        if (request.method === "PUT") requireOrigin(request);
        await activeSession(request, env);
        const requestedWeeks = url.searchParams.getAll("week");
        let week;
        try {
          if (requestedWeeks.length > 1 || requestedWeeks[0] === "" || (request.method === "PUT" && requestedWeeks.length === 0)) throw new Error();
          week = dashboardWeek(requestedWeeks[0]);
        } catch { throw new HttpError("Choose this week or an earlier Monday."); }
        if (request.method === "GET") return json(await readWeeklyNote(env.DB, week.start));
        const input = await jsonInput(request, weeklyNoteBody);
        return json(await saveWeeklyNote(env.DB, week.start, input));
      }
      if (["/api/roastery-lab", "/api/roastery-lab/settings", "/api/roastery-lab/cropster"].includes(url.pathname)) {
        const action = url.pathname.split("/")[3];
        const method = action ? "PUT" : "GET";
        if (request.method !== method) return json({ error: "Method not allowed." }, 405, { Allow: method });
        if (action) requireOrigin(request);
        await activeSession(request, env);
        if (action === "settings") return json(await saveLabSettings(env.DB, await jsonInput(request, labSettingsBody)));
        if (action === "cropster") await saveLabCropster(env.DB, await jsonInput(request, labCropsterBody));
        return json(await roasteryReport(env, { fresh: fresh || action === "cropster" }));
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error?.status === 401) return json({ error: error instanceof HttpError ? error.message : "Your Stockroom session has ended. Sign in again." }, 401, { "Set-Cookie": clearCookie(request) });
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      return json({ error: "The dashboard could not refresh. Please try again." }, 503);
    }
  },
};
