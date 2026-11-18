import { parseWorkbookSheet, readBytes } from "./demand.js";
import { sydneyDate, validDate } from "./metrics.js";
import { parseContractsWorkbook, unavailableContracts } from "./contracts.js";

export const PURCHASE_WORKBOOK_ID = "1q-R7UP0ilUTbWoXY87rpaMYIrxZGZ6cqoBQIUHBvrF8";
export const PURCHASE_SHEET = "ORDER PLAN";
export const PURCHASE_SOURCE_URL = "https://docs.google.com/spreadsheets/d/" + PURCHASE_WORKBOOK_ID + "/edit#gid=2009595819";
const downloadUrl = "https://docs.google.com/spreadsheets/d/" + PURCHASE_WORKBOOK_ID + "/export?format=xlsx";
const cache = new WeakMap();
const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const expectedHeaders = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"];
const sourceNote = "Order dates from ORDER PLAN. EST entries are planned purchases. Amounts use $ as recorded in the sheet. Coffee quantities stay as written when units or bag sizes are unspecified.";

function unavailableForecast(today, note = "The recorded monthly predicted spend in ORDER PLAN column I is unavailable.") {
  const month = validDate(today) ? today.slice(0, 7) : null;
  const monthLabel = month ? new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T00:00:00Z")) : null;
  return { value: null, currency: null, currencySymbol: "$", month, monthLabel, status: "unavailable", asOf: null, sourceUrl: PURCHASE_SOURCE_URL, sourceCell: null, note };
}

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

export function parseGreenForecastWorkbook(bytes, today = sydneyDate()) {
  const base = unavailableForecast(today);
  if (!base.month) return base;
  try {
    const sheet = parseWorkbookSheet(bytes, 1, PURCHASE_SHEET);
    const get = (column, row) => sheet.cells.get(column + row);
    if (text(get("I", 1), 100).replace(/\s+/g, " ") !== "Monthly Predicted Spend") return { ...base, note: "The ORDER PLAN monthly predicted spend heading has changed." };
    let maximumRow = 1;
    for (const cell of sheet.cells.keys()) {
      if (/^[A-I]\d+$/.test(cell)) maximumRow = Math.max(maximumRow, Number(cell.slice(1)));
    }
    if (maximumRow > 5_000) return base;
    const blocks = [];
    let block = null;
    for (let row = 2; row <= maximumRow; row++) {
      const label = text(get("A", row), 100).match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?$/i);
      if (label) {
        if (block) block.end = row - 1;
        block = { start: row, end: maximumRow, month: monthNames.indexOf(label[1].slice(0, 3).toLowerCase()), years: new Set(label[2] ? [label[2]] : []), dateIssues: 0 };
        blocks.push(block);
      }
      if (!block) continue;
      const ordered = date(get("E", row), sheet.date1904);
      if (ordered) {
        // Full order dates anchor the labelled month to a year. Never choose
        // an older occurrence of the same month just because it appears first.
        if (Number(ordered.slice(5, 7)) === block.month + 1) block.years.add(ordered.slice(0, 4));
        else block.dateIssues++;
      }
    }
    const year = base.month.slice(0, 4), targetMonth = Number(base.month.slice(5, 7)) - 1;
    const matches = blocks.filter(group => group.month === targetMonth && group.years.size === 1 && group.years.has(year));
    if (matches.length !== 1) return { ...base, note: "ORDER PLAN has no unique month section with a verified year for the current Sydney month." };
    const selected = matches[0];
    const totals = [];
    for (let row = selected.start; row <= selected.end; row++) {
      const cell = get("I", row);
      if (!cell) continue;
      const value = numeric(cell);
      if (value === null) return { ...base, note: "The selected month’s recorded forecast total is blank or invalid." };
      totals.push({ value, row });
    }
    if (totals.length !== 1) return { ...base, note: "The selected month needs one recorded forecast total in ORDER PLAN column I." };
    return {
      ...base, value: Math.round(totals[0].value * 100) / 100,
      status: selected.dateIssues ? "partial" : "live", sourceCell: "I" + totals[0].row,
      note: "Recorded monthly predicted spend from ORDER PLAN column I. Includes ordered and EST purchases in the month’s plan. Amounts use $ as recorded; the sheet does not specify a currency code."
        + (selected.dateIssues ? " Some order dates fall outside the labelled month." : ""),
    };
  } catch { return base; }
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

export async function readPurchases({ now = new Date(), fetcher = fetch, fresh = false } = {}) {
  const current = new Date(now);
  const timestamp = current.getTime();
  const today = Number.isFinite(timestamp) ? sydneyDate(current) : null;
  const month = today?.slice(0, 7);
  const base = { sourceUrl: PURCHASE_SOURCE_URL, sheetName: PURCHASE_SHEET, asOf: null, events: [], greenForecast: unavailableForecast(today), contracts: unavailableContracts() };
  if (!today) return { ...base, status: "unavailable", note: "Choose a valid date for the purchase plan." };
  let state = cache.get(fetcher);
  if (!state) { state = { sequence: 0, entry: null }; cache.set(fetcher, state); }
  const previous = state.entry;
  if (!fresh && previous && previous.month === month && timestamp >= previous.time && timestamp - previous.time < 55_000) return structuredClone(previous.value);
  const sequence = ++state.sequence;
  if (fresh) state.entry = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const url = fresh ? downloadUrl + "&_refresh=" + timestamp : downloadUrl;
    const bytes = await readBytes(url, fetcher, controller.signal, { fresh });
    // A malformed calendar entry must not hide an independently verified
    // monthly total. Both projections use this one bounded workbook download.
    let report;
    try { report = parsePurchaseWorkbook(bytes, today); }
    catch { report = { events: [], status: "unavailable", note: "The ORDER PLAN purchase calendar could not be parsed. Open the source workbook." }; }
    const greenForecast = parseGreenForecastWorkbook(bytes, today);
    const contracts = parseContractsWorkbook(bytes);
    const asOf = current.toISOString();
    if (greenForecast.value !== null) greenForecast.asOf = asOf;
    if (contracts.status !== "unavailable") contracts.asOf = asOf;
    const value = { ...base, ...report, greenForecast, contracts, asOf };
    if (state.sequence === sequence) state.entry = { time: timestamp, month, value };
    return structuredClone(value);
  } catch {
    if (state.sequence === sequence) state.entry = null;
    return { ...base, status: "unavailable", note: "The ORDER PLAN worksheet could not be read. Try Refresh or open the source workbook." };
  } finally { clearTimeout(timer); }
}
