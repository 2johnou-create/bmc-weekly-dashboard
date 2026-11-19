import assert from "node:assert/strict";
import test from "node:test";
import { assembleRecipes, parseScheduleWeek, sameScheduleReads } from "../src/parse.mjs";
import { weekSnapshot } from "./week-schedule.fixture.mjs";

const range = { weekStart: "2026-02-02", periodEnd: "2026-02-06" };
const profileUrl = id => "https://c-sar.cropster.com/apps/roast/profiles/" + id;
function parameters() {
  const row = (date, lotId, name) => ({ date, machineId: "M1", profileName: "Component A", profileUrl: profileUrl("A"), greenKg: 10, lotIds: [lotId], lotNames: [{ lotId, name }] });
  const group = (id, lotId) => ({ id, name: "Group " + id, profileUrls: [profileUrl(id)], defaultProfileUrl: profileUrl(id), lotIds: [lotId], lotNames: [] });
  return {
    blends: [{ name: "Example blend", signature: "Liberty", components: [{ name: "Group A", profileGroupId: "A", percent: 100 }] }],
    groups: [group("A", "PG-0901"), group("OH", "PG-0904"), group("Decaf", "PG-0905")],
    profileInputs: new Map([[profileUrl("A"), { lotIds: ["PG-0901"] }], [profileUrl("OH"), { lotIds: ["PG-0904"] }], [profileUrl("Decaf"), { lotIds: ["PG-0905"] }]]),
    inventory: { rows: [
      { lotId: "PG-0901", name: "Old template coffee", location: "Marrickville", kg: 10, pricePerKg: 99 },
      { lotId: "PG-0902", name: "Current coffee", location: "Marrickville", kg: 20, pricePerKg: 12.345 },
      { lotId: "PG-0902", name: "Current coffee", location: "Supplier", kg: 200, pricePerKg: 13 },
      { lotId: "PG-0903", name: "Earlier coffee", location: "Marrickville", kg: 10, pricePerKg: 14 },
      { lotId: "PG-0904", name: "OH coffee", location: "Marrickville", kg: 10, pricePerKg: 11.5 },
    ] }, asOf: "2026-02-05", ohGroupId: "OH", decafGroupId: "Decaf",
    scheduleAssignments: { complete: true, ...range, rows: [row("2026-02-02", "PG-0903", "Earlier coffee"), row("2026-02-06", "PG-0902", "Current coffee")] },
  };
}

test("calendar tiles bind exact profile IDs and lots only after full date, batch and weight reconciliation", () => {
  const parsed = parseScheduleWeek(weekSnapshot(), range);
  assert.equal(parsed.profileAssignments.complete, true);
  assert.equal(parsed.profileAssignments.rows.length, 3);
  assert.deepEqual(parsed.profileAssignments.rows[0], { date: "2026-02-02", machineId: "M1", profileName: "Component A", profileUrl: profileUrl("ProfileA"), greenKg: 10, lotIds: ["PG-0901"], lotNames: [{ lotId: "PG-0901", name: "Example A" }] });
  for (const mutate of [
    s => { delete s.calendarWeek.rows[0].tiles; },
    s => { s.calendarWeek.rows[0].tiles[0].pop(); },
    s => { s.calendarWeek.rows[0].tiles[0][0] = "Unknown profile 10 kg\n[PG-0901] Example A"; },
    s => { s.calendarWeek.rows[0].tiles[0][0] = "Component A 11 kg\n[PG-0901] Example A"; },
    s => { s.calendarWeek.rows[0].tiles[0][0] = "Component A 10 kg\n[PG-0999] Other lot"; },
    s => { s.tables[1].rows[0][1] = "3 x 10 kg"; },
    s => { s.tables[1].rowLinks[0] = []; },
  ]) {
    const snapshot = weekSnapshot(); mutate(snapshot);
    const result = parseScheduleWeek(snapshot, range);
    assert.ok(result, "Verified production totals may remain available");
    assert.equal(result.profileAssignments, null, "Unproven ownership must not become a template-price fallback");
  }
});

test("schedule coherence detects changed profile-to-lot ownership even if aggregate pending weights stay the same", () => {
  const first = { kind: "week", week: parseScheduleWeek(weekSnapshot(), range) };
  const second = structuredClone(first);
  second.week.profileAssignments.rows[0].lotIds = ["PG-0902"];
  assert.equal(sameScheduleReads(first, second), false);
});

test("current cost uses latest explicitly assigned lot and local raw price; runout retains every observed week lot", () => {
  const result = assembleRecipes(parameters()), component = result.rows[0].components[0];
  assert.equal(component.coffee, "Current coffee");
  assert.equal(component.currentPricePerKg, 12.345);
  assert.equal(component.pricingBasis, "current-week-schedule");
  assert.equal(component.pricingDate, "2026-02-06");
  assert.deepEqual(component.pricingLotIds, ["PG-0902"]);
  assert.equal(component.pricingProfileUrl, profileUrl("A"));
  assert.deepEqual(result.runoutProfiles[0].lotIds, ["PG-0901", "PG-0903", "PG-0902"]);
  assert.ok(result.runoutLotNames.some(row => row.lotId === "PG-0903" && row.name === "Earlier coffee"));
  assert.equal(result.rows[1].components[0].pricingBasis, "default-profile", "No current-week assignment permits only an explicit default fallback");
});

test("missing ownership, competing latest lots or unavailable valuation cannot silently use an old template price", () => {
  for (const mutate of [
    p => { p.scheduleAssignments = null; },
    p => { p.scheduleAssignments.rows[0].date = "2026-02-06"; },
    p => { p.inventory.rows = p.inventory.rows.filter(row => row.lotId !== "PG-0902"); },
    p => { p.inventory.rows[1].pricePerKg = null; },
    p => { p.scheduleAssignments.rows[1].lotNames[0].name = "Different coffee name"; },
  ]) {
    const params = parameters(); mutate(params);
    const component = assembleRecipes(params).rows[0].components[0];
    assert.equal(component.coffee, null);
    assert.equal(component.currentPricePerKg, null);
    assert.equal(component.pricingBasis, "unverified");
  }
});
