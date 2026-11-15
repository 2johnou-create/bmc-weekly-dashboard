import { addDays, fetchSourceJson, isoTimestamp, mondayOf, SOURCE_ORIGINS, sydneyDate, validDate } from "./metrics.js";

const MAX_REPORT_BYTES = 2_000_000;
const MAX_RECORDS = 10_000;
const BUY_STATUSES = new Set(["ordered", "delivered", "paid"]);
const currency = "AUD";
const shortDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function todayLabel(date) {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

function metric(fields, status, note, asOf = null) {
  return { ...fields, currency, status, source: "green", asOf, note };
}

const unknownBuy = { value: null, kg: null, orders: null };

function unknownForecast(month) {
  return { value: null, month, months: [] };
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sourceDate(payload) {
  return isoTimestamp(payload?.sourceUpdatedAtUtc || payload?.updatedAt);
}

/** The supplier register records order dates. Receipts and planned pallets are separate. */
export function mapGreenBuy(payload, weekStart, now = new Date()) {
  const register = payload?.state?.purchaseOrders;
  if (!Array.isArray(register) || register.length > MAX_RECORDS) {
    return metric(unknownBuy, "unavailable", "The green purchase register could not be read.");
  }
  const end = addDays(weekStart, 7);
  const today = sydneyDate(now);
  const candidates = register.filter(order => order && BUY_STATUSES.has(order.status));
  const latest = candidates.map(order => order.orderDate).filter(date => validDate(date) && date <= today).sort().at(-1);
  const entries = candidates.filter(order => validDate(order.orderDate) && order.orderDate >= weekStart && order.orderDate < end && order.orderDate <= today);

  if (!entries.length) {
    const latestNote = latest ? ` The latest recorded purchase was ${todayLabel(latest)}.` : "";
    return metric(unknownBuy, "unavailable", `No supplier purchases are recorded for this week.${latestNote}`, sourceDate(payload));
  }

  const seen = new Set();
  let kg = 0;
  let value = 0;
  let weighed = 0;
  let priced = 0;
  let needsReview = candidates.some(order => !validDate(order.orderDate));
  for (const order of entries) {
    if (typeof order.id !== "string" || !order.id || seen.has(order.id)) {
      needsReview = true;
      continue;
    }
    seen.add(order.id);
    if (positive(order.invoiceAmount)) {
      value += order.invoiceAmount;
      priced++;
    }
    if (Array.isArray(order.lines) && order.lines.length && order.lines.every(line => positive(line?.quantityKg))) {
      kg += order.lines.reduce((sum, line) => sum + line.quantityKg, 0);
      weighed++;
    }
  }
  if (!seen.size) return metric(unknownBuy, "unavailable", "This week's purchase records need review.", sourceDate(payload));
  needsReview ||= weighed !== seen.size || priced !== seen.size;
  const note = needsReview ? "Known figures from the supplier purchase register. Some records need review." : "Recorded supplier purchases, grouped by order date.";
  return metric({ value: priced ? round(value) : null, kg: weighed ? round(kg) : null, orders: seen.size }, needsReview ? "partial" : "live", note, sourceDate(payload));
}

function readForecastSheet(report) {
  if (typeof report !== "string" || report.length > MAX_REPORT_BYTES || /<!DOCTYPE|<!ENTITY/i.test(report)) {
    throw new Error("The green purchase forecast has an unsupported format.");
  }
  // Green Forecast generates this exact SpreadsheetML structure on the server.
  const sheet = report.match(/<Worksheet ss:Name="Purchase forecast"><Table>([\s\S]*?)<\/Table><\/Worksheet>/);
  if (!sheet) throw new Error("The green purchase forecast sheet is missing.");
  const rows = [...sheet[1].matchAll(/<Row>([\s\S]*?)<\/Row>/g)];
  if (!rows.length || rows.length > MAX_RECORDS || rows.map(row => row[0]).join("") !== sheet[1]) {
    throw new Error("The green purchase forecast rows could not be read.");
  }
  const cells = row => [...row[1].matchAll(/<Cell><Data ss:Type="(?:String|Number)">([^<]*)<\/Data><\/Cell>/g)].map(cell => cell[1]);
  const header = cells(rows[0]);
  const week = header.indexOf("Order week");
  const ready = header.indexOf("Pallet valid");
  const price = header.indexOf("Price per kg");
  const value = header.indexOf("Line value");
  if ([week, ready, price, value].some(column => column === -1)) throw new Error("The green purchase forecast columns changed.");

  return rows.slice(1).map(row => {
    const fields = cells(row);
    const date = fields[week];
    if (fields.length !== header.length || !validDate(date) || mondayOf(date) !== date || !["Yes", "No"].includes(fields[ready])) {
      throw new Error("A green purchase forecast row could not be read.");
    }
    const priced = positive(Number(fields[price])) && positive(Number(fields[value]));
    return { date, value: fields[ready] === "Yes" && priced ? Number(fields[value]) : null };
  });
}

function monthsFrom(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Array.from({ length: 4 }, () => {
    const next = date.toISOString().slice(0, 7);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return next;
  });
}

/** Monthly spend is the forecast purchase value in the order month. */
export function mapGreenForecast(report, payload, now = new Date()) {
  const month = sydneyDate(now).slice(0, 7);
  const state = payload?.state;
  const weeks = state?.settings?.forecastWeeks;
  if (state?.settings?.currency !== currency || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    return metric(unknownForecast(month), "unavailable", "Green Forecast settings could not be verified.");
  }

  // Green Forecast starts its own forecast weeks at UTC Mondays.
  const firstWeek = mondayOf(now.toISOString().slice(0, 10));
  const end = addDays(firstWeek, weeks * 7);
  const lastWeek = addDays(end, -7);
  const activeRecipes = new Set((state.recipes || []).filter(recipe => recipe?.active === true).map(recipe => recipe.id));
  const demandWeek = (Array.isArray(state.demand) ? state.demand : [])
    .filter(row => row && activeRecipes.has(row.recipeId) && validDate(row.weekStart) && row.weekStart <= firstWeek)
    .map(row => row.weekStart).sort().at(-1);
  const oldDemand = !demandWeek || demandWeek < addDays(firstWeek, -28);
  const orderRows = readForecastSheet(report);
  if (orderRows.some(row => row.date < firstWeek || row.date >= end)) {
    return metric(unknownForecast(month), "unavailable", "The purchase forecast dates changed during refresh. Try again.", sourceDate(payload));
  }

  const months = monthsFrom(month).map(key => {
    if (key < firstWeek.slice(0, 7) || key > lastWeek.slice(0, 7)) return { month: key, value: null, status: "unavailable" };
    const matching = orderRows.filter(row => row.date.slice(0, 7) === key);
    const known = matching.filter(row => row.value !== null);
    const gaps = known.length !== matching.length;
    const shortRange = lastWeek.slice(0, 7) === key && end.slice(0, 7) === key;
    const partial = gaps || oldDemand || shortRange;
    const value = known.length ? round(known.reduce((total, row) => total + row.value, 0)) : partial ? null : 0;
    return { month: key, value, status: partial ? "partial" : "live" };
  });

  const notes = ["Planned green purchase value by order month, starting with the current forecast week."];
  if (oldDemand) notes.push(demandWeek ? `Latest recorded demand week began ${todayLabel(demandWeek)}.` : "Current demand is missing from Green Forecast.");
  if (orderRows.some(row => row.value === null)) notes.push("Unpriced or unfilled pallets are excluded.");
  if (months.some(row => row.month === lastWeek.slice(0, 7) && end.slice(0, 7) === row.month)) notes.push("The final month is only partly covered.");
  const status = months[0].status;
  return metric({ value: months[0].value, month, months }, status, notes.join(" "), sourceDate(payload));
}

async function fetchReport(password, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${SOURCE_ORIGINS.green}/api/report`, {
      headers: { "x-green-password": password, Accept: "application/vnd.ms-excel" },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/vnd.ms-excel") || Number(response.headers.get("content-length")) > MAX_REPORT_BYTES) {
      throw new Error("The green purchase forecast could not be read.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The green purchase forecast could not be read.");
    const decoder = new TextDecoder();
    let bytes = 0;
    let xml = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_REPORT_BYTES) {
        await reader.cancel();
        throw new Error("The green purchase forecast is too large.");
      }
      xml += decoder.decode(part.value, { stream: true });
    }
    return xml + decoder.decode();
  } finally {
    clearTimeout(timer);
  }
}

export async function readGreenBuy({ weekStart, env = {}, now = new Date(), fetcher = fetch }) {
  const month = sydneyDate(now).slice(0, 7);
  const greenBuy = metric(unknownBuy, "unavailable", "The green purchase register could not be read.");
  const greenForecast = metric(unknownForecast(month), "unavailable", "The monthly green purchase forecast could not be read.");
  const password = env.SOURCE_GREEN_PASSWORD;
  if (typeof password !== "string" || !password) return { greenBuy, greenForecast };

  const [state, report] = await Promise.allSettled([
    fetchSourceJson(`${SOURCE_ORIGINS.green}/api/roaster`, { "x-green-password": password }, fetcher),
    fetchReport(password, fetcher),
  ]);
  if (state.status !== "fulfilled") return { greenBuy, greenForecast };

  const buys = mapGreenBuy(state.value, weekStart, now);
  if (report.status !== "fulfilled") return { greenBuy: buys, greenForecast };
  try {
    return { greenBuy: buys, greenForecast: mapGreenForecast(report.value, state.value, now) };
  } catch {
    return { greenBuy: buys, greenForecast };
  }
}
