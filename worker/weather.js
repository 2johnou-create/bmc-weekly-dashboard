// MET Norway permits reuse under CC BY 4.0. Its global Locationforecast service
// asks clients to wait at least three hours between identical reads.
const SOURCE_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-33.91&lon=151.16";
const LICENSE_URL = "https://api.met.no/doc/License";
const USER_AGENT = "BMCWeeklyDashboard/1.0 https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site roaster@blackmarketroasters.com.au";
const PROVIDER_CACHE_MS = 3 * 60 * 60 * 1000;
const CURRENT_WINDOW_MS = 45 * 60 * 1000;
const MODEL_STALE_MS = 12 * 60 * 60 * 1000;
const MAX_BYTES = 256_000;
const cache = new WeakMap();

function unavailable() {
  return {
    status: "unavailable", temperatureC: null, time: null, asOf: null,
    location: "Marrickville", sourceUrl: SOURCE_URL, licenseUrl: LICENSE_URL,
    note: "The Marrickville outdoor forecast from MET Norway (CC BY 4.0) is unavailable.",
  };
}

function utcTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) throw new Error("Invalid weather time.");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value) throw new Error("Invalid weather time.");
  return time;
}

function forecast(data, now) {
  const coordinates = data?.geometry?.coordinates;
  const meta = data?.properties?.meta;
  const rows = data?.properties?.timeseries;
  if (data?.type !== "Feature" || data?.geometry?.type !== "Point" || !Array.isArray(coordinates)
    || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])
    || Math.abs(coordinates[0] - 151.16) > 0.01 || Math.abs(coordinates[1] + 33.91) > 0.01
    || meta?.units?.air_temperature !== "celsius" || !Array.isArray(rows) || rows.length < 1 || rows.length > 256) {
    throw new Error("Invalid weather forecast.");
  }
  const updatedAt = utcTime(meta.updated_at);
  if (updatedAt > now + 5 * 60 * 1000) throw new Error("Future weather publication.");
  let previous = -Infinity;
  const points = [];
  for (const row of rows) {
    const time = utcTime(row?.time);
    if (time <= previous) throw new Error("Unordered weather forecast.");
    previous = time;
    if (time < now - 60 * 60 * 1000 || time > now + 6 * 60 * 60 * 1000) continue;
    const temperatureC = row?.data?.instant?.details?.air_temperature;
    if (!Number.isFinite(temperatureC) || temperatureC < -90 || temperatureC > 65) throw new Error("Invalid weather temperature.");
    points.push({ time, temperatureC });
  }
  if (!points.length) throw new Error("No current weather forecast.");
  return { points, updatedAt };
}

function metric(entry, now) {
  const point = entry.points.reduce((best, row) => Math.abs(row.time - now) < Math.abs(best.time - now) ? row : best);
  const stale = Math.abs(point.time - now) > CURRENT_WINDOW_MS || now - entry.updatedAt > MODEL_STALE_MS || entry.deprecated;
  return {
    status: stale ? "stale" : "available", temperatureC: point.temperatureC,
    time: new Date(point.time).toISOString(), asOf: new Date(entry.updatedAt).toISOString(),
    location: "Marrickville", sourceUrl: SOURCE_URL, licenseUrl: LICENSE_URL,
    note: `Marrickville outdoor forecast from MET Norway (CC BY 4.0). Nearest hourly forecast; source checks follow its three-hour update policy.${stale ? " The forecast is out of date or its source version is deprecated." : ""}`,
  };
}

async function readJson(response) {
  if (!response.ok || !/application\/(?:json|geo\+json)/i.test(response.headers.get("content-type") ?? "")
    || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Weather response is unavailable.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Weather response is empty.");
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Weather response is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

function expiresAt(response, now) {
  const expires = Date.parse(response.headers.get("expires") ?? "");
  return Math.max(now + PROVIDER_CACHE_MS, Number.isFinite(expires) ? expires : 0);
}

export async function readWarehouseWeather({ now = new Date(), fetcher = fetch, fresh = false } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || typeof fetcher !== "function") return unavailable();
  const timestamp = now.getTime();
  let state = cache.get(fetcher);
  if (!state) { state = { sequence: 0, entry: null, inflight: null, failureUntil: 0 }; cache.set(fetcher, state); }
  // Always choose the current hour again, including manual refreshes. The
  // provider's minimum interval still applies when fresh=true.
  if (state.entry && timestamp >= state.entry.fetchedAt && timestamp < state.entry.expiresAt) return metric(state.entry, timestamp);
  if (timestamp < state.failureUntil) return unavailable();
  if (state.inflight && timestamp >= state.inflight.at && timestamp - state.inflight.at < PROVIDER_CACHE_MS) {
    const entry = await state.inflight.promise;
    return entry ? metric(entry, timestamp) : unavailable();
  }
  const sequence = ++state.sequence;
  const previous = state.entry;
  const promise = (async () => {
    try {
      const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
      if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;
      if (fresh) headers["Cache-Control"] = "no-cache";
      const response = await fetcher(SOURCE_URL, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers });
      let entry;
      if (response.status === 304) {
        await response.body?.cancel();
        if (!previous) throw new Error("Weather returned no forecast.");
        entry = { ...previous };
      } else {
        entry = { ...forecast(await readJson(response), timestamp), deprecated: response.status === 203 };
      }
      entry.fetchedAt = timestamp;
      entry.expiresAt = expiresAt(response, timestamp);
      entry.lastModified = response.headers.get("last-modified") || (response.status === 304 ? previous?.lastModified : null) || null;
      if (state.sequence === sequence) { state.entry = entry; state.failureUntil = 0; }
      return entry;
    } catch {
      if (state.sequence === sequence) { state.entry = null; state.failureUntil = timestamp + PROVIDER_CACHE_MS; }
      return null;
    }
  })();
  state.inflight = { sequence, at: timestamp, promise };
  try {
    const entry = await promise;
    return entry ? metric(entry, timestamp) : unavailable();
  } finally {
    if (state.inflight?.sequence === sequence) state.inflight = null;
  }
}
