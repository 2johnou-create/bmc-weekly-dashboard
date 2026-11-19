import assert from "node:assert/strict";
import test from "node:test";
import { completedMonths } from "../src/dates.mjs";
import { assembleRecipes, blendLoss, parseBlend, parseInventory, parseLoss, parseMonthlyUse, parseProfileGroup, parseProfileInputs } from "../src/parse.mjs";

const table = (headers, rows, footers = [], rowLinks = []) => ({ headers, rows, footers, rowLinks, pagination: `Show 1 - ${rows.length} of ${rows.length}` });
const sourceRange = { weekStart: "2026-01-01", periodEnd: "2026-01-31" };
const base = { text: "Production report from January 1, 2026 to January 31, 2026 Locations Average", tables: [] };

test("last three completed months follow Sydney and handle a new calendar year", () => {
  const months = completedMonths(new Date("2026-01-15T00:00:00Z"));
  assert.deepEqual(months.map(month => [month.month, month.periodEnd]), [["2025-10", "2025-10-31"], ["2025-11", "2025-11-30"], ["2025-12", "2025-12-31"]]);
});

test("monthly consumption accepts only the exact all-location complete dated lot report", () => {
  const snapshot = { ...base, url: "https://c-sar.cropster.com/apps/roast/production-report/inventory?dateFrom=2026-01-01&dateTo=2026-01-31", tables: [table(
    ["", "Lot ID-Tag", "Name", "Amount of green"], [["", "PG-0901", "Example", "100 kg"]], [["", "Total", "", "100 kg"]],
  )] };
  assert.deepEqual(parseMonthlyUse(snapshot, sourceRange), { month: "2026-01", complete: true, kg: 100, rows: [{ name: "Example", lotId: "PG-0901", kg: 100 }] });
  assert.throws(() => parseMonthlyUse({ ...snapshot, text: base.text.replace("Locations Average", "Locations Marrickville Average") }, sourceRange), /CROPSTER_SCOPE_UNVERIFIED/);
  assert.throws(() => parseMonthlyUse({ ...snapshot, url: snapshot.url + "&locations=lK0G1" }, sourceRange), /CROPSTER_SCOPE_UNVERIFIED/);
});

test("loss preserves measured weights and group identities and derives blend totals from fresh component definitions", () => {
  const snapshot = { ...base, url: "https://c-sar.cropster.com/apps/roast/production-report/profile-group?dateFrom=2026-01-01&dateTo=2026-01-31", tables: [table(
    ["", "Component Name", "Amount roasted", "Batches", "Amount of green"],
    [["", "Component A", "85 kg", "5", "100 kg"], ["", "Component B", "40 kg", "2", "50 kg"]],
    [["", "Total", "125 kg", "7", "150 kg"]],
    [[{ href: "/app/roast/profile-groups/GroupA", text: "Component A" }], [{ href: "/app/roast/profile-groups/GroupB", text: "Component B" }]],
  )] };
  const loss = parseLoss(snapshot, sourceRange);
  assert.equal(loss.rows[0].profileGroupId, "GroupA");
  const result = blendLoss(loss, { rows: [{ name: "Example Blend", components: [{ name: "Component A", profileGroupId: "GroupA", percent: 40 }, { name: "Component B", profileGroupId: "GroupB", percent: 60 }] }] });
  assert.deepEqual(result.rows.at(-1), { name: "Example Blend", greenKg: 150, roastedKg: 125, batches: 7 });
  assert.equal(result.rows[0].profileGroupId, undefined);
});

test("inventory emits exact all-warehouse positions and does not infer new contract quantities", () => {
  const snapshot = {
    url: "https://c-sar.cropster.com/app/inventory/overview", text: "1-25 of 2 items", activeFilters: ["Filters : Status Available Reset filters"],
    tables: [table(["", "ID-Tag", "Name", "Location", "Weight (KG)", "Price"], []), {
      headers: [], rows: [["", "[PG-0901]", "Example A", "Marrickville", "10 kg", "A$12 / kg"], ["", "[PG-0901]", "Example A", "Supplier", "90 kg", "A$12 / kg"]],
      rowLinks: [[{ text: "[PG-0901]", href: "https://c-sar.cropster.com/app/inventory/PositionA" }], [{ text: "[PG-0901]", href: "https://c-sar.cropster.com/app/inventory/PositionB" }]],
    }],
  };
  const parsed = parseInventory([snapshot], "2026-02-05");
  assert.equal(parsed.totalKg, 100);
  assert.equal(parsed.allLocationsComplete, true);
  assert.equal(parsed.rows[1].positionId, "PositionB");
  assert.equal(parsed.contracts, undefined);
  assert.throws(() => parseInventory([{ ...snapshot, activeFilters: ["Filters: Status Available Location Marrickville Reset filters"] }], "2026-02-05"), /CROPSTER_SCOPE_UNVERIFIED/);
});

test("blend parser uses displayed percentages and exact linked groups", () => {
  const snapshot = {
    url: "https://c-sar.cropster.com/app/roast/blend-profiles/BlendExample", text: "Details Example Blend Archive Edit General Information Blend components",
    links: [{ text: "Component A", href: "/app/roast/profile-groups/GroupA" }, { text: "Component B", href: "/app/roast/profile-groups/GroupB" }],
    tables: [table(["Profile group", "% of blend"], [["Component A", "40%"], ["Component B", "60%"]])],
  };
  const parsed = parseBlend(snapshot, "BlendExample", "Liberty");
  assert.equal(parsed.components[1].percent, 60);
  assert.equal(parsed.components[0].profileGroupId, "GroupA");
  snapshot.tables[0].rows[1][1] = "50%";
  assert.throws(() => parseBlend(snapshot, "BlendExample", "Liberty"), /CROPSTER_RECIPE_UNAVAILABLE/);
});

test("associated profiles are deduplicated and complete current input IDs retain their source", () => {
  const snapshot = {
    url: "https://c-sar.cropster.com/app/roast/profile-groups/GroupA", text: "Details Component A Archive General Information Default profile Roast A Minimum stock level 50 kg Associated profiles Green inventory\n30 kg\n[PG-0901] Example A\tMarrickville\t10 kg\n[PG-0903] Example C\tSupplier\t20 kg\nView green lots\nRoasted past 30 days",
    links: [{ text: "Roast A", href: "/apps/roast/profiles/ProfileA" }, { text: "Roast A", href: "/apps/roast/profiles/ProfileA" }, { text: "[PG-0901]", href: "/apps/lots/LotA" }, { text: "[PG-0903]", href: "/apps/lots/LotC" }],
  };
  const group = parseProfileGroup(snapshot, "GroupA");
  assert.equal(group.profileUrls.length, 1);
  assert.equal(group.defaultProfileUrl, "https://c-sar.cropster.com/apps/roast/profiles/ProfileA");
  assert.deepEqual(group.lotIds, ["PG-0901", "PG-0903"]);
  assert.deepEqual(group.lotNames, [{ lotId: "PG-0901", name: "Example A" }, { lotId: "PG-0903", name: "Example C" }]);
  assert.throws(() => parseProfileGroup({ ...snapshot, text: snapshot.text.replace("View green lots", "Show 1 - 2 of 3\nView green lots") }, "GroupA"), /CROPSTER_TABLE_INCOMPLETE/);
  assert.throws(() => parseProfileGroup({ ...snapshot, text: snapshot.text.replace("30 kg\n[PG", "31 kg\n[PG") }, "GroupA"), /CROPSTER_RECIPE_UNAVAILABLE/);
  assert.throws(() => parseProfileGroup({ ...snapshot, tables: [{ heading: "Green inventory", rows: [["Example A"]], pagination: "Show 1 - 1 of 3" }] }, "GroupA"), /CROPSTER_TABLE_INCOMPLETE/);
  assert.throws(() => parseProfileGroup({ ...snapshot, tables: [{ heading: "Green inventory", rows: [["[PG-0901] Example A"]], pagination: "Show 1 - 1 of 1" }] }, "GroupA"), /CROPSTER_TABLE_INCOMPLETE/);
  const inputs = table(["", "Blend %", "Lot", "Green weight"], [["", "100%", "[PG-0901] Example A", "10 kg"], ["", "100%", "[PG-0902] Example B", "20 kg"]], [], [[{ text: "[PG-0901]", href: "/apps/lots/PositionA" }], [{ text: "[PG-0902]", href: "/apps/lots/PositionB" }]]);
  inputs.heading = "Components / Green lots";
  assert.deepEqual(parseProfileInputs({ url: group.defaultProfileUrl, text: "Components / Green lots", tables: [inputs], links: [{ text: "[PG-0999] unrelated history", href: "/apps/lots/Unrelated" }] }), { lotIds: ["PG-0901", "PG-0902"] });
});

test("raw recipes neither insert planned replacements nor guess one of multiple local coffees", () => {
  const group = id => ({ id, name: "Group " + id, profileUrls: ["https://c-sar.cropster.com/apps/roast/profiles/" + id], defaultProfileUrl: "https://c-sar.cropster.com/apps/roast/profiles/" + id, lotIds: ["PG-0901", "PG-0903"], lotNames: [{ lotId: "PG-0903", name: "Current group alternative C" }] });
  const groups = [group("A"), group("OH"), group("Decaf")];
  const profileInputs = new Map(groups.map(item => [item.defaultProfileUrl, { lotIds: item.id === "A" ? ["PG-0901", "PG-0902"] : ["PG-0901"] }]));
  const parsed = assembleRecipes({
    blends: [{ name: "Example Blend", signature: "Liberty", components: [{ name: "Group A", profileGroupId: "A", percent: 100 }] }],
    groups, profileInputs, inventory: { rows: [{ lotId: "PG-0901", name: "Coffee A", location: "Marrickville", kg: 10 }, { lotId: "PG-0902", name: "Coffee B", location: "Marrickville", kg: 10 }] },
    asOf: "2026-02-05", ohGroupId: "OH", decafGroupId: "Decaf",
    scheduleAssignments: { complete: true, rows: [] },
  });
  assert.equal(parsed.rows[0].components[0].coffee, null);
  assert.deepEqual(parsed.runoutProfiles[0].lotIds, ["PG-0901", "PG-0903", "PG-0902"]);
  assert.ok(parsed.runoutLotNames.some(row => row.lotId === "PG-0903" && row.name === "Current group alternative C"));
  assert.equal(parsed.runoutProfiles[0].linksComplete, true);
  assert.match(parsed.runoutProfiles[0].note, /Planned contract replacements/);
});

test("runout keeps zero-stock alternatives and templates while a proved empty week permits labelled default pricing", () => {
  const url = id => "https://c-sar.cropster.com/apps/roast/profiles/" + id;
  const groups = [
    { id: "A", name: "Group A", profileUrls: [url("A")], defaultProfileUrl: url("A"), lotIds: ["PG-0901", "PG-0903"], lotNames: [{ lotId: "PG-0903", name: "Current alternative C" }] },
    { id: "OH", name: "Group OH", profileUrls: [url("OH")], defaultProfileUrl: url("OH"), lotIds: ["PG-0904"], lotNames: [] },
    { id: "Decaf", name: "Group Decaf", profileUrls: [url("Decaf")], defaultProfileUrl: url("Decaf"), lotIds: ["PG-0905"], lotNames: [] },
  ];
  const parsed = assembleRecipes({
    blends: [{ name: "Example blend", signature: "Liberty", components: [{ name: "Group A", profileGroupId: "A", percent: 100 }] }],
    groups, profileInputs: new Map([[url("A"), { lotIds: ["PG-0902"] }], [url("OH"), { lotIds: ["PG-0904"] }], [url("Decaf"), { lotIds: ["PG-0905"] }]]),
    inventory: { rows: [{ lotId: "PG-0902", name: "Template coffee B", location: "Marrickville", kg: 10, pricePerKg: 12 }, { lotId: "PG-0904", name: "OH coffee", location: "Marrickville", kg: 10, pricePerKg: 11 }] },
    asOf: "2026-02-05", ohGroupId: "OH", decafGroupId: "Decaf",
    scheduleAssignments: { complete: true, rows: [] },
  });
  assert.equal(parsed.rows[0].components[0].coffee, "Template coffee B");
  assert.equal(parsed.rows[0].components[0].pricingBasis, "default-profile");
  assert.deepEqual(parsed.runoutProfiles[0].lotIds, ["PG-0901", "PG-0903", "PG-0902"]);
  assert.ok(parsed.runoutLotNames.some(row => row.lotId === "PG-0903" && row.name === "Current alternative C"));
  assert.equal(parsed.runoutProfiles[0].plannedLotIds, undefined);
  assert.equal(parsed.runoutProfiles[0].historicalLotIds, undefined);
});
