import { addDays, validDate } from "./metrics.js";
import { readCropsterReadings, saveCropsterGreenStock } from "./cropster.js";
import { saveCropsterMonday } from "./cropster-monday.js";
import { saveLabCropster } from "./roastery-lab.js";

const DEADLINE_MS = 12_000;
const MAX_BODY = 350_000;
const activeReads = new WeakMap();
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedAmount = (value, limit, nullable = false) => nullable && value === null ||
  Number.isFinite(value) && value >= 0 && value <= limit;

function connection(env) {
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

export function validateCropsterObservation(input, weekStart, now = new Date()) {
  if (!isObject(input) || input.schemaVersion !== "1.0" || input.sourceSystem !== "cropster-website" ||
    input.location !== "Marrickville" || input.weekStart !== weekStart || !validDate(weekStart) ||
    input.periodEnd !== addDays(weekStart, 4) || !isObject(input.production)) throw new Error("Invalid website observation.");
  const observedAt = typeof input.observedAt === "string" ? Date.parse(input.observedAt) : NaN;
  if (!Number.isFinite(observedAt) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.observedAt) ||
    observedAt > now.getTime() + 120_000 || observedAt < now.getTime() - 300_000) throw new Error("Invalid source capture time.");
  const production = input.production;
  for (const key of ["roastedKg", "scheduledKg"]) {
    if (!boundedAmount(production[key], 1_000_000)) throw new Error("Invalid production weight.");
  }
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
    if (!Number.isFinite(time) || time > observedAt || time < observedAt - 660_000) throw new Error("Invalid section capture time.");
    times[field] = new Date(time);
  }
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
  }, green, previousProduction, mondayRoastedKg: boundedAmount(input.mondayRoastedKg, 1_000_000) ? input.mondayRoastedKg : null,
  lab: isObject(input.lab) ? input.lab : {}, labCapturedAt: isObject(input.labObservedAt) ? input.labObservedAt : {} };
}

export const validSyncJobId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

async function websiteJob(config, env, weekStart, jobId, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    if (jobId && !validSyncJobId(jobId)) throw new Error();
    const response = await fetcher(config.url + (jobId ? "/" + jobId : ""), {
      method: jobId ? "GET" : "POST", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${env.CROPSTER_READER_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(jobId ? {} : { body: JSON.stringify({ weekStart }) }),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
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
    if (state.status === "running") return { status: "pending", fetched: false, greenFetched: false,
      jobId: state.jobId, weekStart, note: "Cropster website sync is running." };
    if (state.status === "failed") throw new Error();
    observation = validateCropsterObservation(state.result, weekStart, now);
  }
  catch { return { status: "failed", fetched: false, greenFetched: false, note: "Cropster could not be read. Previous readings and their original capture times are shown. Try Refresh again." }; }
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
    if (!saved) throw new Error("Newer reading retained.");
  } catch {
    return { status: "failed", fetched: false, greenFetched: false, note: "The fresh Cropster reading could not be saved. The latest saved reading is shown." };
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
    labParts[part] = { status: "failed", asOf: null };
    if (!isObject(observation.lab[part])) continue;
    try {
      let report = observation.lab[part];
      if (part === "recipes") report = await mergeRecipeAssignments(env.DB, report, env);
      const partTime = typeof observation.labCapturedAt[part] === "string" ? new Date(observation.labCapturedAt[part]) : observation.observedAt;
      if (!Number.isFinite(partTime.getTime()) || partTime > observation.observedAt ||
        partTime.getTime() < observation.observedAt.getTime() - 660_000) throw new Error();
      await saveLabCropster(env.DB, { [part]: report }, partTime);
      // D1 upserts may retain a newer capture; verify that a usable part survived.
      const stored = await env.DB.prepare("SELECT recorded_at FROM dashboard_roastery_lab_cropster WHERE part = ?").bind(part).first();
      if (!stored || stored.recorded_at < partTime.getTime()) throw new Error();
      labParts[part] = { status: "updated", asOf: new Date(stored.recorded_at).toISOString() };
    } catch { /* A failed section cannot replace its verified prior data. */ }
  }
  return {
    status: "refreshed", fetched: true, greenFetched, mondayFetched, labParts,
    previousFetched: observation.previousProduction !== null,
    previousAsOf: observation.previousProduction ? observation.previousProductionObservedAt.toISOString() : null,
    jobId: state.jobId, weekStart, productionCapturedAt: observation.productionObservedAt.toISOString(),
    greenCapturedAt: observation.greenObservedAt.toISOString(),
    note: "Production was read from Cropster’s website and saved." +
      (greenFetched ? " Marrickville green stock was also updated." : " Green stock was not updated; its original capture time is shown."),
  };
}

export async function readCurrentCropster({ env, weekStart, followingWeekStart, now = new Date(), fetcher = fetch, fresh = false, jobId = null }) {
  const config = connection(env);
  let refresh = {
    mode: config.configured ? "website-reader" : "saved-readings",
    status: config.valid ? "saved" : config.configured ? "failed" : "not-connected",
    fetched: false, greenFetched: false,
    note: config.valid ? "Cropster website reader is connected. Saved figures retain their capture times."
      : config.configured ? "The Cropster website reader needs configuration. Previous readings are shown."
      : "Cropster was not fetched again. Roasted, scheduled and green stock figures use saved readings.",
  };
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

export async function ingestCropsterSync({ env, weekStart, jobId, input, now = new Date() }) {
  if (!validSyncJobId(jobId)) throw new Error("Invalid source job.");
  const refresh = { mode: "website-reader", ...await captureAndSave({ env, weekStart, now,
    suppliedState: { schemaVersion: "1.0", status: "complete", weekStart, jobId, result: input } }) };
  return readBackCropster({ env, weekStart, followingWeekStart: addDays(weekStart, 7), now, refresh, configured: true });
}

async function readBackCropster({ env, weekStart, followingWeekStart, now, refresh, configured }) {
  const readings = await readCropsterReadings({ db: env.DB, weekStart, followingWeekStart, now });
  if (refresh.fetched && (!Number.isFinite(readings.production.roastedKg) ||
    !Number.isFinite(readings.production.scheduledKg) ||
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
