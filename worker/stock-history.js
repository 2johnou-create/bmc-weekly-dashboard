import { SOURCE_ORIGINS, mapNonCoffee, sydneyDate, validDate } from "./metrics.js";
import { parseCsv } from "./online-orders.js";

const MAX_REPORT_BYTES = 2_000_000;
const MAX_REPORT_MONTHS = 12;
const QUANTITY_TOLERANCE = 0.000_001;
const VALUE_METHOD = "Month-end quantities rolled back from Stockroom movements, valued at today's catalogue prices.";
const FRIDAY_VALUE_METHOD = "Friday closing quantities reconstructed from Stockroom movements, valued at today's catalogue prices and stock units.";

export function stockMonthEnds(now = new Date()) {
  const [year, month] = sydneyDate(new Date(now)).split("-").map(Number);
  return [1, 2, 3].map(offset => new Date(Date.UTC(year, month - offset, 0)).toISOString().slice(0, 10));
}

function reportMonths(firstDate, lastDate) {
  const month = new Date(`${firstDate.slice(0, 7)}-01T00:00:00Z`);
  const lastMonth = lastDate.slice(0, 7);
  const months = [];
  while (month.toISOString().slice(0, 7) <= lastMonth) {
    if (months.length === MAX_REPORT_MONTHS) return null;
    months.push(month.toISOString().slice(0, 7));
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return months;
}

function unavailable(date, note) {
  return { date, value: null, status: "unavailable", note };
}

function parseMovements(csv, month) {
  const [headers, ...rows] = parseCsv(csv);
  const required = ["Record Type", "Entity Type", "Entity / SKU", "Change Qty", "Result Qty", "Recorded At"];
  const columns = required.map(name => headers?.indexOf(name) ?? -1);
  if (columns.some(index => index < 0)) throw new Error("Stock movement columns are missing.");
  const movements = [];

  for (const row of rows) {
    if (row.length !== headers.length) throw new Error("Stock movement row is incomplete.");
    const [type, entity, id, deltaText, resultText, recordedAt] = columns.map(index => row[index]);
    if (type !== "Stock movement" || entity !== "inventory") continue;
    const delta = Number(deltaText), resultingQuantity = Number(resultText);
    const timestamp = Date.parse(recordedAt);
    if (!id || !deltaText.trim() || !resultText.trim() || !Number.isFinite(delta) || !Number.isFinite(resultingQuantity) || resultingQuantity < 0 ||
      !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== recordedAt || recordedAt.slice(0, 7) !== month) {
      throw new Error("Stock movement row is invalid.");
    }
    movements.push({ id, delta, resultingQuantity, timestamp, date: sydneyDate(new Date(timestamp)) });
  }
  return movements;
}

async function readMonthlyMovements(month, stockroomCookie, fetcher) {
  const url = `${SOURCE_ORIGINS.stockroom}/api/admin/export/monthly?month=${month}`;
  const response = await fetcher(url, {
    headers: { Accept: "text/csv", Cookie: stockroomCookie, Origin: SOURCE_ORIGINS.stockroom },
    signal: AbortSignal.timeout(12_000),
    redirect: "manual",
    cache: "no-store",
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/csv") || !response.body ||
    Number(response.headers.get("content-length")) > MAX_REPORT_BYTES) {
    throw new Error("Stock movement report could not be read.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, csv = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPORT_BYTES) {
      await reader.cancel();
      throw new Error("Stock movement report is too large.");
    }
    csv += decoder.decode(value, { stream: true });
  }
  return parseMovements(csv + decoder.decode(), month);
}

function validQuantity(value) {
  return Number.isFinite(value) && value >= 0;
}

function stockQuantityAtClose(item, movements, date) {
  let quantity = item.stock;
  if (!validQuantity(quantity)) return null;

  for (const movement of movements) {
    if (movement.date <= date) break;
    if (Number.isFinite(item.updatedAt) && movement.timestamp > item.updatedAt) continue;
    if (Math.abs(quantity - movement.resultingQuantity) > QUANTITY_TOLERANCE) return null;
    quantity -= movement.delta;
    if (quantity < -QUANTITY_TOLERANCE) return null;
    if (Math.abs(quantity) <= QUANTITY_TOLERANCE) quantity = 0;
  }
  return quantity;
}

function unitsPerCount(item) {
  if (item.stockUnitQuantity !== null && item.stockUnitQuantity !== undefined) return item.stockUnitQuantity;
  if (["Cups & Lids", "Food Packaging"].includes(item.category) && validQuantity(item.packSize) && item.packSize > 0) return item.packSize;
  return 1;
}

function valueAtClose(date, items, movementsById, method) {
  let pricedItems = 0, missingItems = 0;
  const countedItems = [];
  for (const [id, movements] of movementsById) {
    if (!items.has(id) && movements.some(movement => movement.date > date)) missingItems++;
  }

  for (const item of items.values()) {
    const quantity = stockQuantityAtClose(item, movementsById.get(item.id) || [], date);
    const units = unitsPerCount(item);
    const priced = validQuantity(item.unitCost) && Number.isFinite(units) && units > 0;
    if (quantity > 0 && priced) pricedItems++;
    countedItems.push({ ...item, stock: quantity > 0 && !priced ? null : quantity, stockUnitQuantity: units });
  }

  const valuation = mapNonCoffee({ items: countedItems });
  const unknown = missingItems + valuation.unpricedItems;
  if (!Number.isFinite(valuation.value) || (unknown && !pricedItems)) return unavailable(date, "A priced stock balance could not be reconstructed.");
  const note = `${method} Current catalogue items only.${unknown ? ` ${unknown} ${unknown === 1 ? "item needs" : "items need"} a quantity check or price. Known-value subtotal shown.` : ""}`;
  return { ...valuation, date, unpricedItems: unknown, status: unknown ? "partial" : "estimated", note };
}

async function readBalancesAtDates({ dates, inventory, stockroomCookie, now, fetcher, method }) {
  const rawItems = Array.isArray(inventory) ? inventory : inventory?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 1500 || !stockroomCookie) {
    return dates.map(date => unavailable(date, "Current Stockroom quantities are unavailable."));
  }
  const items = new Map();
  for (const item of rawItems) {
    if (!item || typeof item.id !== "string" || !item.id || items.has(item.id)) {
      return dates.map(date => unavailable(date, "Stockroom inventory could not be matched to its movements."));
    }
    items.set(item.id, item);
  }

  // The source partitions by UTC. Include the UTC month containing each Sydney close,
  // because movements late on that UTC date may already belong to the next local month.
  const lastChange = Math.max(new Date(now).getTime(), ...rawItems.map(item => Number.isFinite(item.updatedAt) ? item.updatedAt : 0));
  const lastDate = new Date(lastChange);
  if (!Number.isFinite(lastDate.getTime())) return dates.map(date => unavailable(date, "The Stockroom quantity recording time is unavailable."));
  const months = reportMonths(dates.at(-1), lastDate.toISOString());
  if (!months) return dates.map(date => unavailable(date, "This date is outside the available Stockroom reconstruction period."));
  const reports = await Promise.allSettled(months.map(month => readMonthlyMovements(month, stockroomCookie, fetcher)));
  const movementsById = new Map();
  const missingMonths = [];
  for (const [index, report] of reports.entries()) {
    if (report.status === "rejected") {
      missingMonths.push(months[index]);
      continue;
    }
    for (const movement of report.value) {
      const movements = movementsById.get(movement.id) || [];
      movements.push(movement);
      movementsById.set(movement.id, movements);
    }
  }
  for (const movements of movementsById.values()) movements.sort((left, right) => right.timestamp - left.timestamp);

  return dates.map(date => {
    if (missingMonths.some(month => month >= date.slice(0, 7))) {
      return unavailable(date, "Stockroom movement exports for this period are incomplete.");
    }
    return valueAtClose(date, items, movementsById, method);
  });
}

export async function readStockHistory({ inventory, stockroomCookie, now = new Date(), fetcher = fetch }) {
  const dates = stockMonthEnds(now);
  const readings = await readBalancesAtDates({ dates, inventory, stockroomCookie, now, fetcher, method: VALUE_METHOD });
  return readings.map(({ date, value, status, note }) => ({ date, value, status, note }));
}

export async function readFridayStock({ date, inventory, stockroomCookie, now = new Date(), fetcher = fetch }) {
  const metric = { source: "stockroom", status: "unavailable", snapshotDate: date, asOf: null, currency: "AUD", value: null, itemCount: null, categoryCount: null, categories: [], unpricedItems: null };
  const today = new Date(now);
  if (!Number.isFinite(today.getTime()) || !validDate(date) || new Date(`${date}T00:00:00Z`).getUTCDay() !== 5 || date >= sydneyDate(today)) {
    return { ...metric, note: "Choose a completed Friday in Sydney to estimate closing stock." };
  }
  const [reading] = await readBalancesAtDates({ dates: [date], inventory, stockroomCookie, now, fetcher, method: FRIDAY_VALUE_METHOD });
  return { ...metric, status: reading.status, value: reading.value, categoryCount: reading.categoryCount ?? null, categories: reading.categories ?? [], unpricedItems: reading.unpricedItems ?? null, note: reading.note };
}
