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
  if (remaining.components.size === 0) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
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
  if (!snapshot.scheduleMachines || !Object.keys(snapshot.scheduleMachines).length || !Object.values(snapshot.scheduleMachines).every(value => value === true)) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const sourceDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(day + "T12:00:00Z"));
  if (!compact(snapshot.text).includes(sourceDay + ", in Marrickville")
    && !compact(snapshot.text).includes(sourceDay + " , in Marrickville")) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const text = compact(snapshot.text);
  const empty = ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"].every(marker => text.includes(marker));
  if (empty && Array.isArray(snapshot.tables) && snapshot.tables.length === 0) {
    if (snapshot.calendarDay?.tiles?.length !== 0 || snapshot.calendarDay?.states?.length !== 0) throw new ReaderError("CROPSTER_BATCH_STATUS_UNVERIFIED");
    return { day, greenKg: 0, roastedKg: 0, lotKg: new Map(), pendingBatchCount: 0 };
  }
  const displayedDay = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}/${day.slice(0, 4)}`;
  const remainingHeader = `${displayedDay} to roast`, totalHeader = `${displayedDay} total`, outputHeader = `${displayedDay} estimated output`;
  const batches = batchRows(snapshot.calendarDay?.tiles, snapshot.calendarDay?.states);
  const pending = parsePendingTables(snapshot, remainingHeader, totalHeader, outputHeader, batches);
  return { day, ...pending };
}

function batchRows(tiles, states) {
  if (!Array.isArray(tiles) || !Array.isArray(states) || tiles.length !== states.length) throw new ReaderError("CROPSTER_BATCH_STATUS_UNVERIFIED");
  return tiles.map((tile, index) => {
    const status = states[index];
    if (!["unpublished", "scheduled", "synced", "roasted"].includes(status)) throw new ReaderError("CROPSTER_BATCH_STATUS_UNVERIFIED");
    const lines = trim(tile).split(/\n+/).map(compact).filter(Boolean);
    const weight = lines.shift()?.match(new RegExp("^(.+)\\s+(" + numeric + ")\\s*kg$"));
    const kg = weight ? number(weight[2]) : null;
    const ids = lines.map(line => line.match(/^\[(PG-\d+)\]\s+.+$/)?.[1]);
    if (!(kg > 0) || !ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
    return { kg, status, lotIds: ids, profileName: weight[1] };
  });
}

function parsePendingTables(snapshot, remainingHeader, totalHeader, outputHeader, batches) {
  const coffees = tableWith(snapshot, ["profile", "type", remainingHeader, totalHeader, outputHeader]);
  const lots = tableWith(snapshot, ["lot", remainingHeader, totalHeader]);
  if (!completeTable(snapshot, coffees) || !completeTable(snapshot, lots)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  let greenKg = 0, roastedKg = 0;
  const componentKg = new Map();
  for (const row of coffees.rows) {
    const remainingCell = trim(row[coffees.index(remainingHeader)]);
    if (!remainingCell) continue; // Cropster's blank To-roast cell means that schedule is fully completed.
    const remaining = quantityBreakdown(remainingCell);
    if (remaining.total === 0) continue;
    const total = quantityBreakdown(row[coffees.index(totalHeader)]);
    const estimated = quantityBreakdown(row[coffees.index(outputHeader)]);
    if (/post-roast blend/i.test(trim(row[coffees.index("type")]))) for (const [name, kg] of remaining.components) componentKg.set(name, (componentKg.get(name) || 0) + kg);
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
  const batchGreenKg = sum(batches.filter(row => row.status !== "roasted").map(row => row.kg));
  const totalGreenKg = sum(batches.map(row => row.kg));
  const summaryTotal = coffees.rows.map(row => kilograms(row[coffees.index(totalHeader)]));
  // A repeating schedule's coffee-level Total # of batches is a lifetime
  // count. The profile summary is scoped by the same dated period headers.
  const profiles = tableWith(snapshot, ["profile", "# of batches", remainingHeader, totalHeader]);
  if (!completeTable(snapshot, profiles)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const profileTotal = profiles.rows.map(row => kilograms(row[profiles.index(totalHeader)]));
  const summaryCounts = profiles.rows.map(row => {
    const counts = trim(row[profiles.index("# of batches")]).split(/\n+/).map(line => compact(line).match(new RegExp("^(\\d+)\\s*x\\s*" + numeric + "\\s*kg$"))?.[1]);
    return counts.some(count => count === undefined) ? null : sum(counts.map(Number));
  });
  if (summaryCounts.some(count => !Number.isSafeInteger(count)) || sum(summaryCounts) !== batches.length
    || profileTotal.some(kg => kg === null) || !close(sum(profileTotal), totalGreenKg)
    || summaryTotal.some(kg => kg === null) || !close(sum(summaryTotal), totalGreenKg) || !close(greenKg, batchGreenKg)) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  const pending = batches.filter(row => row.status !== "roasted"), known = new Map();
  for (const [name, kg] of componentKg) if (!close(kg, sum(pending.filter(row => row.profileName === name).map(row => row.kg)))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  for (const row of pending) if (row.lotIds.length === 1) known.set(row.lotIds[0], (known.get(row.lotIds[0]) || 0) + row.kg);
  const multi = pending.filter(row => row.lotIds.length > 1);
  for (const [id, kg] of known) if (!lotKg.has(id) || kg > lotKg.get(id) + 0.06) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  for (const [id, kg] of lotKg) if (kg - (known.get(id) || 0) > 0.06 && !multi.some(row => row.lotIds.includes(id))) throw new ReaderError("CROPSTER_SCHEDULE_AMBIGUOUS");
  return { greenKg: batchGreenKg, roastedKg, lotKg, pendingBatchCount: pending.length };
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
  const batches = grid.rows.flatMap(machine => {
    if (!Array.isArray(machine.tiles) || !Array.isArray(machine.states) || machine.tiles.length !== 7 || machine.states.length !== 7) throw new ReaderError("CROPSTER_BATCH_STATUS_UNVERIFIED");
    return machine.tiles.flatMap((tiles, day) => {
      if (tiles.length !== machine.batchCounts[day]) throw new ReaderError("CROPSTER_BATCH_STATUS_UNVERIFIED");
      return batchRows(tiles, machine.states[day]);
    });
  });
  const pending = parsePendingTables(snapshot, `${prefix} to roast`, `${prefix} total`, `${prefix} estimated output`, batches);
  let profileAssignments = null;
  try { profileAssignments = parseCalendarAssignments(snapshot, range, prefix); }
  catch (error) { if (!(error instanceof ReaderError)) throw error; }
  return { weekStart: range.weekStart, periodEnd: range.periodEnd, ...pending, profileAssignments };
}

function parseCalendarAssignments(snapshot, range, prefix) {
  const summary = tableWith(snapshot, ["profile", "# of batches", `${prefix} used`, `${prefix} total`]);
  const lots = tableWith(snapshot, ["lot", `${prefix} total`]);
  if (!completeTable(snapshot, summary) || !completeTable(snapshot, lots)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const label = value => compact(value).replace(/\s+\(\d+(?:\.\d+)?\)(?:\s*-\s*[^()]+)?$/, "");
  const profiles = new Map();
  for (let index = 0; index < summary.rows.length; index++) {
    const row = summary.rows[index], name = label(row[summary.index("profile")]);
    const found = links({ links: summary.rowLinks?.[index] || [] }, /^\/apps\/roast\/profiles\/[A-Za-z0-9_-]+$/);
    const urls = new Set(found.filter(link => compact(link.text) === compact(row[summary.index("profile")])).map(link => new URL(link.href, CROPSTER_ORIGIN).href));
    const kg = kilograms(row[summary.index(`${prefix} total`)]);
    const batches = trim(row[summary.index("# of batches")]).split(/\n+/).map(line => compact(line).match(new RegExp("^(\\d+)\\s*x\\s*" + numeric + "\\s*kg$"))?.[1]);
    if (!name || profiles.has(name) || urls.size !== 1 || kg === null || batches.some(count => count === undefined)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    profiles.set(name, { profileUrl: [...urls][0], kg, batchCount: sum(batches.map(Number)), observedKg: 0, observedCount: 0 });
  }
  const rows = [], knownLotKg = new Map(), multi = [], observedLots = new Set();
  for (const machine of snapshot.calendarWeek.rows) {
    if (!Array.isArray(machine.tiles) || machine.tiles.length !== 7) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    for (let day = 0; day < 7; day++) {
      const tiles = machine.tiles[day];
      if (!Array.isArray(tiles) || tiles.length !== machine.batchCounts[day]) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
      for (const [tileIndex, tile] of tiles.entries()) {
        if (day > 4 || typeof tile !== "string" || tile.length > 3000) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
        const lines = trim(tile).split(/\n+/).map(compact).filter(Boolean);
        const first = lines.shift()?.match(new RegExp("^(.+)\\s+(" + numeric + ")\\s*kg$"));
        const profileName = first?.[1], greenKg = first ? number(first[2]) : null, profile = profiles.get(profileName);
        if (!profile || !(greenKg > 0) || !lines.length || lines.length > 20) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
        const lotNames = lines.map(line => {
          const match = line.match(/^\[(PG-\d+)\]\s+(.+)$/);
          if (!match || match[2].length > 160) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
          return { lotId: match[1], name: match[2] };
        });
        const lotIds = lotNames.map(lot => lot.lotId);
        if (new Set(lotIds).size !== lotIds.length) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
        lotIds.forEach(id => observedLots.add(id));
        profile.observedKg += greenKg;
        profile.observedCount++;
        const row = { date: addDays(range.weekStart, day), machineId: machine.machineId, profileName, profileUrl: profile.profileUrl, greenKg, lotIds, lotNames, status: machine.states[day][tileIndex] };
        rows.push(row);
        if (lotIds.length === 1) knownLotKg.set(lotIds[0], (knownLotKg.get(lotIds[0]) || 0) + greenKg);
        else multi.push(row);
      }
    }
  }
  if (!rows.length || [...profiles.values()].some(profile => !close(profile.kg, profile.observedKg) || profile.batchCount !== profile.observedCount)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const reportedLots = new Map();
  for (const row of lots.rows) {
    const id = trim(row[lots.index("lot")]).match(/^\[(PG-\d+)\](?:\s|$)/)?.[1], kg = kilograms(row[lots.index(`${prefix} total`)]);
    if (!id || kg === null || reportedLots.has(id)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    reportedLots.set(id, kg);
  }
  if (reportedLots.size !== observedLots.size || [...observedLots].some(id => !reportedLots.has(id))
    || !close(sum(rows.map(row => row.greenKg)), sum([...reportedLots.values()]))) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  let residualKg = 0;
  for (const [id, kg] of reportedLots) {
    const residual = kg - (knownLotKg.get(id) || 0);
    if (residual < -0.06 || residual > 0.06 && !multi.some(row => row.lotIds.includes(id))) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    residualKg += residual;
  }
  if (!close(residualKg, sum(multi.map(row => row.greenKg)))) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  return { complete: true, weekStart: range.weekStart, periodEnd: range.periodEnd, rows };
}

export function sameScheduleReads(first, second) {
  if (first.kind !== second.kind) return false;
  if (first.kind === "days") return sameSchedules(first.days, second.days);
  if (first.kind !== "week" || first.week.weekStart !== second.week.weekStart || first.week.periodEnd !== second.week.periodEnd) return false;
  const assigned = week => week.profileAssignments?.complete ? JSON.stringify(week.profileAssignments.rows.map(row => [row.date, row.machineId, row.profileUrl, row.greenKg, [...row.lotIds].sort(), row.status]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) : null;
  return sameSchedules([{ ...first.week, day: first.week.weekStart }], [{ ...second.week, day: second.week.weekStart }]) && assigned(first.week) === assigned(second.week);
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

export function parseLegacyInventory(snapshot, asOf) {
  sourceUrl(snapshot, "/apps/lots/inventory-report");
  const text = compact(snapshot.text), date = dateLabel(asOf);
  if (!text.includes("for " + date) || !text.replaceAll("Values refer to the inventory on ", "Values refer to inventory on ").includes("Values refer to inventory on " + date)) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const scope = snapshot.legacyInventoryScope;
  const snapshotButton = scope?.snapshotButtons?.filter(button => compact(button.text) === "Snapshot Report");
  const timeframeButton = scope?.snapshotButtons?.filter(button => compact(button.text) === "Timeframe Report");
  if (!scope || scope.locationControls?.length !== 1 || !Array.isArray(scope.locationControls[0].selected) || scope.locationControls[0].selected.length !== 0 || compact(scope.locationControls[0].text)
    || scope.consumedControls?.length !== 1 || scope.consumedControls[0].checked !== false || scope.checkedRows !== 0
    || !Array.isArray(scope.nonCheckboxInputs) || scope.nonCheckboxInputs.length > 10 || scope.nonCheckboxInputs.some(input => input.type !== "text" || trim(input.value))
    || snapshotButton?.length !== 1 || timeframeButton?.length !== 1 || !/\bactive\b/.test(snapshotButton[0].class || "") || /\bactive\b/.test(timeframeButton[0].class || "")) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
  const table = tableWith(snapshot, ["lot id-tag", "name", "weight (kg)", "total value", "location", "price"]);
  if (!completeTable(snapshot, table) || table.rows.length === 0) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const seen = new Set(), positions = new Set(), values = [];
  const rows = table.rows.map((row, index) => {
    const lotId = trim(row[table.index("lot id-tag")]);
    const name = compact(row[table.index("name")]), location = compact(row[table.index("location")]);
    const kg = kilograms(row[table.index("weight (kg)")]), value = aud(row[table.index("total value")]);
    const priceText = compact(row[table.index("price")]).match(new RegExp("^(" + numeric + ")\\s*\\$\\s*/\\s*kg$"));
    const pricePerKg = priceText ? number(priceText[1]) : null;
    const links = (table.rowLinks?.[index] || []).filter(link => {
      try { const url = new URL(link.href, CROPSTER_ORIGIN); return url.origin === CROPSTER_ORIGIN && /^\/apps\/lots\/inventory\/[A-Za-z0-9_-]+$/.test(url.pathname) && compact(link.text) === lotId; }
      catch { return false; }
    });
    if (!/^PG-\d+$/.test(lotId) || !name || name.length > 160 || !location || location.length > 160 || kg === null || value === null || pricePerKg === null
      || !close(kg * pricePerKg, value, 0.011) || links.length !== 1) throw new ReaderError("CROPSTER_INVENTORY_UNAVAILABLE");
    const key = JSON.stringify([lotId, location]), positionId = new URL(links[0].href, CROPSTER_ORIGIN).pathname.split("/").at(-1);
    if (seen.has(key) || positions.has(positionId)) throw new ReaderError("CROPSTER_INVENTORY_UNAVAILABLE");
    seen.add(key); positions.add(positionId); values.push(value);
    return { name, location, lotId, kg, pricePerKg, positionId };
  });
  const totals = (table.footers || []).filter(row => /^Total - page:\s*\d+$/.test(compact(row[table.index("lot id-tag")])));
  if (totals.length !== 1) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  const total = totals[0], totalKg = sum(rows.map(row => row.kg)), totalValue = sum(values), locations = new Set(rows.map(row => row.location)).size;
  const footerCount = Number(compact(total[table.index("lot id-tag")]).match(/\d+$/)?.[0]);
  const locationCount = compact(total[table.index("location")]).match(/^Count:\s*(\d+)$/)?.[1];
  const overview = text.split("Green Inventory Overview")[1]?.split("By lot")[0] || "";
  const overviewTotals = overview.match(new RegExp("(" + numeric + ")\\s+kg\\s+(" + numeric + ")\\s+AUD\\s+(\\d+)\\s+Locations\\s+(\\d+)\\s+# of lots"));
  if (footerCount !== rows.length || Number(locationCount) !== locations || !close(kilograms(total[table.index("weight (kg)")]), totalKg, 0.011)
    || !close(aud(total[table.index("total value")]), totalValue, 0.011) || !overviewTotals
    || Number(overviewTotals[3]) !== locations || Number(overviewTotals[4]) !== rows.length
    || !close(number(overviewTotals[1]), totalKg, 0.51) || !close(number(overviewTotals[2]), totalValue, 0.51)) throw new ReaderError("CROPSTER_TOTAL_UNAVAILABLE");
  return { asOf, allLocationsComplete: true, totalKg: round(totalKg), rows };
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
  const green = parseGroupGreenInventory(snapshot);
  return { id, name: detailName(snapshot), profileUrls: profiles, defaultProfileUrl: [...defaults][0], lotIds: green.lotIds, lotNames: green.lotNames };
}

function parseGroupGreenInventory(snapshot) {
  // The current profile-group UI renders this as a widget rather than an HTML
  // table. Its bounded section includes zero-stock alternatives and terminates
  // at the explicit View-green-lots link; template inputs are a separate source.
  const sections = [...trim(snapshot.text).matchAll(/Green inventory\s*([\s\S]*?)View green lots/g)];
  if (sections.length !== 1) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const section = sections[0][1], text = compact(section);
  const totalText = text.match(new RegExp("^(" + numeric + ")\\s*kg(?:\\s|$)"))?.[1];
  const totalKg = totalText === undefined ? null : number(totalText);
  const related = links(snapshot, /^\/apps\/lots\/[A-Za-z0-9_-]+$/);
  const rows = [...section.matchAll(/\[(PG-\d+)\]([^[]*)/g)].map(match => {
    const lotId = match[1], tail = match[2];
    const name = trim(tail.split(/[\t\n]/)[0]);
    const weights = [...tail.matchAll(new RegExp("(" + numeric + ")\\s*kg\\b", "g"))];
    const kg = weights.length === 1 ? number(weights[0][1]) : null;
    if (!name || name.length > 160 || kg === null || !related.some(link => compact(link.text) === "[" + lotId + "]")) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    return { lotId, name, kg };
  });
  if (totalKg === null || !rows.length || rows.length > 1200 || !close(totalKg, sum(rows.map(row => row.kg)))
    || /Show more|Load more|\bNext\b|\bPrevious\b|\bPage\s+\d/i.test(text)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const pagers = [...text.matchAll(/Show\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/gi)];
  if (pagers.some(pager => Number(pager[1]) !== 1 || Number(pager[2]) !== rows.length || Number(pager[3]) !== rows.length)) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const groupTables = (snapshot.tables || []).filter(table => /^Green inventory$/i.test(trim(table.heading)));
  const rowIds = new Set(rows.map(row => row.lotId));
  if (groupTables.some(table => {
    const tableIds = new Set(table.rows.flatMap(row => row.flatMap(cell => [...trim(cell).matchAll(/\[(PG-\d+)\]/g)].map(match => match[1]))));
    return !completeTable(snapshot, table) || table.rows.length !== rows.length || tableIds.size !== rowIds.size || [...rowIds].some(id => !tableIds.has(id));
  })) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
  const names = new Map();
  for (const row of rows) {
    if (names.has(row.lotId) && names.get(row.lotId) !== row.name) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    names.set(row.lotId, row.name);
  }
  return { lotIds: [...names.keys()], lotNames: [...names].map(([lotId, name]) => ({ lotId, name })) };
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
    return day.day === other.day && day.pendingBatchCount === other.pendingBatchCount && close(day.greenKg, other.greenKg, 0.00001) && close(day.roastedKg, other.roastedKg, 0.00001)
      && day.lotKg.size === other.lotKg.size && [...day.lotKg].every(([id, kg]) => close(kg, other.lotKg.get(id), 0.00001));
  });
}

export function assembleRecipes({ blends, groups, profileInputs, inventory, asOf, decafGroupId, ohGroupId, use, scheduleAssignments }) {
  const groupById = new Map(groups.map(group => [group.id, group]));
  const lotNames = new Map();
  const alias = row => lotNames.set(JSON.stringify([row.lotId, row.name]), { lotId: row.lotId, name: row.name });
  for (const row of inventory.rows) alias(row);
  for (const group of groups) for (const row of group.lotNames || []) alias(row);
  const assignments = scheduleAssignments?.complete === true ? scheduleAssignments.rows : null;
  for (const row of assignments || []) for (const lot of row.lotNames) alias(lot);
  for (const month of use?.months || []) for (const row of month.rows) alias(row);
  const prices = inventoryPrices(inventory);
  const currentCoffee = groupId => {
    const group = groupById.get(groupId), input = group && profileInputs.get(group.defaultProfileUrl);
    if (!input) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    const observed = assignments?.filter(row => group.profileUrls.includes(row.profileUrl));
    const latestDate = observed?.length ? observed.map(row => row.date).sort().at(-1) : null;
    const latest = latestDate ? observed.filter(row => row.date === latestDate) : [];
    const lotIds = [...new Set(latest.length ? latest.flatMap(row => row.lotIds) : assignments ? input.lotIds : [])].sort();
    const profileUrls = new Set(latest.map(row => row.profileUrl));
    const profileUrl = latest.length ? profileUrls.size === 1 ? [...profileUrls][0] : null : assignments ? group.defaultProfileUrl : null;
    const basis = latest.length ? "current-week-schedule" : "default-profile";
    const unknown = { coffee: null, currentPricePerKg: null, pricingBasis: "unverified", pricingDate: latestDate || (assignments ? asOf : null), pricingLotIds: lotIds, pricingProfileUrl: profileUrl };
    if (!assignments || lotIds.length !== 1 || !profileUrl || latest.some(row => row.lotIds.length !== 1)) return unknown;
    const local = inventory.rows.filter(row => row.location === "Marrickville" && row.kg > 0 && row.lotId === lotIds[0]);
    const eligible = local.length ? local : inventory.rows.filter(row => row.kg > 0 && row.lotId === lotIds[0]);
    const names = new Set(eligible.map(row => row.name)), price = prices.get(lotIds[0]);
    const assignedNames = new Set(latest.flatMap(row => row.lotNames.map(lot => lot.name)));
    if (names.size !== 1 || price == null || assignedNames.size > 1 || assignedNames.size === 1 && !assignedNames.has([...names][0])) return unknown;
    return { ...unknown, coffee: [...names][0], currentPricePerKg: price, pricingBasis: basis };
  };
  const oh = groupById.get(ohGroupId);
  if (!oh || !groupById.has(decafGroupId)) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
  const rows = [...blends.map(blend => ({ ...blend, components: blend.components.map(component => ({ ...component, ...currentCoffee(component.profileGroupId) })) })),
    { name: oh.name, signature: "OH", components: [{ name: oh.name, percent: 100, profileGroupId: ohGroupId, ...currentCoffee(ohGroupId) }] }];
  const runoutProfiles = groups.map(group => {
    if (!Array.isArray(group.lotIds) || !group.lotIds.length) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    const actualLotIds = (assignments || []).filter(row => group.profileUrls.includes(row.profileUrl)).flatMap(row => row.lotIds);
    const lotIds = [...new Set([...group.lotIds, ...actualLotIds, ...group.profileUrls.flatMap(url => {
      const inputs = profileInputs.get(url);
      if (!inputs) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
      return inputs.lotIds;
    })])];
    if (lotIds.length > 1200) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
    return { id: group.id, name: group.name, lotIds, linksComplete: true, note: "Current Cropster website profile-group green inventory, verified current-week calendar assignments and template inputs only. Planned contract replacements and historical assignments require their separately verified provenance." };
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
