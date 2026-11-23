import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleDay, parseScheduleWeek, sameScheduleReads } from "../src/parse.mjs";
import { weekSnapshot } from "./week-schedule.fixture.mjs";

const range = { weekStart: "2026-02-02", periodEnd: "2026-02-06" };

test("explicit inconsistent status is completed scheduled work and retains provenance", () => {
  // Live 23 November evidence: an orange Inconsistent tile opened a completed
  // roast whose actual lot differed from its scheduled lot. Cropster documents
  // this as already roasted. These synthetic values contain no customer data.
  const source = weekSnapshot();
  source.calendarWeek.rows[0].states[0][1] = "inconsistent";
  const parsed = parseScheduleWeek(source, range);
  assert.equal(parsed.pendingBatchCount, 2);
  assert.equal(parsed.greenKg, 20);
  assert.equal(parsed.roastedKg, 16.25, "This is only the remaining output estimate, never completed actual production");
  assert.equal(parsed.profileAssignments.rows[1].status, "inconsistent");
  assert.equal(parsed.profileAssignments.rows[1].greenKg, 15, "Original scheduled weight remains provenance");
  assert.equal(sameScheduleReads({ kind: "week", week: parsed }, { kind: "week", week: parseScheduleWeek(weekSnapshot(), range) }), false);
});

test("daily fallback also excludes verified inconsistent tiles from pending work", () => {
  const source = weekSnapshot();
  source.url = "https://c-sar.cropster.com/apps/roast/schedule/calendar/day?date=" + range.weekStart;
  source.text = "2 February 2026, in Marrickville Scheduled coffees Summary per green lot";
  source.calendarDay = {
    tiles: source.calendarWeek.rows[0].tiles.flat(),
    states: ["synced", "inconsistent", "synced", "roasted"],
  };
  for (const table of source.tables) table.headers = table.headers.map(header => header.replace("2-8", "2/2/2026"));
  const parsed = parseScheduleDay(source, range.weekStart, range);
  assert.equal(parsed.pendingBatchCount, 2);
  assert.equal(parsed.greenKg, 20);
  assert.equal(parsed.roastedKg, 16.25);
});

test("inconsistent work must reconcile against every pending summary", () => {
  for (const mutate of [
    source => { source.calendarWeek.rows[0].states[0][0] = "inconsistent"; },
    source => { source.tables[0].rows[0][2] = "35 kg\nComponent A: 20 kg\nComponent B: 15 kg"; },
    source => { source.tables[1].rows[0][2] = "20 kg"; },
    source => { source.tables[1].rows[0][3] = "14 kg"; },
    source => { source.tables[1].rows[0][3] = ""; },
    source => { source.tables[2].rows[0][1] = "20 kg"; },
  ]) {
    const source = weekSnapshot();
    source.calendarWeek.rows[0].states[0][1] = "inconsistent";
    mutate(source);
    assert.throws(() => parseScheduleWeek(source, range), /CROPSTER_SCHEDULE_AMBIGUOUS/);
  }
});

test("an inconsistent tile requires the date-scoped Used summary for corroboration", () => {
  const source = weekSnapshot();
  source.calendarWeek.rows[0].states[0][1] = "inconsistent";
  source.tables[1].headers[3] = "Lifetime Used";
  assert.throws(() => parseScheduleWeek(source, range), /CROPSTER_BATCH_STATUS_UNVERIFIED/);
});

test("unknown or ambiguous status still fails closed", () => {
  for (const status of [null, "unknown", "roasted inconsistent", "completed", undefined]) {
    const source = weekSnapshot(); source.calendarWeek.rows[0].states[0][1] = status;
    assert.throws(() => parseScheduleWeek(source, range), /CROPSTER_BATCH_STATUS_UNVERIFIED/);
  }
});
