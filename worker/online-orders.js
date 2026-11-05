import { validDate, addDays, mondayOf, sydneyDate } from "./metrics.js";

export const ONLINE_ORDERS_FOLDER_URL = "https://drive.google.com/drive/folders/1ziyEe7KOPe9IIlmpckhyl_75FaV-o71n";
export const ONLINE_ORDERS_CSV_HEADERS = "Order Number,Order Date,Order Total,Currency\n";
const MAX_BYTES = 2_000_000;
const MAX_FILES = 12;
const MAX_ROWS = 20_000;
const cache = new WeakMap();
const normalize = value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const source = "Online orders folder";
const noData = note => ({ status: "unavailable", orders: null, value: null, currency: "AUD", source, asOf: null, note, url: ONLINE_ORDERS_FOLDER_URL });

function parseCsv(text) {
  if (typeof text !== "string" || text.length > MAX_BYTES || text.includes("\0")) throw new Error("CSV is not supported.");
  const rows = [], row = [];
  let cell = "", quoted = false, closed = false;
  function pushCell() { if (cell.length > 20_000 || row.length >= 100) throw new Error("CSV is too large."); row.push(cell); cell = ""; closed = false; }
  function pushRow() { pushCell(); if (rows.length >= MAX_ROWS + 1) throw new Error("CSV has too many rows."); if (row.some(value => value.trim())) rows.push([...row]); row.length = 0; }
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
      continue;
    }
    if (char === ",") { pushCell(); continue; }
    if (char === "\n" || char === "\r") { if (char === "\r" && text[index + 1] === "\n") index++; pushRow(); continue; }
    if (char === '"') { if (cell || closed) throw new Error("CSV quotes are invalid."); quoted = true; continue; }
    if (closed) { if (!/[ \t]/.test(char)) throw new Error("CSV quotes are invalid."); continue; }
    cell += char;
    if (cell.length > 20_000) throw new Error("CSV cell is too large.");
  }
  if (quoted) throw new Error("CSV quotes are incomplete.");
  if (cell || row.length || closed) pushRow();
  return rows;
}

function localOrderDate(value) {
  const input = value.trim();
  if (validDate(input)) return input; // A date-only export is explicitly a Sydney calendar date.
  const match = input.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?\s*(Z|[+-]\d{2}:?\d{2})$/i);
  if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return null;
  let offset = match[6].toUpperCase();
  if (offset !== "Z") {
    offset = offset.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const hour = Number(offset.slice(1, 3)), minute = Number(offset.slice(4));
    if (hour > 14 || minute > 59 || (hour === 14 && minute > 0)) return null;
  }
  const timestamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}${match[5] || ""}${offset}`);
  return Number.isFinite(timestamp) ? sydneyDate(new Date(timestamp)) : null;
}
function cents(value) {
  const cleaned = value.trim().replace(/^AUD\s*/i, "").replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const result = Math.round(Number(cleaned.replace(/,/g, "")) * 100);
  return Number.isSafeInteger(result) && result <= 100_000_000_000 ? result : null;
}
function truthy(value) { return /^(?:true|yes|1)$/i.test(value.trim()); }
function column(headers, alternatives) {
  for (const name of alternatives) {
    const matches = headers.flatMap((header, index) => header === name ? [index] : []);
    if (matches.length > 1) throw new Error("CSV contains duplicate order headers.");
    if (matches.length) return matches[0];
  }
  return -1;
}
function parseOrderFile(file) {
  const rows = parseCsv(file.text);
  if (!rows.length) throw new Error("CSV headers are missing.");
  const headers = rows[0].map(normalize);
  let idColumn = column(headers, ["ordernumber", "orderid", "orderreference"]);
  const dateColumn = column(headers, ["orderdate", "createdat", "placedat", "ordercreatedat", "createddate"]);
  // Shopify calls the order number "Name". Accept that only with its identifiable export columns.
  if (idColumn < 0 && headers.includes("createdat") && (headers.includes("financialstatus") || headers.includes("lineitemquantity"))) idColumn = column(headers, ["name"]);
  if (idColumn < 0 || dateColumn < 0) throw new Error("Use Order Number and Order Date headers.");
  const totalColumn = column(headers, ["ordertotal", "grandtotal", "totalamount", "total"]);
  const currencyColumn = column(headers, ["currency", "currencycode"]);
  const cancelColumn = column(headers, ["cancelledat", "canceledat"]);
  const statusColumn = column(headers, ["orderstatus"]);
  const testColumn = column(headers, ["testorder", "istest", "test"]);
  const records = new Map();
  let invalidRows = 0;
  for (const row of rows.slice(1)) {
    const at = index => index < 0 ? "" : (row[index] || "").trim();
    const id = at(idColumn), dateText = at(dateColumn), totalText = at(totalColumn);
    // Blank order fields on line-item detail rows cannot create an additional order.
    if (!id) { if (dateText || totalText) invalidRows++; continue; }
    if (id.length > 120 || /[\u0000-\u001f\u007f]/.test(id) || row.length > headers.length) { invalidRows++; continue; }
    const record = records.get(id) || { dates: new Set(), values: new Set(), currencies: new Set(), invalidDate: false, invalidAmount: false, cancelled: false, test: false };
    if (dateText) {
      const date = localOrderDate(dateText);
      if (date) record.dates.add(date); else record.invalidDate = true;
    }
    if (totalText) { const amount = cents(totalText); if (amount === null) record.invalidAmount = true; else record.values.add(amount); }
    const currency = at(currencyColumn).toUpperCase();
    if (currency) record.currencies.add(currency);
    const cancelledAt = at(cancelColumn);
    if (cancelledAt && !localOrderDate(cancelledAt)) record.invalidDate = true;
    record.cancelled ||= Boolean(cancelledAt && localOrderDate(cancelledAt)) || /^(?:cancelled|canceled)$/i.test(at(statusColumn));
    record.test ||= truthy(at(testColumn));
    records.set(id, record);
  }
  for (const record of records.values()) {
    // Date inheritance is confined to this same order inside this one file.
    if (!record.dates.size) record.invalidDate = true;
  }
  return { records, invalidRows, rows: rows.length - 1, firstSheet: file.firstSheet === true };
}

/** Aggregate only. Identifiers, line items and customer fields never enter the returned metric. */
export function summarizeOnlineOrderFiles(files, weekStart, { incomplete = false, failedFiles = 0 } = {}) {
  if (!validDate(weekStart) || mondayOf(weekStart) !== weekStart) return noData("Choose a Monday to read online orders.");
  const weekEnd = addDays(weekStart, 6), records = new Map();
  let invalidRows = 0, badFiles = failedFiles, firstSheet = false, totalRows = 0;
  const modifiedDates = [];
  for (const file of files) {
    try {
      const parsed = parseOrderFile(file);
      totalRows += parsed.rows;
      if (totalRows > 40_000) { incomplete = true; break; }
      invalidRows += parsed.invalidRows;
      firstSheet ||= parsed.firstSheet;
      if (typeof file.modified === "string" && Number.isFinite(Date.parse(file.modified))) modifiedDates.push(new Date(file.modified).toISOString());
      for (const [id, item] of parsed.records) {
        const existing = records.get(id);
        if (!existing) { records.set(id, item); continue; }
        item.dates.forEach(date => existing.dates.add(date));
        item.values.forEach(value => existing.values.add(value));
        item.currencies.forEach(currency => existing.currencies.add(currency));
        existing.invalidDate ||= item.invalidDate;
        existing.invalidAmount ||= item.invalidAmount;
        existing.cancelled ||= item.cancelled;
        existing.test ||= item.test;
      }
    } catch { badFiles++; }
  }
  let orders = 0, totalCents = 0, relevant = 0, unclearDates = invalidRows, unknownValues = 0;
  for (const record of records.values()) {
    if (record.invalidDate || record.dates.size !== 1) { unclearDates++; continue; }
    const date = [...record.dates][0];
    if (date < weekStart || date > weekEnd) continue;
    relevant++;
    if (record.cancelled || record.test) continue;
    orders++;
    if (record.invalidAmount || record.values.size !== 1 || record.currencies.size !== 1 || !record.currencies.has("AUD")) unknownValues++;
    else totalCents += [...record.values][0];
  }
  const asOf = modifiedDates.sort().at(-1) || null;
  if (!relevant) {
    return { ...noData(badFiles && !records.size ? "The orders file could not be read. Use the CSV template with Order Number and Order Date." : "No orders dated in this week yet. Upload this week's online orders CSV to the folder."), asOf, status: incomplete || unclearDates || badFiles ? "partial" : "unavailable", note: `${badFiles && !records.size ? "The orders file could not be read. Use the CSV template with Order Number and Order Date." : "No orders dated in this week yet. Upload this week's online orders CSV to the folder."}${unclearDates ? " Some rows need a valid order number or dated timestamp." : ""}${incomplete ? " The folder or export exceeds the read limit; totals are incomplete." : ""}` };
  }
  const partialCount = incomplete || unclearDates > 0 || badFiles > 0 || firstSheet;
  const partial = partialCount || unknownValues > 0;
  return {
    status: partial ? "partial" : "live", orders,
    value: unknownValues || partialCount ? null : Math.round(totalCents) / 100,
    currency: "AUD", source, asOf, url: ONLINE_ORDERS_FOLDER_URL,
    note: `Unique orders placed in this Sydney week; repeated line items and duplicate files count once. Cancelled and test orders are excluded. ${partialCount ? "Known order count only; " : ""}${unclearDates ? "some rows need valid order dates or references. " : ""}${badFiles ? "some files could not be read. " : ""}${incomplete ? "the folder or export exceeds the read limit. " : ""}${firstSheet ? "Google Sheets exports use the first worksheet only. " : ""}${unknownValues ? "Order value needs one consistent AUD total per order. " : ""}${!unknownValues && !partialCount ? "Value uses the exported order total, including any tax or shipping in that total." : ""}`.trim(),
  };
}

function unescapeListing(value) {
  return value.replace(/\\(x[0-9a-f]{2}|u[0-9a-f]{4}|[\\'"/nrtbf])/gi, (_, escape) => {
    if (escape[0] === "x" || escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[escape] ?? escape;
  });
}
function folderFiles(html) {
  const match = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*'((?:\\.|[^'\\])*)';/);
  if (!match) throw new Error("The public folder listing is unavailable.");
  const data = JSON.parse(unescapeListing(match[1]));
  if (!Array.isArray(data) || (data[0] !== null && !Array.isArray(data[0])) || (data[0]?.length || 0) > 500) throw new Error("The public folder listing changed.");
  const files = [], seen = new Set();
  for (const row of data[0] || []) {
    if (!Array.isArray(row) || !/^[\w-]{20,100}$/.test(row[0] || "") || typeof row[2] !== "string" || typeof row[3] !== "string" || row[2].length > 240 || seen.has(row[0])) continue;
    seen.add(row[0]);
    files.push({ id: row[0], name: row[2], mime: row[3], modified: typeof row[10] === "number" && row[10] > 0 && Number.isFinite(row[10]) ? new Date(row[10]).toISOString() : null });
  }
  // A continuation token means the public first page cannot establish complete coverage.
  return { files: files.sort((a, b) => (b.modified || "").localeCompare(a.modified || "")), incomplete: Boolean(data[1]) };
}
function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("The source redirect is not allowed.");
  const allowed = (url.href === ONLINE_ORDERS_FOLDER_URL) || (url.hostname === "drive.google.com" && url.pathname === "/uc") || (url.hostname === "drive.usercontent.google.com" && url.pathname === "/download") || (url.hostname === "docs.google.com" && /^\/spreadsheets\/d\/[\w-]{20,100}\/export$/.test(url.pathname)) || (/^doc-\d{2}-\d{2}-sheets\.googleusercontent\.com$/.test(url.hostname) && url.pathname.startsWith("/export/"));
  if (!allowed) throw new Error("The source redirect is not allowed.");
  return url.href;
}
async function publicText(url, fetcher, signal, budget) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    url = allowedUrl(url);
    const response = await fetcher(url, { redirect: "manual", cache: "no-store", signal, headers: { Accept: "text/csv,text/html;q=0.9,*/*;q=0.1" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("The source redirect is missing.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("The source is unavailable."); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("The source file is too large."); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The source is empty.");
    let size = 0, output = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength; budget.bytes += value.byteLength;
      if (size > MAX_BYTES || budget.bytes > 8_000_000) { await reader.cancel(); throw new Error("The source read limit was exceeded."); }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  }
  throw new Error("The source redirected too many times.");
}

export async function readOnlineOrders(weekStart, env = {}) {
  if (!validDate(weekStart) || mondayOf(weekStart) !== weekStart) return noData("Choose a Monday to read online orders.");
  const fetcher = typeof env.fetch === "function" ? env.fetch : globalThis.fetch;
  const now = typeof env.now === "function" ? env.now() : Date.now();
  let entries = cache.get(fetcher);
  if (!entries) { entries = new Map(); cache.set(fetcher, entries); }
  const previous = entries.get(weekStart);
  if (previous && now - previous.time < 55_000) return { ...previous.metric };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 16_000), budget = { bytes: 0 };
  try {
    const listing = folderFiles(await publicText(ONLINE_ORDERS_FOLDER_URL, fetcher, controller.signal, budget));
    const visible = listing.files.filter(file => !/template|example/i.test(file.name));
    const supported = visible.filter(file => /\.csv$/i.test(file.name) || file.mime === "text/csv" || file.mime === "application/vnd.google-apps.spreadsheet");
    let metric;
    if (!visible.length) metric = noData("Folder connected. No orders file for this week yet. Upload the online orders CSV using the template.");
    else if (!supported.length) metric = noData("Folder connected. Upload an online orders CSV using the template; other file formats are not supported yet.");
    else {
      const files = []; let failedFiles = visible.length - supported.length;
      for (const file of supported.slice(0, MAX_FILES)) {
        if (controller.signal.aborted || budget.bytes > 8_000_000) { failedFiles++; break; }
        try {
          const native = file.mime === "application/vnd.google-apps.spreadsheet";
          const url = native ? `https://docs.google.com/spreadsheets/d/${file.id}/export?format=csv` : `https://drive.google.com/uc?export=download&id=${file.id}`;
          files.push({ text: await publicText(url, fetcher, controller.signal, budget), modified: file.modified, firstSheet: native });
        } catch { failedFiles++; }
      }
      metric = summarizeOnlineOrderFiles(files, weekStart, { failedFiles, incomplete: listing.incomplete || supported.length > MAX_FILES || controller.signal.aborted || budget.bytes > 8_000_000 });
    }
    if (entries.size >= 8) entries.delete(entries.keys().next().value);
    entries.set(weekStart, { time: now, metric });
    return { ...metric };
  } catch { return noData("The online orders folder could not be read. Try refreshing or check the folder's existing access."); }
  finally { clearTimeout(timer); }
}
