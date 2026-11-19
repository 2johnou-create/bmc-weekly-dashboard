import assert from "node:assert/strict";
import test from "node:test";
import { aggregateScheduleRead, parseScheduleWeek, sameScheduleReads } from "../src/parse.mjs";
import { weekSnapshot } from "./week-schedule.fixture.mjs";

const range = { weekStart: "2026-02-02", periodEnd: "2026-02-06" };

test("verified complete weekly grids exclude empty weekends and retain component-specific partial output", () => {
  const parsed = parseScheduleWeek(weekSnapshot(), range);
  assert.ok(parsed);
  assert.equal(parsed.greenKg, 20);
  assert.equal(parsed.roastedKg, 16.25);
  assert.deepEqual(aggregateScheduleRead({ kind: "week", week: parsed }, new Map([["PG-0901", 10], ["PG-0902", 12]]), range), { scheduledKg: 16.25, scheduledValue: 230 });
});

test("weekend activity, unselected filters and incomplete or inconsistent grid coverage require daily fallback", () => {
  const mutations = [
    snapshot => { snapshot.calendarWeek.dates[0] = "2026-02-01"; },
    snapshot => { snapshot.calendarWeek.dates.pop(); },
    snapshot => { snapshot.scheduleStatuses.synced = false; },
    snapshot => { snapshot.scheduleMachines.M1 = false; },
    snapshot => { snapshot.scheduleMachines.M2 = true; },
    snapshot => { snapshot.calendarWeek.rows[0].machineId = "different"; },
    snapshot => { snapshot.calendarWeek.rows[0].cellCount = 7; },
    snapshot => { snapshot.calendarWeek.rows[0].batchCounts[5] = 1; snapshot.calendarWeek.rows[0].emptyCells[5] = false; snapshot.calendarWeek.rows[0].summary = "4 Batches"; },
    snapshot => { snapshot.calendarWeek.rows[0].emptyCells[6] = false; },
    snapshot => { snapshot.calendarWeek.rows[0].summary = "4 Batches"; },
    snapshot => { snapshot.calendarWeek.rows[0].emptyCells[0] = true; },
    snapshot => { snapshot.text = snapshot.text.replace("Marrickville", "Other facility"); },
  ];
  for (const mutate of mutations) {
    const snapshot = weekSnapshot(); mutate(snapshot);
    assert.equal(parseScheduleWeek(snapshot, range), null);
  }
});

test("every checked machine needs one fully reconciled row and no missing weekend cells", () => {
  const snapshot = weekSnapshot();
  snapshot.scheduleMachines.M2 = true;
  snapshot.calendarWeek.rows.push({ machineId: "M2", cellCount: 8, summary: "1 Batch, 10 kg", batchCounts: [0, 0, 0, 0, 1, 0, 0], emptyCells: [true, true, true, true, false, true, true] });
  assert.ok(parseScheduleWeek(snapshot, range));
  snapshot.calendarWeek.rows.push(structuredClone(snapshot.calendarWeek.rows[1]));
  assert.equal(parseScheduleWeek(snapshot, range), null);
});

test("two verified weekly reads must preserve remaining quantities, output and lot identity", () => {
  const first = { kind: "week", week: parseScheduleWeek(weekSnapshot(), range) };
  const second = { kind: "week", week: parseScheduleWeek(weekSnapshot(), range) };
  assert.equal(sameScheduleReads(first, second), true);
  second.week.roastedKg += 1;
  assert.equal(sameScheduleReads(first, second), false);
  second.week.roastedKg -= 1;
  second.week.lotKg = new Map([["PG-0999", 20]]);
  assert.equal(sameScheduleReads(first, second), false);
  assert.equal(sameScheduleReads(first, { kind: "days", days: [] }), false);
});
