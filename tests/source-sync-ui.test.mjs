import assert from "node:assert/strict";
import test from "node:test";
import { weeklyPage } from "../worker/weekly-ui.js";
import { warehousePage } from "../worker/warehouse-ui.js";
import { roasteryLabPage } from "../worker/roastery-lab-ui.js";

const week = "2026-11-16";
const jobId = "11111111-2222-4333-8444-555555555555";
const captured = "2026-11-18T01:00:00.000Z";
const checked = "2026-11-20T01:00:00.000Z";
const views = [
  { name: "Steam Room", page: weeklyPage, kind: "weekly", following: "statusText", event: "    el('previous').addEventListener", path: "/api/weekly-report" },
  { name: "Warehouse", page: warehousePage, kind: "warehouse", following: "makeClockMarks", event: '    el("zoneNav").addEventListener', path: "/api/warehouse" },
  { name: "Roastery Lab", page: roasteryLabPage, kind: "lab", following: "sourceStatus", event: "    el('addRelease').addEventListener", path: "/api/roastery-lab" },
];
const script = page => page.match(/<script>([\s\S]*?)<\/script>/)[1];
const response = (value, status = 200) => Response.json(value, { status });

function clock(automatic = true) {
  const pending = new Map(), durations = [];
  let elapsed = 0, sequence = 0;
  const setTimeout = (callback, duration) => {
    const id = ++sequence;
    durations.push(duration);
    pending.set(id, { callback, duration });
    if (automatic && duration <= 2000) queueMicrotask(() => {
      if (!pending.delete(id)) return;
      elapsed += duration;
      callback();
    });
    return id;
  };
  return {
    setTimeout, clearTimeout: id => pending.delete(id), durations, pending,
    Date: class extends Date { static now() { return elapsed; } },
  };
}

function fixtureReport(view, status = "complete") {
  const report = {
    week: { start: week, isCurrent: true }, generatedAt: checked, source: { asOf: captured }, settings: {},
    cropsterRefresh: { mode: "website-reader", status: status === "complete" ? "refreshed" : "failed", fetched: status === "complete", productionAsOf: captured, labAsOf: captured },
    sourceSync: { status, message: status === "complete" ? "All connected sources were updated." : "Cropster could not update. Other connected sources were rechecked." },
  };
  return view.kind === "warehouse" ? { weekly: report, lab: {}, sourceSync: report.sourceSync, generatedAt: checked } : report;
}

function runtime(view, fetcher, timer = clock(), selectedWeek = "") {
  const source = script(view.page);
  const helperStart = source.indexOf("    function cropsterRefreshText(report) {");
  const helperEnd = source.indexOf("    function " + view.following, helperStart);
  const loadStart = source.indexOf("    async function load(");
  const loadEnd = source.indexOf(view.event, loadStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && loadStart >= 0 && loadEnd > loadStart);
  const elements = new Map(), calls = [], statuses = [];
  const state = { rendered: 0, expired: 0, payload: null };
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === "weekNoteInput" || id === "qa" ? "Unsaved meeting draft" : "", textContent: "", hidden: false, disabled: false,
      setAttribute() {}, focus() {}, classList: { add() {}, remove() {}, toggle() {} },
      replaceChildren(...children) { this.children = children; },
    });
    return elements.get(id);
  };
  const initial = fixtureReport(view, "partial");
  const dependencies = {
    el, timer, selectedWeek, initial, state, statuses,
    fetch: async (address, options) => {
      calls.push({ address, options });
      return fetcher(address, options, { state, el, initial, calls });
    },
  };
  const prelude = `
    const {el, timer, selectedWeek, initial, state, statuses, fetch} = deps;
    const {setTimeout, clearTimeout, Date} = timer;
    const formatTimestamp = value => value && Number.isFinite(new Date(value).getTime()) ? value : '';
    const date = formatTimestamp, dateText = formatTimestamp, timeFormat = {};
    const set = (id, value) => { el(id).textContent = value; if (id === 'status') statuses.push(value); };
    const setMessage = set, message = set, showText = set;
    const stopDispatchPoll = () => {}, setWeekQuery = () => {};
    const readJson = response => response.json();
    const node = (tag, text) => ({tag, text});
    const document = {createTextNode: text => ({text})};
    const weekLabel = () => 'This week';
    let signedIn = true, busy = false, currentRequest = null, activeRequest, sessionGeneration = 1;
    let loadedWeek = {start: '${week}', isCurrent: true}, requestedWeek = selectedWeek;
    let loadedCropsterRefresh = {mode: 'website-reader'};
    let data = initial;
    const showSession = () => { signedIn = false; state.expired++; currentRequest?.abort(); activeRequest?.abort(); currentRequest = null; activeRequest = undefined; };
    const expireSession = showSession;
    const abortLoad = () => {activeRequest?.abort(); activeRequest = undefined;};
    const render = next => {state.rendered++; state.payload = next; loadedWeek = next.week; return Promise.resolve(true);};
    const renderData = () => {state.rendered++; state.payload = data;};
    const renderReport = next => {state.rendered++; state.payload = next;};
  `;
  const app = new Function("deps", prelude + source.slice(helperStart, helperEnd) + source.slice(loadStart, loadEnd) + `
    return {load, sync: coordinateSourceSync, summary: sourceSyncResultText, notice: cropsterRefreshText,
      abort: () => (currentRequest || activeRequest)?.abort(), getData: () => data};
  `)(dependencies);
  return { ...app, calls, el, state, statuses, timer, initial };
}

for (const view of views) {
  test(view.name + " waits for the full source job, then reads all report feeds with the same job reference", async () => {
    let polls = 0;
    const app = runtime(view, async (address, options, context) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") {
        assert.equal(url.pathname, "/api/source-sync");
        assert.equal(options.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(options.body), view.kind === "weekly" ? {weekStart: week} : {});
        return response({ status: "running", jobId, weekStart: week, pollUrl: "https://untrusted.test/ignore" });
      }
      if (url.pathname === "/api/source-sync") {
        assert.equal(context.state.rendered, 0);
        assert.equal(context.el("refresh").disabled, true);
        assert.equal(context.el("weekNoteInput").value, "Unsaved meeting draft");
        assert.equal(context.el("figures").hidden, false);
        assert.equal(url.searchParams.get("jobId"), jobId);
        assert.equal(url.searchParams.get("week"), week);
        polls++;
        return response({ status: polls === 1 ? "running" : "complete", jobId, weekStart: week });
      }
      assert.equal(url.pathname, view.path);
      assert.equal(polls, 2);
      assert.equal(url.searchParams.get("refresh"), "1");
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      assert.equal(url.searchParams.get("sourceSyncWeek"), week);
      return response(fixtureReport(view));
    }, clock(), view.kind === "weekly" ? week : "");
    await app.load(true, { fresh: true });
    assert.deepEqual(app.timer.durations, [720000, 2000, 2000]);
    assert.equal(app.calls.length, 4);
    assert.ok(app.calls.every(call => call.options.signal === app.calls[0].options.signal));
    assert.ok(app.statuses.includes("Updating Cropster…"));
    assert.match(app.el("status").textContent, /All connected sources were updated\./);
    assert.equal(app.state.rendered, 1);
    assert.equal(app.el("qa").value, "Unsaved meeting draft");
    assert.equal(app.el("refresh").disabled, false);
  });

  test(view.name + " reads back a failed source job and reports partial coverage instead of all-source success", async () => {
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "running", jobId, weekStart: week});
      if (url.pathname === "/api/source-sync") return response({status: "failed", jobId, weekStart: week});
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      return response(fixtureReport(view, "partial"));
    });
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 3);
    assert.equal(app.state.rendered, 1);
    assert.match(app.el("status").textContent, /Cropster could not update\. Other connected sources were rechecked\./);
    assert.doesNotMatch(app.el("status").textContent, /All connected sources/);
    assert.equal(app.el("weekNoteInput").value, "Unsaved meeting draft");
  });

  test(view.name + " reads back an immediately completed job without polling", async () => {
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "complete", jobId, weekStart: week});
      assert.equal(url.pathname, view.path);
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      assert.equal(url.searchParams.get("sourceSyncWeek"), week);
      assert.equal(url.searchParams.get("refresh"), "1");
      return response(fixtureReport(view));
    });
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 2);
    assert.deepEqual(app.timer.durations, [720000]);
    assert.equal(app.state.rendered, 1);
    assert.match(app.el("status").textContent, /All connected sources were updated\./);
  });

  test(view.name + " accepts an immediate capture without a job reference and never polls it", async () => {
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "complete", weekStart: week});
      assert.equal(url.pathname, view.path);
      assert.equal(url.searchParams.has("sourceSyncJob"), false);
      assert.equal(url.searchParams.has("sourceSyncWeek"), false);
      assert.equal(url.searchParams.get("refresh"), "1");
      return response(fixtureReport(view));
    });
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 2);
    assert.deepEqual(app.timer.durations, [720000]);
    assert.equal(app.state.rendered, 1);
  });

  for (const phase of ["start", "poll"]) test(view.name + " stops immediately when the source " + phase + " returns401", async () => {
    const app = runtime(view, async (_address, options) => options.method === "POST" && phase === "poll"
      ? response({status: "running", jobId, weekStart: week}) : response({error: "Sign in again"}, 401));
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, phase === "start" ? 1 : 2);
    assert.equal(app.state.expired, 1);
    assert.equal(app.state.rendered, 0);
    assert.equal(app.getData(), app.initial);
  });

  test(view.name + " keeps a manual source job intact when an automatic refresh fires", async () => {
    let resolveStart;
    const start = new Promise(resolve => {resolveStart = resolve;});
    const app = runtime(view, async (_address, options) => options.method === "POST" ? start : response(fixtureReport(view)));
    const completion = app.load(true, {fresh: true});
    await app.load(false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].options.signal.aborted, false);
    assert.equal(app.getData(), app.initial);
    resolveStart(response({status: "not-connected", weekStart: week}));
    await completion;
    assert.equal(app.calls.length, 2);
    assert.equal(new URL(app.calls[1].address, "https://dashboard.test").searchParams.has("sourceSyncJob"), false);
  });
}

test("all three pages use the same fixed-path source-job coordinator", () => {
  const implementations = views.map(view => {
    const code = script(view.page);
    return code.slice(code.indexOf("    function sourceSyncPause("), code.indexOf("    function sourceSyncResultText("));
  });
  assert.equal(implementations[0], implementations[1]);
  assert.equal(implementations[0], implementations[2]);
});

test("job references and weeks are validated before any poll or report request", async () => {
  for (const state of [
    {status: "running", jobId: "https://untrusted.test/private", weekStart: week},
    {status: "complete", jobId: "https://untrusted.test/private", weekStart: week},
    {status: "running", jobId, weekStart: "2026-11-17"},
    {status: "running", jobId, weekStart: "2026-11-09"},
  ]) {
    const app = runtime(views[0], async () => response(state), clock(), week);
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 1);
    assert.equal(app.state.rendered, 0);
    assert.equal(app.getData(), app.initial);
  }
});

test("mismatched poll results cannot be applied to the selected report", async () => {
  const app = runtime(views[0], async (_address, options) => response(options.method === "POST"
    ? {status: "running", jobId, weekStart: week}
    : {status: "complete", jobId, weekStart: "2026-11-09"}));
  await app.load(true, {fresh: true});
  assert.equal(app.calls.length, 2);
  assert.equal(app.state.rendered, 0);
});

test("source polling is bounded to660seconds and retains the last report when it expires", async () => {
  const app = runtime(views[0], async () => response({status: "running", jobId, weekStart: week}));
  await app.load(true, {fresh: true});
  assert.equal(app.calls.length, 330);
  assert.equal(app.state.rendered, 0);
  assert.match(app.el("status").textContent, /took too long.*last loaded figures/);
});

test("aborting during the two-second pause prevents both further polls and report reads", async () => {
  const timer = clock(false);
  const app = runtime(views[0], async () => response({status: "running", jobId, weekStart: week}), timer);
  const completion = app.load(true, {fresh: true});
  for (let turn = 0; turn < 200 && !app.statuses.includes("Updating Cropster…"); turn++) await Promise.resolve();
  assert.ok(app.statuses.includes("Updating Cropster…"));
  app.abort();
  await completion;
  assert.equal(app.calls.length, 1);
  assert.equal(app.state.rendered, 0);
  assert.equal(timer.pending.size, 0);
});

test("a failed start without a job cannot be presented as an all-source success", () => {
  const app = runtime(views[0], async () => {throw Error("No network expected");});
  const report = {sourceSync: {status: "complete", message: "All sources updated."}};
  assert.match(app.summary(report, report, {status: "failed"}), /Cropster could not update/);
  assert.doesNotMatch(app.summary(report, report, {status: "failed"}), /All sources updated/);
});

test("Lab freshness uses its own report capture instead of a newer production capture", () => {
  const app = runtime(views[2], async () => {throw Error("No network expected");});
  const notice = app.notice({source: {asOf: captured}, cropsterRefresh: {mode: "website-reader", status: "refreshed", productionAsOf: checked}});
  assert.ok(notice.includes(captured));
  assert.ok(!notice.includes(checked));
});
