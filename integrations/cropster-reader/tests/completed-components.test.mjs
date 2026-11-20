import assert from "node:assert/strict";
import test from "node:test";
import { aggregateScheduleRead, aggregateSchedule, parseScheduleWeek, sameScheduleReads, sameSchedules } from "../src/parse.mjs";
import { addDays } from "../src/dates.mjs";

const range = { weekStart: "2026-02-02", periodEnd: "2026-02-06" };
const table = (headers, rows, rowLinks = []) => ({ headers, rows, rowLinks, pagination: `Show 1 - ${rows.length} of ${rows.length}` });
function snapshot({ finished = 1, repeat = false } = {}) {
  const names = ["Component A", "Component B", "Component C"], coffees = ["Alpha", "Beta", "Gamma"];
  const totals = names.map(name => name + ": 20 kg").join("\n");
  const estimated = "51 kg\nComponent A: 17 kg\nComponent B: 16 kg\nComponent C: 18 kg";
  const pendingKg = (3 - finished) * 10;
  const remaining = pendingKg + " kg\n" + names.map((name, index) => name + ":" + (index < finished ? "" : " 10 kg")).join("\n");
  const tiles = names.flatMap((name, index) => Array.from({ length: 2 }, () => `${name} 10 kg\n[PG-090${index + 1}] ${coffees[index]}`));
  const states = names.flatMap((_name, index) => ["roasted", index < finished ? "roasted" : "synced"]);
  const days = Array.from({ length: 7 }, () => []), dayStates = Array.from({ length: 7 }, () => []);
  days[4] = tiles; dayStates[4] = states;
  if (repeat) { days[0] = [...tiles]; dayStates[0] = tiles.map(() => "roasted"); }
  const fullRows = [["Example blend", "Post-roast blend", remaining, "60 kg\n" + totals, estimated, "300", "02/06/2026"]];
  if (repeat) fullRows.unshift(["Example blend", "Post-roast blend", "0 kg\nComponent A:\nComponent B:\nComponent C:", "60 kg\n" + totals, estimated, "300", "02/02/2026"]);
  const whole = repeat ? 40 : 20;
  return {
    url: "https://c-sar.cropster.com/apps/roast/schedule/calendar/week?date=2026-02-02", text: "2-8 February 2026, in Marrickville Scheduled coffees Summary per green lot",
    scheduleStatuses: { unpublished: true, scheduled: true, synced: true, roasted: true, inconsistent: true }, scheduleMachines: { M1: true },
    calendarWeek: { dates: Array.from({ length: 7 }, (_, index) => addDays(range.weekStart, index)), rows: [{ machineId: "M1", cellCount: 8,
      summary: `${repeat ? 12 : 6} Batches`, batchCounts: days.map(day => day.length), emptyCells: days.map(day => day.length === 0), tiles: days, states: dayStates }] },
    tables: [
      table(["Profile", "Type", "2-8 To roast", "2-8 Total", "2-8 Estimated output", "Total # of batches", "Scheduled on"], fullRows),
      table(["Profile", "# of batches", "2-8 To roast", "2-8 Used", "2-8 Total"], names.map((name, index) => [name + " (10)", `${repeat ? 4 : 2} x 10 kg`, index < finished ? "" : "10 kg", `${whole - (index < finished ? 0 : 10)} kg`, `${whole} kg`]),
        names.map((name, index) => [{ text: name + " (10)", href: "https://c-sar.cropster.com/apps/roast/profiles/P" + index }])),
      table(["Lot", "2-8 To roast", "2-8 Total"], names.map((_name, index) => [`[PG-090${index + 1}] ${coffees[index]}`, index < finished ? "" : "10 kg", `${whole} kg`])),
    ],
  };
}

test("blank completed component labels are zero only with row totals, dated tile states, profile and lot corroboration", () => {
  for (const [finished, green, output] of [[1, 20, 17], [2, 10, 9], [3, 0, 0]]) {
    const parsed = parseScheduleWeek(snapshot({ finished }), range);
    assert.equal(parsed.greenKg, green);
    assert.equal(parsed.pendingBatchCount, 3 - finished);
    assert.equal(parsed.roastedKg, output);
  }
});

test("completed labels on repeated dated rows do not erase the later row's pending components", () => {
  const parsed = parseScheduleWeek(snapshot({ finished: 2, repeat: true }), range);
  assert.equal(parsed.greenKg, 10);
  assert.equal(parsed.pendingBatchCount, 1);
  assert.equal(parsed.roastedKg, 9);
  assert.equal(parsed.profileAssignments.rows.length, 12);
});

test("blank or omitted truly pending components, missing dates and missing whole breakdowns still fail closed", () => {
  for (const mutate of [
    s => { s.tables[0].rows[0][2] = "20 kg\nComponent A: 10 kg\nComponent B: 10 kg\nComponent C:"; },
    s => { s.tables[0].rows[0][2] = "20 kg\nComponent C: 20 kg"; },
    s => { s.tables[0].rows[0][2] = "20 kg"; },
    s => { s.tables[0].rows[0][6] = ""; },
    s => { s.tables[0].rows[0][6] = "02/02/2026"; },
    s => { s.tables[1].rows[0][2] = "10 kg"; },
  ]) {
    const source = snapshot(); mutate(source);
    assert.throws(() => parseScheduleWeek(source, range), /CROPSTER_SCHEDULE_AMBIGUOUS/);
  }
});

test("unavailable optional output factors preserve verified pending green/count/raw cost as an explicit null estimate", () => {
  for (const mutate of [
    s => { s.tables[0].headers[4] = "Output unavailable"; },
    s => { s.tables[0].rows[0][4] = ""; },
    s => { s.tables[0].rows[0][4] = "51 kg\nComponent A:\nComponent B: 16 kg\nComponent C: 18 kg"; },
    s => { s.tables[0].rows[0][3] = "60 kg"; },
  ]) {
    const source = snapshot(); mutate(source);
    const first = { kind: "week", week: parseScheduleWeek(source, range) };
    const second = { kind: "week", week: parseScheduleWeek(source, range) };
    assert.equal(first.week.greenKg, 20);
    assert.equal(first.week.pendingBatchCount, 2);
    assert.equal(first.week.roastedKg, null);
    assert.equal(sameScheduleReads(first, second), true);
    assert.deepEqual(aggregateScheduleRead(first, new Map([["PG-0902", 12], ["PG-0903", 13]]), range), { scheduledKg: null, scheduledValue: 250 });
  }
  const complete = snapshot({ finished: 3 }); complete.tables[0].headers[4] = "Output unavailable";
  assert.equal(parseScheduleWeek(complete, range).roastedKg, 0, "Zero remaining work needs no output-loss assumption");
});

test("one unknown daily estimate makes the weekly estimate null without losing verified raw cost or stable core coherence", () => {
  const days = Array.from({ length: 5 }, (_, index) => ({ day: addDays(range.weekStart, index), greenKg: 10, pendingBatchCount: 1, roastedKg: index === 2 ? null : 8.5, lotKg: new Map([["PG-0903", 10]]) }));
  assert.deepEqual(aggregateSchedule(days, new Map([["PG-0903", 13]]), range), { scheduledKg: null, scheduledValue: 650 });
  const changedEstimate = days.map(day => ({ ...day, roastedKg: 8.5 }));
  assert.equal(sameSchedules(days, days.map(day => ({ ...day }))), true);
  assert.equal(sameSchedules(days, changedEstimate), false);
  assert.equal(sameSchedules(days, changedEstimate, { ignoreOutputEstimate: true }), true);
  changedEstimate[0].greenKg = 20;
  assert.equal(sameSchedules(days, changedEstimate, { ignoreOutputEstimate: true }), false);
});
