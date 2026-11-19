import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserReader } from "../src/browser.mjs";
import { dateLabel } from "../src/dates.mjs";
import { ReaderError } from "../src/errors.mjs";
import { cloneCheckpoint } from "../src/checkpoint.mjs";
import { weekSnapshot } from "./week-schedule.fixture.mjs";

const origin = "https://c-sar.cropster.com";
const table = (headers, rows, footers = []) => ({ headers, rows, footers, pagination: `Show 1 - ${rows.length} of ${rows.length}` });

function sourceSnapshot(address) {
  const url = new URL(address);
  if (url.pathname === "/apps/roast/schedule/calendar/day") {
    const day = url.searchParams.get("date");
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(day + "T12:00:00Z"));
    return { url: address, text: `${label}, in Marrickville No coffees scheduled No profiles scheduled No green lots scheduled`, tables: [], scheduleStatuses: { unpublished: true, scheduled: true, synced: true, roasted: true, inconsistent: true } };
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

function simulatedBrowser({ failPrevious = false, fastWeek = false, inventoryFailures = 0, extraInventory = false } = {}) {
  const visits = [], waits = [], navigations = [];
  const context = { async newPage() {
    let address;
    return {
      setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {}, close: async () => {},
      async goto(value, options) {
        navigations.push({ address: value, ...options });
        visits.push(value); address = value;
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
        const snapshot = new URL(address).pathname === "/apps/roast/schedule/calendar/week" && fastWeek ? { ...weekSnapshot(), url: address } : structuredClone(sourceSnapshot(address));
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
