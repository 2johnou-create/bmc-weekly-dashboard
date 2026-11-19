import { page } from "./ui.js";
import { weeklyPage } from "./weekly-ui.js";
import { roasteryLabPage } from "./roastery-lab-ui.js";
import { warehousePage } from "./warehouse-ui.js";
import { collectWarehouse } from "./warehouse-report.js";
import { collectWeeklyReport, readDispatchStatus } from "./weekly-report.js";
import { addDays, collectDashboard, dashboardWeek, fetchSourceJson, SOURCE_ORIGINS, sydneyDate } from "./metrics.js";
import { readCurrentCropster, validSyncJobId, ingestCropsterSync, verifyCropsterJob } from "./cropster-reader.js";
import { sourceSyncSummary, saveSourceSyncLog, readSourceSyncLog, mergeSourceSyncSummary } from "./source-sync.js";
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
import { readExpenses, saveExpenseReading } from "./expenses.js";
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
const sourceSyncBody = { maximum: 512, missing: "Choose a reporting week.", invalid: "Choose a valid reporting week.", tooLarge: "The sync request is too large." };
const finishingSyncs = new Map();
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
async function requireCropsterWriter(request, env) {
  const expected = env.CROPSTER_SYNC_WRITE_TOKEN;
  const header = request.headers.get("authorization") || "";
  if (typeof expected !== "string" || expected.length < 32 || expected.length > 256 ||
    !header.startsWith("Bearer ") || header.length > 263) throw new HttpError("Source writer authorization is required.", 401);
  const hash = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [first, second] = await Promise.all([hash(expected), hash(header.slice(7))]);
  const a = new Uint8Array(first), b = new Uint8Array(second);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  if (difference) throw new HttpError("Source writer authorization is required.", 401);
}
function requestedSyncJob(url, weekStart) {
  const jobId = url.searchParams.get("sourceSyncJob");
  if (jobId === null) return null;
  if (!validSyncJobId(jobId) || url.searchParams.get("sourceSyncWeek") !== weekStart) throw new HttpError("The source sync does not match this reporting week.");
  return jobId;
}

async function finishSourceSync(env, session, cropsterResult, week, jobId, now) {
  // A finished browser job also forces every sheet/feed used by the three dashboards.
  // This is shared by simultaneous staff refreshes; it never returns business values.
  const key = jobId || crypto.randomUUID();
  let task = finishingSyncs.get(key);
  if (!task) {
    task = collectWarehouse({ env, stockroomCookie: session.stockroomCookie, now, fresh: true, cropsterResult })
      .then(async report => {
        report.sourceSync.jobStatus = cropsterResult.refresh.status === "refreshed" ? "complete" : "failed";
        await saveSourceSyncLog(env.DB, key, week.start, report.sourceSync, new Date());
        return report.sourceSync;
      });
    finishingSyncs.set(key, task);
    void task.finally(() => { if (finishingSyncs.get(key) === task) finishingSyncs.delete(key); }).catch(() => {});
  }
  return task;
}

async function roasteryReport(env, { fresh = false, jobId = null, syncWebsite = fresh || Boolean(jobId) } = {}) {
  const now = new Date();
  const week = dashboardWeek(undefined, now);
  const cropster = await readCurrentCropster({ env, weekStart: week.start, followingWeekStart: addDays(week.start, 7), now, fresh: syncWebsite, jobId });
  const [data, coffeeC, purchases] = await Promise.all([
    readRoasteryLab(env.DB, now), readCoffeeC({ now, fresh }), readPurchases({ now, fresh }),
  ]);
  const report = {
    ...data,
    consumption: { ...data.consumption, coverage: mergeGreenCoverage(data.consumption, data.prices, purchases.contracts, sydneyDate(now)) },
    coffeeC, purchases, generatedAt: now.toISOString(), cropsterRefresh: cropster.refresh,
  };
  const stored = await readSourceSyncLog(env.DB, jobId, week.start);
  report.sourceSync = mergeSourceSyncSummary(stored, sourceSyncSummary({ weekly: { week, generatedAt: now.toISOString(), cropsterRefresh: cropster.refresh, metrics: {} }, lab: report }));
  return report;
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
    const skipWebsiteSync = url.searchParams.get("sourceSyncCheckUnavailable") === "1";
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
      if (url.pathname === "/api/integrations/cropster") {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        await requireCropsterWriter(request, env);
        const input = await jsonInput(request, { ...labCropsterBody, maximum: 350_000 });
        if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== "1.0" ||
          !validSyncJobId(input.jobId) || Object.keys(input).some(key => !["schemaVersion", "jobId", "weekStart", "result", "status"].includes(key)) ||
          input.status !== undefined && !["running", "complete", "failed"].includes(input.status)) throw new HttpError("Enter a valid source observation.");
        const now = new Date();
        const week = dashboardWeek(input.weekStart, now);
        if (!week.isCurrent || input.weekStart !== week.start) throw new HttpError("Source observations must use the current Sydney week.");
        if (!input.result || input.result.weekStart !== week.start || input.result.periodEnd !== addDays(week.start, 4) ||
          input.result.sourceSystem !== "cropster-website" || input.result.location !== "Marrickville") throw new HttpError("Enter a valid current-week source observation.");
        const previous = await readSourceSyncLog(env.DB, input.jobId, week.start);
        if (input.status === "running" && ["complete", "failed"].includes(previous?.jobStatus)) return json({ ok: true, status: previous.status });
        // New checkpoint deliveries are cross-checked against the reader's actual
        // job. A later checkpoint wins over an older delivery still in flight.
        let verified;
        try { verified = input.status === undefined ? { status: "complete", result: input.result } :
          await verifyCropsterJob({ env, weekStart: week.start, jobId: input.jobId }); }
        catch (error) { throw new HttpError("The Cropster job could not be verified (" +
          (/^READER_[A-Z0-9_]{1,40}$/.test(error.safeCode || "") ? error.safeCode : "READER_UNAVAILABLE") + ").", 503); }
        const readings = await ingestCropsterSync({ env, weekStart: week.start, jobId: input.jobId, input: verified.result, status: verified.status, now });
        if (!readings.refresh.accepted) throw new HttpError("The source observation could not be saved.", 503);
        if (verified.status !== "complete") {
          const lab = await readRoasteryLab(env.DB, now);
          const summary = sourceSyncSummary({ weekly: { generatedAt: now.toISOString(), cropsterRefresh: readings.refresh,
            metrics: { production: readings.production, green: readings.green } },
            lab: { ...lab, purchases: {}, coffeeC: {} } });
          summary.sources = summary.sources.filter(source => ["production", "monday", "previous-production", "green"].includes(source.id) || source.id.startsWith("lab-"));
          summary.status = "partial";
          summary.jobStatus = verified.status;
          summary.message = verified.status === "running" ? "Verified Cropster sections saved. Remaining reports are updating in the background." :
            "The background update stopped. Verified sections were saved with their actual capture times.";
          await saveSourceSyncLog(env.DB, input.jobId, week.start, summary, now);
          return json({ ok: true, status: "partial" });
        }
        // The server finishes source work even when the visitor has closed the page.
        // Stock Take remains a visitor-authorized read. Dispatch also supports
        // its dedicated server read token, so its feed can be rechecked here.
        const [demand, priorDemand, expenses, purchases, coffeeC, lab, dispatch] = await Promise.all([
          readWeeklyDemand(week.start, { fresh: true }), readWeeklyDemand(addDays(week.start, -7), { fresh: true }),
          readExpenses({ db: env.DB, env, week, now, fresh: true }), readPurchases({ now, fresh: true }),
          readCoffeeC({ now, fresh: true }), readRoasteryLab(env.DB, now),
          readDispatchStatus({ weekStart: week.start, env, now }),
        ]);
        const summary = sourceSyncSummary({ weekly: { generatedAt: now.toISOString(), cropsterRefresh: readings.refresh,
          metrics: { production: readings.production, green: readings.green, wholesale: dispatch.wholesale } }, lab: { ...lab, purchases, coffeeC } });
        summary.sources = summary.sources.filter(source => !["demand", "stocktake", "expenses"].includes(source.id));
        summary.jobStatus = "complete";
        summary.sources.push({ id: "demand", label: "Roast tallies", status: [demand, priorDemand].every(value => value.status === "live") ? "updated" : "failed", asOf: demand.asOf });
        summary.sources.push({ id: "expenses", label: "Warehouse expenses sheet", status: expenses.status === "live" ? "updated" : "failed", asOf: expenses.asOf });
        summary.status = summary.sources.every(item => item.status === "updated") ? "complete" : "partial";
        summary.message = summary.status === "complete" ? "Cropster, Dispatch and workbook sources saved. Stock Take rechecks when the dashboard opens." :
          "Some sources need attention. Verified readings retain their actual capture times.";
        await saveSourceSyncLog(env.DB, input.jobId, week.start, summary, now);
        return json({ ok: true, status: summary.status, sourceSync: summary });
      }
      if (url.pathname === "/api/source-sync") {
        if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
        if (request.method === "POST") requireOrigin(request);
        const session = await activeSession(request, env);
        let input = {};
        if (request.method === "POST") {
          input = await jsonInput(request, sourceSyncBody);
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "weekStart")) throw new HttpError("Choose a valid reporting week.");
        }
        const now = new Date();
        const week = dashboardWeek(request.method === "GET" ? url.searchParams.get("week") || undefined : input.weekStart || undefined, now);
        if (!week.isCurrent) return json({ status: "archive", weekStart: week.start, note: "Historical Friday archives will be rechecked." });
        const jobId = request.method === "GET" ? url.searchParams.get("jobId") : null;
        if (request.method === "GET" && !validSyncJobId(jobId)) throw new HttpError("Choose a valid source sync job.");
        const completed = jobId ? await readSourceSyncLog(env.DB, jobId, week.start) : null;
        if (["complete", "failed"].includes(completed?.jobStatus) && completed.sources.some(item => item.id === "stocktake")) return json({ status: completed.jobStatus, jobId, weekStart: week.start, sourceSync: completed });
        const readings = await readCurrentCropster({ env, weekStart: week.start, followingWeekStart: addDays(week.start, 7), now, fresh: true, jobId });
        const policy = readings.refresh;
        if (policy.status === "pending") return json({ status: "running", jobId: policy.jobId, weekStart: week.start, note: policy.note }, 202);
        if (jobId && policy.status === "failed" && !policy.readerStatus) throw new HttpError("The background update could not be checked. It will be checked again shortly.", 503);
        const sourceSync = await finishSourceSync(env, session, readings, week, policy.jobId || jobId, now);
        return json({ status: policy.status === "refreshed" ? "complete" : policy.status === "not-connected" ? "not-connected" : "failed",
          ...(policy.jobId || jobId ? { jobId: policy.jobId || jobId } : {}), weekStart: week.start, note: policy.note, sourceSync });
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
        if (fresh && week.isCurrent) {
          await fetchSourceJson(SOURCE_ORIGINS.stockroom + "/api/inventory", { Cookie: session.stockroomCookie, Origin: SOURCE_ORIGINS.stockroom });
          await readCurrentCropster({ env, weekStart: week.start, followingWeekStart: addDays(week.start, 7), fresh: true, jobId: requestedSyncJob(url, week.start) });
        }
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
        const sourceSyncJob = requestedSyncJob(url, week.start);
        try {
          return json(await collectWeeklyReport({ weekStart: week.start, stockroomCookie: session.stockroomCookie, env, fresh, sourceSyncJob, syncWebsite: !skipWebsiteSync }));
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
          return json(await collectWarehouse({ env, stockroomCookie: session.stockroomCookie, fresh, sourceSyncJob: requestedSyncJob(url, dashboardWeek().start), syncWebsite: !skipWebsiteSync }));
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
        return json(await roasteryReport(env, { fresh: fresh || action === "cropster", syncWebsite: !skipWebsiteSync && (fresh || Boolean(url.searchParams.get("sourceSyncJob"))), jobId: requestedSyncJob(url, dashboardWeek().start) }));
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error?.status === 401) return json({ error: error instanceof HttpError ? error.message : "Your Stockroom session has ended. Sign in again." }, 401, { "Set-Cookie": clearCookie(request) });
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      return json({ error: "The dashboard could not refresh. Please try again." }, 503);
    }
  },
};
