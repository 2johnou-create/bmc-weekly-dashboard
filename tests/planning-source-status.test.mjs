import assert from "node:assert/strict";
import test from "node:test";
import { sourceSyncSummary } from "../worker/source-sync.js";

function report() {
  return {
    weekly: { generatedAt: "2026-11-20T01:00:00Z", metrics: {}, cropsterRefresh: {
      mode: "website-reader", status: "refreshed",
      labParts: Object.fromEntries(["inventory", "recipes", "use", "loss"].map(part => [part, { status: "updated" }])),
    } },
    lab: { purchases: { status: "live", asOf: "2026-11-20T01:00:00Z", contracts: { status: "live" }, greenForecast: { status: "live" } },
      coffeeC: { status: "delayed" }, settings: { status: "available" } },
  };
}
const planning = value => sourceSyncSummary(value).sources.find(item => item.id === "planning");

test("a loaded purchase calendar with excluded dates is partial rather than a failed workbook read", () => {
  const value = report();
  value.lab.purchases.status = "partial";
  value.lab.purchases.note = "Some older entries have missing or invalid order dates and are excluded.";
  const result = planning(value);
  assert.equal(result.status, "partial");
  assert.equal(result.asOf, value.lab.purchases.asOf);
  assert.match(result.note, /Calendar loaded.*missing or invalid order dates/);
  assert.doesNotMatch(result.note, /older/);
  assert.equal(sourceSyncSummary(value).status, "partial");
});

test("any partial planning projection retains its specific quality note while unavailable projections fail", () => {
  for (const part of ["contracts", "greenForecast"]) {
    const value = report();
    value.lab.purchases[part] = { status: "partial", note: "Synthetic source quality issue." };
    assert.equal(planning(value).status, "partial");
    assert.match(planning(value).note, /Synthetic source quality issue/);
    value.lab.purchases[part].status = "unavailable";
    assert.equal(planning(value).status, "failed");
    delete value.lab.purchases[part];
    assert.equal(planning(value).status, "failed");
  }
  const value = report();
  value.lab.purchases.status = "unavailable";
  assert.equal(planning(value).status, "failed");
});

test("fully read planning projections remain updated and the Steam Room forecast preserves partial status", () => {
  const value = report();
  assert.equal(planning(value).status, "updated");
  assert.equal(sourceSyncSummary(value).status, "complete");
  const standalone = { weekly: { metrics: { expenses: { greenForecast: { status: "partial", note: "Dates need review." } } } } };
  assert.equal(planning(standalone).status, "partial");
  assert.equal(planning(standalone).note, "Dates need review.");
});
