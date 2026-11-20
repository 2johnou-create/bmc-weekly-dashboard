import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserReader } from "../src/browser.mjs";
import { dateLabel } from "../src/dates.mjs";
import { ReaderError } from "../src/errors.mjs";
import { cloneCheckpoint } from "../src/checkpoint.mjs";
import { weekSnapshot } from "./week-schedule.fixture.mjs";
import { legacyInventorySnapshot } from "./legacy-inventory.fixture.mjs";
import { createRefreshControl } from "../src/refresh-control.mjs";

const origin = "https://c-sar.cropster.com";
const table = (headers, rows, footers = []) => ({ headers, rows, footers, pagination: `Show 1 - ${rows.length} of ${rows.length}` });

function sourceSnapshot(address) {
  const url = new URL(address);
  if (url.pathname === "/apps/roast/schedule/calendar/day") {
    const day = url.searchParams.get("date");
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(day + "T12:00:00Z"));
    return { url: address, text: `${label}, in Marrickville No coffees scheduled No profiles scheduled No green lots scheduled`, tables: [], scheduleStatuses: { unpublished: true, scheduled: true, synced: true, roasted: true, inconsistent: true }, scheduleMachines: { M1: true }, calendarDay: { tiles: [], states: [] } };
  }
  if (url.pathname === "/app/inventory/overview") return {
    url: address, text: "1-25 of 1 items", activeFilters: ["Filters: Status Available Reset filters"],
    tables: [table(["", "ID-Tag", "Name", "Location", "Weight (KG)", "Price"], []), { headers: [], rows: [["", "[PG-0901]", "Example coffee", "Marrickville", "10 kg", "A$10 / kg"]] }],
  };
  if (url.pathname === "/apps/lots/inventory-report/location") return {
    url: address, text: "Green Inventory Report for February 5, 2026 Values refer to the inventory on February 5, 2026",
    tables: [table(["Location", "Weight", "Total value"], [["Marrickville", "10 kg", "$ 100.00 AUD"]])],
  };
  const from = url.searchParams.get("dateFrom"), to = url.searchParams.get("dateTo");
  const text = `Production report from ${dateLabel(from)} to ${dateLabel(to)} Locations ${url.searchParams.get("locations") ? "Marrickville " : ""}Average`;
  if (url.pathname.endsWith("/profile-group")) return {
    url: address, text,
    tables: [table(["", "Component Name", "Amount roasted", "Batches", "Amount of green"], [["", "Example component", "8.5 kg", "1", "10 kg"]], [["", "Total", "8.5 kg", "1", "10 kg"]])],
  };
  if (url.pathname.endsWith("/inventory")) return {
    url: address, text,
    tables: [table(["", "Lot ID-Tag", "Name", "Amount of green", "Total price*"], [["", "PG-0901", "Example coffee", "10 kg", "$ 100.00 AUD"]], [["", "Total", "", "10 kg", "$ 100.00 AUD"]])],
  };
  throw new Error("Unexpected synthetic source path");
}

function simulatedBrowser({ failPrevious = false, fastWeek = false, inventoryFailures = 0, extraInventory = false, legacyInventory = false, invalidLegacyScope = false, onVisit, transformWeek } = {}) {
  const visits = [], waits = [], navigations = [];
  const context = { async newPage() {
    let address;
    return {
      setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {}, close: async () => {},
      async goto(value, options) {
        navigations.push({ address: value, ...options });
        visits.push(value); address = value;
        if (onVisit) onVisit(value);
        if (failPrevious && new URL(value).searchParams.get("dateFrom") === "2026-01-26") throw new ReaderError("CROPSTER_AUTH_REQUIRED");
      },
      url: () => address,
      waitForFunction: async (_predicate, kind, options) => {
        waits.push({ kind, ...options });
        if (kind === "prices" && inventoryFailures-- > 0) { const error = new Error("Synthetic timeout with private text"); error.name = "TimeoutError"; throw error; }
      },
      locator: selector => ({ isVisible: async () => false, count: async () => selector.includes("-status-") ? 1 : 0, check: async () => {} }),
      getByRole: () => ({ count: async () => 0 }),
      evaluate: async () => {
        if (legacyInventory && new URL(address).pathname === "/apps/lots/inventory-report") {
          const snapshot = legacyInventorySnapshot();
          if (invalidLegacyScope) snapshot.legacyInventoryScope.consumedControls[0].checked = true;
          return snapshot;
        }
        const snapshot = new URL(address).pathname === "/apps/roast/schedule/calendar/week" && fastWeek ? { ...weekSnapshot(), url: address } : structuredClone(sourceSnapshot(address));
        if (transformWeek && new URL(address).pathname === "/apps/roast/schedule/calendar/week") transformWeek(snapshot);
        if (extraInventory && new URL(address).pathname === "/app/inventory/overview") {
          snapshot.text = "1-25 of 2 items";
          snapshot.tables[1].rows.push(["", "[PG-0902]", "Example second coffee", "Marrickville", "20 kg", "A$12 / kg"]);
        }
        return snapshot;
      },
    };
  } };
  return { visits, waits, navigations, browser: { isConnected: () => true, newContext: async () => context, close: async () => {} } };
}

test("real orchestration publishes coherent weekly data before retrospective and Lab source visits", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 1, 5) + tick++);
  const source = simulatedBrowser(), checkpoints = [];
  const reader = createBrowserReader({ timeoutMs: 10000, chromiumSandbox: false }, { now, launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { scope: "all", onCapture: async snapshot => {
    if (checkpoints.length === 0) {
      assert.equal(source.visits.some(address => new URL(address).searchParams.get("dateFrom") === "2026-01-26"), false);
      assert.deepEqual(Object.keys(snapshot.lab), ["inventory"]);
      assert.equal(snapshot.production.roastedKg, 8.5);
      assert.equal(snapshot.production.scheduledKg, 0);
      assert.equal(snapshot.mondayRoastedKg, 8.5);
      assert.equal(snapshot.green.kg, 10);
    }
    checkpoints.push(snapshot);
  } });
  assert.ok(checkpoints.length >= 4);
  assert.equal(checkpoints[0].lab.use, undefined);
  assert.equal(result.lab.use.months.length, 3);
  assert.equal(result.productionObservedAt, checkpoints[0].productionObservedAt);
  assert.equal(result.labObservedAt.inventory, checkpoints[0].labObservedAt.inventory);
  assert.ok(Date.parse(result.labObservedAt.use) > Date.parse(checkpoints[0].productionObservedAt));
  assert.ok(Date.parse(result.observedAt) > Date.parse(checkpoints[0].observedAt));
  assert.equal(checkpoints[0].previousProduction, undefined);
  assert.equal(result.previousProduction.weekStart, "2026-01-26");
  checkpoints[0].production.roastedKg = 999;
  assert.equal(result.production.roastedKg, 8.5, "Later snapshots must not share the earlier checkpoint's mutable object");
  await reader.close();
});

test("a retrospective failure occurs after the verified weekly checkpoint has been emitted", async () => {
  const source = simulatedBrowser({ failPrevious: true }), checkpoints = [];
  const reader = createBrowserReader({ timeoutMs: 10000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  await assert.rejects(reader.read("2026-02-02", { scope: "all", onCapture: snapshot => checkpoints.push(snapshot) }), /CROPSTER_AUTH_REQUIRED/);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].production.roastedKg, 8.5);
  assert.equal(checkpoints[0].lab.use, undefined);
  await reader.close();
});

test("checkpoint finalisation updates only the overall time and preserves every source timestamp", () => {
  const sectionTime = "2026-02-05T00:00:00Z";
  const original = { observedAt: sectionTime, productionObservedAt: sectionTime, greenObservedAt: sectionTime, mondayObservedAt: sectionTime, previousProductionObservedAt: sectionTime, labObservedAt: { inventory: sectionTime, use: sectionTime } };
  const updated = cloneCheckpoint(original, () => new Date("2026-02-05T00:20:00Z"));
  assert.equal(updated.observedAt, "2026-02-05T00:20:00.000Z");
  for (const key of ["productionObservedAt", "greenObservedAt", "mondayObservedAt", "previousProductionObservedAt"]) assert.equal(updated[key], sectionTime);
  assert.deepEqual(updated.labObservedAt, original.labObservedAt);
  updated.labObservedAt.inventory = "changed";
  assert.equal(original.labObservedAt.inventory, sectionTime);
});

test("the verified weekly path uses two week views and keeps independent sources outside production coherence", async () => {
  const source = simulatedBrowser({ fastWeek: true }), stages = [];
  const reader = createBrowserReader({ timeoutMs: 10000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { onProgress: stage => stages.push(stage) });
  assert.equal(result.production.scheduledKg, 16.25);
  assert.deepEqual(result.scheduledBatches, { greenKg: 20, batches: 2 });
  assert.equal(result.schedulePlan, undefined);
  assert.equal(source.visits.filter(address => new URL(address).pathname.endsWith("/calendar/week")).length, 2);
  assert.equal(source.visits.filter(address => new URL(address).pathname.endsWith("/calendar/day")).length, 0);
  const started = stage => stages.findIndex(item => item.stage === stage && item.state === "running");
  const before = started("weekly_production_before"), after = started("weekly_production_after");
  for (const stage of ["inventory", "green_marrickville", "weekly_monday"]) assert.ok(started(stage) < before, stage);
  assert.ok(started("weekly_schedule_week") > before && started("weekly_schedule_verify_week") < after);
  await reader.close();
});

test("one warm inventory retry enriches saved prices without freshening verified schedule weights", async () => {
  let tick = 0;
  const source = simulatedBrowser({ fastWeek: true, inventoryFailures: 1, extraInventory: true }), checkpoints = [];
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date(Date.UTC(2026, 1, 5) + tick++), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { scope: "all", onCapture: snapshot => checkpoints.push(snapshot) });
  assert.equal(checkpoints[0].production.scheduledValue, null);
  assert.equal(checkpoints[0].lab.inventory, undefined);
  assert.equal(checkpoints[1].production.scheduledValue, 230);
  assert.equal(result.lab.inventory.rows.length, 2);
  assert.equal(checkpoints[1].production.scheduledKg, checkpoints[0].production.scheduledKg);
  assert.equal(checkpoints[1].production.roastedKg, checkpoints[0].production.roastedKg);
  assert.equal(checkpoints[1].productionObservedAt, checkpoints[0].productionObservedAt);
  assert.ok(Date.parse(checkpoints[1].labObservedAt.inventory) > Date.parse(checkpoints[0].productionObservedAt));
  assert.equal(checkpoints[1].warnings.includes("INVENTORY_UNAVAILABLE"), false);
  assert.equal(checkpoints[1].warnings.includes("SCHEDULED_COST_UNAVAILABLE"), false);
  assert.equal(source.visits.filter(address => new URL(address).pathname === "/app/inventory/overview").length, 2);
  assert.ok(source.waits.filter(wait => wait.kind === "prices").every(wait => wait.timeout === 120000));
  assert.ok(source.navigations.every(navigation => navigation.timeout <= 45000));
  await reader.close();
});

test("a second unavailable inventory leaves a verified weekly checkpoint and does not retry forever", async () => {
  const source = simulatedBrowser({ fastWeek: true, inventoryFailures: 2 }), checkpoints = [];
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { onCapture: snapshot => checkpoints.push(snapshot) });
  assert.equal(checkpoints.length, 1);
  assert.equal(result.production.scheduledKg, 16.25);
  assert.equal(result.production.scheduledValue, null);
  assert.ok(result.warnings.includes("INVENTORY_UNAVAILABLE"));
  assert.equal(source.visits.filter(address => new URL(address).pathname === "/app/inventory/overview").length, 2);
  await reader.close();
});

test("verified legacy stock is the primary inventory path and skips the modern app", async () => {
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true });
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { scope: "all" });
  assert.equal(result.lab.inventory.rows.length, 3);
  assert.equal(result.lab.inventory.rows[1].positionId, "PositionB");
  assert.equal(result.production.scheduledValue, 230);
  assert.equal(source.visits.filter(address => new URL(address).pathname === "/app/inventory/overview").length, 0);
  assert.equal(source.visits.filter(address => new URL(address).pathname === "/apps/lots/inventory-report").length, 1);
  await reader.close();
});

test("unproven legacy scope falls back to the bounded modern inventory reader", async () => {
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true, invalidLegacyScope: true, extraInventory: true });
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { scope: "all" });
  assert.equal(result.lab.inventory.rows.length, 2);
  assert.equal(source.visits.filter(address => new URL(address).pathname === "/app/inventory/overview").length, 1);
  await reader.close();
});

test("an explicit joined refresh rechecks edited schedules at the next Lab view boundary and coalesces repeat clicks", async () => {
  const control = createRefreshControl(), checkpoints = [], stages = [];
  let changed = false, tick = 0;
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true,
    onVisit(address) {
      if (!changed && new URL(address).searchParams.get("dateFrom") === "2026-01-26") {
        changed = true;
        for (let index = 0; index < 5; index++) control.request();
      }
    },
    transformWeek(snapshot) {
      if (!changed) return;
      snapshot.tables[0].rows[0][2] = "10 kg\nComponent A: 5 kg\nComponent B: 5 kg";
      snapshot.tables[1].rows[1][2] = "5 kg";
      snapshot.tables[1].rows[1][3] = "15 kg";
      snapshot.tables[2].rows[1][1] = "5 kg";
      snapshot.calendarWeek.rows[0].states[1] = ["roasted", "synced"];
    },
  });
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date(Date.UTC(2026, 1, 5) + tick++), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { scope: "all", refreshControl: control, onProgress: stage => stages.push(stage), onCapture: capture => checkpoints.push(capture) });
  assert.equal(checkpoints[0].production.scheduledKg, 16.25);
  assert.equal(checkpoints[1].production.scheduledKg, 8.25);
  assert.deepEqual(checkpoints[1].scheduledBatches, { greenKg: 10, batches: 2 });
  assert.equal(result.production.scheduledKg, 8.25);
  assert.ok(Date.parse(checkpoints[1].productionObservedAt) > Date.parse(checkpoints[0].productionObservedAt));
  assert.ok(Date.parse(checkpoints[1].greenObservedAt) > Date.parse(checkpoints[0].greenObservedAt));
  assert.equal(stages.filter(stage => stage.stage === "weekly_refresh" && stage.state === "complete").length, 1);
  const priorityComplete = stages.findIndex(stage => stage.stage === "weekly_refresh" && stage.state === "complete");
  assert.ok(stages.findIndex(stage => stage.stage === "previous_cost" && stage.state === "running") > priorityComplete);
  assert.equal(source.visits.filter(address => new URL(address).pathname.endsWith("/calendar/week")).length, 4);
  assert.equal(control.hasPending(), false);
  assert.equal(control.isAccepting(), false);
  await reader.close();
});

test("an explicit request at the final checkpoint cannot be lost before job completion", async () => {
  const control = createRefreshControl(), checkpoints = [];
  let requested = false, tick = 0;
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true });
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date(Date.UTC(2026, 1, 5) + tick++), launch: async () => source.browser });
  await reader.read("2026-02-02", { scope: "all", refreshControl: control, onCapture: capture => {
    checkpoints.push(capture);
    if (capture.lab?.loss && !requested) { requested = true; control.request(); }
  } });
  assert.equal(requested, true);
  assert.equal(source.visits.filter(address => new URL(address).pathname.endsWith("/calendar/week")).length, 4);
  assert.equal(checkpoints.at(-1).lab.use.months.length, 3, "A priority refresh must retain verified Lab sections");
  const beforeRecheck = checkpoints.find(capture => capture.lab?.loss);
  assert.equal(checkpoints.at(-1).labObservedAt.use, beforeRecheck.labObservedAt.use);
  assert.equal(checkpoints.at(-1).labObservedAt.loss, beforeRecheck.labObservedAt.loss);
  assert.ok(Date.parse(checkpoints.at(-1).productionObservedAt) > Date.parse(beforeRecheck.productionObservedAt));
  assert.equal(control.hasPending(), false);
  assert.equal(control.isAccepting(), false);
  await reader.close();
});

test("missing estimated-output columns cannot block actual roasted or verified pending batch checkpoints", async () => {
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true, transformWeek(snapshot) { snapshot.tables[0].headers[4] = "Output unavailable"; } });
  const checkpoints = [];
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02", { onCapture: capture => checkpoints.push(capture) });
  assert.equal(result.production.roastedKg, 8.5);
  assert.equal(result.production.scheduledKg, null);
  assert.equal(result.production.scheduledValue, 230);
  assert.deepEqual(result.scheduledBatches, { greenKg: 20, batches: 2 });
  assert.ok(result.warnings.includes("SCHEDULED_OUTPUT_ESTIMATE_UNAVAILABLE"));
  assert.equal(checkpoints[0].production.scheduledKg, null);
  assert.deepEqual(checkpoints[0].scheduledBatches, result.scheduledBatches);
  await reader.close();
});

test("an optional output factor changing between reads becomes unknown while matching core quantities still refresh", async () => {
  let captures = 0;
  const source = simulatedBrowser({ fastWeek: true, legacyInventory: true, transformWeek(snapshot) { if (++captures % 2 === 0) snapshot.tables[0].headers[4] = "Output unavailable"; } });
  const reader = createBrowserReader({ timeoutMs: 1800000, chromiumSandbox: false }, { now: () => new Date("2026-02-05T00:00:00Z"), launch: async () => source.browser });
  const result = await reader.read("2026-02-02");
  assert.equal(captures, 2, "Only optional uncertainty must not restart the full core capture");
  assert.equal(result.production.roastedKg, 8.5);
  assert.equal(result.production.scheduledKg, null);
  assert.equal(result.production.scheduledValue, 230);
  assert.deepEqual(result.scheduledBatches, { greenKg: 20, batches: 2 });
  assert.ok(result.warnings.includes("SCHEDULED_OUTPUT_ESTIMATE_UNAVAILABLE"));
  await reader.close();
});
