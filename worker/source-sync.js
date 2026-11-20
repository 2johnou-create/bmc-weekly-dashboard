const source = (id, label, status, asOf = null, note = "") => ({ id, label, status, asOf, note });
const readable = metric => metric && ["live", "recorded", "estimated", "delayed", "available"].includes(metric.status);

export function sourceSyncSummary({ weekly, lab, packing, weather }, { historical = false } = {}) {
  const metrics = weekly?.metrics || {};
  const cropster = weekly?.cropsterRefresh || {};
  const state = success => success ? "updated" : "failed";
  const metricState = metric => metric?.status === "partial" ? "partial" : state(readable(metric));
  const cropsterState = flag => historical ? "archive" : flag ? "updated" :
    cropster.mode === "saved-readings" ? "not-connected" : cropster.status === "pending" ? "pending" : cropster.status === "saved" ? "saved" : "failed";
  const production = metrics.production;
  const verifiedBatches = Number.isFinite(production?.scheduledGreenKg) && production.scheduledGreenKg >= 0 &&
    Number.isSafeInteger(production?.scheduledBatchCount) && production.scheduledBatchCount >= 0 &&
    (production.scheduledGreenKg === 0) === (production.scheduledBatchCount === 0);
  const productionCore = Number.isFinite(production?.roastedKg) && (verifiedBatches || Number.isFinite(production?.scheduledKg));
  const productionComplete = [production?.scheduledKg, production?.roastedValue, production?.scheduledValue].every(Number.isFinite);
  const productionState = !historical && cropster.fetched && productionCore
    ? productionComplete ? "updated" : "partial" : cropsterState(false);
  const productionNote = productionState === "partial"
    ? [cropster.note, production?.note].filter(Boolean).join(" ") : cropster.note;
  const sources = Object.keys(metrics).length ? [
    source("demand", "Roast tally", state(readable(metrics.demand)), metrics.demand?.asOf, metrics.demand?.note),
    source("production", "Cropster production and schedule", productionState, production?.asOf, productionNote),
    source("monday", "Cropster Monday output", cropsterState(cropster.mondayFetched), null),
    source("previous-production", "Cropster previous-week comparison", cropsterState(cropster.previousFetched), cropster.previousAsOf || null),
    source("green", "Cropster Marrickville stock", cropsterState(cropster.greenFetched &&
      [metrics.green?.kg, metrics.green?.value].every(Number.isFinite)), metrics.green?.asOf),
    source("stocktake", "Stock Take inventory", metricState(metrics.stock), metrics.stock?.asOf, metrics.stock?.note),
    source("dispatch", "Wholesale dispatch", metricState(metrics.wholesale), metrics.wholesale?.asOf, metrics.wholesale?.note),
    source("expenses", "Warehouse expenses sheet", metrics.expenses?.status === "live" ? "updated" :
      ["recorded", "stale"].includes(metrics.expenses?.status) ? "not-connected" : "failed", metrics.expenses?.asOf, metrics.expenses?.note),
  ] : [];
  if (!lab && metrics.expenses?.greenForecast) sources.push(source("planning", "Green buy forecast workbook",
    metricState(metrics.expenses.greenForecast), metrics.expenses.greenForecast.asOf, metrics.expenses.greenForecast.note));
  if (lab) {
    for (const part of ["inventory", "recipes", "use", "loss"]) {
      const item = cropster.labParts?.[part];
      sources.push(source("lab-" + part, "Cropster Lab " + ({ inventory: "inventory and prices", recipes: "blend profiles", use: "consumption", loss: "roast loss" })[part],
        historical ? "archive" : item?.status === "updated" ? "updated" : cropster.mode === "saved-readings" ? "not-connected" : cropster.status === "pending" ? "pending" : cropster.status === "saved" ? "saved" : "failed",
        item?.asOf || lab.source?.partAsOf?.[part] || null));
    }
    const planning = [
      ["Purchase calendar", lab.purchases], ["Contract calendar", lab.purchases?.contracts],
      ["Monthly forecast", lab.purchases?.greenForecast],
    ];
    const planningStatus = planning.some(([, metric]) => !readable(metric) && metric?.status !== "partial") ? "failed" :
      planning.some(([, metric]) => metric?.status === "partial") ? "partial" : "updated";
    const planningNote = planning.filter(([, metric]) => !readable(metric)).map(([label, metric]) => label + ": " +
      (label === "Purchase calendar" && metric?.status === "partial"
        ? "Calendar loaded; rows with missing or invalid order dates are excluded."
        : metric?.note || "This part of the planning workbook is unavailable.")).join(" ");
    sources.push(source("planning", "Green buy, purchases and contracts workbook", planningStatus, lab.purchases?.asOf, planningNote));
    sources.push(source("coffee-c", "Coffee C market quote", state(readable(lab.coffeeC)), lab.coffeeC?.asOf));
    sources.push(source("qa-releases", "QA notes and release plan", state(Boolean(lab.settings) && lab.settings.status !== "unavailable"), lab.settings?.updatedAt));
  }
  if (packing) sources.push(source("packing", "Stock Take packing rate", metricState(packing), packing.asOf, packing.note));
  if (weather) sources.push(source("weather", "Local weather forecast", state(readable(weather)), weather.asOf));
  return summarizeSources(sources, weekly?.generatedAt || null, historical);
}

function summarizeSources(sources, checkedAt, historical = false) {
  const failed = sources.filter(item => ["failed", "partial", "not-connected", "pending", "saved"].includes(item.status));
  const checked = sources.length - failed.length;
  return {
    status: failed.length ? "partial" : "complete",
    checkedAt,
    sources,
    message: failed.length
      ? `Updated ${checked} of ${sources.length} sources. ${failed.length} ${failed.length === 1 ? "source needs" : "sources need"} attention; saved readings keep their capture dates.`
      : historical ? "Historical sources rechecked. Friday archives retained." : "All card sources updated.",
  };
}

export function mergeSourceSyncSummary(previous, current) {
  if (!previous) return current;
  const sources = new Map(previous.sources.map(item => [item.id, item]));
  for (const item of current.sources) sources.set(item.id, item);
  return summarizeSources([...sources.values()], current.checkedAt);
}

export async function saveSourceSyncLog(db, id, weekStart, summary, now = new Date()) {
  if (!db?.prepare) return;
  try {
    await db.prepare(`INSERT INTO dashboard_source_sync_log (id, week_start, checked_at, status, source_status_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at,
      status = excluded.status, source_status_json = excluded.source_status_json
      WHERE excluded.checked_at >= dashboard_source_sync_log.checked_at
      AND NOT (COALESCE(json_extract(dashboard_source_sync_log.source_status_json, '$.jobStatus'), '') IN ('complete', 'failed')
        AND COALESCE(json_extract(excluded.source_status_json, '$.jobStatus'), '') = 'running')
      AND NOT (COALESCE(json_extract(dashboard_source_sync_log.source_status_json, '$.jobStatus'), '') = 'complete'
        AND COALESCE(json_extract(excluded.source_status_json, '$.jobStatus'), '') = 'failed')`)
      .bind(id, weekStart, now.getTime(), summary.status, JSON.stringify(summary)).run();
  } catch { /* A diagnostic log cannot discard freshly read source data. */ }
}

export async function readSourceSyncLog(db, id, weekStart) {
  if (!db?.prepare || !id) return null;
  try {
    const row = await db.prepare("SELECT source_status_json FROM dashboard_source_sync_log WHERE id = ? AND week_start = ?").bind(id, weekStart).first();
    const value = row ? JSON.parse(row.source_status_json) : null;
    return value && ["complete", "partial"].includes(value.status) && typeof value.message === "string" && Array.isArray(value.sources) ? value : null;
  } catch { return null; }
}
