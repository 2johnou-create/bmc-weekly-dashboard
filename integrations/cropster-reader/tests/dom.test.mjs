import assert from "node:assert/strict";
import test from "node:test";
import { captureDocument, renderedViewReady } from "../src/dom.mjs";

test("stock readiness accepts both observed inventory-date phrasings", () => {
  const originalDocument = globalThis.document;
  try {
    for (const article of ["", "the "]) {
      globalThis.document = {
        body: { innerText: `Values refer to ${article}inventory on February 5, 2026 Show 1 - 4 of 4` },
        querySelector: () => null,
        querySelectorAll: () => [{ innerText: "Location Total value" }],
      };
      assert.equal(renderedViewReady("stock"), true);
    }
  } finally { globalThis.document = originalDocument; }
});

test("schedule readiness accepts the verified empty panels without waiting for nonexistent headers", () => {
  const originalDocument = globalThis.document;
  try {
    const full = "No coffees scheduled No profiles scheduled No green lots scheduled";
    globalThis.document = { body: { innerText: full }, querySelector: () => null, querySelectorAll: () => [] };
    assert.equal(renderedViewReady("schedule"), true);
    for (const marker of ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"]) {
      document.body.innerText = full.replace(marker, "");
      assert.equal(renderedViewReady("schedule"), false);
    }
  } finally { globalThis.document = originalDocument; }
});

test("rendered schedule capture carries the actual checked state of all five status inputs", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const statuses = ["unpublished", "scheduled", "synced", "roasted", "inconsistent"];
  try {
    globalThis.document = {
      title: "Synthetic schedule", body: { innerText: "No coffees scheduled No profiles scheduled No green lots scheduled" },
      querySelectorAll: selector => selector.includes('input[type="checkbox"]') ? statuses.map(status => ({ id: "synthetic-status-" + status, checked: status !== "synced" })) : [],
    };
    globalThis.location = { href: "https://c-sar.cropster.com/apps/roast/schedule/calendar/day?date=2026-02-05" };
    const captured = captureDocument();
    assert.deepEqual(captured.scheduleStatuses, { unpublished: true, scheduled: true, synced: false, roasted: true, inconsistent: true });
    assert.deepEqual(captured.tables, []);
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

test("rendered DOM capture pairs each table with its own pager and reads no input values", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const cell = text => ({ innerText: text });
  const row = cells => ({ querySelectorAll: selector => selector === "td" || selector === "th,td" || selector === "td,th" ? cells.map(cell) : [] });
  function makeTable(headers, cells, pager) {
    const table = {
      querySelector: selector => selector === "thead tr" ? row(headers) : null,
      querySelectorAll: selector => selector === "tbody tr" ? cells.map(row) : [],
    };
    table.parentElement = { innerText: "Own section " + pager, querySelectorAll: selector => selector === "table" ? [table] : [], parentElement: null };
    return table;
  }
  const first = makeTable(["Profile", "Weight"], [["Example A", "10 kg"]], "Show 1 - 1 of 10");
  const second = makeTable(["Lot", "Weight"], [["Example B", "20 kg"]], "Show 1 - 1 of 1");
  try {
    globalThis.document = {
      title: "Synthetic source", body: { innerText: "Rendered table text only" },
      querySelectorAll: selector => selector === "table" ? [first, second] : [],
      privateState: { password: "must-never-be-read" },
    };
    globalThis.location = { href: "https://c-sar.cropster.com/synthetic" };
    const captured = captureDocument();
    assert.equal(captured.tables[0].pagination, "Show 1 - 1 of 10");
    assert.equal(captured.tables[1].pagination, "Show 1 - 1 of 1");
    assert.deepEqual(captured.tables[0].rows, [["Example A", "10 kg"]]);
    assert.doesNotMatch(JSON.stringify(captured), /must-never-be-read/);
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});
