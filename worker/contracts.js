import { parseWorkbookSheet } from "./demand.js";

export const CONTRACT_SOURCE_URL = "https://docs.google.com/spreadsheets/d/1q-R7UP0ilUTbWoXY87rpaMYIrxZGZ6cqoBQIUHBvrF8/edit";
const columns = [
  { id: "B", header: /^Ethiopia$/i, usedFor: ["Liberty"] },
  { id: "C", header: /^Colombia\s*\/\s*Honduras$/i, usedFor: ["Liberty"] },
  { id: "D", header: /^Bra[sz]il\b/i, usedFor: ["Liberty", "Rhythm", "Single origins"] },
  { id: "F", header: /^China$/i, usedFor: ["Rhythm"] },
  { id: "G", header: /^Indonesia\b/i, usedFor: ["Rhythm"] },
  { id: "H", header: /^Peru$/i, usedFor: ["OH"] },
  { id: "I", header: /^Colombia$/i, usedFor: ["Decaf"] },
];
const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const green = new Set(["00FF00", "6AA84F", "93C47D"]);

export function unavailableContracts(note = "The NEW CONTRACTS calendar could not be read. Open the source planning workbook.") {
  return { status: "unavailable", asOf: null, sourceUrl: CONTRACT_SOURCE_URL, sourceUpdatedLabel: null, note, years: [], columns: [] };
}

function text(cell, maximum = 1_000) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) throw new Error("Unsupported contract text.");
  return value.replace(/\r\n?/g, "\n").trim();
}

function planningMonth(cell, format, date1904) {
  const label = text(cell, 100);
  if (!label) return null;
  const written = label.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-/]?\s*(20\d{2}|\d{2})$/i);
  if (written) return `${written[2].length === 2 ? "20" : ""}${written[2]}-${String(monthNames.indexOf(written[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}`;
  if (![null, "n"].includes(cell?.type) || !/^\d+(?:\.0+)?$/.test(label)) throw new Error("Unsupported contract month label.");
  const serial = Number(label);
  if (serial < 10_000 || serial > 100_000) throw new Error("Invalid contract date.");
  const date = new Date(Date.parse(date1904 ? "1904-01-01T00:00:00Z" : "1899-12-30T00:00:00Z") + serial * 86_400_000);
  const code = format?.numberFormat?.replace(/" "/g, " ").replace(/\\ /g, " ").replace(/\s+/g, "").toLowerCase();
  // This source writes Jun26 using a month+day display, with 26 meaning its
  // planning year. The raw serial year is deliberately not authoritative.
  if (!/^mmmd{1,2}$/.test(code ?? "")) throw new Error("Contract month display format changed.");
  const writtenYear = date.getUTCDate();
  if (writtenYear < 20 || writtenYear > 99) throw new Error("Invalid written planning year.");
  return `20${writtenYear}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseContractsWorkbook(bytes) {
  try {
    const sheet = parseWorkbookSheet(bytes, 0, "CONTRACTS", { styles: true });
    const get = (column, row) => sheet.cells.get(column + row);
    let lastRow = 1;
    for (const ref of sheet.cells.keys()) if (/^[A-I]\d+$/.test(ref)) lastRow = Math.max(lastRow, Number(ref.slice(1)));
    if (lastRow > 5_000) throw new Error("Contract source is too large.");
    const markers = [];
    for (let row = 1; row <= lastRow; row++) {
      const value = get("A", row)?.value;
      if (typeof value === "string" && value.trim().toUpperCase() === "NEW") markers.push(row);
    }
    if (markers.length !== 1) throw new Error("The NEW contract block is ambiguous.");
    const marker = markers[0], sourceUpdatedLabel = text(get("B", marker), 160);
    const updated = sourceUpdatedLabel.match(/^updated(?:\s+on)?\s+(\d{1,2})\/(\d{1,2})\/(20\d{2})$/i);
    if (!updated) throw new Error("Contract update date is missing.");
    const updateDate = `${updated[3]}-${updated[2].padStart(2, "0")}-${updated[1].padStart(2, "0")}`;
    const parsedDate = new Date(updateDate + "T00:00:00Z");
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== updateDate) throw new Error("Contract update date is invalid.");
    for (const [column, expected] of [["B", /^LIBERTY$/i], ["E", /^RHYTHM$/i], ["H", /^OH!?$/i], ["I", /^DECAF$/i]]) {
      if (!expected.test(text(get(column, marker + 1), 100))) throw new Error("Contract group headings changed.");
    }
    const normalized = columns.map(column => {
      const origin = text(get(column.id, marker + 2), 160);
      if (!column.header.test(origin)) throw new Error("Contract origin headings changed.");
      return { id: column.id, origin, rateLabel: text(get(column.id, marker + 3), 256), usedFor: [...column.usedFor], cells: [] };
    });
    const months = [];
    let ended = false, unknown = false;
    for (let row = marker + 4; row <= lastRow; row++) {
      const cell = get("A", row);
      const label = typeof cell?.value === "string" ? cell.value.trim() : "";
      if (!label) { ended = true; continue; }
      if (ended) {
        // Supplier notes below the calendar are separate source material. A
        // later month-like row would instead reveal a broken calendar gap.
        if (/^[a-z]{3,9}\s*[-/]?\s*(?:20)?\d{2}$/i.test(label)
          || [null, "n"].includes(cell?.type) && /mmm/i.test(sheet.formats.get("A" + row)?.numberFormat ?? "")) throw new Error("Contract month sequence is incomplete.");
        continue;
      }
      const month = planningMonth(cell, sheet.formats.get("A" + row), sheet.date1904);
      if (!month || months.length >= 36) throw new Error("Contract month sequence is incomplete.");
      const ordinal = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
      if (months.length && ordinal !== months.at(-1).ordinal + 1) throw new Error("Contract months must be consecutive.");
      months.push({ month, ordinal });
      for (const column of normalized) {
        const sourceCell = column.id + row, source = get(column.id, row), value = text(source);
        const color = sheet.formats.get(sourceCell)?.fillColor;
        const hasText = ["s", "inlineStr", "str"].includes(source?.type) && value.length > 0;
        const state = green.has(color) && hasText ? "contracted" : color === "FF0000" && !value ? "gap" : "unknown";
        if (state === "unknown") unknown = true;
        column.cells.push({ month, state, text: value, sourceCell });
      }
    }
    // The explicit NEW update anchors the unusual written YY month labels.
    // Its update month must exist in the strict consecutive planning sequence;
    // a later update may retain the earlier year's calendar rows.
    if (!months.length || !months.some(item => item.month === updateDate.slice(0, 7))) throw new Error("Contract planning years are unverified.");
    return {
      status: unknown ? "partial" : "live", asOf: null, sourceUrl: CONTRACT_SOURCE_URL, sourceUpdatedLabel,
      note: "Monthly coverage and supplier notes from the NEW CONTRACTS plan. Green cells with text record coverage; red blank cells record gaps. Planning years follow the displayed month labels. Bag and tonne notes remain as written; kilograms are not inferred."
        + (unknown ? " Some cells have unknown coverage." : ""),
      years: [...new Set(months.map(item => Number(item.month.slice(0, 4))))], columns: normalized,
    };
  } catch { return unavailableContracts(); }
}
