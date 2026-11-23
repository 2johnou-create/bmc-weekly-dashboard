import { addDays, validDate } from "./metrics.js";
import { readCropsterReadings, saveCropsterGreenStock } from "./cropster.js";
import { saveCropsterMonday } from "./cropster-monday.js";
import { saveLabCropster } from "./roastery-lab.js";
import { readCropsterScheduledBatches, saveCropsterScheduledBatches, validateCropsterScheduledBatches } from "./cropster-scheduled-batches.js";
import { readSourceSyncLog } from "./source-sync.js";

const DEADLINE_MS = 12_000;
const MAX_BODY = 350_000;
const MAX_SECTION_AGE = 1_860_000;
const activeReads = new WeakMap();
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedAmount = (value, limit, nullable = false) => nullable && value === null ||
  Number.isFinite(value) && value >= 0 && value <= limit;

export function cropsterReaderConnection(env) {
  const configured = Boolean(env.CROPSTER_READER_URL || env.CROPSTER_READER_TOKEN);
  if (!configured) return { configured: false, valid: false };
  try {
    const url = new URL(env.CROPSTER_READER_URL);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".onrender.com") ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      typeof env.CROPSTER_READER_TOKEN !== "string" || env.CROPSTER_READER_TOKEN.length < 32 ||
      env.CROPSTER_READER_TOKEN.length > 256 || /\s/.test(env.CROPSTER_READER_TOKEN)) throw new Error();
    return { configured: true, valid: true, url: new URL("/v1/sync", url).href };
  } catch { return { configured: true, valid: false }; }
}

export function validateCropsterObservation(input, weekStart, now = new Date(), { maximumPublicationAge = 300_000 } = {}) {
  if (!isObject(input) || input.schemaVersion !== "1.0" || input.sourceSystem !== "cropster-website" ||
    input.location !== "Marrickville" || input.weekStart !== weekStart || !validDate(weekStart) ||
    input.periodEnd !== addDays(weekStart, 4) || !isObject(input.production)) throw new Error("Invalid website observation.");
  const observedAt = typeof input.observedAt === "string" ? Date.parse(input.observedAt) : NaN;
  if (!Number.isFinite(observedAt) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.observedAt) ||
    observedAt > now.getTime() + 120_000 || observedAt < now.getTime() - maximumPublicationAge) throw new Error("Invalid source capture time.");
  const production = input.production;
  if (!boundedAmount(production.roastedKg, 1_000_000) ||
      !boundedAmount(production.scheduledKg, 1_000_000, true)) throw new Error("Invalid production weight.");
  for (const key of ["roastedValue", "scheduledValue"]) {
    if (!boundedAmount(production[key], 100_000_000, true)) throw new Error("Invalid production cost.");
  }
  let green = null;
  if (input.green != null) {
    if (!isObject(input.green) || input.green.location !== "Marrickville" ||
      !boundedAmount(input.green.kg, 1_000_000) || !boundedAmount(input.green.value, 100_000_000, true)) throw new Error("Invalid green inventory.");
    green = { kg: input.green.kg, value: input.green.value };
  }
  // Only validated scalar fields cross into storage. Reader warnings and page text are not HTML.
  const times = {};
  for (const field of ["productionObservedAt", "greenObservedAt", "mondayObservedAt", "previousProductionObservedAt"]) {
    const optionalSection = field === "greenObservedAt" && input.green == null ||
      field === "mondayObservedAt" && input.mondayRoastedKg == null ||
      field === "previousProductionObservedAt" && input.previousProduction == null;
    const time = input[field] === undefined || optionalSection && input[field] === null ? observedAt : Date.parse(input[field]);
    if (!Number.isFinite(time) || time > observedAt || time < observedAt - MAX_SECTION_AGE) throw new Error("Invalid section capture time.");
    times[field] = new Date(time);
  }
  const scheduledBatches = validateCropsterScheduledBatches(input.scheduledBatches, weekStart, times.productionObservedAt);
  if (production.scheduledKg === null && !scheduledBatches) throw new Error("A missing output estimate requires verified pending green batches.");
  let previousProduction = null;
  if (input.previousProduction != null) {
    const value = input.previousProduction;
    if (!isObject(value) || value.weekStart !== addDays(weekStart, -7) || value.periodEnd !== addDays(weekStart, -3) ||
      !boundedAmount(value.roastedKg, 1_000_000) || !boundedAmount(value.roastedValue, 100_000_000) ||
      value.scheduledKg !== 0 || value.scheduledValue !== 0) throw new Error("Invalid previous-week observation.");
    previousProduction = { roastedKg: value.roastedKg, roastedValue: value.roastedValue, scheduledKg: 0, scheduledValue: 0 };
  }
  return { observedAt: new Date(observedAt), ...times, production: {
    roastedKg: production.roastedKg, scheduledKg: production.scheduledKg,
    roastedValue: production.roastedValue, scheduledValue: production.scheduledValue,
  }, green, scheduledBatches, previousProduction, mondayRoastedKg: boundedAmount(input.mondayRoastedKg, 1_000_000) ? input.mondayRoastedKg : null,
  lab: isObject(input.lab) ? input.lab : {}, labCapturedAt: isObject(input.labObservedAt) ? input.labObservedAt : {} };
}

export const validSyncJobId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

async function websiteJob(config, env, weekStart, jobId, fetcher, requestId = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    if (jobId && !validSyncJobId(jobId)) throw new Error();
    const response = await fetcher(config.url + (jobId ? "/" + jobId : ""), {
      method: jobId ? "GET" : "POST", redirect: "manual", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${env.CROPSTER_READER_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(jobId ? {} : { body: JSON.stringify({ weekStart, ...(requestId ? { requestId } : {}) }) }),
    });
    if (jobId && response.status === 404) { const expired = new Error("The background job has expired."); expired.jobExpired = true; throw expired; }
    if (!response.ok) { const unavailable = new Error("Reader returned an unsuccessful response."); unavailable.safeCode = "READER_HTTP_" + response.status; throw unavailable; }
    if (!response.headers.get("content-type")?.includes("application/json")) { const unexpected = new Error("Reader returned an unexpected response."); unexpected.safeCode = "READER_CONTENT_TYPE"; throw unexpected; }
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_BODY) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let count = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > MAX_BODY) { await reader.cancel(); throw new Error(); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const state = JSON.parse(new TextDecoder().decode(bytes));
    if (!isObject(state) || state.schemaVersion !== "1.0" || state.weekStart !== weekStart ||
      !validSyncJobId(state.jobId) || jobId && state.jobId !== jobId ||
      !["running", "complete", "failed"].includes(state.status)) throw new Error();
    return state;
  } finally { clearTimeout(timer); }
}

export function safeReaderCode(error) {
  if (/^(?:READER|CROPSTER)_[A-Z0-9_]{1,60}$/.test(error?.safeCode || "")) return error.safeCode;
  if (error?.jobExpired) return "READER_JOB_EXPIRED";
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "READER_TIMEOUT";
  if (/cache.*(?:unsupported|not supported)|unsupported.*cache/i.test(error?.message || "")) return "READER_CACHE_MODE";
  if (/redirect.*(?:unsupported|not supported)|unsupported.*redirect/i.test(error?.message || "")) return "READER_REDIRECT_MODE";
  return "READER_FETCH_OR_PROTOCOL";
}

export async function requestCropsterWebsiteJob({ env, weekStart, jobId = null, requestId = null, fetcher = fetch }) {
  const config = cropsterReaderConnection(env);
  if (!config.valid || requestId !== null && !validSyncJobId(requestId)) {
    const error = new Error("Reader configuration is unavailable."); error.safeCode = "READER_CONFIGURATION"; throw error;
  }
  try { return await websiteJob(config, env, weekStart, jobId, fetcher, requestId); }
  catch (error) { error.safeCode = safeReaderCode(error); throw error; }
}

// A timed-out health GET still wakes Render. A later coordinator poll continues
// readiness instead of treating a sleeping Free instance as a failed roast read.
export async function probeCropsterReader({ env, fetcher = fetch }) {
  const config = cropsterReaderConnection(env);
  if (!config.valid) { const error = new Error("Reader configuration is unavailable."); error.safeCode = "READER_CONFIGURATION"; throw error; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const response = await fetcher(new URL("/health", config.url).href, {
      method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) { const error = new Error("Reader readiness is unavailable."); error.safeCode = "READER_HTTP_" + response.status; throw error; }
    const length = Number(response.headers.get("content-length"));
    if (length > 1024 || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Invalid readiness reply.");
    const text = await response.text();
    if (text.length > 1024) throw new Error("Invalid readiness reply.");
    const state = JSON.parse(text);
    if (state?.status !== "ok" || state?.service !== "cropster-website-reader") throw new Error("Invalid readiness reply.");
    return true;
  } catch (error) { error.safeCode = safeReaderCode(error); throw error; }
  finally { clearTimeout(timer); }
}

async function mergeRecipeAssignments(db, fresh, env) {
  const stored = await db.prepare("SELECT data_json FROM dashboard_roastery_lab_cropster WHERE part = ?").bind("recipes").first();
  const previous = stored ? JSON.parse(stored.data_json) : {};
  const configured = env.CROPSTER_PROFILE_ASSIGNMENTS_JSON ? JSON.parse(env.CROPSTER_PROFILE_ASSIGNMENTS_JSON) : {};
  if (!isObject(configured) || Object.keys(configured).length > 300) throw new Error("Invalid planning assignments.");
  for (const [id, value] of Object.entries(configured)) {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id) || !isObject(value) ||
      Object.keys(value).some(key => !["plannedLotIds", "historicalLotIds"].includes(key)) ||
      [value.plannedLotIds, value.historicalLotIds].some(ids => !Array.isArray(ids) || ids.length > 1200 ||
        new Set(ids).size !== ids.length || ids.some(lot => typeof lot !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(lot)))) throw new Error("Invalid planning assignments.");
  }
  const groups = new Map((previous.runoutProfiles || []).map(group => [group.id, group]));
  const runoutProfiles = (fresh.runoutProfiles || []).map(group => {
    const old = groups.get(group.id) || {};
    const cropsterLotIds = group.lotIds || [];
    // Legacy captures mixed Cropster links and approved CONTRACTS assignments.
    // Require explicit provenance before removing any of those planned inputs.
    const migrated = configured[group.id];
    const hasProvenance = Array.isArray(old.plannedLotIds) && Array.isArray(old.historicalLotIds);
    const removed = (old.lotIds || []).filter(id => !cropsterLotIds.includes(id));
    if (!hasProvenance && !migrated && removed.length && /contract|planned|historical|replacement/i.test(old.note || "")) throw new Error("Planning assignments need migration.");
    const plannedLotIds = old.plannedLotIds || migrated?.plannedLotIds || [], historicalLotIds = old.historicalLotIds || migrated?.historicalLotIds || [];
    return { ...group, cropsterLotIds, plannedLotIds, historicalLotIds,
      lotIds: [...new Set([...cropsterLotIds, ...plannedLotIds, ...historicalLotIds])],
      note: [group.note, plannedLotIds.length || historicalLotIds.length ? "Approved planned replacements and historical substitutions are retained separately from current Cropster links." : ""].filter(Boolean).join(" "),
    };
  });
  if ([...groups.values()].some(old => !(fresh.runoutProfiles || []).some(group => group.id === old.id)
    && ((old.plannedLotIds?.length || old.historicalLotIds?.length) || /contract|planned|historical|replacement/i.test(old.note || "")))) throw new Error("An approved planning group is missing.");
  const aliases = new Map();
  for (const row of [...(previous.runoutLotNames || []), ...(fresh.runoutLotNames || [])]) {
    aliases.set(JSON.stringify([row.lotId, row.name?.replace(/\s+/g, " ").trim().toLowerCase()]), row);
  }
  return { ...fresh, runoutProfiles, runoutLotNames: [...aliases.values()] };
}

async function captureAndSave({ config, env, weekStart, now, fetcher, jobId, suppliedState = null }) {
  let observation, state;
  try {
    state = suppliedState || await websiteJob(config, env, weekStart, jobId, fetcher);
    if (state.status === "running" && !state.result) return { status: "pending", readerStatus: "running", fetched: false, greenFetched: false,
      jobId: state.jobId, weekStart, note: "Cropster website sync is running." };
    if (state.status === "failed" && !state.result) return { status: "failed", readerStatus: "failed", fetched: false, greenFetched: false,
      jobId: state.jobId, weekStart, note: "The Cropster background update stopped. Previous readings retain their capture times." };
    observation = validateCropsterObservation(state.result, weekStart, now,
      state.status === "running" ? { maximumPublicationAge: MAX_SECTION_AGE } : {});
  }
  catch (error) {
    if (state?.status === "running") return { status: "pending", readerStatus: "running", jobId: state.jobId, weekStart,
      fetched: false, greenFetched: false, note: "Cropster is still updating. The latest verified readings retain their capture times." };
    return { status: "failed", safeCode: safeReaderCode(error), ...(state?.status ? { readerStatus: state.status } : error.jobExpired ? { readerStatus: "expired" } : {}),
      fetched: false, greenFetched: false, note: "Cropster could not be read. Previous readings and their original capture times are shown. Try Refresh again." };
  }
  let productionFetched = false, productionAccepted = false;
  try {
    // Update only current-week fields. Comparisons survive even a transient SELECT failure.
    const value = observation.production;
    const fields = ["roasted_kg", "scheduled_kg", "roasted_value", "scheduled_value"];
    const amounts = [value.roastedKg, value.scheduledKg, value.roastedValue, value.scheduledValue];
    if (observation.previousProduction) {
      const prior = observation.previousProduction;
      fields.push("previous_roasted_kg", "previous_scheduled_kg", "previous_roasted_value", "previous_scheduled_value");
      amounts.push(prior.roastedKg, prior.scheduledKg, prior.roastedValue, prior.scheduledValue);
    }
    const columns = ["week_start", ...fields, "recorded_at"];
    const updates = [...fields, "recorded_at"].map(field => `${field} = excluded.${field}`).join(", ");
    const saved = await env.DB.prepare(`INSERT INTO dashboard_cropster_readings (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(week_start) DO UPDATE SET ${updates}
      WHERE excluded.recorded_at >= dashboard_cropster_readings.recorded_at RETURNING week_start`)
      .bind(weekStart, ...amounts, observation.productionObservedAt.getTime()).first();
    productionFetched = Boolean(saved);
    const retained = saved || await env.DB.prepare("SELECT recorded_at FROM dashboard_cropster_readings WHERE week_start = ?").bind(weekStart).first();
    productionAccepted = Boolean(saved) || Number(retained?.recorded_at) >= observation.productionObservedAt.getTime();
  } catch {
    // Other independently captured sections can still be newer and valid.
  }
  let scheduledBatchesFetched = false;
  if (observation.scheduledBatches && productionAccepted) {
    try { scheduledBatchesFetched = await saveCropsterScheduledBatches(env.DB, observation.scheduledBatches, weekStart, observation.productionObservedAt); }
    catch { /* Scheduled batches can only accompany the retained production capture. */ }
  }
  let greenFetched = false, mondayFetched = false;
  if (observation.green) {
    try { await saveCropsterGreenStock(env.DB, observation.green, observation.greenObservedAt); greenFetched = true; }
    catch { /* Retain the original green-stock reading and timestamp. */ }
  }
  if (observation.mondayRoastedKg !== null) {
    try { await saveCropsterMonday(env.DB, { weekStart, roastedKg: observation.mondayRoastedKg }, weekStart, observation.mondayObservedAt); mondayFetched = true; }
    catch { /* Keep the original Monday reading. */ }
  }
  const labParts = {};
  for (const part of ["inventory", "recipes", "use", "loss"]) {
    labParts[part] = { status: state.status === "running" ? "pending" : "failed", asOf: null };
    if (!isObject(observation.lab[part])) continue;
    try {
      let report = observation.lab[part];
      if (part === "recipes") report = await mergeRecipeAssignments(env.DB, report, env);
      const partTime = typeof observation.labCapturedAt[part] === "string" ? new Date(observation.labCapturedAt[part]) : observation.observedAt;
      if (!Number.isFinite(partTime.getTime()) || partTime > observation.observedAt ||
        partTime.getTime() < observation.observedAt.getTime() - MAX_SECTION_AGE) throw new Error();
      await saveLabCropster(env.DB, { [part]: report }, partTime);
      // D1 upserts may retain a newer capture; verify that a usable part survived.
      const stored = await env.DB.prepare("SELECT recorded_at FROM dashboard_roastery_lab_cropster WHERE part = ?").bind(part).first();
      if (!stored || stored.recorded_at < partTime.getTime()) throw new Error();
      labParts[part] = { status: "updated", asOf: new Date(stored.recorded_at).toISOString() };
    } catch { /* A failed section cannot replace its verified prior data. */ }
  }
  return {
    status: state.status === "running" ? "pending" : state.status === "failed" || !productionAccepted ? "failed" : "refreshed",
    readerStatus: state.status,
    accepted: productionAccepted || greenFetched || mondayFetched || Object.values(labParts).some(part => part.status === "updated"),
    fetched: productionFetched, greenFetched, mondayFetched, scheduledBatchesFetched, labParts,
    previousFetched: productionFetched && observation.previousProduction !== null,
    previousAsOf: productionFetched && observation.previousProduction ? observation.previousProductionObservedAt.toISOString() : null,
    jobId: state.jobId, weekStart, productionCapturedAt: observation.productionObservedAt.toISOString(),
    greenCapturedAt: observation.greenObservedAt.toISOString(),
    note: (productionFetched ? "Verified production was read from Cropster’s website and saved." : "The latest saved production reading was retained.") +
      (greenFetched ? " Marrickville green stock was also updated." : " Green stock keeps its original capture time.") +
      (state.status === "running" ? " Remaining Cropster reports are updating in the background." : state.status === "failed" ? " Some reports could not finish; verified sections were retained." : ""),
  };
}

export async function readCurrentCropster({ env, weekStart, followingWeekStart, now = new Date(), fetcher = fetch, fresh = false, jobId = null }) {
  const config = cropsterReaderConnection(env);
  let refresh = {
    mode: config.configured ? "website-reader" : "saved-readings",
    status: config.valid ? "saved" : config.configured ? "failed" : "not-connected",
    fetched: false, greenFetched: false,
    note: config.valid ? "Cropster website reader is connected. Saved figures retain their capture times."
      : config.configured ? "The Cropster website reader needs configuration. Previous readings are shown."
      : "Cropster was not fetched again. Roasted, scheduled and green stock figures use saved readings.",
  };
  const completed = jobId ? await readSourceSyncLog(env.DB, jobId, weekStart) : null;
  if (fresh && ["complete", "failed"].includes(completed?.jobStatus)) {
    return readSavedCropsterJob({env, weekStart, followingWeekStart, now, jobId, summary: completed});
  }
  if (fresh && config.valid && env.DB?.prepare) {
    let jobs = activeReads.get(env.DB);
    if (!jobs) { jobs = new Map(); activeReads.set(env.DB, jobs); }
    const key = config.url + ":" + weekStart + ":" + (jobId || "start");
    let job = jobs.get(key);
    if (!job) {
      job = captureAndSave({ config, env, weekStart, now, fetcher, jobId });
      jobs.set(key, job);
      void job.finally(() => { if (jobs.get(key) === job) jobs.delete(key); }).catch(() => {});
    }
    refresh = { ...refresh, ...await job };
  }
  return readBackCropster({ env, weekStart, followingWeekStart, now, refresh, configured: config.configured });
}

export async function verifyCropsterJob({ env, weekStart, jobId, fetcher = fetch }) {
  const config = cropsterReaderConnection(env);
  if (!config.valid || !validSyncJobId(jobId)) { const invalid = new Error("The source job cannot be verified."); invalid.safeCode = "READER_CONFIGURATION"; throw invalid; }
  try { return await websiteJob(config, env, weekStart, jobId, fetcher); }
  catch (error) {
    if (!error.safeCode) error.safeCode = /cache.*(?:unsupported|not supported)|unsupported.*cache/i.test(error.message || "") ? "READER_CACHE_MODE" :
      /redirect.*(?:unsupported|not supported)|unsupported.*redirect/i.test(error.message || "") ? "READER_REDIRECT_MODE" : "READER_FETCH_OR_PROTOCOL";
    throw error;
  }
}

export async function readSavedCropsterJob({env, weekStart, followingWeekStart = addDays(weekStart, 7), now = new Date(), jobId, summary, pending = false, phase = null, safeCode = null}) {
  const sources = new Map((summary?.sources || []).map(source => [source.id, source]));
  const updated = id => sources.get(id)?.status === "updated" || sources.get(id)?.status === "partial";
  const refresh = {
    mode: "website-reader", status: pending ? "pending" : summary?.jobStatus === "complete" ? "refreshed" : summary?.jobStatus === "failed" ? "failed" : "saved",
    readerStatus: pending ? "running" : summary?.jobStatus || undefined,
    fetched: updated("production"), greenFetched: updated("green"), mondayFetched: updated("monday"),
    previousFetched: updated("previous-production"), previousAsOf: sources.get("previous-production")?.asOf || null,
    labParts: Object.fromEntries(["inventory", "recipes", "use", "loss"].map(part => [part, {
      status: sources.get("lab-" + part)?.status || (pending ? "pending" : "saved"), asOf: sources.get("lab-" + part)?.asOf || null,
    }])),
    ...(jobId ? {jobId} : {}), weekStart, ...(phase ? {phase} : {}), ...(safeCode ? {safeCode} : {}),
    note: pending ? phase === "warming" ? "Waking the Cropster reader. Saved readings retain their capture times." : "Cropster is updating in the background. Saved readings retain their capture times."
      : summary?.jobStatus === "complete" ? "The verified Cropster update finished and remains saved with its actual capture times."
      : summary?.jobStatus === "failed" ? "The Cropster update stopped. Verified saved readings retain their actual capture times."
      : "Saved Cropster readings retain their actual capture times.",
  };
  return readBackCropster({env, weekStart, followingWeekStart, now, refresh, configured: cropsterReaderConnection(env).configured});
}

export async function ingestCropsterSync({ env, weekStart, jobId, input, status = "complete", now = new Date() }) {
  if (!validSyncJobId(jobId)) throw new Error("Invalid source job.");
  if (!["running", "complete", "failed"].includes(status)) throw new Error("Invalid source job status.");
  const refresh = { mode: "website-reader", ...await captureAndSave({ env, weekStart, now,
    suppliedState: { schemaVersion: "1.0", status, weekStart, jobId, result: input } }) };
  return readBackCropster({ env, weekStart, followingWeekStart: addDays(weekStart, 7), now, refresh, configured: true });
}

async function readBackCropster({ env, weekStart, followingWeekStart, now, refresh, configured }) {
  const [readings, scheduledBatches] = await Promise.all([
    readCropsterReadings({ db: env.DB, weekStart, followingWeekStart, now }),
    readCropsterScheduledBatches(env.DB, weekStart),
  ]);
  const matchedScheduled = scheduledBatches?.asOf === readings.production.asOf ? scheduledBatches : null;
  readings.production.scheduledGreenKg = matchedScheduled?.greenKg ?? null;
  readings.production.scheduledBatchCount = matchedScheduled?.batches ?? null;
  if (matchedScheduled && readings.production.scheduledKg === null) {
    readings.production.note += " Pending scheduled green input and batch count were verified for this capture.";
  }
  if (refresh.fetched && (!Number.isFinite(readings.production.roastedKg) ||
    !Number.isFinite(readings.production.scheduledKg) && !(readings.production.scheduledKg === null && matchedScheduled) ||
    Date.parse(readings.production.asOf) < Date.parse(refresh.productionCapturedAt) || !readings.production.asOf)) {
    refresh = { ...refresh, status: "failed", fetched: false,
      note: "The fresh Cropster reading was saved but could not be loaded. Try Refresh again." };
  }
  if (refresh.greenFetched && (!Number.isFinite(readings.green.kg) ||
    !readings.green.asOf || Date.parse(readings.green.asOf) < Date.parse(refresh.greenCapturedAt))) {
    refresh = { ...refresh, greenFetched: false, note: "Production was updated. Green stock could not be loaded; its capture time is shown." };
  }
  delete refresh.productionCapturedAt;
  delete refresh.greenCapturedAt;
  if (configured) {
    for (const metric of [readings.production, readings.green]) {
      metric.note = metric.note.replace("Dashboard Refresh reloads this saved reading; it does not fetch Cropster again. ", "");
    }
  }
  return { ...readings, refresh: { ...refresh, productionAsOf: readings.production.asOf, greenAsOf: readings.green.asOf } };
}
