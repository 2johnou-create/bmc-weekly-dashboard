import assert from "node:assert/strict";
import test from "node:test";
import { parseLegacyInventory } from "../src/parse.mjs";
import { legacyInventorySnapshot } from "./legacy-inventory.fixture.mjs";

test("legacy stock preserves all warehouse positions and raw prices with complete reconciled totals", () => {
  const result = parseLegacyInventory(legacyInventorySnapshot(), "2026-02-05");
  assert.equal(result.totalKg, 120);
  assert.equal(result.allLocationsComplete, true);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[1], { name: "Example A", location: "Supplier", lotId: "PG-0901", kg: 90, pricePerKg: 10, positionId: "PositionB" });
});

test("legacy stock requires exact date and verified unfiltered snapshot scope", () => {
  for (const mutate of [
    s => { s.text = s.text.replaceAll("February 5", "February 4"); },
    s => { delete s.legacyInventoryScope; },
    s => { s.legacyInventoryScope.locationControls[0].selected.push("Marrickville"); },
    s => { s.legacyInventoryScope.locationControls[0].text = "Marrickville"; },
    s => { s.legacyInventoryScope.consumedControls[0].checked = true; },
    s => { s.legacyInventoryScope.checkedRows = 1; },
    s => { s.legacyInventoryScope.nonCheckboxInputs[0].value = "Coffee filter"; },
    s => { s.legacyInventoryScope.snapshotButtons[0].class = "button ember-view"; },
    s => { s.legacyInventoryScope.snapshotButtons[1].class = "button active ember-view"; },
  ]) {
    const snapshot = legacyInventorySnapshot(); mutate(snapshot);
    assert.throws(() => parseLegacyInventory(snapshot, "2026-02-05"), /CROPSTER_SCOPE_UNVERIFIED/);
  }
});

test("legacy placeholder rows and incomplete page, footer or overview totals cannot establish inventory", () => {
  for (const mutate of [
    s => { s.tables[0].rows = s.tables[0].rows.map(row => row.map(() => "")); },
    s => { s.tables[0].pagination = "Show 1 - 3 of 30"; },
    s => { s.tables[0].footers[0][3] = "121 kg"; },
    s => { s.tables[0].footers[0][5] = "$ 1,241.00 AUD"; },
    s => { s.tables[0].footers[0][6] = "Count: 1"; },
    s => { s.text = s.text.replace("3 # of lots", "4 # of lots"); },
    s => { s.text = s.text.replace("120 kg", "125 kg"); },
    s => { s.tables[0].rows[0][5] = "$ 101.00 AUD"; },
    s => { s.tables[0].rows[0][7] = "10 EUR / kg"; },
    s => { s.tables[0].rowLinks[1] = s.tables[0].rowLinks[0]; },
  ]) {
    const snapshot = legacyInventorySnapshot(); mutate(snapshot);
    assert.throws(() => parseLegacyInventory(snapshot, "2026-02-05"), /CROPSTER_(?:TABLE_INCOMPLETE|TOTAL_UNAVAILABLE|INVENTORY_UNAVAILABLE)/);
  }
});
