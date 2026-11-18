import { addDays, dashboardWeek, sydneyDate, validDate } from "./metrics.js";

const tokenUrl = "https://auth.cropster.com/oauth2/token";
const roastedLotsUrl = "https://api.cropster.com/rpc/v1/inventory.roast.listRoastedLots";
const maximumPages = 20;
const pageSize = 100;
const maximumResponseBytes = 1_000_000;
const roastTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const lotId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const sydneyOffset = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  timeZoneName: "longOffset",
});

let tokenCache;

export function unavailableCropsterProduction(note = "Connect the Cropster service account to see completed roasts. Schedule and production value data are unavailable.") {
  return {
    status: "unavailable",
    source: "Cropster",
    totalKg: null,
    roastedKg: null,
    scheduledKg: null,
    previousKg: null,
    previousRoastedKg: null,
    changePercent: null,
    roastedChangePercent: null,
    value: null,
    previousValue: null,
    valueChangePercent: null,
    currency: "AUD",
    byDay: [],
    days: null,
    asOf: null,
    note,
  };
}

function sydneyMondayUtc(date) {
  // The week starts on Monday, outside Sydney's Sunday daylight-saving transition.
  const reference = new Date(`${date}T00:00:00Z`);
  const zone = sydneyOffset.formatToParts(reference).find(part => part.type === "timeZoneName").value;
  return new Date(`${date}T00:00:00${zone.slice(3)}`).toISOString();
}

async function readJson(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const error = new Error("Cropster request failed.");
    error.status = response.status;
    throw error;
  }
  if (Number(response.headers.get("content-length")) > maximumResponseBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Cropster response exceeds the size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Cropster response is empty.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel();
        throw new Error("Cropster response exceeds the size limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function tokenFor(clientId, clientSecret, fetcher) {
  const existing = tokenCache;
  if (existing?.clientId === clientId && existing.clientSecret === clientSecret && existing.fetcher === fetcher && existing.expiresAt > Date.now()) {
    return existing.promise;
  }
  const requestedAt = Date.now();
  const entry = { clientId, clientSecret, fetcher, expiresAt: requestedAt + 8_000 };
  entry.promise = (async () => {
    const response = await fetcher(tokenUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "inventory.roast",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const token = await readJson(response);
    if (typeof token?.access_token !== "string" || !/^\S{1,8192}$/.test(token.access_token) || !/^Bearer$/i.test(token.token_type) || !(Number.isFinite(token.expires_in) && token.expires_in > 0)) {
      throw new Error("Cropster returned an invalid token response.");
    }
    const lifetime = Math.min(token.expires_in * 1000, 8 * 60 * 60 * 1000);
    entry.expiresAt = requestedAt + lifetime - Math.min(60_000, lifetime / 10);
    return token.access_token;
  })().catch(error => {
    if (tokenCache === entry) tokenCache = undefined;
    throw error;
  });
  tokenCache = entry;
  return entry.promise;
}

async function listRoastedLots(from, token, fetcher) {
  const rows = [];
  const cursors = new Set();
  const signal = AbortSignal.timeout(12_000);
  let after = null;
  for (let page = 0; page < maximumPages; page++) {
    if (page > 0) await new Promise(resolve => setTimeout(resolve, 225));
    signal.throwIfAborted();
    const response = await fetcher(roastedLotsUrl, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ params: { filter: { roastedDate: { from } }, pagination: { limit: pageSize, after } } }),
      signal,
    });
    const body = await readJson(response);
    if (body?.ok !== true || !Array.isArray(body.result?.roastedLots) || body.result.roastedLots.length > pageSize) {
      throw new Error("Cropster returned an unexpected roasted lot response.");
    }
    rows.push(...body.result.roastedLots);
    after = body.meta?.pagination?.endCursor;
    if (after == null) return rows;
    if (typeof after !== "string" || !after || after.length > 4_096 || cursors.has(after)) {
      throw new Error("Cropster pagination is incomplete.");
    }
    cursors.add(after);
  }
  throw new Error("Cropster pagination exceeded the weekly reporting limit.");
}

function roastWeightKg(weight) {
  if (!(Number.isFinite(weight?.amount) && weight.amount >= 0)) return null;
  if (weight.unit === "KG") return weight.amount;
  if (weight.unit === "LBS") return weight.amount * 0.45359237;
  return null;
}

function summarizeRoasts(rows, weekStart, previousStart, now) {
  const weekEnd = addDays(weekStart, 7);
  const byDay = new Map(Array.from({ length: 7 }, (_, day) => [addDays(weekStart, day), 0]));
  const incomplete = new Set();
  const lots = new Map();
  const previous = "previous";
  const current = "current";

  for (const row of rows) {
    const timestamp = typeof row?.roastedDate === "string" && roastTimestamp.test(row.roastedDate) && validDate(row.roastedDate.slice(0, 10))
      ? Date.parse(row.roastedDate) : NaN;
    if (!Number.isFinite(timestamp)) {
      incomplete.add(previous);
      incomplete.add(current);
      continue;
    }
    const date = sydneyDate(new Date(timestamp));
    if (date < previousStart || date >= weekEnd) continue;
    const period = date < weekStart ? previous : current;
    const kg = roastWeightKg(row.weight);
    if (kg === null || typeof row.id !== "string" || !lotId.test(row.id) || timestamp > now.getTime()) {
      incomplete.add(period);
      continue;
    }
    const id = row.id.toLowerCase();
    const recorded = lots.get(id);
    if (!recorded) {
      lots.set(id, { date, kg, period });
    } else if (recorded.date !== date || recorded.kg !== kg) {
      incomplete.add(recorded.period);
      incomplete.add(period);
    }
  }

  let roastedKg = 0;
  let previousRoastedKg = 0;
  for (const { date, kg, period } of lots.values()) {
    if (period === previous) previousRoastedKg += kg;
    else {
      roastedKg += kg;
      byDay.set(date, byDay.get(date) + kg);
    }
  }
  const roundKg = value => Math.round(value * 100) / 100;
  const currentComplete = !incomplete.has(current);
  const previousComplete = !incomplete.has(previous);
  const comparison = currentComplete && previousComplete && previousRoastedKg > 0
    ? Math.round((roastedKg - previousRoastedKg) * 1000 / previousRoastedKg) / 10
    : null;
  return {
    roastedKg: currentComplete ? roundKg(roastedKg) : null,
    previousRoastedKg: previousComplete ? roundKg(previousRoastedKg) : null,
    roastedChangePercent: comparison,
    byDay: currentComplete ? Array.from(byDay, ([date, kg]) => ({ date, kg: roundKg(kg) })) : [],
    days: currentComplete ? Array.from(byDay.values()).filter(kg => kg > 0).length : null,
    missingCompleted: incomplete.size > 0,
  };
}

export async function readCropsterProduction({ weekStart, env = {}, now = new Date(), fetcher = fetch }) {
  const { CROPSTER_CLIENT_ID: clientId, CROPSTER_CLIENT_SECRET: clientSecret } = env;
  if (typeof clientId !== "string" || !clientId.trim() || typeof clientSecret !== "string" || !clientSecret.trim()) {
    return unavailableCropsterProduction();
  }

  try {
    const week = dashboardWeek(weekStart, now);
    const previousStart = addDays(week.start, -7);
    const token = await tokenFor(clientId, clientSecret, fetcher);
    const rows = await listRoastedLots(sydneyMondayUtc(previousStart), token, fetcher);
    const { missingCompleted, ...data } = summarizeRoasts(rows, week.start, previousStart, now);
    const note = missingCompleted
      ? "Some completed roasts in Cropster have missing or inconsistent data. Schedule and production value data are unavailable."
      : "Completed roasts come from Cropster. Schedule data, including Friday, and production value are unavailable.";
    return {
      ...unavailableCropsterProduction(note),
      ...data,
      status: data.roastedKg === null && data.previousRoastedKg === null ? "unavailable" : "partial",
      asOf: now.toISOString(),
    };
  } catch (error) {
    if (error?.status === 401 && tokenCache?.fetcher === fetcher && tokenCache?.clientId === clientId) tokenCache = undefined;
    const authError = [400, 401, 403].includes(error?.status);
    return unavailableCropsterProduction(authError
      ? "Cropster rejected the read connection. Check the service account and roast inventory scope."
      : "Cropster completed roasts could not be read. Try refreshing.");
  }
}
