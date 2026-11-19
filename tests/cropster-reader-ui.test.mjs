import assert from "node:assert/strict";
import test from "node:test";
import { weeklyPage } from "../worker/weekly-ui.js";
import { warehousePage } from "../worker/warehouse-ui.js";

const captured = "2026-11-18T01:00:00.000Z";
const checked = "2026-11-20T01:00:00.000Z";
const formatTimestamp = value => Number.isFinite(new Date(value).getTime()) ? value : "";
const script = page => page.match(/<script>([\s\S]*?)<\/script>/)[1];

function freshnessHelpers(page, followingFunction, formatter) {
  const source = script(page);
  const start = source.indexOf("    function cropsterRefreshText(report) {");
  const end = source.indexOf("    function " + followingFunction, start);
  assert.ok(start >= 0 && end > start);
  return new Function(formatter, source.slice(start, end) + "; return { notice: cropsterRefreshText, result: cropsterRefreshResultText, loading: cropsterRefreshLoadingText };")(formatTimestamp);
}

const views = [
  ["Steam Room", weeklyPage, "statusText", "formatTimestamp"],
  ["Warehouse", warehousePage, "makeClockMarks", "date"],
];

for (const [name, page, followingFunction, formatter] of views) {
  const helpers = freshnessHelpers(page, followingFunction, formatter);
  test(name + " distinguishes an existing website capture from the dashboard check time", () => {
    for (const status of ["saved", "refreshed"]) {
      const report = { generatedAt: checked, cropsterRefresh: { mode: "website-reader", status, fetched: status === "refreshed", productionAsOf: captured } };
      assert.equal(helpers.notice(report), "Cropster website · captured " + captured + " Sydney time.");
      assert.ok(!helpers.notice(report).includes(checked));
    }
    assert.match(helpers.notice({ cropsterRefresh: { mode: "website-reader", status: "saved" } }), /capture unavailable/);
  });

  test(name + " claims a fresh source read only for a successful fetched observation", () => {
    assert.equal(helpers.result({ cropsterRefresh: { mode: "website-reader", status: "refreshed", fetched: true } }), "Cropster updated from website.");
    assert.equal(helpers.result({ cropsterRefresh: { mode: "website-reader", status: "refreshed", fetched: true, greenFetched: true } }), "Cropster updated from website.");
    for (const policy of [
      { mode: "website-reader", status: "refreshed", fetched: false },
      { mode: "website-reader", status: "saved", fetched: true },
      { mode: "saved-readings", status: "refreshed", fetched: true },
      {},
    ]) assert.equal(helpers.result({ cropsterRefresh: policy }), "Cropster was not fetched again.");
    assert.equal(helpers.notice({}), "Cropster: saved readings · automatic sync not connected.");
  });

  test(name + " discloses a successful production refresh whose green stock was not updated", () => {
    const report = { generatedAt: checked, cropsterRefresh: { mode: "website-reader", status: "refreshed", fetched: true, greenFetched: false, productionAsOf: captured } };
    assert.equal(helpers.result(report), "Cropster production updated. Green stock was not updated.");
    assert.ok(helpers.notice(report).includes(captured));
    assert.ok(!helpers.notice(report).includes(checked));
  });

  test(name + " retains the original observation label on failure without inventing a saved reading", () => {
    const report = { generatedAt: checked, cropsterRefresh: { mode: "website-reader", status: "failed", fetched: false, productionAsOf: captured } };
    assert.match(helpers.notice(report), /could not update · previous reading shown/);
    assert.ok(helpers.notice(report).includes(captured));
    assert.ok(!helpers.notice(report).includes(checked));
    assert.equal(helpers.result(report), "Cropster could not update. Previous reading retained.");
    const empty = { cropsterRefresh: { mode: "website-reader", status: "failed", fetched: false } };
    assert.match(helpers.notice(empty), /no saved production reading/);
    assert.match(helpers.result(empty), /No saved production reading is available/);
  });

  test(name + " preserves Friday archives and limits source-reading progress to a connected reader", () => {
    for (const report of [
      { week: { isCurrent: false }, cropsterRefresh: { mode: "website-reader", status: "refreshed", fetched: true } },
      { cropsterRefresh: { mode: "friday-archive" } },
    ]) {
      assert.equal(helpers.notice(report), "Cropster: saved Friday archive.");
      assert.equal(helpers.result(report), "Saved Friday Cropster archive reloaded.");
    }
    assert.equal(helpers.loading({ mode: "website-reader" }), "Reading Cropster…");
    assert.match(helpers.loading({ mode: "saved-readings" }), /^Refreshing/);
    assert.match(helpers.loading(null), /^Refreshing/);
  });
}

function fakeElements() {
  const elements = new Map();
  return id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", value: id === "weekNoteInput" ? "Keep this meeting draft" : "", hidden: false, disabled: false,
      classList: { add() {}, remove() {} }, setAttribute() {}, focus() {},
      replaceChildren(...children) { this.children = children; },
    });
    return elements.get(id);
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function runtime(page, kind, fetcher, timers, el) {
  const source = script(page);
  const start = source.indexOf("    async function load(" + (kind === "weekly" ? "announce" : "manual"));
  const end = source.indexOf(kind === "weekly" ? "    el('previous').addEventListener" : '    el("zoneNav").addEventListener', start);
  assert.ok(start >= 0 && end > start);
  const helper = freshnessHelpers(page, kind === "weekly" ? "statusText" : "makeClockMarks", kind === "weekly" ? "formatTimestamp" : "date");
  const initial = { weekly: { week: { isCurrent: true }, cropsterRefresh: { mode: "website-reader", status: "saved", productionAsOf: captured } }, lab: {}, generatedAt: captured };
  const dependencies = {
    el, fetch: fetcher, setTimeout: (_callback, duration) => { timers.push(duration); return duration; },
    clearTimeout() {}, helpers: helper, initial, formatTimestamp,
  };
  const prelude = `
    const {el, fetch, setTimeout, clearTimeout, helpers, initial, formatTimestamp} = deps;
    const cropsterRefreshLoadingText = helpers.loading, cropsterRefreshResultText = helpers.result;
    const coordinateSourceSync = async () => ({status: 'not-connected', weekStart: '2026-11-16'});
    const sourceSyncResultText = (report, cropsterReport) => helpers.result(cropsterReport);
    const set = (id, value) => { el(id).textContent = value; };
    const setMessage = set, showText = set;
    const stopDispatchPoll = () => {};
    const readJson = response => response.json();
    const showSession = () => {};
    const setWeekQuery = () => {};
    const date = formatTimestamp;
    const node = (tag, text) => ({ tag, text });
    const document = { createTextNode: text => ({ text }) };
    const weekLabel = () => 'This week';
    let signedIn = true, currentRequest = null, activeRequest = null, sessionGeneration = 1;
    let loadedWeek = { start: '2026-11-16', isCurrent: true }, requestedWeek = '';
    let loadedCropsterRefresh = initial.weekly.cropsterRefresh;
    let data = initial;
    const render = next => { loadedWeek = next.week; loadedCropsterRefresh = next.cropsterRefresh; return Promise.resolve(true); };
    const renderData = () => {};
  `;
  return new Function("deps", prelude + source.slice(start, end) + "; return {load, getData: () => data, initial};")(dependencies);
}

for (const [name, page, kind] of [["Steam Room", weeklyPage, "weekly"], ["Warehouse", warehousePage, "warehouse"]]) {
  test(name + " keeps existing content and allows240seconds for a coordinated manual refresh", async () => {
    const pending = deferred();
    const timers = [];
    const el = fakeElements();
    el("figures").hidden = false;
    const calls = [];
    const app = runtime(page, kind, (url, options) => { calls.push({ url, options }); return pending.promise; }, timers, el);
    const completion = app.load(true, { fresh: true });
    assert.deepEqual(timers, [720000]);
    assert.equal(el("status").textContent, "Reading Cropster…");
    assert.equal(el("refresh").disabled, true);
    assert.equal(el("figures").hidden, false);
    assert.equal(el("weekNoteInput").value, "Keep this meeting draft");
    assert.equal(app.getData(), app.initial);
    await Promise.resolve();
    assert.match(calls[0].url, /refresh=1/);
    const report = { week: { start: "2026-11-16", isCurrent: true }, cropsterRefresh: { mode: "website-reader", status: "refreshed", fetched: true, productionAsOf: checked }, generatedAt: checked };
    pending.resolve(Response.json(kind === "weekly" ? report : { weekly: report, lab: {}, generatedAt: checked }));
    await completion;
    assert.match(el("status").textContent, /Cropster updated from website\./);
    assert.equal(el("refresh").disabled, false);
    assert.equal(el("weekNoteInput").value, "Keep this meeting draft");
  });

  test(name + " renders retained-read failure after the source request resolves without announcing success", async () => {
    const el = fakeElements();
    const report = { week: { start: "2026-11-16", isCurrent: true }, cropsterRefresh: { mode: "website-reader", status: "failed", fetched: false, productionAsOf: captured }, generatedAt: checked };
    const app = runtime(page, kind, async () => Response.json(kind === "weekly" ? report : { weekly: report, lab: {}, generatedAt: checked }), [], el);
    await app.load(true, { fresh: true });
    assert.match(el("status").textContent, /Cropster could not update\. Previous reading retained\./);
    assert.doesNotMatch(el("status").textContent, /updated from website/);
    assert.equal(el("weekNoteInput").value, "Keep this meeting draft");
  });
}
