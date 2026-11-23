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
      querySelectorAll: selector => selector === "table thead" ? [{ innerText: "Amount of green" }] : selector === "table" ? [{}, {}] : selector.includes("progressbar") ? [{}] : selector.includes('role="alert"') ? [{}, {}] : [],
    };
    globalThis.location = { origin: "https://c-sar.cropster.com", pathname: "/apps/roast/production-report/profile-group" };
    const flags = viewDiagnostics({ kind: "production", expectedPath: location.pathname });
    assert.equal(flags.urlClass, "expected");
    assert.equal(flags.expectedBody, true);
    assert.equal(flags.expectedHeaders, true);
    assert.equal(flags.pager, true);
    assert.equal(flags.tableCount, 2);
    assert.equal(flags.loadingCount, 1);
    assert.equal(flags.errorPanelCount, 2);
    assert.doesNotMatch(JSON.stringify(flags), /private|quantities|passwords|https:|\/apps\//);
    const safe = safeProgress({ stage: "weekly_production_before", state: "failed", phase: "ready", diagnostics: { ...flags, title: "private title", body: "private body", url: "https://private.test", tableCount: 100000, pageErrorCount: 3, failedScriptCount: 100000 } });
    assert.equal(safe.diagnostics.urlClass, "expected");
    assert.equal(safe.diagnostics.tableCount, undefined);
    assert.equal(safe.diagnostics.loadingCount, 1);
    assert.equal(safe.diagnostics.errorPanelCount, 2);
    assert.equal(safe.diagnostics.pageErrorCount, 3);
    assert.equal(safe.diagnostics.failedScriptCount, undefined);
    assert.doesNotMatch(JSON.stringify(safe), /private|title|body|https:/);
    location.pathname = "/app/login";
    assert.equal(viewDiagnostics({ kind: "production", expectedPath: "/apps/roast/production-report/profile-group" }).urlClass, "login");
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

test("schedule failure diagnostics count status structure without exposing source text or classes", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const tile = statuses => ({ innerText: "private coffee 49 kg", closest: () => statuses === null ? null : ({
    className: "private-class-must-not-be-returned",
    classList: { contains: value => statuses.some(status => value === "calendar__item--" + status) },
  }) });
  const tiles = [tile(["scheduled"]), tile(["synced", "roasted"]), tile(["inconsistent"]), tile([]), tile(null)];
  const cells = [{}, ...[2, 3, 0, 0, 0, 0, 0].map(count => ({ querySelectorAll: () => tiles.slice(0, count) }))];
  try {
    globalThis.document = {
      readyState: "complete", body: { innerText: "Scheduled coffees Summary per green lot Show 1 - 5 of 5 private coffee 49 kg" },
      querySelector: () => null,
      querySelectorAll: selector => selector === "table thead" ? [{ innerText: "To roast" }]
        : selector === "table" ? [{}, {}, {}]
        : selector === ".calendar__item__main" ? tiles
        : selector === ".calendar--week__row--main" ? [{ children: cells }] : [],
    };
    globalThis.location = { origin: "https://c-sar.cropster.com", pathname: "/apps/roast/schedule/calendar/week" };
    const diagnostics = viewDiagnostics({ kind: "schedule", expectedPath: location.pathname });
    assert.equal(diagnostics.scheduleTileCount, 5);
    assert.equal(diagnostics.scheduleUnknownStatusCount, 2);
    assert.equal(diagnostics.scheduleMissingParentCount, 1);
    assert.equal(diagnostics.scheduleMultipleStatusCount, 1);
    assert.deepEqual(diagnostics.scheduleStatusCounts, { unpublished: 0, scheduled: 1, synced: 1, roasted: 1, inconsistent: 1 });
    assert.deepEqual(diagnostics.calendarCellCounts, [8]);
    assert.deepEqual(diagnostics.calendarDayTileCounts, [[2, 3, 0, 0, 0, 0, 0]]);
    const safe = safeProgress({ stage: "weekly_schedule_week", state: "failed", phase: "parse", diagnostics: {
      ...diagnostics, scheduleStatusCounts: { ...diagnostics.scheduleStatusCounts, secret: "private" },
    } });
    assert.deepEqual(safe.diagnostics.scheduleStatusCounts, diagnostics.scheduleStatusCounts);
    assert.deepEqual(safe.diagnostics.calendarDayTileCounts, diagnostics.calendarDayTileCounts);
    assert.doesNotMatch(JSON.stringify(safe), /private|49|kg|className|https:/);
    assert.equal(safeProgress({ stage: "weekly_monday", state: "failed", phase: "parse", diagnostics }).diagnostics.scheduleTileCount, undefined);
    const invalid = safeProgress({ stage: "weekly_schedule_0", state: "failed", phase: "parse", diagnostics: {
      scheduleTileCount: 10001, scheduleStatusCounts: { roasted: -1 }, calendarCellCounts: [31], calendarDayTileCounts: [["secret"]],
    } });
    assert.equal(invalid.diagnostics, undefined);
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

test("rendered weekly capture scopes dates, machines and batch counts to calendar cells", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const counts = [2, 1, 0, 0, 0, 0, 0];
  const tileText = "Example profile 10 kg\n[PG-0901] Example coffee";
  const header = { innerText: "Example machine\n3 Batches, 30 kg", querySelector: () => ({ getAttribute: () => "M1" }) };
  const cells = counts.map(count => ({ innerText: count ? "Scheduled batch" : "", querySelectorAll: () => Array.from({ length: count }, () => ({ innerText: tileText, closest: () => ({ classList: { contains: name => name === "calendar__item--synced" } }) })) }));
  try {
    globalThis.document = {
      title: "Synthetic schedule", body: { innerText: "2-8 February 2026, in Marrickville" },
      querySelectorAll: selector => selector.includes("-machine-") ? [{ id: "example-machine-M1", checked: true }]
        : selector.startsWith(".calendar--week__row--header") ? Array.from({ length: 7 }, (_, index) => ({ href: `https://c-sar.cropster.com/apps/roast/schedule/calendar/day?date=2026-02-0${index + 2}` }))
        : selector === ".calendar--week__row--main" ? [{ children: [header, ...cells] }] : [],
    };
    globalThis.location = { href: "https://c-sar.cropster.com/apps/roast/schedule/calendar/week?date=2026-02-02" };
    const captured = captureDocument();
    assert.deepEqual(captured.scheduleMachines, { M1: true });
    assert.deepEqual(captured.calendarWeek.dates, Array.from({ length: 7 }, (_, index) => `2026-02-0${index + 2}`));
    assert.deepEqual(captured.calendarWeek.rows, [{ machineId: "M1", cellCount: 8, summary: header.innerText, batchCounts: counts, emptyCells: [false, false, true, true, true, true, true], tiles: [[tileText, tileText], [tileText], [], [], [], [], []], states: [["synced", "synced"], ["synced"], [], [], [], [], []] }]);
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

test("legacy inventory readiness requires every visible row to finish rendering its lot link", () => {
  const originalDocument = globalThis.document;
  let loaded = false;
  try {
    globalThis.document = {
      body: { innerText: "Green Inventory Report Show 1 - 2 of 2" }, querySelector: () => null,
      querySelectorAll: selector => selector === "table thead" ? [{ innerText: "Lot ID-Tag Name Weight (kg) Price" }]
        : selector === "table tbody tr" ? [0, 1].map(index => ({ querySelectorAll: () => index === 0 || loaded ? [{ innerText: "PG-0901" }] : [] })) : [],
    };
    assert.equal(renderedViewReady("legacyPrices"), false);
    loaded = true;
    assert.equal(renderedViewReady("legacyPrices"), true);
  } finally { globalThis.document = originalDocument; }
});

test("legacy inventory capture reads the verified display scope from exact rendered controls", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const buttons = [{ innerText: "Snapshot Report", className: "button active ember-view" }, { innerText: "Timeframe Report", className: "button ember-view" }].map(button => ({ ...button, getAttribute: () => null }));
  const textInputs = [{ type: "text", value: "" }, { type: "text", value: "" }], rowCheckbox = { type: "checkbox", checked: false };
  try {
    globalThis.document = {
      title: "Synthetic source", body: { innerText: "Green Inventory Report" },
      querySelectorAll: selector => selector === ".ember-power-select-multiple-options" ? [{ innerText: "", querySelectorAll: () => [] }]
        : selector === "input.toggle[data-test-checkbox]" ? [{ checked: false }]
        : selector === 'button,[role="button"]' ? buttons
        : selector === "table input" ? [...textInputs, rowCheckbox]
        : selector === 'table input[type="checkbox"]' ? [rowCheckbox] : [],
    };
    globalThis.location = { href: "https://c-sar.cropster.com/apps/lots/inventory-report?pageSize=100" };
    assert.deepEqual(captureDocument().legacyInventoryScope, {
      locationControls: [{ text: "", selected: [] }], consumedControls: [{ checked: false }],
      snapshotButtons: [{ text: "Snapshot Report", class: "button active ember-view", pressed: null }, { text: "Timeframe Report", class: "button ember-view", pressed: null }],
      nonCheckboxInputs: textInputs, checkedRows: 0,
    });
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});
