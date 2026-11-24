import assert from "node:assert/strict";
import test from "node:test";
import { addDays, weekRange } from "../src/dates.mjs";
import {
  aggregateSchedule, aud, kilograms, parseInventoryPrices, parseMarrickvilleStock,
  parseRoastedCost, parseRoastedOutput, parseScheduleDay, sameProduction, sameSchedules, previousProduction,
} from "../src/parse.mjs";

const range = weekRange("2026-02-02", new Date("2026-02-05T00:00:00Z"));
const table = (headers, rows, footers = []) => ({ headers, rows, footers, pagination: rows.length ? `Show 1 - ${rows.length} of ${rows.length}` : "Show 0 - 0 of 0" });
const periodText = "Production report from February 2, 2026 to February 6, 2026 Marrickville";
const report = (kind, tables) => ({
  url: `https://c-sar.cropster.com/apps/roast/production-report/${kind}?dateFrom=2026-02-02&dateTo=2026-02-06&locations=lK0G1`,
  text: periodText, tables,
});
const output = () => report("profile-group", [table(
  ["", "Component Name", "Amount roasted", "Batches", "Amount of green"],
  [["", "Example A", "16.75 kg", "1", "20 kg"], ["", "Example B", "8.125 kg", "1", "10 kg"]],
  [["", "Total", "24.875 kg", "2", "30 kg"]],
)]);
const cost = () => report("inventory", [table(
  ["", "Lot ID-Tag", "Name", "Amount of green", "Total price*"],
  [["", "PG-0901", "Example A", "20 kg", "$ 200.00 AUD"], ["", "PG-0902", "Example B", "10 kg", "$ 150.00 AUD"]],
  [["", "Total", "", "30 kg", "$ 350.00 AUD"]],
)]);

function schedule(day, { pending = "20 kg", total = "40 kg", estimated = "34 kg", type = "Single origin", lotRows } = {}) {
  const date = `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
  const toRoast = date + " To roast", totalHeader = date + " Total";
  const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(day + "T12:00:00Z"));
  const lots = lotRows || [["[PG-0901] Example A", pending ? pending.split("\n")[0] : "", "40 kg"]];
  const calendarDay = { tiles: [], states: [] };
  lots.forEach((row, index) => {
    const left = kilograms(row[1]) ?? 0, whole = kilograms(row[2]) ?? 0;
    const profile = total.split("\n")[index + 1]?.split(":")[0] || "Example";
    for (const [kg, state] of [[left, "synced"], [whole - left, "roasted"]]) if (kg > 0) {
      calendarDay.tiles.push(`${profile} ${kg} kg\n${row[0]}`); calendarDay.states.push(state);
    }
  });
  return {
    url: "https://c-sar.cropster.com/apps/roast/schedule/calendar/day?date=" + day,
    text: `${dayLabel}, in Marrickville Scheduled coffees Summary per green lot`,
    scheduleStatuses: { unpublished: true, scheduled: true, synced: true, roasted: true, inconsistent: true },
    scheduleMachines: { M1: true }, calendarDay,
    tables: [
      table(["", "Profile", "Type", toRoast, totalHeader, date + " Estimated output", "Total # of batches", "Total scheduled"], [["", "Example", type, pending, total, estimated, String(calendarDay.tiles.length), "1,000 kg"]]),
      table(["Lot", toRoast, totalHeader], lots),
      table(["Profile", "# of batches", toRoast, date + " Used", totalHeader], lots.map((row, index) => {
        const profile = total.split("\n")[index + 1]?.split(":")[0] || "Example";
        const relevant = calendarDay.tiles.map((tile, tileIndex) => ({ tile, state: calendarDay.states[tileIndex] })).filter(item => item.tile.split("\n")[1] === row[0]);
        const counts = relevant.map(item => "1 x " + item.tile.split("\n")[0].match(/([\d.]+ kg)$/)[1]).join("\n");
        const whole = kilograms(row[2]), left = kilograms(row[1]) ?? 0;
        return [profile, counts, row[1], `${whole - left} kg`, row[2]];
      })),
    ],
  };
}

test("explicit kg and AUD parsers reject units, negative and missing values rather than defaulting to zero", () => {
  assert.equal(kilograms("1,234.567 kg"), 1234.567);
  assert.equal(kilograms("0 kg"), 0);
  assert.equal(kilograms("10 lb"), null);
  assert.equal(kilograms("-3 kg"), null);
  assert.equal(kilograms(""), null);
  assert.equal(aud("$ 1,234.56 AUD"), 1234.56);
  assert.equal(aud("A$0"), 0);
  assert.equal(aud("$ 25 USD"), null);
  assert.equal(aud("$ 25"), null);
});

test("completed production uses the scoped full table footer and reconciles its rows", () => {
  assert.deepEqual(parseRoastedOutput(output(), range), { roastedKg: 24.875, greenKg: 30, batches: 2 });
  const wrongWeek = output(); wrongWeek.url = wrongWeek.url.replace("dateTo=2026-02-06", "dateTo=2026-02-07");
  assert.throws(() => parseRoastedOutput(wrongWeek, range), /CROPSTER_SCOPE_UNVERIFIED/);
  const mixedLocations = output(); mixedLocations.url += ",other";
  assert.throws(() => parseRoastedOutput(mixedLocations, range), /CROPSTER_SCOPE_UNVERIFIED/);
  const wrongTotal = output(); wrongTotal.tables[0].footers[0][2] = "25 kg";
  assert.throws(() => parseRoastedOutput(wrongTotal, range), /CROPSTER_TOTAL_UNAVAILABLE/);
});

test("each table needs its own complete pager, even if a different table has a matching count", () => {
  const snapshot = output();
  snapshot.text += " Show 1 - 2 of 2";
  snapshot.tables[0].pagination = "Show 1 - 2 of 20";
  assert.throws(() => parseRoastedOutput(snapshot, range), /CROPSTER_TABLE_INCOMPLETE/);
});

test("production cost must match the exact completed green weight and leaves missing prices unknown", () => {
  assert.equal(parseRoastedCost(cost(), range, 30), 350);
  assert.throws(() => parseRoastedCost(cost(), range, 31), /CROPSTER_CHANGED_DURING_READ/);
  const missing = cost(); missing.tables[0].rows[0][4] = "";
  assert.equal(parseRoastedCost(missing, range, 30), null);
});

test("previous-week comparison requires matching dated output and cost and excludes any historical schedule", () => {
  assert.deepEqual(previousProduction(output(), cost(), range), {
    weekStart: range.weekStart, periodEnd: range.periodEnd, roastedKg: 24.875, roastedValue: 350,
    scheduledKg: 0, scheduledValue: 0,
  });
  const unavailable = cost(); unavailable.tables[0].rows[0][4] = "";
  assert.throws(() => previousProduction(output(), unavailable, range), /PREVIOUS_PRODUCTION_UNAVAILABLE/);
  const wrongRange = { ...range, weekStart: "2026-01-26", periodEnd: "2026-01-30" };
  assert.throws(() => previousProduction(output(), cost(), wrongRange), /CROPSTER_SCOPE_UNVERIFIED/);
});

test("daily scheduled output scales the current total to remaining green input and ignores all-time scheduled", () => {
  const day = parseScheduleDay(schedule("2026-02-06"), "2026-02-06", range);
  assert.equal(day.greenKg, 20);
  assert.equal(day.roastedKg, 17);
  assert.deepEqual([...day.lotKg], [["PG-0901", 20]]);
});

test("an empty schedule definition cannot invalidate reconciled batch, profile and lot totals", () => {
  const source = schedule("2026-02-06");
  const coffee = source.tables[0];
  const empty = coffee.headers.map(header => header === "Profile" ? "Empty seasonal schedule" :
    header === "Type" ? "Pre-roast blend" : "");
  coffee.rows.push(empty);
  coffee.pagination = "Show 1 - 2 of 2";
  const parsed = parseScheduleDay(source, "2026-02-06", range);
  assert.equal(parsed.greenKg,20);
  assert.equal(parsed.pendingBatchCount,1);
  for (const label of ["Estimated output","To roast"]) {
    const column=coffee.headers.findIndex(header=>header.toLowerCase().endsWith(label.toLowerCase()));
    assert.ok(column>=0);
    empty[column] = "3 kg";
    assert.throws(() => parseScheduleDay(source,"2026-02-06",range),/CROPSTER_SCHEDULE_AMBIGUOUS/);
    empty[column] = "";
  }
});

test("partly completed post-roast blends apply each component's own output ratio", () => {
  const snapshot = schedule("2026-02-06", {
    pending: "30 kg\nComponent A: 10 kg\nComponent B: 20 kg",
    total: "60 kg\nComponent A: 20 kg\nComponent B: 40 kg",
    estimated: "49 kg\nComponent A: 17 kg\nComponent B: 32 kg",
    type: "Post-roast blend",
    lotRows: [["[PG-0901] Example A", "10 kg", "20 kg"], ["[PG-0902] Example B", "20 kg", "40 kg"]],
  });
  assert.equal(parseScheduleDay(snapshot, "2026-02-06", range).roastedKg, 24.5);
  snapshot.tables[0].rows[0][3] = "10 kg\nComponent A: 10 kg";
  snapshot.tables[1].rows[1][1] = "";
  snapshot.tables[2].rows[1][2] = "";
  snapshot.tables[2].rows[1][3] = "40 kg";
  snapshot.calendarDay.states = snapshot.calendarDay.tiles.map((text, index) => text.includes("PG-0902") ? "roasted" : snapshot.calendarDay.states[index]);
  assert.equal(parseScheduleDay(snapshot, "2026-02-06", range).roastedKg, 8.5);
});

test("ambiguous schedule components, missing output and unmatched lot inputs fail closed", () => {
  const missing = schedule("2026-02-06", { estimated: "" });
  const verified = parseScheduleDay(missing, "2026-02-06", range);
  assert.equal(verified.greenKg, 20);
  assert.equal(verified.roastedKg, null);
  const mismatch = schedule("2026-02-06", { lotRows: [["[PG-0901] Example", "19 kg", "40 kg"]] });
  assert.throws(() => parseScheduleDay(mismatch, "2026-02-06", range), /CROPSTER_SCHEDULE_AMBIGUOUS/);
  const post = schedule("2026-02-06", { type: "Post-roast blend" });
  assert.throws(() => parseScheduleDay(post, "2026-02-06", range), /CROPSTER_SCHEDULE_AMBIGUOUS/);
  const filtered = schedule("2026-02-06"); filtered.scheduleStatuses.synced = false;
  assert.throws(() => parseScheduleDay(filtered, "2026-02-06", range), /CROPSTER_SCOPE_UNVERIFIED/);
});

test("a positive remaining blend with missing component detail cannot silently become zero output", () => {
  const snapshot = schedule("2026-02-06", {
    pending: "20 kg", total: "40 kg\nComponent A: 20 kg\nComponent B: 20 kg",
    estimated: "33 kg\nComponent A: 17 kg\nComponent B: 16 kg", type: "Post-roast blend",
    lotRows: [["[PG-0901] Example A", "5 kg", "20 kg"], ["[PG-0902] Example B", "15 kg", "20 kg"]],
  });
  assert.throws(() => parseScheduleDay(snapshot, "2026-02-06", range), /CROPSTER_SCHEDULE_AMBIGUOUS/);
});

test("five complete weekdays include Friday, exclude Saturday, and preserve a real zero", () => {
  const days = Array.from({ length: 5 }, (_, index) => {
    const day = addDays(range.weekStart, index);
    return parseScheduleDay(schedule(day, index === 4 ? {} : { pending: "" }), day, range);
  });
  assert.deepEqual(aggregateSchedule(days, new Map([["PG-0901", 11]]), range), { scheduledKg: 17, scheduledValue: 220 });
  assert.equal(aggregateSchedule(days, null, range).scheduledValue, null);
  assert.throws(() => parseScheduleDay(schedule("2026-02-07"), "2026-02-07", range), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => aggregateSchedule(days.slice(0, 4), new Map(), range), /CROPSTER_SCHEDULE_INCOMPLETE/);
  const zero = days.map(day => ({ ...day, greenKg: 0, roastedKg: 0, lotKg: new Map() }));
  assert.deepEqual(aggregateSchedule(zero, null, range), { scheduledKg: 0, scheduledValue: 0 });
});

test("the explicit empty-schedule layout is zero only after verifying date, location and every status filter", () => {
  const empty = schedule("2026-02-05");
  empty.tables = [];
  empty.calendarDay = { tiles: [], states: [] };
  empty.text = "5 February 2026, in Marrickville Scheduled coffees No coffees scheduled Summary per profile No profiles scheduled Summary per green lot No green lots scheduled";
  assert.deepEqual(parseScheduleDay(empty, "2026-02-05", range), { day: "2026-02-05", greenKg: 0, roastedKg: 0, lotKg: new Map(), pendingBatchCount: 0 });
  for (const marker of ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"]) {
    assert.throws(() => parseScheduleDay({ ...empty, text: empty.text.replace(marker, "") }, "2026-02-05", range), /CROPSTER_TABLE_UNRECOGNISED/);
  }
  assert.throws(() => parseScheduleDay({ ...empty, text: empty.text.replace("Marrickville", "Other warehouse") }, "2026-02-05", range), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => parseScheduleDay({ ...empty, text: empty.text.replace("5 February", "4 February") }, "2026-02-05", range), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => parseScheduleDay({ ...empty, scheduleStatuses: { ...empty.scheduleStatuses, synced: false } }, "2026-02-05", range), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => parseScheduleDay({ ...empty, scheduleStatuses: undefined }, "2026-02-05", range), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => parseScheduleDay({ ...empty, tables: [{ headers: [], rows: [] }] }, "2026-02-05", range), /CROPSTER_TABLE_UNRECOGNISED/);
});

function inventoryPage(start, end, total, rows) {
  return {
    url: "https://c-sar.cropster.com/app/inventory/overview",
    text: `${start}-${end} of ${total} items`, activeFilters: ["Filters: Status Available Reset filters"],
    tables: [table(["", "ID-Tag", "Name", "Location", "Price", "Weight (KG)"], []), { headers: [], rows: rows.map(row => [...row, "100 kg"]) }],
  };
}

test("inventory prices join exact lot IDs, prefer Marrickville and reconcile all page windows", () => {
  const first = inventoryPage(1, 2, 3, [["", "[PG-0901]", "Example", "Marrickville", "A$11 / kg"], ["", "[PG-0901]", "Example", "Supplier", "A$10 / kg"]]);
  const last = inventoryPage(3, 4, 3, [["", "[PG-0902]", "Example B", "Supplier", "A$12.5 / kg"]]);
  assert.deepEqual([...parseInventoryPrices([first, last])], [["PG-0901", 11], ["PG-0902", 12.5]]);
  assert.throws(() => parseInventoryPrices([first]), /CROPSTER_TABLE_INCOMPLETE/);
  last.tables[1].rows = [];
  assert.throws(() => parseInventoryPrices([first, last]), /CROPSTER_TABLE_INCOMPLETE/);
});

test("green stock takes only the exact Marrickville row of the dated location report", () => {
  const snapshot = {
    url: "https://c-sar.cropster.com/apps/lots/inventory-report/location",
    text: "Green Inventory Report for February 6, 2026 Values refer to the inventory on February 6, 2026",
    tables: [table(["", "Location", "Number of lots", "Weight", "Total value"], [["", "Supplier", "1", "900 kg", "$ 9,000.00 AUD"], ["", "Marrickville", "1", "100.5 kg", "$ 1,005.00 AUD"]])],
  };
  assert.deepEqual(parseMarrickvilleStock(snapshot, "2026-02-06"), { location: "Marrickville", kg: 100.5, value: 1005 });
  assert.throws(() => parseMarrickvilleStock(snapshot, "2026-02-05"), /CROPSTER_SCOPE_UNVERIFIED/);
});

test("coherence includes completed weight, green weight and batch count", () => {
  const first = { roastedKg: 10, greenKg: 12, batches: 1 };
  assert.equal(sameProduction(first, { ...first }), true);
  for (const key of Object.keys(first)) assert.equal(sameProduction(first, { ...first, [key]: first[key] + 1 }), false);
});

test("schedule coherence detects plan edits even when completed production has not changed", () => {
  const days = Array.from({ length: 5 }, (_, index) => {
    const day = addDays(range.weekStart, index);
    return parseScheduleDay(schedule(day), day, range);
  });
  assert.equal(sameSchedules(days, days.map(day => ({ ...day, lotKg: new Map(day.lotKg) }))), true);
  assert.equal(sameSchedules(days, days.map((day, index) => index === 4 ? { ...day, roastedKg: day.roastedKg + 1 } : day)), false);
  assert.equal(sameSchedules(days, days.map((day, index) => index === 4 ? { ...day, lotKg: new Map([["PG-0999", 20]]) } : day)), false);
});
