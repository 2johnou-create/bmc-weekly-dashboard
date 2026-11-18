import { parseCsv } from "./online-orders.js";

const QUOTES_URL = "https://www.ice.com/marketdata/api/productguide/charting/contract-data?productId=580&hubId=728&mode=2";
const EXPIRY_URL = "https://www.ice.com/api/productguide/spec/15/expiry/csv";
const SOURCE_URL = "https://www.ice.com/products/15/Coffee-C-Futures/data";
const MAX_BYTES = 128_000;
const CACHE_MS = 60_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const cache = new WeakMap();
const monthCodes = { Mar: "H", May: "K", Jul: "N", Sep: "U", Dec: "Z" };
const newYorkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

function unavailable() {
  return {
    status: "unavailable", price: null, currency: "USD", unit: "US¢/lb", asOf: null,
    contract: null, delayMinutes: 15, marketStatus: "unknown", sourceUrl: SOURCE_URL,
    change: null, changePercent: null, note: "The delayed ICE Coffee C quote could not be read. Try refreshing.",
  };
}

function dateValue(month, day, year) {
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Invalid exchange date.");
  return date;
}

function selectContract(csv, now) {
  const [headers, ...rows] = parseCsv(csv);
  if (headers?.[0] !== "CONTRACT SYMBOL" || headers?.[2] !== "LTD" || !rows.length || rows.length > 60) throw new Error("Invalid exchange expiry list.");
  const today = newYorkDay.format(now);
  const contracts = rows.map(row => {
    const strip = row[0].match(/^="((?:Mar|May|Jul|Sep|Dec)\d{2})"$/)?.[1];
    const lastTrade = row[2]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!strip || !lastTrade) throw new Error("Invalid exchange contract.");
    return { strip, expires: dateValue(lastTrade[1], lastTrade[2], lastTrade[3]) };
  }).filter(row => row.expires >= today).sort((a, b) => a.expires.localeCompare(b.expires));
  if (!contracts.length || new Set(contracts.map(row => row.strip)).size !== contracts.length) throw new Error("Missing exchange front contract.");
  return contracts[0].strip;
}

function quoteTimestamp(value) {
  const parts = typeof value === "string" && value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) (AM|PM) GMT$/);
  if (!parts || Number(parts[4]) < 1 || Number(parts[4]) > 12 || Number(parts[5]) > 59) throw new Error("Invalid exchange quote time.");
  const date = dateValue(parts[1], parts[2], parts[3]);
  const hour = Number(parts[4]) % 12 + (parts[6] === "PM" ? 12 : 0);
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${parts[5]}:00Z`).getTime();
}

function quoteResult(data, strip, now) {
  if (!Array.isArray(data) || data.length > 60) throw new Error("Invalid exchange quote list.");
  const matches = data.filter(row => row?.marketStrip === strip);
  if (matches.length !== 1) throw new Error("Missing exchange front quote.");
  const row = matches[0];
  if (!Number.isFinite(row.lastPrice) || row.lastPrice <= 0 || row.lastPrice > 1_000_000 || !Number.isSafeInteger(row.marketId) || row.marketId <= 0) throw new Error("Invalid exchange quote.");
  const timestamp = quoteTimestamp(row.lastTime);
  if (timestamp > now.getTime() + 60_000) throw new Error("Exchange quote is in the future.");
  const year = strip.slice(3);
  return {
    status: now.getTime() - timestamp > STALE_MS ? "stale" : "delayed",
    price: row.lastPrice, currency: "USD", unit: "US¢/lb", asOf: new Date(timestamp).toISOString(),
    contract: `KC${monthCodes[strip.slice(0, 3)]}${year} · ${strip.slice(0, 3)} 20${year}`,
    delayMinutes: 15, marketStatus: "unknown", sourceUrl: `${SOURCE_URL}?marketId=${row.marketId}`,
    change: null, changePercent: Number.isFinite(row.change) ? row.change : null,
    note: "ICE quote delayed at least 15 minutes. The front contract rolls after its New York last trading date. Market-open status is unavailable.",
  };
}

async function readText(url, type, fetcher, signal, fresh) {
  const headers = { Accept: type };
  if (fresh) { headers["Cache-Control"] = "no-cache"; headers.Pragma = "no-cache"; }
  const response = await fetcher(url, { redirect: "manual", cache: "no-store", signal, headers });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes(type) || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Exchange response is unavailable.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Exchange response is empty.");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Exchange response is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function readCoffeeC({ now = new Date(), fetcher = fetch, fresh = false } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return unavailable();
  let state = cache.get(fetcher);
  if (!state) { state = { sequence: 0, entry: null }; cache.set(fetcher, state); }
  const cached = state.entry;
  if (!fresh && cached && cached.tradeDate === newYorkDay.format(now) && now.getTime() >= cached.fetchedAt && now.getTime() - cached.fetchedAt < CACHE_MS) {
    return { ...cached.value, status: now.getTime() - Date.parse(cached.value.asOf) > STALE_MS ? "stale" : "delayed" };
  }
  const sequence = ++state.sequence;
  if (fresh) state.entry = null;
  try {
    const signal = AbortSignal.timeout(8_000);
    const [quotes, expiry] = await Promise.allSettled([
      readText(QUOTES_URL, "application/json", fetcher, signal, fresh),
      readText(EXPIRY_URL, "text/csv", fetcher, signal, fresh),
    ]);
    if (quotes.status !== "fulfilled" || expiry.status !== "fulfilled") throw new Error("Exchange request failed.");
    const value = quoteResult(JSON.parse(quotes.value), selectContract(expiry.value, now), now);
    if (state.sequence === sequence) state.entry = { fetchedAt: now.getTime(), tradeDate: newYorkDay.format(now), value };
    return { ...value };
  } catch {
    if (state.sequence === sequence) state.entry = null;
    return unavailable();
  }
}
