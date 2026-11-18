import { parseWorkbookSheet, readBytes } from "./demand.js";
import { sydneyDate, validDate } from "./metrics.js";

export const PURCHASE_WORKBOOK_ID = "1q-R7UP0ilUTbWoXY87rpaMYIrxZGZ6cqoBQIUHBvrF8";
export const PURCHASE_SHEET = "ORDER PLAN";
export const PURCHASE_SOURCE_URL = "https://docs.google.com/spreadsheets/d/" + PURCHASE_WORKBOOK_ID + "/edit#gid=2009595819";
const downloadUrl = "https://docs.google.com/spreadsheets/d/" + PURCHASE_WORKBOOK_ID + "/export?format=xlsx";
const cache = new WeakMap();
const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const expectedHeaders = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"];
const sourceNote = "Order dates from ORDER PLAN. EST entries are planned purchases. Amounts use $ as recorded in the sheet. Coffee quantities stay as written when units or bag sizes are unspecified.";

function text(cell, maximum = 2_000) {
  const value = typeof cell?.value === "string" ? cell.value.replace(/\r\n?/g, "\n").trim() : "";
  if (value.length > maximum || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value)) throw new Error("The purchase sheet contains unsupported text.");
  return value;
}

function numeric(cell) {
  if (!cell || ![null, "n"].includes(cell.type) || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell.value ?? "")) return null;
  const value = Number(cell.value);
  return Number.isFinite(value) && value >= 0 && value <= 100_000_000 ? value : null;
}

function date(cell, date1904) {
  const serial = numeric(cell);
  if (serial !== null && serial >= 10_000 && serial <= 100_000) {
    const epoch = date1904 ? "1904-01-01" : "1899-12-30";
    return new Date(Date.parse(epoch) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  const value = text(cell, 100);
  if (validDate(value)) return value;
  const written = value.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s-]+(20\d{2})$/i);
  const month = written ? monthNames.indexOf(written[2].slice(0, 3).toLowerCase()) + 1 : 0;
  const resolved = month ? written[3] + "-" + String(month).padStart(2, "0") + "-" + written[1].padStart(2, "0") : null;
  return validDate(resolved) ? resolved : null;
}

function withinMonthDate(cell, block) {
  const value = text(cell, 100);
  const written = value.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})$/i);
  if (!written || block.years.size !== 1 || monthNames.indexOf(written[2].slice(0, 3).toLowerCase()) !== block.month) return null;
  const resolved = [...block.years][0] + "-" + String(block.month + 1).padStart(2, "0") + "-" + written[1].padStart(2, "0");
  return validDate(resolved) ? resolved : null;
}

function explicitQuantities(description) {
  const bagged = description.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*[^\n]+\(\s*@?\s*(\d+(?:\.\d+)?)\s*kg\s*\/\s*bag\s*\)\s*$/i);
  if (bagged) return { bags: Number(bagged[1]), kg: Math.round(Number(bagged[1]) * Number(bagged[2]) * 100) / 100 };
  return { bags: null, kg: null };
}

export function parsePurchaseWorkbook(bytes, today = sydneyDate()) {
  const sheet = parseWorkbookSheet(bytes, 1, PURCHASE_SHEET);
  const get = (column, row) => sheet.cells.get(column + row);
  const headers = ["B", "C", "D", "E", "F", "G"].map(column => text(get(column, 1), 100).replace(/\s+/g, " "));
  if (headers.some((header, index) => header !== expectedHeaders[index])) throw new Error("The purchase sheet headers changed.");

  let maximumRow = 1;
  for (const cell of sheet.cells.keys()) {
    if (/^[A-G]\d+$/.test(cell)) maximumRow = Math.max(maximumRow, Number(cell.slice(1)));
  }
  if (maximumRow > 5_000) throw new Error("The purchase sheet is too large.");

  const blocks = [];
  let block = { start: 2, end: maximumRow, month: null, years: new Set() };
  blocks.push(block);
  for (let row = 2; row <= maximumRow; row++) {
    const month = monthNames.indexOf(text(get("A", row), 100).slice(0, 3).toLowerCase());
    if (month !== -1) {
      block.end = row - 1;
      block = { start: row, end: maximumRow, month, years: new Set() };
      blocks.push(block);
    }
    const ordered = date(get("E", row), sheet.date1904);
    if (ordered) block.years.add(ordered.slice(0, 4));
  }

  const events = [];
  let skipped = 0;
  for (const group of blocks) {
    for (let row = group.start; row <= group.end; row++) {
      const supplier = text(get("B", row), 160);
      if (!supplier || /^(?:total|supplier)\b/i.test(supplier)) continue;
      const coffee = text(get("C", row));
      const invoice = text(get("D", row), 240);
      if (/\bgift\s*box\b/i.test(coffee)) continue;
      const ordered = date(get("E", row), sheet.date1904) ?? withinMonthDate(get("E", row), group);
      if (!ordered) { skipped++; continue; }
      const kind = /^(?:est|estimated|planned)\b/i.test(invoice) ? "upcoming" : "ordered";
      const dueDate = date(get("F", row), sheet.date1904);
      events.push({
        id: "order-plan-" + row,
        date: ordered,
        kind,
        supplier,
        coffee,
        ...explicitQuantities(coffee),
        value: numeric(get("G", row)),
        currency: null,
        currencySymbol: "$",
        invoice: invoice || null,
        dueDate,
        note: kind === "upcoming" && ordered < today ? "Estimated order date has passed. Confirmation is not recorded." : null,
      });
    }
  }
  if (!events.length) throw new Error("No dated green coffee orders were found.");
  events.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  return {
    events,
    status: skipped ? "partial" : "live",
    note: sourceNote + (skipped ? " Some older entries have missing or invalid order dates and are excluded." : ""),
  };
}

export async function readPurchases({ now = new Date(), fetcher = fetch } = {}) {
  const base = { sourceUrl: PURCHASE_SOURCE_URL, sheetName: PURCHASE_SHEET, asOf: null, events: [] };
  const timestamp = new Date(now).getTime();
  const previous = cache.get(fetcher);
  if (previous && timestamp >= previous.time && timestamp - previous.time < 55_000) return structuredClone(previous.value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const bytes = await readBytes(downloadUrl, fetcher, controller.signal);
    const report = parsePurchaseWorkbook(bytes, sydneyDate(new Date(now)));
    const value = { ...base, ...report, asOf: new Date(now).toISOString() };
    cache.set(fetcher, { time: timestamp, value });
    return structuredClone(value);
  } catch {
    return { ...base, status: "unavailable", note: "The ORDER PLAN worksheet could not be read. Try Refresh or open the source workbook." };
  } finally { clearTimeout(timer); }
}
