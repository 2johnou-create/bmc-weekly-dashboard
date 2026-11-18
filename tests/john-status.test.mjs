import assert from "node:assert/strict";
import test from "node:test";
import { deriveJohnStatus } from "../worker/john-status.js";

function report() {
  return {
    week: { start: "2026-11-16", isCurrent: true },
    metrics: {
      demand: { status: "live", kg: 100, previousKg: 100 },
      production: { status: "live", roastedKg: 50, scheduledKg: 50, totalKg: 100, previousRoastedKg: 100, previousScheduledKg: 0, previousKg: 100 },
      wholesale: { status: "live", orders: 10, done: 5, pending: 5, provisional: false },
    },
  };
}

test("John's scores use known plan progress and a comparable workload", () => {
  const value = deriveJohnStatus(report());
  assert.equal(value.weekStart, "2026-11-16");
  assert.equal(value.workload.score, 3);
  assert.equal(value.energy.score, 3);
  assert.equal(value.emotion.score, 3);
  assert.match(value.energy.reason, /50% average plan progress/);
  assert.match(value.emotion.reason, /50 of 100 kg roasted; 50 kg remains scheduled/);
  assert.match(value.emotion.reason, /5 of 10 primary orders done; 5 pending/);
  assert.match(value.sourceNote, /Playful game estimates for virtual John/);
  assert.match(value.sourceNote, /do not measure a person/);
});

test("the heaviest comparable volume sets workload and reduces game energy while work remains", () => {
  const baseline = deriveJohnStatus(report());
  const busy = report();
  busy.metrics.demand.kg = 130;
  const value = deriveJohnStatus(busy);
  assert.equal(value.workload.score, 5);
  assert.equal(value.energy.score, 2);
  assert.equal(value.emotion.score, baseline.emotion.score);
  assert.match(value.workload.reason, /Demand: 130 kg versus 100 kg last week \(\+30%\)/);
  busy.metrics.demand.kg = 80;
  Object.assign(busy.metrics.production, { roastedKg: 75, scheduledKg: 75, totalKg: 150 });
  const productionBusy = deriveJohnStatus(busy);
  assert.equal(productionBusy.workload.score, 5);
  assert.match(productionBusy.workload.reason, /Production plan: 150 kg versus 100 kg/);
});

test("workload bands have deterministic boundaries including exact ten-percent decreases", () => {
  for (const [kg, score] of [[75, 1], [90, 2], [99, 3], [109, 3], [110, 4], [124, 4], [125, 5]]) {
    const weekly = report();
    weekly.metrics.demand.kg = kg;
    weekly.metrics.production.previousScheduledKg = null;
    assert.equal(deriveJohnStatus(weekly).workload.score, score, `${kg}kg`);
  }
});

test("missing values stay unknown and a total never replaces an unknown schedule", () => {
  const missing = deriveJohnStatus({ week: report().week, metrics: {} });
  for (const name of ["energy", "workload", "emotion"]) {
    assert.equal(missing[name].score, null);
    assert.equal(missing[name].label, "Unknown");
  }
  const weekly = report();
  weekly.metrics.production.scheduledKg = null;
  weekly.metrics.wholesale = { status: "unavailable", orders: 10, done: 10, pending: 0 };
  const value = deriveJohnStatus(weekly);
  assert.equal(value.workload.score, 3);
  assert.equal(value.energy.score, null);
  assert.equal(value.emotion.score, null);
  assert.match(value.emotion.reason, /without both roasted and outstanding scheduled/);
});

test("current provisional dispatch contributes only coherent counts and is identified as unconfirmed", () => {
  const weekly = report();
  weekly.metrics.wholesale = { status: "partial", provisional: true, orders: null, pending: null, scheduledOrders: 10, done: 5, scheduledPendingOrders: 5 };
  const value = deriveJohnStatus(weekly);
  assert.equal(value.emotion.score, 3);
  assert.match(value.emotion.reason, /unconfirmed saved schedule: 5 of 10 primary orders done; 5 pending/);
  assert.match(value.emotion.reason, /partial source coverage/);
  weekly.metrics.wholesale.scheduledPendingOrders = 10;
  const inconsistent = deriveJohnStatus(weekly);
  assert.match(inconsistent.emotion.reason, /Dispatch progress is unknown/);
  assert.match(inconsistent.summary, /source coverage is missing/);
});

test("legacy handover counts and last-week dispatch counts cannot become current primary-order progress", () => {
  const weekly = report();
  weekly.metrics.production = { status: "unavailable" };
  weekly.metrics.wholesale = { status: "partial", orders: 10, done: null, pending: null, completed: 100, previousDone: 50, previousPending: 0 };
  const value = deriveJohnStatus(weekly);
  assert.equal(value.emotion.score, null);
  assert.equal(value.energy.score, null);
  assert.equal(value.workload.score, 3);
});

test("stale and partial readings retain their explicit source coverage in the explanations", () => {
  const weekly = report();
  weekly.metrics.demand.status = "partial";
  weekly.metrics.production.status = "stale";
  weekly.metrics.wholesale.status = "stale";
  const value = deriveJohnStatus(weekly);
  assert.match(value.workload.reason, /Demand has partial source coverage/);
  assert.match(value.workload.reason, /Cropster reading is stale/);
  assert.match(value.energy.reason, /Cropster reading is stale/);
  assert.match(value.emotion.reason, /Dispatch reading is stale/);
});

test("verified empty queues are clear, while a zero baseline never invents a percentage comparison", () => {
  const weekly = report();
  weekly.metrics.demand.kg = 0;
  Object.assign(weekly.metrics.production, { roastedKg: 0, scheduledKg: 0, totalKg: 0 });
  weekly.metrics.wholesale = { status: "live", orders: 0, done: 0, pending: 0 };
  const value = deriveJohnStatus(weekly);
  assert.equal(value.workload.score, 1);
  assert.equal(value.energy.score, 5);
  assert.equal(value.emotion.score, 5);
  assert.match(value.emotion.reason, /zero roasted kilograms and zero outstanding/);
  assert.match(value.emotion.reason, /no primary orders recorded/);
  weekly.metrics.demand.previousKg = 0;
  Object.assign(weekly.metrics.production, { previousRoastedKg: 0, previousScheduledKg: 0, previousKg: 0 });
  const noBaseline = deriveJohnStatus(weekly);
  assert.equal(noBaseline.workload.score, null);
  assert.equal(noBaseline.energy.score, null);
  assert.equal(noBaseline.emotion.score, 5);
  assert.doesNotMatch(JSON.stringify(noBaseline), /Infinity|NaN/);
});

test("invalid or unavailable source values and inconsistent production totals are not scored", () => {
  for (const invalid of [null, undefined, NaN, Infinity, -1, "100"]) {
    const weekly = report();
    weekly.metrics.demand.kg = invalid;
    weekly.metrics.production.roastedKg = invalid;
    weekly.metrics.wholesale.done = invalid;
    const value = deriveJohnStatus(weekly);
    assert.equal(value.workload.score, null);
    assert.equal(value.energy.score, null);
    assert.equal(value.emotion.score, null);
  }
  const weekly = report();
  weekly.metrics.demand.status = "unavailable";
  weekly.metrics.production.totalKg = 200;
  weekly.metrics.wholesale.pending = 9;
  const value = deriveJohnStatus(weekly);
  assert.equal(value.energy.score, null);
  assert.equal(value.workload.score, null);
  assert.equal(value.emotion.score, null);
});

test("historical and unverified-week inputs do not produce current-week game estimates", () => {
  for (const weekly of [undefined, {}, { ...report(), week: { start: "2026-11-16", isCurrent: false } }, { ...report(), week: { start: "2026-11-17", isCurrent: true } }, { ...report(), week: { start: "2026-11-16" } }]) {
    const value = deriveJohnStatus(weekly);
    assert.equal(value.energy.score, null);
    assert.equal(value.workload.score, null);
    assert.equal(value.emotion.score, null);
    assert.match(value.summary, /waiting/);
  }
});

test("the exact DTO is deterministic and does not mutate report data or add a cheer boost", () => {
  const weekly = report();
  const before = structuredClone(weekly);
  const first = deriveJohnStatus(weekly);
  assert.deepEqual(first, deriveJohnStatus(weekly));
  assert.deepEqual(weekly, before);
  assert.deepEqual(Object.keys(first), ["energy", "workload", "emotion", "summary", "sourceNote", "weekStart"]);
  for (const name of ["energy", "workload", "emotion"]) {
    assert.deepEqual(Object.keys(first[name]), ["score", "label", "reason"]);
    assert.ok(Number.isInteger(first[name].score) && first[name].score >= 1 && first[name].score <= 5);
  }
});
