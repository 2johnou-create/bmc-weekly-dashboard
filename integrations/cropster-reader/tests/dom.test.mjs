import assert from "node:assert/strict";
import test from "node:test";
import { captureDocument, renderedViewReady, viewDiagnostics } from "../src/dom.mjs";
import { safeProgress } from "../src/progress.mjs";

test("timeout diagnostics return only structural classifications and bounded flags", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  try {
    globalThis.document = {
      title: "private title must not be returned", readyState: "complete",
      body: { innerText: "Production report private quantities and passwords Amount of green Show 1 - 2 of 2" },
      querySelector: () => null,
      querySelectorAll: selector => selector === "table thead" ? [{ innerText: "Amount of green" }] : selector === "table" ? [{}, {}] : [],
    };
    globalThis.location = { origin: "https://c-sar.cropster.com", pathname: "/apps/roast/production-report/profile-group" };
    const flags = viewDiagnostics({ kind: "production", expectedPath: location.pathname });
    assert.equal(flags.urlClass, "expected");
    assert.equal(flags.expectedBody, true);
    assert.equal(flags.expectedHeaders, true);
    assert.equal(flags.pager, true);
    assert.equal(flags.tableCount, 2);
    assert.doesNotMatch(JSON.stringify(flags), /private|quantities|passwords|https:|\/apps\//);
    const safe = safeProgress({ stage: "weekly_production_before", state: "failed", phase: "ready", diagnostics: { ...flags, title: "private title", body: "private body", url: "https://private.test", tableCount: 100000 } });
    assert.equal(safe.diagnostics.urlClass, "expected");
    assert.equal(safe.diagnostics.tableCount, undefined);
    assert.doesNotMatch(JSON.stringify(safe), /private|title|body|https:/);
    location.pathname = "/app/login";
    assert.equal(viewDiagnostics({ kind: "production", expectedPath: "/apps/roast/production-report/profile-group" }).urlClass, "login");
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

test("readiness and diagnostics agree on multiline rendered body and table headings", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const cases = [
    ["production", "Production\n report\nShow 1 - 2 of 2", "Amount\nof\ngreen"],
    ["stock", "Values\nrefer to the\ninventory on a source date\nShow 1 - 2 of 2", "Location\tTotal\nvalue"],
    ["schedule", "Scheduled\ncoffees\nSummary per\ngreen lot\nShow 1 - 2 of 2", "To\nroast"],
    ["prices", "Green\nInventory\n1-25 of 38 items", "ID-Tag\nPrice"],
    ["blend", "Blend\ncomponents", "%\nof\nblend"],
    ["profile", "Components /\nGreen lots", "Blend\n%\tGreen\nweight"],
  ];
  try {
    globalThis.location = { origin: "https://c-sar.cropster.com", pathname: "/synthetic" };
    for (const [kind, body, headings] of cases) {
      globalThis.document = {
        body: { innerText: body }, readyState: "complete",
        querySelector: selector => selector === 'input[type="password"]' || selector.includes('iframe[') ? null : {},
        querySelectorAll: selector => selector === "table thead" ? [{ innerText: headings }] : selector === "table" ? [{}] : [],
      };
      assert.equal(renderedViewReady(kind), true, `${kind} must accept whitespace-wrapped rendered labels`);
      const diagnostics = viewDiagnostics({ kind, expectedPath: "/synthetic" });
      assert.equal(diagnostics.expectedBody, true, kind);
      assert.equal(diagnostics.expectedHeaders, true, kind);
    }
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

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
