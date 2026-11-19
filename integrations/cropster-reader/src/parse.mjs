import { ReaderError } from "./errors.mjs";
import { addDays, dateLabel } from "./dates.mjs";

export const CROPSTER_ORIGIN = "https://c-sar.cropster.com";
const trim = value => typeof value === "string" ? value.replace(/\u00a0/g, " ").trim() : "";
const compact = value => trim(value).replace(/\s+/g, " ");
const header = value => compact(value).replace(/[*!]/g, "").toLowerCase()
  .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, month, day, year) => `${Number(month)}/${Number(day)}/${year}`);
const numeric = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const kgPattern = new RegExp("^(" + numeric + ")\\s*kg$");
const maximum = 100_000_000;

function number(value) {
  if (!new RegExp("^" + numeric + "$").test(value)) return null;
  const result = Number(value.replaceAll(",", ""));
  return Number.isFinite(result) && result >= 0 && result <= maximum ? result : null;
}

export function kilograms(cell) {
  const match = trim(cell).split("\n")[0].match(kgPattern);
  return match ? number(match[1]) : null;
}

export function aud(cell) {
  const value = compact(cell);
  const match = value.match(new RegExp("^(?:A\\$\\s*(" + numeric + ")|\\$\\s*(" + numeric + ")\\s+AUD)$"));
  return match ? number(match[1] ?? match[2]) : null;
}

export const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const close = (first, second, tolerance = 0.06) => Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= tolerance;
const sum = values => values.reduce((total, value) => total + value, 0);

function sourceUrl(snapshot, pathname) {
  let url;
  try { url = new URL(snapshot?.url); } catch { throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED"); }
  if (url.origin !== CROPSTER_ORIGIN || url.pathname !== pathname || url.username || url.password) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  return url;
}

function tableWith(snapshot, names) {
  const matches = (snapshot?.tables || []).filter(table => names.every(name => table.headers.some(value => header(value) === name)));
  if (matches.length !== 1) throw new ReaderError("CROPSTER_TABLE_UNRECOGNISED");
  const table = matches[0];
  if (!Array.isArray(table.rows) || table.rows.length > 1000) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  return { ...table, index: name => table.headers.findIndex(value => header(value) === name) };
}

function completeTable(snapshot, table) {
  const text = compact(table.pagination);
  const matches = Array.from(text.matchAll(/Show\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/gi));
  const count = table.rows.filter(row => row.some(value => trim(value))).length;
  return matches.some(match => Number(match[1]) === 1 && Number(match[2]) === count && Number(match[3]) === count)
    || (count === 0 && /\b(?:No results|No records|Show [01] - 0 of 0)\b/i.test(text));
}

function productionScope(snapshot, range, path, allLocations = false) {
  const url = sourceUrl(snapshot, path);
  if (url.searchParams.get("dateFrom") !== range.weekStart || url.searchParams.get("dateTo") !== range.periodEnd
    || (allLocations ? Boolean(url.searchParams.get("locations")) : url.searchParams.get("locations") !== "lK0G1")) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const period = `from ${dateLabel(range.weekStart)} to ${dateLabel(range.periodEnd)}`;
  const text = compact(snapshot.text);
  if (!text.includes(period) || !allLocations && !text.includes("Marrickville")) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  if (allLocations) {
    const selection = text.match(/\bLocations\s*(.*?)\s*Average\b/);
    if (!selection || selection[1].replace(/[×\s]/g, "") !== "") throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  }
}

export function parseRoastedOutput(snapshot, range) {
  productionScope(snapshot, range, "/apps/roast/production-report/profile-group");
  const table = tableWith(snapshot, ["component name", "amount roasted", "amount of green", "batches"]);
  if (!completeTable(snapshot, table)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const totals = (table.footers || []).filter(row => row.some(value => header(value) === "total"));
  if (totals.length !== 1) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  const total = totals[0];
  const roastedKg = kilograms(total[table.index("amount roasted")]);
  const greenKg = kilograms(total[table.index("amount of green")]);
  const batches = number(trim(total[table.index("batches")]));
  const roastRows = table.rows.map(row => kilograms(row[table.index("amount roasted")]));
  const greenRows = table.rows.map(row => kilograms(row[table.index("amount of green")]));
  if (roastedKg === null || greenKg === null || !Number.isSafeInteger(batches)
    || roastRows.some(value => value === null) || greenRows.some(value => value === null)
    || !close(roastedKg, sum(roastRows)) || !close(greenKg, sum(greenRows))) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  return { roastedKg, greenKg, batches };
}

export function parseRoastedCost(snapshot, range, expectedGreenKg) {
  productionScope(snapshot, range, "/apps/roast/production-report/inventory");
  const table = tableWith(snapshot, ["lot id-tag", "amount of green", "total price"]);
  if (!completeTable(snapshot, table)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const totals = (table.footers || []).filter(row => row.some(value => header(value) === "total"));
  if (totals.length !== 1) return null;
  const total = totals[0];
  const greenKg = kilograms(total[table.index("amount of green")]);
  if (!close(greenKg, expectedGreenKg)) throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
  const value = aud(total[table.index("total price")]);
  const rows = table.rows.map(row => aud(row[table.index("total price")]));
  return value !== null && rows.every(value => value !== null) && close(value, sum(rows)) ? value : null;
}

function quantityBreakdown(cell) {
  const lines = trim(cell).split(/\n+/).map(trim).filter(Boolean);
  const total = kilograms(lines.shift() || "");
  const components = new Map();
  for (const line of lines) {
    const match = line.match(new RegExp("^(.+):\\s*(" + numeric + ")\\s*kg$"));
    if (!match || components.has(trim(match[1]))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
    components.set(trim(match[1]), number(match[2]));
  }
  if (total === null || [...components.values()].some(value => value === null)
    || components.size && !close(total, sum([...components.values()]))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  return { total, components };
}

function remainingOutput(remaining, total, estimated, type) {
  if (remaining.total > total.total || total.total <= 0 || estimated.total > total.total) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  if (remaining.components.size === 0 && total.components.size === 0 && estimated.components.size === 0) {
    if (/post-roast blend/i.test(type)) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
    return estimated.total * remaining.total / total.total;
  }
  if (remaining.components.size > total.components.size || total.components.size !== estimated.components.size
    || [...total.components.keys()].some(name => !estimated.components.has(name))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  let output = 0;
  for (const [name, remainingKg] of remaining.components) {
    const totalKg = total.components.get(name), estimatedKg = estimated.components.get(name);
    if (!(totalKg > 0) || estimatedKg === undefined || remainingKg > totalKg || estimatedKg > totalKg) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
    output += estimatedKg * remainingKg / totalKg;
  }
  return output;
}

export function parseScheduleDay(snapshot, day, range) {
  if (day < range.weekStart || day > range.periodEnd) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const url = sourceUrl(snapshot, "/apps/roast/schedule/calendar/day");
  if (url.searchParams.get("date") !== day) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  if (!["unpublished", "scheduled", "synced", "roasted", "inconsistent"].every(status => snapshot.scheduleStatuses?.[status] === true)) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const sourceDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(day + "T12:00:00Z"));
  if (!compact(snapshot.text).includes(sourceDay + ", in Marrickville")
    && !compact(snapshot.text).includes(sourceDay + " , in Marrickville")) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const text = compact(snapshot.text);
  const empty = ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"].every(marker => text.includes(marker));
  if (empty && Array.isArray(snapshot.tables) && snapshot.tables.length === 0) {
    return { day, greenKg: 0, roastedKg: 0, lotKg: new Map() };
  }
  const displayedDay = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}/${day.slice(0, 4)}`;
  const remainingHeader = `${displayedDay} to roast`, totalHeader = `${displayedDay} total`, outputHeader = `${displayedDay} estimated output`;
  return { day, ...parsePendingTables(snapshot, remainingHeader, totalHeader, outputHeader) };
}

function parsePendingTables(snapshot, remainingHeader, totalHeader, outputHeader) {
  const coffees = tableWith(snapshot, ["profile", "type", remainingHeader, totalHeader, outputHeader]);
  const lots = tableWith(snapshot, ["lot", remainingHeader, totalHeader]);
  if (!completeTable(snapshot, coffees) || !completeTable(snapshot, lots)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  let greenKg = 0, roastedKg = 0;
  for (const row of coffees.rows) {
    const remainingCell = trim(row[coffees.index(remainingHeader)]);
    if (!remainingCell) continue; // Cropster's blank To-roast cell means that schedule is fully completed.
    const remaining = quantityBreakdown(remainingCell);
    if (remaining.total === 0) continue;
    const total = quantityBreakdown(row[coffees.index(totalHeader)]);
    const estimated = quantityBreakdown(row[coffees.index(outputHeader)]);
    greenKg += remaining.total;
    roastedKg += remainingOutput(remaining, total, estimated, trim(row[coffees.index("type")]));
  }
  const lotKg = new Map();
  for (const row of lots.rows) {
    const remaining = trim(row[lots.index(remainingHeader)]);
    if (!remaining) continue;
    const kg = kilograms(remaining);
    const id = trim(row[lots.index("lot")]).match(/^\[(PG-\d+)\](?:\s|$)/)?.[1];
    if (!id || kg === null) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
    lotKg.set(id, (lotKg.get(id) || 0) + kg);
  }
  if (!close(greenKg, sum([...lotKg.values()]))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  return { greenKg, roastedKg, lotKg };
}

export function parseScheduleWeek(snapshot, range) {
  const url = sourceUrl(snapshot, "/apps/roast/schedule/calendar/week");
  const selected = url.searchParams.get("date");
  if (selected && (selected < range.weekStart || selected > addDays(range.weekStart, 6))) return null;
  if (!["unpublished", "scheduled", "synced", "roasted", "inconsistent"].every(status => snapshot.scheduleStatuses?.[status] === true)) return null;
  const machines = snapshot.scheduleMachines;
  if (!machines || typeof machines !== "object" || !Object.keys(machines).length || !Object.values(machines).every(checked => checked === true)) return null;
  const grid = snapshot.calendarWeek;
  if (!grid || !Array.isArray(grid.dates) || grid.dates.length !== 7
    || grid.dates.some((day, index) => day !== addDays(range.weekStart, index)) || !Array.isArray(grid.rows)
    || grid.rows.length !== Object.keys(machines).length || grid.rows.length > 20) return null;
  const from = Number(range.weekStart.slice(8, 10)), through = Number(addDays(range.weekStart, 6).slice(8, 10));
  if (!new RegExp(`\\b${from}\\s*[-–]\\s*${through}\\b[^,]{1,60},\\s*in\\s+Marrickville\\b`).test(compact(snapshot.text))) return null;
  const seen = new Set();
  for (const row of grid.rows) {
    if (!Object.hasOwn(machines, row.machineId) || seen.has(row.machineId) || row.cellCount !== 8
      || !Array.isArray(row.batchCounts) || row.batchCounts.length !== 7
      || row.batchCounts.some(count => !Number.isSafeInteger(count) || count < 0 || count > 10000)
      || !Array.isArray(row.emptyCells) || row.emptyCells.length !== 7 || row.emptyCells.some(empty => typeof empty !== "boolean")) return null;
    seen.add(row.machineId);
    const reported = compact(row.summary).match(/(?:^|\s)(\d[\d,]*)\s+Batch(?:es)?\b/i)?.[1];
    if (reported === undefined || number(reported) !== sum(row.batchCounts)
      || row.batchCounts.some((count, index) => count > 0 && row.emptyCells[index])) return null;
    if ([5, 6].some(index => row.batchCounts[index] !== 0 || row.emptyCells[index] !== true)) return null;
  }
  const prefix = `${from}-${through}`;
  const pending = parsePendingTables(snapshot, `${prefix} to roast`, `${prefix} total`, `${prefix} estimated output`);
  return { weekStart: range.weekStart, periodEnd: range.periodEnd, ...pending };
}

export function sameScheduleReads(first, second) {
  if (first.kind !== second.kind) return false;
  if (first.kind === "days") return sameSchedules(first.days, second.days);
  if (first.kind !== "week" || first.week.weekStart !== second.week.weekStart || first.week.periodEnd !== second.week.periodEnd) return false;
  return sameSchedules([{ ...first.week, day: first.week.weekStart }], [{ ...second.week, day: second.week.weekStart }]);
}

export function parseInventory(snapshots, asOf) {
  if (!Array.isArray(snapshots) || snapshots.length < 1 || snapshots.length > 20) throw new ReaderError("CROPSTER_PRICES_UNAVAILABLE");
  const positions = [];
  let covered = 0, expected = null;
  for (const snapshot of snapshots) {
    sourceUrl(snapshot, "/app/inventory/overview");
    const text = compact(snapshot.text);
    if (!Array.isArray(snapshot.activeFilters) || snapshot.activeFilters.length !== 1
      || compact(snapshot.activeFilters[0]).replace(/^Filters\s*:\s*/, "Filters: ").replace(/Reset filters$/i, "").trim() !== "Filters: Status Available") throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
    const coverage = text.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+items/i);
    if (!coverage || Number(coverage[1]) !== covered + 1) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
    // The UI reports its page window (e.g. 26-50 of 38); only 13 rows exist.
    const total = Number(coverage[3]), end = Math.min(Number(coverage[2]), total);
    if (expected !== null && total !== expected || end < covered + 1 || end > total) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
    expected = total;
    const headerTables = snapshot.tables.filter(table => ["id-tag", "name", "location", "weight (kg)", "price"].every(name => table.headers.some(value => header(value) === name)));
    if (!headerTables.length || headerTables.some(table => JSON.stringify(table.headers.map(header)) !== JSON.stringify(headerTables[0].headers.map(header)))) throw new ReaderError("CROPSTER_TABLE_UNRECOGNISED");
    const table = { ...headerTables[0], index: name => headerTables[0].headers.findIndex(value => header(value) === name) };
    const idIndex = table.index("id-tag"), nameIndex = table.index("name"), locationIndex = table.index("location"), priceIndex = table.index("price"), kgIndex = table.index("weight (kg)");
    // Cropster renders its fixed header and scrolling body as separate tables.
    const rows = snapshot.tables.flatMap(item => item.rows.map((cells, index) => ({ cells, links: item.rowLinks?.[index] || [] })))
      .filter(row => /^\[PG-\d+\]$/.test(trim(row.cells[idIndex])));
    if (rows.length !== end - covered) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
    for (const item of rows) {
      const row = item.cells;
      const id = trim(row[idIndex]).slice(1, -1);
      const priceText = trim(row[priceIndex]).match(new RegExp("^A\\$\\s*(" + numeric + ")\\s*\\/\\s*kg$"));
      const kg = kilograms(row[kgIndex]);
      const name = compact(row[nameIndex]), location = compact(row[locationIndex]);
      if (kg === null || !name || name.length > 160 || !location || location.length > 160) throw new ReaderError("CROPSTER_INVENTORY_UNAVAILABLE");
      const link = item.links.find(link => {
        try { const url = new URL(link.href); return url.origin === CROPSTER_ORIGIN && /^\/app\/inventory\/[A-Za-z0-9_-]+$/.test(url.pathname); }
        catch { return false; }
      });
      const positionId = link ? new URL(link.href).pathname.split("/").at(-1) : null;
      positions.push({ id, name, location, kg, price: priceText ? number(priceText[1]) : null, ...(positionId ? { positionId } : {}) });
    }
    covered = end;
  }
  if (covered !== expected) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  if (positions.length > 1200) throw new ReaderError("CROPSTER_INVENTORY_UNAVAILABLE");
  const seen = new Set();
  for (const row of positions) {
    const key = JSON.stringify([row.id, row.location]);
    if (seen.has(key)) throw new ReaderError("CROPSTER_INVENTORY_UNAVAILABLE");
    seen.add(key);
  }
  return {
    asOf, allLocationsComplete: true, totalKg: round(sum(positions.map(row => row.kg))),
    rows: positions.map(row => ({ name: row.name, location: row.location, lotId: row.id, kg: row.kg, pricePerKg: row.price, ...(row.positionId ? { positionId: row.positionId } : {}) })),
  };
}

export function inventoryPrices(inventory) {
  const positions = inventory.rows.map(row => ({ id: row.lotId, location: row.location, price: row.pricePerKg }));
  const byLot = new Map();
  for (const id of new Set(positions.map(row => row.id))) {
    const all = positions.filter(row => row.id === id), local = all.filter(row => row.location === "Marrickville");
    const eligible = local.length ? local : all;
    const prices = new Set(eligible.map(row => row.price));
    byLot.set(id, prices.size === 1 && !prices.has(null) ? [...prices][0] : null);
  }
  return byLot;
}

export function parseInventoryPrices(snapshots) {
  return inventoryPrices(parseInventory(snapshots, null));
}

export function parseMonthlyUse(snapshot, range) {
  productionScope(snapshot, range, "/apps/roast/production-report/inventory", true);
  const table = tableWith(snapshot, ["lot id-tag", "name", "amount of green"]);
  if (!completeTable(snapshot, table)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const totals = (table.footers || []).filter(row => row.some(value => header(value) === "total"));
  if (totals.length !== 1) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  const kg = kilograms(totals[0][table.index("amount of green")]);
  const rows = table.rows.map(row => {
    const lotId = trim(row[table.index("lot id-tag")]).match(/^\[?(PG-\d+)\]?$/)?.[1];
    const name = compact(row[table.index("name")]), kg = kilograms(row[table.index("amount of green")]);
    if (!lotId || !name || name.length > 160 || kg === null) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
    return { name, lotId, kg };
  });
  if (kg === null || !close(kg, sum(rows.map(row => row.kg))) || new Set(rows.map(row => row.lotId)).size !== rows.length) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  return { month: range.weekStart.slice(0, 7), complete: true, kg, rows };
}

export function parseLoss(snapshot, range) {
  productionScope(snapshot, range, "/apps/roast/production-report/profile-group", true);
  const table = tableWith(snapshot, ["component name", "amount roasted", "amount of green", "batches"]);
  if (!completeTable(snapshot, table)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const rows = table.rows.map(row => {
    const name = compact(row[table.index("component name")]), greenKg = kilograms(row[table.index("amount of green")]);
    const roastedKg = kilograms(row[table.index("amount roasted")]), batches = number(trim(row[table.index("batches")]));
    if (!name || name.length > 160 || !(greenKg > 0) || roastedKg === null || roastedKg > greenKg || !Number.isSafeInteger(batches)) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
    const index = table.rows.indexOf(row);
    const group = links({ links: table.rowLinks?.[index] || [] }, /^\/app\/roast\/profile-groups\/[A-Za-z0-9_-]+$/)[0];
    return { name, greenKg, roastedKg, batches, ...(group ? { profileGroupId: new URL(group.href, CROPSTER_ORIGIN).pathname.split("/").at(-1) } : {}) };
  });
  const totals = (table.footers || []).filter(row => row.some(value => header(value) === "total"));
  if (totals.length !== 1 || !close(kilograms(totals[0][table.index("amount of green")]), sum(rows.map(row => row.greenKg)))
    || !close(kilograms(totals[0][table.index("amount roasted")]), sum(rows.map(row => row.roastedKg)))) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  return { from: range.weekStart, asOf: range.periodEnd, rows };
}

export function aggregateSchedule(days, prices, range) {
  if (!Array.isArray(days) || days.length !== 5 || days.some((day, index) => day.day !== addDays(range.weekStart, index))) throw new ReaderError("CROPSTER_SCHEDULE_INCOMPLETE");
  return aggregatePendingRows(days, prices);
}

function aggregatePendingRows(days, prices) {
  let value = 0, completeCost = prices instanceof Map;
  for (const day of days) for (const [id, kg] of day.lotKg) {
    const price = prices?.get(id);
    if (price === null || price === undefined) completeCost = false;
    else value += kg * price;
  }
  const greenKg = sum(days.map(day => day.greenKg));
  return {
    scheduledKg: round(sum(days.map(day => day.roastedKg))),
    scheduledValue: greenKg === 0 ? 0 : completeCost ? round(value) : null,
  };
}

export function aggregateScheduleRead(reading, prices, range) {
  if (reading.kind === "days") return aggregateSchedule(reading.days, prices, range);
  if (reading.kind !== "week" || reading.week.weekStart !== range.weekStart || reading.week.periodEnd !== range.periodEnd) throw new ReaderError("CROPSTER_SCHEDULE_INCOMPLETE");
  return aggregatePendingRows([reading.week], prices);
}

export function parseMarrickvilleStock(snapshot, day) {
  sourceUrl(snapshot, "/apps/lots/inventory-report/location");
  const text = compact(snapshot.text);
  if (!text.includes("for " + dateLabel(day)) || !text.replace("Values refer to the inventory on ", "Values refer to inventory on ").includes("Values refer to inventory on " + dateLabel(day))) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const table = tableWith(snapshot, ["location", "weight", "total value"]);
  if (!completeTable(snapshot, table)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const rows = table.rows.filter(row => trim(row[table.index("location")]) === "Marrickville");
  if (rows.length !== 1) throw new ReaderError("CROPSTER_STOCK_UNAVAILABLE");
  const kg = kilograms(rows[0][table.index("weight")]), value = aud(rows[0][table.index("total value")]);
  if (kg === null) throw new ReaderError("CROPSTER_STOCK_UNAVAILABLE");
  return { location: "Marrickville", kg, value };
}

export function sameProduction(first, second) {
  return first.roastedKg === second.roastedKg && first.greenKg === second.greenKg && first.batches === second.batches;
}

export function previousProduction(outputSnapshot, costSnapshot, range) {
  const completed = parseRoastedOutput(outputSnapshot, range);
  const roastedValue = parseRoastedCost(costSnapshot, range, completed.greenKg);
  if (roastedValue === null) throw new ReaderError("PREVIOUS_PRODUCTION_UNAVAILABLE");
  // This is a closed Monday–Friday comparison, not a reading of a historical
  // outstanding schedule. Pending work is deliberately excluded from it.
  return {
    weekStart: range.weekStart, periodEnd: range.periodEnd,
    roastedKg: completed.roastedKg, roastedValue, scheduledKg: 0, scheduledValue: 0,
  };
}

function links(snapshot, pattern) {
  return (snapshot.links || []).filter(link => {
    try { const url = new URL(link.href, CROPSTER_ORIGIN); return url.origin === CROPSTER_ORIGIN && pattern.test(url.pathname); }
    catch { return false; }
  });
}

function detailName(snapshot) {
  const name = compact(snapshot.text).match(/\bDetails\s+(.+?)\s+Archive\b/)?.[1];
  if (!name || name.length > 160) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return name;
}

export function parseBlend(snapshot, id, signature) {
  sourceUrl(snapshot, "/app/roast/blend-profiles/" + id);
  const table = tableWith(snapshot, ["profile group", "% of blend"]);
  if (table.rows.length < 1 || table.rows.length > 20 || !compact(snapshot.text).includes("Blend components")) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const groups = links(snapshot, /^\/app\/roast\/profile-groups\/[A-Za-z0-9_-]+$/);
  const components = table.rows.map(row => {
    const name = compact(row[table.index("profile group")]);
    const percent = number(trim(row[table.index("% of blend")]).replace(/%$/, ""));
    const matching = groups.filter(link => compact(link.text) === name);
    const ids = new Set(matching.map(link => new URL(link.href, CROPSTER_ORIGIN).pathname.split("/").at(-1)));
    if (!name || name.length > 160 || !(percent > 0) || percent > 100 || ids.size !== 1) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    return { name, percent, profileGroupId: [...ids][0] };
  });
  if (new Set(components.map(component => component.profileGroupId)).size !== components.length || !close(sum(components.map(component => component.percent)), 100, 0.051)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return { name: detailName(snapshot), signature, components };
}

export function parseProfileGroup(snapshot, id) {
  sourceUrl(snapshot, "/app/roast/profile-groups/" + id);
  const text = compact(snapshot.text);
  if (!text.includes("Associated profiles") || !text.includes("Green inventory") || /Show more|Load more/i.test(text)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const found = links(snapshot, /^\/apps\/roast\/profiles\/[A-Za-z0-9_-]+$/);
  const profiles = [...new Set(found.map(link => new URL(link.href, CROPSTER_ORIGIN).href))];
  const defaultName = text.match(/Default profile\s+(.+?)\s+Minimum stock level/)?.[1];
  const defaults = new Set(found.filter(link => compact(link.text) === defaultName).map(link => new URL(link.href, CROPSTER_ORIGIN).href));
  if (!profiles.length || profiles.length > 40 || defaults.size !== 1) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return { id, name: detailName(snapshot), profileUrls: profiles, defaultProfileUrl: [...defaults][0] };
}

export function parseProfileInputs(snapshot) {
  let url;
  try { url = new URL(snapshot.url); } catch { throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE"); }
  if (url.origin !== CROPSTER_ORIGIN || !/^\/apps\/roast\/profiles\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const table = tableWith(snapshot, ["blend %", "lot", "green weight"]);
  if (!/^Components\s*\/\s*Green lots$/i.test(table.heading) || !table.rows.length || table.rows.length > 100) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const lotIds = [...new Set(table.rows.map((row, index) => {
    const id = compact(row[table.index("lot")]).match(/^\[(PG-\d+)\](?:\s|$)/)?.[1];
    const related = links({ links: table.rowLinks?.[index] || [] }, /^(?:\/apps\/lots|\/app\/inventory)\/[A-Za-z0-9_-]+$/);
    if (!id || !related.some(link => compact(link.text).startsWith("[" + id + "]"))) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    return id;
  }))];
  if (!lotIds.length || lotIds.length > 100) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return { lotIds };
}

export function sameSchedules(first, second) {
  if (first.length !== second.length) return false;
  return first.every((day, index) => {
    const other = second[index];
    return day.day === other.day && close(day.greenKg, other.greenKg, 0.00001) && close(day.roastedKg, other.roastedKg, 0.00001)
      && day.lotKg.size === other.lotKg.size && [...day.lotKg].every(([id, kg]) => close(kg, other.lotKg.get(id), 0.00001));
  });
}

export function assembleRecipes({ blends, groups, profileInputs, inventory, asOf, decafGroupId, ohGroupId, use }) {
  const groupById = new Map(groups.map(group => [group.id, group]));
  const lotNames = new Map();
  const alias = row => lotNames.set(JSON.stringify([row.lotId, row.name]), { lotId: row.lotId, name: row.name });
  for (const row of inventory.rows) alias(row);
  for (const month of use?.months || []) for (const row of month.rows) alias(row);
  const coffee = groupId => {
    const group = groupById.get(groupId), input = group && profileInputs.get(group.defaultProfileUrl);
    if (!input) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    const local = inventory.rows.filter(row => row.location === "Marrickville" && row.kg > 0 && input.lotIds.includes(row.lotId));
    const eligible = local.length ? local : inventory.rows.filter(row => row.kg > 0 && input.lotIds.includes(row.lotId));
    const names = new Set(eligible.map(row => row.name));
    return names.size === 1 ? [...names][0] : null;
  };
  const oh = groupById.get(ohGroupId);
  if (!oh || !groupById.has(decafGroupId)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const rows = [...blends.map(blend => ({ ...blend, components: blend.components.map(component => ({ ...component, coffee: coffee(component.profileGroupId) })) })),
    { name: oh.name, signature: "OH", components: [{ name: oh.name, percent: 100, profileGroupId: ohGroupId, coffee: coffee(ohGroupId) }] }];
  const runoutProfiles = groups.map(group => {
    const lotIds = [...new Set(group.profileUrls.flatMap(url => {
      const inputs = profileInputs.get(url);
      if (!inputs) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
      return inputs.lotIds;
    }))];
    if (lotIds.length > 1200) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    return { id: group.id, name: group.name, lotIds, linksComplete: true, note: "Current Cropster website profile inputs only. Planned contract replacements and historical assignments require their separately verified provenance." };
  });
  if (lotNames.size > 2400) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return { asOf, rows, runoutProfiles, runoutLotNames: [...lotNames.values()], decafProfileGroupId: decafGroupId };
}

export function blendLoss(loss, recipes) {
  const rows = loss.rows.map(({ profileGroupId, ...row }) => row);
  const byId = new Map(loss.rows.filter(row => row.profileGroupId).map(row => [row.profileGroupId, row]));
  const byName = new Map(loss.rows.map(row => [row.name, row]));
  for (const recipe of recipes.rows) {
    if (rows.some(row => row.name === recipe.name)) continue;
    const measurements = recipe.components.map(component => byId.get(component.profileGroupId) || byName.get(component.name)).filter(Boolean);
    const greenKg = sum(measurements.map(row => row.greenKg));
    if (greenKg > 0) rows.push({ name: recipe.name, greenKg, roastedKg: sum(measurements.map(row => row.roastedKg)), batches: sum(measurements.map(row => row.batches)) });
  }
  return { ...loss, rows };
}
