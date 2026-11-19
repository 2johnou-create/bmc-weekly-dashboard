import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { buildRunoutPools } from "../worker/profile-runout.js";
import { labReport, mergeGreenCoverage, readRoasteryLab, saveLabCropster } from "../worker/roastery-lab.js";

const today = "2026-11-19";
const now = new Date("2026-11-19T02:00:00Z");
function fixture() {
  return {
    inventory: { asOf: "2026-11-18", allLocationsComplete: true, rows: [
      { lotId: "LOT-A", name: "Example old coffee", location: "Warehouse", kg: 30, pricePerKg: 10 },
      { lotId: "LOT-A", name: "Example old coffee", location: "Supplier", kg: 70, pricePerKg: 10 },
      { lotId: "LOT-B", name: "Example current coffee", location: "Supplier", kg: 200, pricePerKg: 12 },
    ], contracts: [] },
    recipes: { asOf: "2026-11-18", runoutProfiles: [
      { id: "lib", name: "Example Liberty profile", lotIds: ["LOT-A", "LOT-B", "LOT-C"], linksComplete: true, note: "Exact profile links read in Cropster." },
      { id: "rhy", name: "Example Rhythm profile", lotIds: ["LOT-A", "LOT-B", "LOT-C"], linksComplete: true, note: "Replacement eligibility recorded in the plan." },
    ], runoutLotNames: [{ lotId: "LOT-C", name: "Example historical coffee" }], rows: [
      { name: "Liberty Blend", signature: "Liberty", components: [{ name: "Liberty Brazil", coffee: "Example current coffee", percent: 100, profileGroupId: "lib" }] },
      { name: "Rhythm Blend", signature: "Rhythm", components: [{ name: "Rhythm Brazil", coffee: "Example current coffee", percent: 100, profileGroupId: "rhy" }] },
    ] },
    use: { months: ["2026-08", "2026-09", "2026-10"].map((month, index) => ({ month, complete: true, kg: 100, rows: [
      { lotId: "LOT-A", name: "Example old coffee", kg: 30 - index * 10 },
      { lotId: "LOT-B", name: "Example current coffee", kg: 60 - index * 10 },
      { lotId: "LOT-C", name: "Example historical coffee", kg: 10 + index * 20 },
    ] })) },
  };
}

test("overlapping profiles share one global pool, all locations and all unique related lot consumption", () => {
  const data = fixture(), before = structuredClone(data);
  const pools = buildRunoutPools(data, today);
  assert.equal(pools.length, 1);
  const pool = pools[0];
  assert.equal(pool.status, "recorded");
  assert.deepEqual(pool.profileGroupIds, ["lib", "rhy"]);
  assert.deepEqual(pool.usedFor, ["Liberty", "Rhythm"]);
  assert.equal(pool.inventoryKg, 300);
  assert.equal(pool.additionalContractKg, 0);
  assert.equal(pool.totalKg, 300);
  assert.equal(pool.lotCount, 3);
  assert.equal(pool.avgMonthlyKg, 100);
  assert.equal(pool.twoMonthAverageKg, 100);
  assert.equal(pool.depletionMonth, "2027-02");
  assert.equal(pool.lotRows.find(row => row.lotId === "LOT-C").kg, 0, "absence from a verified full inventory is a real zero");
  assert.deepEqual(pool.locations, [{ name: "Supplier", kg: 270 }, { name: "Warehouse", kg: 30 }]);
  assert.match(pool.note, /Exact profile links read in Cropster/);
  assert.match(pool.note, /Replacement eligibility recorded in the plan/);
  assert.deepEqual(data, before);
});

test("identical inventory positions and repeated contract references cannot count supply twice", () => {
  const data = fixture();
  data.inventory.rows.push({ ...data.inventory.rows[0] });
  const included = { id: "contract-b", lotId: "LOT-B", remainingKg: 200, includedInventoryKg: 200 };
  data.inventory.contracts = [included, { ...included }, { id: "extra-c", lotId: "LOT-C", remainingKg: 100, includedInventoryKg: 0, availableFrom: "2026-11-01" }];
  const pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.inventoryKg, 300);
  assert.equal(pool.additionalContractKg, 100);
  assert.equal(pool.totalKg, 400);
  assert.equal(pool.lotRows.find(row => row.lotId === "LOT-C").kg, 100);
  assert.equal(pool.depletionMonth, "2027-03");
});

test("partially overlapping eligibility keeps a unique global quantity but cannot promise a per-profile runout date", () => {
  const data = fixture();
  data.recipes.runoutProfiles[0].lotIds = ["LOT-A", "LOT-B"];
  data.recipes.runoutProfiles[1].lotIds = ["LOT-B", "LOT-C"];
  const pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.totalKg, 300);
  assert.equal(pool.avgMonthlyKg, 100);
  assert.equal(pool.status, "partial");
  assert.equal(pool.depletionMonth, null);
  assert.match(pool.note, /partially overlapping eligible lots/);
  const report = labReport(data, today);
  const coverage = mergeGreenCoverage(report.consumption, report.prices, {}, today);
  assert.equal(coverage.groups[0].columns[2].stockDepletionMonth, null);
  assert.equal(coverage.groups[1].columns[0].stockDepletionMonth, null);
});

test("unknown contract overlap blocks total runout, while unknown arrival is an explicit quantity estimate", () => {
  const data = fixture();
  data.inventory.contracts = [{ id: "extra", lotId: "LOT-C", remainingKg: 100, includedInventoryKg: null }];
  let pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.totalKg, null);
  assert.equal(pool.additionalContractKg, null);
  assert.equal(pool.depletionMonth, null);
  assert.equal(pool.inventoryKg, 300);
  data.inventory.contracts[0].includedInventoryKg = 0;
  pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.totalKg, 400);
  assert.equal(pool.depletionMonth, "2027-03");
  assert.equal(pool.status, "partial");
  assert.match(pool.note, /quantity coverage estimate/);
  data.inventory.contracts = [{ id: "bad", lotId: "LOT-A", remainingKg: 200, includedInventoryKg: 150 }];
  assert.equal(buildRunoutPools(data, today)[0].totalKg, null, "overlap cannot exceed the lot's recorded stock");
});

test("missing links, incomplete location coverage and negative consumed balances cannot supply a trusted forecast", () => {
  for (const mutate of [
    data => { data.recipes.runoutProfiles[0].linksComplete = false; },
    data => { data.inventory.allLocationsComplete = false; },
    data => { data.inventory.rows[0].lotId = null; },
    data => { data.inventory.rows[0].kg = -2; },
    data => { data.inventory.rows.push({ ...data.inventory.rows[0], kg: 999 }); },
  ]) {
    const data = fixture(); mutate(data);
    const pool = buildRunoutPools(data, today)[0];
    assert.equal(pool.status, "partial");
    assert.equal(pool.totalKg, null);
    assert.equal(pool.depletionMonth, null);
  }
});

test("exact unique historical names can resolve lot identities, while ambiguous or missing matches remain unknown", () => {
  const data = fixture();
  for (const month of data.use.months) for (const row of month.rows) delete row.lotId;
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, 100);
  data.recipes.runoutLotNames.push({ lotId: "OTHER-ID", name: "Example historical coffee" });
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, null);
  data.recipes.runoutLotNames.pop();
  data.use.months[2].rows[0].name = "Unidentified past lot";
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, null);
  data.use.months[2].rows[0].lotId = "LOT-A";
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, 100, "an explicit lot ID is authoritative even after a name change");
});

test("same-name lot collisions are safe with explicit IDs and duplicate monthly IDs never double the burn", () => {
  const data = fixture();
  data.inventory.rows.find(row => row.lotId === "LOT-B").name = "Example old coffee";
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, 100);
  data.use.months[1].rows.push({ ...data.use.months[1].rows[0] });
  assert.equal(buildRunoutPools(data, today)[0].avgMonthlyKg, null);
});

test("complete absent use is zero, incomplete months are unknown, and both rates use the same global lot set", () => {
  const data = fixture();
  data.use.months[0].rows = [];
  let pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.avgMonthlyKg, 66.67);
  assert.equal(pool.twoMonthAverageKg, 100);
  data.use.months[0].complete = false;
  pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.avgMonthlyKg, null);
  assert.equal(pool.twoMonthAverageKg, 100);
  assert.equal(pool.depletionMonth, null);
  for (const month of data.use.months) { month.complete = true; month.rows = []; }
  pool = buildRunoutPools(data, today)[0];
  assert.equal(pool.avgMonthlyKg, 0);
  assert.equal(pool.twoMonthAverageKg, 0);
  assert.equal(pool.depletionMonth, null);
});

test("new calendar markers reference verified pooled IDs and never fall back to one selected coffee", () => {
  const data = fixture(), report = labReport(data, today);
  const coverage = mergeGreenCoverage(report.consumption, report.prices, {}, today);
  const liberty = coverage.groups[0].columns[2], rhythm = coverage.groups[1].columns[0];
  assert.equal(liberty.stockDepletionMonth, "2027-02");
  assert.equal(liberty.twoMonthAverageKg, 100);
  assert.equal(liberty.runout.poolId, rhythm.runout.poolId);
  assert.equal(coverage.runoutPools.length, 1);
  delete data.recipes.runoutProfiles;
  const legacy = labReport(data, today);
  assert.equal(legacy.prices.highlights[0].pricePerKg, report.prices.highlights[0].pricePerKg);
  const noLinks = mergeGreenCoverage(legacy.consumption, legacy.prices, {}, today).groups[0].columns[2];
  assert.equal(noLinks.stockDepletionMonth, null);
  assert.equal(noLinks.runout, null);
  assert.match(noLinks.runoutNote, /Verified complete profile-to-lot links/);
});

test("Decaf uses an explicit profile ID without name inference and keeps three price highlights", () => {
  const data = fixture();
  data.recipes.runoutProfiles.push({ id: "decaf", name: "Observed product group", lotIds: ["LOT-D"], linksComplete: true });
  data.recipes.decafProfileGroupId = "decaf";
  data.inventory.rows.push({ lotId: "LOT-D", name: "Source coffee without product keyword", location: "Supplier", kg: 50, pricePerKg: 15 });
  for (const month of data.use.months) month.rows.push({ lotId: "LOT-D", name: "Source coffee without product keyword", kg: 10 });
  const report = labReport(data, today);
  const decaf = mergeGreenCoverage(report.consumption, report.prices, {}, today).groups[3].columns[0];
  assert.equal(decaf.runout.totalKg, 50);
  assert.deepEqual(decaf.runout.usedFor, ["Decaf"]);
  assert.ok(decaf.stockDepletionMonth);
  assert.equal(report.prices.highlights.length, 3);
});

test("additive source fields survive validated storage and invalid identities or coverage flags are rejected", async t => {
  const db = localDatabase(":memory:"); t.after(() => db.close());
  const data = fixture();
  await saveLabCropster(db, data, now);
  const saved = await readRoasteryLab(db, now);
  assert.equal(saved.consumption.runoutPools[0].totalKg, 300);
  assert.equal(saved.consumption.runoutPools[0].avgMonthlyKg, 100);
  assert.match(saved.consumption.runoutPools[0].note, /Exact profile links/);
  assert.equal(saved.prices.highlights[0].components[0].profileGroupId, "lib");
  for (const mutate of [
    data => { data.inventory.allLocationsComplete = "true"; },
    data => { data.recipes.runoutProfiles[0].lotIds.push("LOT-A"); },
    data => { data.recipes.rows[0].components[0].profileGroupId = "not a valid id"; },
    data => { data.use.months[0].rows.push({ ...data.use.months[0].rows[0] }); },
    data => { data.inventory.contracts = [{ id: "invalid", lotId: "LOT-A", remainingKg: 1, includedInventoryKg: 2 }]; },
  ]) { const invalid = fixture(); mutate(invalid); await assert.rejects(saveLabCropster(db, invalid, now), error => error.status === 400); }
});
