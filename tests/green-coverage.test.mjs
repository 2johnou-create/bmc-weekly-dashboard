import assert from "node:assert/strict";
import test from "node:test";
import { labReport, mergeGreenCoverage } from "../worker/roastery-lab.js";
import { sydneyDate } from "../worker/metrics.js";

const today = "2026-11-19";
const names = {
  brazil: "Brazil Bom Dia NY2/3 - IAC", colombia: "Colombia Supremo COF", ethiopia: "Ethiopian Sidamo G4 Natural",
  peru: "Peru Callao Cajamarca - IAC", uganda: "Uganda Robusta", oh: "Peru Organic G1 Washed", decaf: "Colombia Tumbuga Decaf",
};
const useRows = [
  [names.brazil, 300], [names.colombia, 100], [names.ethiopia, 50], [names.peru, 120],
  [names.uganda, 80], [names.oh, 200], [names.decaf, 75], ["Unrelated Specialty", 90],
].map(([name, kg]) => ({ name, kg }));
function fixture() {
  return {
    inventory: { asOf: "2026-11-18", rows: [
      { name: names.brazil, location: "Roastery", kg: 100, pricePerKg: 10 },
      { name: names.brazil, location: "Supplier", kg: 500, pricePerKg: 10 },
      { name: names.colombia, location: "Supplier", kg: 0, pricePerKg: 12 },
      ...[names.ethiopia, names.peru, names.oh, names.decaf, "Unrelated Specialty"].map(name => ({ name, location: "Supplier", kg: 300, pricePerKg: 15 })),
    ] },
    recipes: { asOf: "2026-11-18", rows: [
      { name: "Liberty Blend", signature: "Liberty", components: [
        { name: "Liberty Honduras", coffee: names.colombia, percent: 50 },
        { name: "Liberty Brazil", coffee: names.brazil, percent: 30 },
        { name: "Liberty Ethiopia", coffee: names.ethiopia, percent: 20 },
      ] },
      { name: "Rhythm Blend", signature: "Rhythm", components: [
        { name: "Rhythm China", coffee: names.peru, percent: 45 },
        { name: "Rhythm Brazil", coffee: names.brazil, percent: 35 },
        { name: "Rhythm Indonesia", coffee: names.uganda, percent: 20 },
      ] },
      { name: "OH Blend", signature: "OH", components: [{ name: "Peru", coffee: names.oh, percent: 100 }] },
    ] },
    use: { months: ["2026-08", "2026-09", "2026-10"].map(month => ({ month, complete: true, rows: structuredClone(useRows) })) },
  };
}
function contracts() {
  return {
    status: "live", asOf: "2026-11-19T01:00:00.000Z", sourceUrl: "https://docs.google.com/spreadsheets/d/fixture/edit#gid=1",
    sourceUpdatedLabel: "Updated Nov 2026", note: "CONTRACTS as written; bag and tn labels are not converted.", years: [2026, 2027],
    columns: ["B", "C", "D", "F", "G", "H", "I"].map(id => ({
      id, origin: `Plan ${id}`, rateLabel: "10 bags / month", usedFor: id === "D" ? ["Liberty", "Rhythm", "Single origins"] : [],
      cells: [
        { month: "2026-10", state: "gap", text: "", sourceCell: `${id}29` },
        { month: "2026-11", state: "contracted", text: "Recorded supplier", sourceCell: `${id}30` },
        { month: "2026-12", state: id === "D" ? "unknown" : "gap", text: "", sourceCell: `${id}31` },
        { month: "2027-01", state: "contracted", text: "Future planned coffee", sourceCell: `${id}32` },
        { month: "2027-02", state: "gap", text: "", sourceCell: `${id}33` },
      ],
    })),
  };
}

test("coverage uses fixed product lanes while preserving source labels and duplicating shared calendar cells only", () => {
  const report = labReport(fixture(), today);
  const plan = contracts();
  const before = structuredClone({ report, plan });
  const result = mergeGreenCoverage(report.consumption, report.prices, plan, today);
  assert.deepEqual(result.groups.map(group => [group.name, group.columns.map(column => column.sourceColumn)]), [
    ["Liberty", ["B", "C", "D"]], ["Rhythm", ["D", "F", "G"]], ["OH", ["H"]], ["Decaf", ["I"]],
  ]);
  assert.equal(result.groups[0].columns[0].label, "Plan B");
  assert.equal(result.groups[0].columns[0].rateLabel, "10 bags / month");
  assert.equal(result.groups[0].columns[0].cells.find(cell => cell.month === "2027-01").text, "Future planned coffee");
  assert.deepEqual(result.groups[0].columns[2].cells, result.groups[1].columns[0].cells);
  assert.equal(result.groups[0].columns[2].id, "liberty-D");
  assert.equal(result.groups[1].columns[0].id, "rhythm-D");
  assert.equal(result.currentMonth, "2026-11");
  assert.deepEqual(result.years, [2026, 2027]);
  assert.deepEqual({ report, plan }, before);
});

test("actual recipe coffees resolve profile aliases and shared origin consumption is never allocated or counted twice", () => {
  const report = labReport(fixture(), today);
  const result = mergeGreenCoverage(report.consumption, report.prices, contracts(), today);
  const brazil = result.origins.find(origin => origin.name === names.brazil);
  assert.equal(result.origins.filter(origin => origin.name === names.brazil).length, 1);
  assert.equal(brazil.avgMonthlyKg, 300);
  assert.equal(brazil.lastMonthKg, 300);
  assert.equal(brazil.kg, 600);
  assert.deepEqual(brazil.locations, [{ name: "Roastery", kg: 100 }, { name: "Supplier", kg: 500 }]);
  assert.deepEqual(brazil.usedFor, [{ name: "Liberty", percent: 30 }, { name: "Rhythm", percent: 35 }]);
  assert.deepEqual(result.origins.find(origin => origin.name === names.colombia).usedFor, [{ name: "Liberty", percent: 50 }]);
  assert.deepEqual(result.origins.find(origin => origin.name === names.peru).usedFor, [{ name: "Rhythm", percent: 45 }]);
  assert.deepEqual(result.origins.find(origin => origin.name === names.uganda).usedFor, [{ name: "Rhythm", percent: 20 }]);
  assert.equal(result.origins.some(origin => origin.name === "Honduras" || origin.name === "China" || origin.name === "Indonesia"), false);
  assert.equal(result.origins.some(origin => origin.name === "Unrelated Specialty"), false);
  assert.deepEqual(result.origins.find(origin => origin.name === names.decaf).usedFor, [{ name: "Decaf", percent: null }]);
  assert.match(result.originNote, /not allocated to blends/);
});

test("stock-only depletion stays independent of contract continuity and unknown months stop coverage", () => {
  const report = labReport(fixture(), today);
  const result = mergeGreenCoverage(report.consumption, report.prices, contracts(), today);
  assert.equal(result.origins.find(origin => origin.name === names.brazil).depletionMonth, "2027-01");
  const liberty = result.groups[0].columns[0];
  assert.equal(liberty.coverageThrough, "2026-11");
  assert.equal(liberty.firstGapMonth, "2026-12");
  const shared = result.groups[0].columns[2];
  assert.equal(shared.coverageThrough, "2026-11");
  assert.equal(shared.firstGapMonth, "2027-02");
  assert.equal(shared.cells.find(cell => cell.month === "2026-12").state, "unknown");
  assert.equal(shared.cells.find(cell => cell.month === "2027-01").state, "contracted");
  const noCurrent = contracts();
  noCurrent.columns[0].cells = noCurrent.columns[0].cells.filter(cell => cell.month !== "2026-11");
  assert.equal(mergeGreenCoverage(report.consumption, report.prices, noCurrent, today).groups[0].columns[0].coverageThrough, null);
});

test("calendar runout markers use verified current profile aliases, share Brazil and link only the Colombian Decaf", () => {
  const report = labReport(fixture(), today);
  report.consumption.origins.push({ name: "Brazil Santos Decaf NY2/3 SC14/16 Coficom", kg: null, avgMonthlyKg: 10.5, lastMonthKg: 0, locations: [], depletionMonth: null });
  report.consumption.origins.find(origin => origin.name === names.brazil).depletionMonth = "2028-03";
  const plan = contracts();
  plan.columns.find(column => column.id === "I").origin = "Colombia";
  const result = mergeGreenCoverage(report.consumption, report.prices, plan, today);
  const lanes = Object.fromEntries(result.groups.flatMap(group => group.columns.map(column => [column.id, column])));
  assert.equal(lanes["liberty-B"].coffee, names.ethiopia);
  assert.equal(lanes["liberty-C"].coffee, names.colombia);
  assert.equal(lanes["liberty-D"].coffee, names.brazil);
  assert.equal(lanes["rhythm-D"].coffee, names.brazil);
  assert.equal(lanes["rhythm-F"].coffee, names.peru);
  assert.equal(lanes["rhythm-G"].coffee, names.uganda);
  assert.equal(lanes["oh-H"].coffee, names.oh, "a single verified 100% component does not need the OH Peru profile alias");
  assert.equal(lanes["decaf-I"].coffee, names.decaf);
  assert.equal(lanes["decaf-I"].stockDepletionMonth, report.consumption.origins.find(origin => origin.name === names.decaf).depletionMonth);
  assert.equal(lanes["liberty-D"].stockDepletionMonth, "2028-03");
  assert.equal(lanes["rhythm-D"].stockDepletionMonth, "2028-03");
  assert.equal(lanes["rhythm-G"].stockDepletionMonth, null, "unrecorded stock has no runout marker");
  assert.deepEqual(result.years, [2026, 2027, 2028]);
  assert.equal(lanes["liberty-D"].cells.find(cell => cell.month === "2028-03").state, "unknown");
  assert.equal(lanes["liberty-D"].coverageThrough, "2026-11");
  assert.equal(result.origins.filter(origin => origin.usedFor.some(use => use.name === "Decaf")).length, 2);
});

test("unknown or ambiguous profiles, missing exact coffees and ambiguous Colombian Decafs never receive assumed runout markers", () => {
  const base = labReport(fixture(), today);
  const plan = contracts();
  plan.columns.find(column => column.id === "I").origin = "Colombia";
  const altered = structuredClone(base);
  altered.prices.highlights[0].components[0].name = "Unverified profile";
  altered.prices.highlights[1].components.push({ ...altered.prices.highlights[1].components[0] });
  altered.prices.highlights[2].components[0].coffee = "Different exact Peru lot";
  altered.consumption.origins.push({ name: "Colombia Other Decaf", kg: 100, avgMonthlyKg: 10, lastMonthKg: 10, locations: [], depletionMonth: "2028-01" });
  const result = mergeGreenCoverage(altered.consumption, altered.prices, plan, today);
  const lanes = Object.fromEntries(result.groups.flatMap(group => group.columns.map(column => [column.id, column])));
  for (const id of ["liberty-C", "rhythm-F", "oh-H", "decaf-I"]) {
    assert.equal(lanes[id].coffee, null);
    assert.equal(lanes[id].stockDepletionMonth, null);
  }
});

test("depletion uses unrounded stock and monthly use while an old contract calendar includes the current year as unknown", () => {
  const data = {
    inventory: { asOf: "2026-11-18", rows: [{ name: "Precise origin", location: "Supplier", kg: 4.134, pricePerKg: 10 }] },
    use: { months: [
      { month: "2026-08", complete: true, rows: [{ name: "Precise origin", kg: 10 }] },
      { month: "2026-09", complete: true, rows: [{ name: "Precise origin", kg: 10 }] },
      { month: "2026-10", complete: true, rows: [{ name: "Precise origin", kg: 11 }] },
    ] },
  };
  const report = labReport(data, today);
  assert.equal(report.consumption.origins[0].avgMonthlyKg, 10.33);
  assert.equal(report.consumption.origins[0].kg, 4.13);
  assert.equal(report.consumption.origins[0].depletionMonth, "2026-12");
  assert.equal(report.consumption.origins[0].depletionMonth, report.consumption.forecasts[0].depletionMonth);
  const result = mergeGreenCoverage({}, {}, contracts(), "2028-04-01");
  assert.deepEqual(result.years, [2026, 2027, 2028]);
  assert.equal(result.currentYear, 2028);
  assert.equal(result.groups[0].columns[0].cells.find(cell => cell.month === "2028-04").state, "unknown");
  assert.equal(result.groups[0].columns[0].coverageThrough, null);
});

test("origin use includes zero or unrecorded stock and keeps incomplete months unknown", () => {
  const data = fixture();
  let report = labReport(data, today);
  const uganda = report.consumption.origins.find(origin => origin.name === names.uganda);
  assert.equal(uganda.kg, null);
  assert.equal(uganda.avgMonthlyKg, 80);
  assert.equal(uganda.lastMonthKg, 80);
  assert.equal(uganda.depletionMonth, null);
  assert.equal(report.consumption.origins.find(origin => origin.name === names.colombia).kg, 0);
  data.use.months[2] = { month: "2026-10", complete: false, rows: [] };
  report = labReport(data, today);
  assert.equal(report.consumption.origins.find(origin => origin.name === names.brazil).avgMonthlyKg, null);
  assert.equal(report.consumption.origins.find(origin => origin.name === names.brazil).lastMonthKg, null);
  data.use.months[2].complete = true;
  report = labReport(data, today);
  assert.equal(report.consumption.origins.find(origin => origin.name === names.brazil).avgMonthlyKg, 200);
  assert.equal(report.consumption.origins.find(origin => origin.name === names.brazil).lastMonthKg, 0);
});

test("no unverified coffee substitutions are inferred and multiple explicit Decaf origins stay separate", () => {
  const report = labReport(fixture(), today);
  report.prices.highlights[0].components[0].coffee = "Different verified lot";
  report.consumption.origins.push({ name: "Other Decaf", kg: 100, avgMonthlyKg: 10, lastMonthKg: 10, locations: [], depletionMonth: "2027-01" });
  const result = mergeGreenCoverage(report.consumption, report.prices, contracts(), today);
  const unknown = result.origins.find(origin => origin.name === "Different verified lot");
  assert.equal(unknown.kg, null);
  assert.equal(unknown.avgMonthlyKg, null);
  assert.equal(result.origins.some(origin => origin.name === names.colombia), false);
  const decafs = result.origins.filter(origin => origin.usedFor.some(use => use.name === "Decaf"));
  assert.deepEqual(decafs.map(origin => origin.name), [names.decaf, "Other Decaf"]);
  assert.deepEqual(decafs.map(origin => origin.usedFor), [[{ name: "Decaf", percent: null }], [{ name: "Decaf", percent: null }]]);
  assert.equal(decafs[0].kg, 300);
  assert.equal(decafs[1].kg, 100);
  assert.match(result.originNote, /shown separately/);
});

test("a historical Decaf with unrecorded current stock remains visible beside current Decaf inventory", () => {
  const report = labReport(fixture(), today);
  report.consumption.origins.push({ name: "Brazil Santos Decaf NY2/3 SC14/16 Coficom", kg: null, avgMonthlyKg: 10.5, lastMonthKg: 0, locations: [], depletionMonth: null });
  const result = mergeGreenCoverage(report.consumption, report.prices, contracts(), today);
  const historical = result.origins.find(origin => origin.name === "Brazil Santos Decaf NY2/3 SC14/16 Coficom");
  assert.deepEqual(historical.usedFor, [{ name: "Decaf", percent: null }]);
  assert.equal(historical.kg, null);
  assert.equal(historical.avgMonthlyKg, 10.5);
  assert.equal(historical.lastMonthKg, 0);
  assert.equal(result.origins.filter(origin => origin.name === names.decaf).length, 1);
});

test("missing or duplicate source months remain unknown, without converting bag labels to kilograms", () => {
  const missing = mergeGreenCoverage(undefined, undefined, undefined, today);
  assert.equal(missing.status, "unavailable");
  assert.deepEqual(missing.origins, []);
  assert.deepEqual(missing.years, [2026]);
  assert.equal(missing.groups.length, 4);
  const plan = contracts();
  plan.columns[0].cells.push({ month: "2026-11", state: "contracted", text: "Conflicting entry", sourceCell: "B99" });
  const result = mergeGreenCoverage({}, {}, plan, today);
  assert.equal(result.groups[0].columns[0].cells.find(cell => cell.month === "2026-11").state, "unknown");
  assert.equal(result.groups[0].columns[0].coverageThrough, null);
  assert.equal("kg" in result.groups[0].columns[0], false);
});

test("two-month labels use actual origin green input independently of three-month forecasts and recipe shares", () => {
  const data = fixture();
  for (const [index, kg] of [900, 100, 200].entries()) data.use.months[index].rows.find(row => row.name === names.brazil).kg = kg;
  const historicalDecaf = "Brazil Santos Decaf NY2/3 SC14/16 Coficom";
  for (const [index, kg] of [100, 20, 0].entries()) data.use.months[index].rows.push({ name: historicalDecaf, kg });
  const report = labReport(data, today);
  const plan = contracts();
  plan.columns.find(column => column.id === "I").origin = "Colombia";
  const result = mergeGreenCoverage(report.consumption, report.prices, plan, today);
  const origin = result.origins.find(item => item.name === names.brazil);
  const lanes = Object.fromEntries(result.groups.flatMap(group => group.columns.map(column => [column.id, column])));
  assert.equal(origin.avgMonthlyKg, 400);
  assert.equal(origin.twoMonthAverageKg, 150);
  assert.equal(origin.depletionMonth, "2027-01");
  assert.equal(lanes["liberty-D"].twoMonthAverageKg, 150);
  assert.equal(lanes["rhythm-D"].twoMonthAverageKg, 150);
  assert.equal(lanes["liberty-C"].twoMonthAverageKg, 100, "Honduras profile resolves the actual Colombian coffee");
  assert.equal(lanes["rhythm-F"].twoMonthAverageKg, 120, "China profile resolves the actual Peruvian coffee");
  assert.equal(lanes["rhythm-G"].twoMonthAverageKg, 80, "unrecorded stock does not hide known origin use");
  assert.equal(lanes["decaf-I"].twoMonthAverageKg, 75);
  assert.equal(result.origins.find(item => item.name === historicalDecaf).twoMonthAverageKg, 10);
  assert.deepEqual(result.twoMonthAverageMonths, ["2026-09", "2026-10"]);
  assert.deepEqual(report.consumption.twoMonthAverageMonths, result.twoMonthAverageMonths);
  report.prices.highlights[0].components[0].name = "Unknown profile";
  assert.equal(mergeGreenCoverage(report.consumption, report.prices, plan, today).groups[0].columns[1].twoMonthAverageKg, null);
});

test("two-month averages require both complete month reports, treating absent coffee in a complete report as zero", () => {
  const average = data => labReport(data, today).consumption.origins.find(origin => origin.name === names.brazil).twoMonthAverageKg;
  const data = fixture();
  data.use.months[2].rows.find(row => row.name === names.brazil).kg = 200;
  data.use.months[1].rows = data.use.months[1].rows.filter(row => row.name !== names.brazil);
  assert.equal(average(data), 100);
  data.use.months[2].rows = data.use.months[2].rows.filter(row => row.name !== names.brazil);
  assert.equal(average(data), 0);
  data.use.months[1].complete = false;
  data.use.months[1].rows.push({ name: names.brazil, kg: 200 });
  assert.equal(average(data), null, "a row in an incomplete month is insufficient");
  data.use.months.splice(1, 1);
  assert.equal(average(data), null, "a missing complete month is not zero");
  const report = labReport(data, today);
  const result = mergeGreenCoverage(report.consumption, report.prices, contracts(), today);
  assert.deepEqual(result.twoMonthAverageMonths, ["2026-09", "2026-10"]);
  assert.equal(result.groups[0].columns[2].twoMonthAverageKg, null);
  const oldMissing = fixture();
  oldMissing.use.months[0].complete = false;
  assert.equal(average(oldMissing), 300, "only the latest two complete months establish the new rate");
});

test("Sydney New Year rolls the two-month period from October–November to November–December and excludes current-month data", () => {
  const data = fixture();
  data.use.months = [
    { month: "2026-10", complete: true, rows: [{ name: names.brazil, kg: 10 }] },
    { month: "2026-11", complete: true, rows: [{ name: names.brazil, kg: 20 }] },
    { month: "2026-12", complete: true, rows: [{ name: names.brazil, kg: 30 }] },
    { month: "2027-01", complete: false, rows: [{ name: names.brazil, kg: 999_999 }] },
  ];
  const beforeDate = sydneyDate(new Date("2026-12-31T12:59:59Z"));
  const afterDate = sydneyDate(new Date("2026-12-31T13:00:00Z"));
  const before = labReport(data, beforeDate);
  const after = labReport(data, afterDate);
  assert.deepEqual(before.consumption.twoMonthAverageMonths, ["2026-10", "2026-11"]);
  assert.equal(before.consumption.origins.find(origin => origin.name === names.brazil).twoMonthAverageKg, 15);
  assert.deepEqual(after.consumption.twoMonthAverageMonths, ["2026-11", "2026-12"]);
  assert.equal(after.consumption.origins.find(origin => origin.name === names.brazil).twoMonthAverageKg, 25);
  const result = mergeGreenCoverage(after.consumption, after.prices, contracts(), afterDate);
  assert.deepEqual(result.twoMonthAverageMonths, ["2026-11", "2026-12"]);
  assert.equal(result.groups[0].columns[2].twoMonthAverageKg, 25);
  const missing = mergeGreenCoverage(labReport({}, afterDate).consumption, {}, {}, afterDate);
  assert.deepEqual(missing.twoMonthAverageMonths, ["2026-11", "2026-12"]);
});
