import assert from "node:assert/strict";
import test from "node:test";
import { captureDocument } from "../src/dom.mjs";

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
