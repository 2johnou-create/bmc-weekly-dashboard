import { unzipSync, strFromU8 } from "../vendor/fflate.mjs";

const FOLDER_URL = "https://drive.google.com/drive/folders/1rxLbvoqyaxEdRJWJeWBOwmnmDqxnHXEo";
const KNOWN_TALLY = { id: "1uJnlW7nU7eB_mWRe-cG7kaiX5qPq8tJV", name: "NEW ROAST TALLY 2ND NOV.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modified: null };
const MAX_BYTES = 2_000_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const cache = new WeakMap();

function xmlText(value = "") {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
    const names = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (names[key]) return names[key];
    const point = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}
function attribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "s"));
  return match ? xmlText(match[2]) : null;
}
function unescapeJsString(input) {
  return input.replace(/\\(x[0-9a-f]{2}|u[0-9a-f]{4}|[\\'"/nrtbf])/gi, (_, escape) => {
    if (escape[0] === "x" || escape[0] === "u") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[escape] ?? escape;
  });
}
function filenameDate(name, year) {
  const match = name.match(/(?:^|[\s_])([0-3]?\d)(?:st|nd|rd|th)?[\s_-]+(jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)(?:[\s_-]+(20\d{2}))?/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  return `${match[3] || year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

// Drive's public folder listing is not a stable API. Never execute its scripts.
export function parseDriveFolderCandidates(html, weekStart) {
  if (typeof html !== "string" || html.length > MAX_BYTES) throw new Error("Folder listing is too large.");
  const candidates = [];
  const metadata = html.match(/window\[['"]_DRIVE_ivd['"]\]\s*=\s*'((?:\\.|[^'\\])*)';/);
  if (metadata) {
    const decoded = JSON.parse(unescapeJsString(metadata[1]));
    if (!Array.isArray(decoded?.[0]) || decoded[0].length > 500) throw new Error("Folder listing changed.");
    for (const file of decoded[0]) {
      if (Array.isArray(file)) candidates.push({ id: file[0], name: file[2], mime: file[3], modified: file[10] });
    }
  } else {
    for (const match of html.matchAll(/<(?:div|tr)\b[^>]*\bdata-id=["'][^"']+["'][^>]*>/gi)) {
      const id = attribute(match[0], "data-id"), title = attribute(match[0], "data-tooltip");
      if (title) candidates.push({ id, name: title.replace(/ Microsoft Excel$/, ""), mime: title.includes("Microsoft Excel") ? KNOWN_TALLY.mime : "application/vnd.google-apps.spreadsheet", modified: null });
    }
  }
  const unique = new Map();
  for (const file of candidates) {
    if (typeof file.id !== "string" || !/^[\w-]{20,100}$/.test(file.id) || typeof file.name !== "string" || file.name.length > 240) continue;
    if (!/roast/i.test(file.name) || !/tally/i.test(file.name) || /template|example/i.test(file.name)) continue;
    if (![KNOWN_TALLY.mime, "application/vnd.google-apps.spreadsheet"].includes(file.mime)) continue;
    const date = filenameDate(file.name, weekStart.slice(0, 4));
    // A filename is only a discovery hint; the internal workbook date is authoritative.
    if (date && date !== weekStart) continue;
    const modified = typeof file.modified === "number" && Number.isFinite(file.modified) && file.modified > 0 ? new Date(file.modified).toISOString() : null;
    unique.set(file.id, { ...file, modified, date });
  }
  return [...unique.values()].sort((a, b) => Number(b.date === weekStart) - Number(a.date === weekStart) || (b.modified || "").localeCompare(a.modified || "")).slice(0, 3);
}

function safeXml(bytes) {
  if (!bytes) throw new Error("Workbook structure changed.");
  const value = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error("Workbook XML is not supported.");
  return value;
}
function texts(xml) {
  return [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(match => xmlText(match[1])).join("").slice(0, 4000);
}
function cells(xml, shared) {
  const result = new Map();
  let count = 0;
  for (const match of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    if (++count > 100_000) throw new Error("Worksheet is too large.");
    const ref = attribute(match[1], "r"), type = attribute(match[1], "t");
    if (!ref || !/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(ref)) continue;
    const content = match[2] || "", raw = content.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
    let value = raw === undefined ? null : xmlText(raw);
    if (type === "s") value = /^\d+$/.test(value || "") ? shared[Number(value)] ?? null : null;
    if (type === "inlineStr") value = texts(content);
    const formula = content.match(/<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/)?.[1];
    if (value !== null || formula) result.set(ref, { value, formula: formula ? xmlText(formula) : null });
  }
  return result;
}
function number(cell) {
  const value = cell?.value;
  if (typeof value !== "string" || !value.trim() || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function excelDate(value, date1904) {
  if (typeof value !== "string") return null;
  if (/^\d+(?:\.0+)?$/.test(value)) {
    const serial = Number(value);
    if (serial < 1000 || serial > 100000) return null;
    return new Date(Date.parse(date1904 ? "1904-01-01T00:00:00Z" : "1899-12-30T00:00:00Z") + serial * 86400000).toISOString().slice(0, 10);
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
  return match && new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1] ? match[1] : null;
}
function planningTotal(sheet) {
  if (!sheet) return null;
  const header = [...sheet].find(([, cell]) => /demand\s*\(kg\)/i.test(cell.value || ""));
  if (!header) return null;
  const column = header[0].match(/^[A-Z]+/)[0], headerRow = Number(header[0].match(/\d+$/)[0]);
  let sum = 0, rows = 0;
  for (let row = headerRow + 1; row <= headerRow + 80; row++) {
    const label = sheet.get(`B${row}`)?.value?.trim();
    const cell = sheet.get(`${column}${row}`), value = number(cell);
    if ((!label || /^total\b/i.test(label)) && cell?.formula && /^SUM\(/i.test(cell.formula) && rows) {
      if (value === null || Math.abs(sum - value) > 0.02) throw new Error("Demand totals disagree.");
      return value;
    }
    if (!label) continue;
    if (value === null) return null;
    sum += value;
    rows++;
  }
  return null;
}
function tallyTotal(sheet) {
  const totals = [...sheet].filter(([, cell]) => /^(?:BLEND TOTAL|SINGLE ORIGIN TOTAL)$/i.test(cell.value || ""));
  if (!totals.length) return null;
  const amounts = totals.map(([ref]) => number(sheet.get(`J${ref.match(/\d+$/)[0]}`)));
  return amounts.some(value => value === null) ? null : amounts.reduce((sum, value) => sum + value, 0);
}

export function parseWeeklyDemandWorkbook(bytes, weekStart) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES || bytes[0] !== 80 || bytes[1] !== 75) throw new Error("The source did not return an Excel workbook.");
  let entries = 0, totalSize = 0;
  const names = new Set();
  const archive = unzipSync(bytes, { filter(file) {
    if (++entries > 200 || names.has(file.name) || file.name.split("/").includes("..") || file.name.startsWith("/")) throw new Error("Workbook archive is not supported.");
    names.add(file.name);
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize > MAX_BYTES || (totalSize += file.originalSize) > 8_000_000) throw new Error("Workbook is too large.");
    return /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(file.name);
  } });
  const workbook = safeXml(archive["xl/workbook.xml"]), rels = safeXml(archive["xl/_rels/workbook.xml.rels"]);
  const sharedXml = archive["xl/sharedStrings.xml"] ? safeXml(archive["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(match => texts(match[1]));
  if (shared.length > 20_000) throw new Error("Workbook text is too large.");
  const relationships = new Map([...rels.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].map(match => [attribute(match[1], "Id"), attribute(match[1], "Target")]));
  const sheets = new Map();
  for (const match of workbook.matchAll(/<sheet\b([^>]+)\/?\s*>/g)) {
    const name = attribute(match[1], "name"), relation = attribute(match[1], "r:id"), target = relationships.get(relation);
    if (name !== "1. Roast Tally" && name !== "3. Roast Planning") continue;
    if (!target || target.split("/").includes("..")) throw new Error("Workbook relationship is not supported.");
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    sheets.set(name, cells(safeXml(archive[path]), shared));
  }
  const tally = sheets.get("1. Roast Tally");
  if (!tally || !/week commencing/i.test(tally.get("B2")?.value || "")) throw new Error("Workbook week is missing.");
  const actualWeek = excelDate(tally.get("C2")?.value, /<workbookPr\b[^>]*date1904=["'](?:1|true)["']/i.test(workbook));
  if (actualWeek !== weekStart) throw new Error("Workbook belongs to a different week.");
  const plan = planningTotal(sheets.get("3. Roast Planning")), total = tallyTotal(tally);
  if (plan !== null && total !== null && Math.abs(plan - total) > 0.02) throw new Error("Demand totals disagree.");
  const kg = plan ?? total;
  if (kg === null || !Number.isFinite(kg) || kg > 1_000_000) throw new Error("Weekly demand total is missing.");
  const month = Number(weekStart.slice(5, 7)), day = Number(weekStart.slice(8, 10));
  const olderChannelNotes = [...tally.values()].some(cell => {
    if (!/^\*\s*(?:Online|Subscriptions):/i.test(cell.value || "")) return false;
    const period = cell.value.match(/\b(\d{1,2})[–-](\d{1,2})\s+([a-z]{3,9})\b/i);
    return period && (MONTHS.indexOf(period[3].slice(0, 3).toLowerCase()) + 1 !== month || Number(period[1]) < day || Number(period[2]) > day + 6);
  });
  return { kg: Math.round(kg * 100) / 100, olderChannelNotes };
}

function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Source redirect is not allowed.");
  const allowed = (url.hostname === "drive.google.com" && (url.pathname === "/uc" || url.href === FOLDER_URL)) || (url.hostname === "drive.usercontent.google.com" && url.pathname === "/download") || (url.hostname === "docs.google.com" && /^\/spreadsheets\/d\/[\w-]{20,100}\/export$/.test(url.pathname)) || (/^doc-\d{2}-\d{2}-sheets\.googleusercontent\.com$/.test(url.hostname) && url.pathname.startsWith("/export/"));
  if (!allowed) throw new Error("Source redirect is not allowed.");
  return url.href;
}
async function readBytes(url, fetcher, signal) {
  for (let redirect = 0; redirect <= 3; redirect++) {
    url = allowedUrl(url);
    const response = await fetcher(url, { redirect: "manual", cache: "no-store", signal, headers: { Accept: "*/*" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Source redirect is missing.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Source is unavailable."); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("Source response is too large."); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source response is empty.");
    const chunks = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Source response is too large."); }
      chunks.push(value);
    }
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
  throw new Error("Source redirected too many times.");
}

export async function readWeeklyDemand(weekStart, env = {}) {
  const unavailable = note => ({ status: "unavailable", kg: null, source: "Weekly roast tally", asOf: null, note, url: FOLDER_URL });
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(weekStart || "") || !Number.isFinite(Date.parse(`${weekStart}T00:00:00Z`)) || new Date(`${weekStart}T00:00:00Z`).toISOString().slice(0, 10) !== weekStart || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) return unavailable("Choose a Monday to read weekly demand.");
  const fetcher = typeof env.fetch === "function" ? env.fetch : globalThis.fetch;
  const now = typeof env.now === "function" ? env.now() : Date.now();
  let entries = cache.get(fetcher);
  if (!entries) { entries = new Map(); cache.set(fetcher, entries); }
  const cached = entries.get(weekStart);
  if (cached && now - cached.time < 55_000) return { ...cached.value };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 16_000);
  let folderFailed = false, candidates = [];
  try {
    try { candidates = parseDriveFolderCandidates(strFromU8(await readBytes(FOLDER_URL, fetcher, controller.signal)), weekStart); }
    catch { folderFailed = true; }
    if (weekStart === "2026-11-02" && !candidates.some(file => file.id === KNOWN_TALLY.id)) candidates.push(KNOWN_TALLY);
    for (const candidate of candidates.slice(0, 3)) {
      if (controller.signal.aborted) break;
      try {
        const url = candidate.mime === "application/vnd.google-apps.spreadsheet" ? `https://docs.google.com/spreadsheets/d/${candidate.id}/export?format=xlsx` : `https://drive.google.com/uc?export=download&id=${candidate.id}`;
        const result = parseWeeklyDemandWorkbook(await readBytes(url, fetcher, controller.signal), weekStart);
        const value = { status: result.olderChannelNotes || folderFailed ? "partial" : "live", kg: result.kg, source: "Weekly roast tally", asOf: candidate.modified, note: `Planned coffee demand for the week starting ${weekStart}.${result.olderChannelNotes ? " Online and subscription reference dates in the tally are outside this week; review those inputs." : ""}${folderFailed ? " The folder listing could not be refreshed; the known workbook was re-read and its week verified." : ""}`, url: `https://docs.google.com/spreadsheets/d/${candidate.id}/edit` };
        if (entries.size >= 8) entries.delete(entries.keys().next().value);
        entries.set(weekStart, { time: now, value });
        return { ...value };
      } catch { /* Try another bounded candidate; an old or malformed file is never a zero. */ }
    }
    return unavailable(folderFailed ? "The roast tally could not be reached. Try refreshing." : "No readable roast tally with the matching internal week was found. Add this week's tally to the shared roast folder.");
  } finally { clearTimeout(timer); }
}
