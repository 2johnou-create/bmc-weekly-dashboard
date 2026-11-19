import { addDays } from "../src/dates.mjs";

const range = { weekStart: "2026-02-02", periodEnd: "2026-02-06" };
const table = (headers, rows) => ({ headers, rows, pagination: `Show 1 - ${rows.length} of ${rows.length}` });

export function weekSnapshot() {
  return {
    url: "https://c-sar.cropster.com/apps/roast/schedule/calendar/week?date=2026-02-05",
    text: "2-8 February 2026, in Marrickville Scheduled coffees Summary per green lot",
    scheduleStatuses: { unpublished: true, scheduled: true, synced: true, roasted: true, inconsistent: true },
    scheduleMachines: { M1: true },
    calendarWeek: {
      dates: Array.from({ length: 7 }, (_, index) => addDays(range.weekStart, index)),
      rows: [{ machineId: "M1", cellCount: 8, summary: "Example machine\n3 Batches, 40 kg", batchCounts: [2, 1, 0, 0, 0, 0, 0], emptyCells: [false, false, true, true, true, true, true], tiles: [["Component A 10 kg\n[PG-0901] Example A", "Component A 10 kg\n[PG-0901] Example A"], ["Component B 20 kg\n[PG-0902] Example B"], [], [], [], [], []] }],
    },
    tables: [
      table(["Profile", "Type", "2-8 To roast", "2-8 Total", "2-8 Estimated output", "Total scheduled"], [["Example blend", "Post-roast blend", "20 kg\nComponent A: 5 kg\nComponent B: 15 kg", "40 kg\nComponent A: 20 kg\nComponent B: 20 kg", "33 kg\nComponent A: 17 kg\nComponent B: 16 kg", "400 kg"]]),
      { ...table(["Profile", "# of batches", "2-8 To roast", "2-8 Used", "2-8 Total", "Total scheduled"], [["Component A (10)", "2 x 10 kg", "5 kg", "15 kg", "20 kg", ""], ["Component B (20)", "1 x 20 kg", "15 kg", "5 kg", "20 kg", ""]]), rowLinks: [[{ text: "Component A (10)", href: "https://c-sar.cropster.com/apps/roast/profiles/ProfileA" }], [{ text: "Component B (20)", href: "https://c-sar.cropster.com/apps/roast/profiles/ProfileB" }]] },
      table(["Lot", "2-8 To roast", "2-8 Total"], [["[PG-0901] Example A", "5 kg", "20 kg"], ["[PG-0902] Example B", "15 kg", "20 kg"]]),
    ],
  };
}

