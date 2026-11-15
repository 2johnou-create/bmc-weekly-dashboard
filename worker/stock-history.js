import { SOURCE_ORIGINS, sydneyDate } from "./metrics.js";
import { parseCsv } from "./online-orders.js";

const MAX_REPORT_BYTES = 2_000_000;
const QUANTITY_TOLERANCE = 0.000_001;
const VALUE_METHOD = "Month-end quantities rolled back from Stockroom movements, valued at today's catalogue prices.";

export function stockMonthEnds(now = new Date()) {
  const [year, month] = sydneyDate(new Date(now)).split("-").map(Number);
  return [1, 2, 3].map(offset => new Date(Date.UTC(year, month - offset, 0)).toISOString().slice(0, 10));
}

function reportMonths(firstDate, lastDate) {
  const month = new Date(`${firstDate.slice(0, 7)}-01T00:00:00Z`);
  const lastMonth = lastDate.slice(0, 7);
  const months = [];
  while (month.toISOString().slice(0, 7) <= lastMonth) {
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

function valueAtClose(date, items, movementsById) {
  let total = 0, pricedItems = 0, unknown = 0;
  for (const [id, movements] of movementsById) {
    if (!items.has(id) && movements.some(movement => movement.date > date)) unknown++;
  }

  for (const item of items.values()) {
    const quantity = stockQuantityAtClose(item, movementsById.get(item.id) || [], date);
    const units = unitsPerCount(item);
    if (quantity === null || (quantity > 0 && (!validQuantity(item.unitCost) || !Number.isFinite(units) || units <= 0))) {
      unknown++;
      continue;
    }
    if (quantity > 0) {
      total += quantity * item.unitCost * units;
      pricedItems++;
    }
  }

  if (!Number.isFinite(total) || (unknown && !pricedItems)) return unavailable(date, "A priced month-end balance could not be reconstructed.");
  const note = `${VALUE_METHOD} Current catalogue items only.${unknown ? ` ${unknown} ${unknown === 1 ? "item needs" : "items need"} a quantity check or price. Known-value subtotal shown.` : ""}`;
  return { date, value: Math.round(total * 100) / 100, status: unknown ? "partial" : "estimated", note };
}

export async function readStockHistory({ inventory, stockroomCookie, now = new Date(), fetcher = fetch }) {
  const dates = stockMonthEnds(now);
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
  const lastDate = new Date(now).toISOString();
  const months = reportMonths(dates.at(-1), lastDate);
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
    return valueAtClose(date, items, movementsById);
  });
}
