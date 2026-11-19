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

function clock() {
  const pending = new Map(), durations = [];
  let elapsed = 0, sequence = 0;
  const epoch = Date.parse(checked);
  const setTimeout = (callback, duration) => {
    const id = ++sequence;
    durations.push(duration);
    pending.set(id, { callback, duration });
    return id;
  };
  return {
    setTimeout, clearTimeout: id => pending.delete(id), durations, pending,
    advance: duration => {elapsed += duration;},
    Date: class extends Date {
      constructor(...args) {super(...(args.length ? args : [epoch + elapsed]));}
      static now() { return epoch + elapsed; }
    },
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

function runtime(view, fetcher, timer = clock(), selectedWeek = "", storage = new Map()) {
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
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (address, options) => {
      calls.push({ address, options });
      return fetcher(address, options, { state, el, initial, calls });
    },
  };
  const prelude = `
    const {el, timer, selectedWeek, initial, state, statuses, fetch, sessionStorage} = deps;
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
    const showSession = () => { signedIn = false; state.expired++; clearPendingSourceSync(); currentRequest?.abort(); activeRequest?.abort(); currentRequest = null; activeRequest = undefined; };
    const expireSession = showSession;
    const abortLoad = () => {activeRequest?.abort(); activeRequest = undefined;};
    const render = next => {state.rendered++; state.payload = next; loadedWeek = next.week; return Promise.resolve(true);};
    const renderData = () => {state.rendered++; state.payload = data;};
    const renderReport = next => {state.rendered++; state.payload = next;};
  `;
  const app = new Function("deps", prelude + source.slice(helperStart, helperEnd) + source.slice(loadStart, loadEnd) + `
    return {load, sync: coordinateSourceSync, summary: sourceSyncResultText, notice: cropsterRefreshText,
      abort: () => (currentRequest || activeRequest)?.abort(), getData: () => data,
      pending: readPendingSourceSync, pendingForWeek: pendingSourceSyncForWeek, storageKey: sourceSyncStorageKey};
  `)(dependencies);
  return { ...app, calls, el, state, statuses, timer, initial, storage };
}

for (const view of views) {
  test(view.name + " immediately reads cards after starting a background job", async () => {
    const app = runtime(view, async (address, options, context) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") {
        assert.equal(url.pathname, "/api/source-sync");
        assert.deepEqual(JSON.parse(options.body), view.kind === "weekly" ? {weekStart: week} : {});
        return response({status: "running", jobId, weekStart: week, pollUrl: "https://untrusted.test/ignore"});
      }
      assert.equal(url.pathname, view.path);
      assert.equal(context.state.rendered, 0);
      assert.equal(url.searchParams.get("refresh"), "1");
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      assert.equal(url.searchParams.get("sourceSyncWeek"), week);
      return response(fixtureReport(view));
    }, clock(), view.kind === "weekly" ? week : "");
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 2, "No blocking GET polling before the first report");
    assert.deepEqual(app.timer.durations, [90000]);
    assert.ok(app.calls.every(call => call.options.signal === app.calls[0].options.signal));
    assert.equal(app.state.rendered, 1);
    assert.equal(app.el("refresh").disabled, false);
    assert.match(app.el("status").textContent, /Cropster updating in background/);
    assert.doesNotMatch(app.el("status").textContent, /All connected sources/);
    const report = view.kind === "warehouse" ? app.state.payload.weekly : app.state.payload;
    assert.match(app.notice(report), /Cropster updating in background/);
    assert.ok(app.notice(report).includes(captured));
    assert.equal(app.el("qa").value, "Unsaved meeting draft");
    assert.equal(app.pending().jobId, jobId);
    assert.deepEqual(Object.keys(JSON.parse(app.storage.get(app.storageKey))).sort(), ["jobId", "startedAt", "weekStart"]);
  });

  test(view.name + " checks one pending job on automatic refresh and reads new checkpoints without another POST", async () => {
    let reportCount = 0;
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "running", jobId, weekStart: week});
      if (url.pathname === "/api/source-sync") {
        assert.equal(url.searchParams.get("jobId"), jobId);
        assert.equal(url.searchParams.get("week"), week);
        return response({status: "running", jobId, weekStart: week});
      }
      const report = fixtureReport(view);
      const core = view.kind === "warehouse" ? report.weekly : report;
      core.cropsterRefresh.productionAsOf = ++reportCount === 1 ? captured : checked;
      core.source.asOf = core.cropsterRefresh.productionAsOf;
      core.cropsterRefresh.labAsOf = core.source.asOf;
      return response(report);
    });
    await app.load(true, {fresh: true});
    const startedAt = app.pending().startedAt;
    app.timer.advance(60000);
    await app.load(false);
    assert.equal(app.calls.length, 4);
    assert.equal(app.calls.filter(call => call.options.method === "POST").length, 1);
    const reportUrl = new URL(app.calls[3].address, "https://dashboard.test");
    assert.equal(reportUrl.pathname, view.path);
    assert.equal(reportUrl.searchParams.get("sourceSyncJob"), jobId);
    assert.equal(reportUrl.searchParams.has("refresh"), false);
    assert.equal(app.state.rendered, 2);
    assert.equal(app.pending().startedAt, startedAt);
    const core = view.kind === "warehouse" ? app.state.payload.weekly : app.state.payload;
    assert.ok(app.notice(core).includes(checked));
    assert.match(app.el("status").textContent, /updating in background/);
    assert.equal(app.el("weekNoteInput").value, "Unsaved meeting draft");
  });

  for (const terminal of ["complete", "failed"]) test(view.name + " clears a " + terminal + " job after one automatic status check and retains source timestamps", async () => {
    let running = true;
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "running", jobId, weekStart: week});
      if (url.pathname === "/api/source-sync") return response({status: terminal, jobId, weekStart: week});
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      return response(fixtureReport(view, running || terminal === "complete" ? "complete" : "partial"));
    });
    await app.load(true, {fresh: true});
    running = false;
    await app.load(false);
    assert.equal(app.pending(), null);
    assert.equal(app.storage.has(app.storageKey), false);
    assert.equal(app.calls.length, 4);
    assert.equal(app.state.rendered, 2);
    assert.equal(app.el("qa").value, "Unsaved meeting draft");
    assert.match(app.el("status").textContent, terminal === "complete" ? /All connected sources were updated/ : /Cropster could not update/);
    const core = view.kind === "warehouse" ? app.state.payload.weekly : app.state.payload;
    assert.ok(app.notice(core).includes(captured));
  });

  for (const phase of ["start", "poll"]) test(view.name + " stops on401 during a background " + phase, async () => {
    const storage = new Map();
    const timer = clock();
    if (phase === "poll") storage.set("bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()}));
    const app = runtime(view, async () => response({error: "Sign in again"}, 401), timer, "", storage);
    await app.load(true, {fresh: phase === "start"});
    assert.equal(app.calls.length, 1);
    assert.equal(app.state.expired, 1);
    assert.equal(app.state.rendered, 0);
    assert.equal(app.getData(), app.initial);
    assert.equal(app.pending(), null);
  });

  test(view.name + " keeps a manual network request intact when automatic refresh fires", async () => {
    let resolveStart;
    const start = new Promise(resolve => {resolveStart = resolve;});
    const app = runtime(view, async (_address, options) => options.method === "POST" ? start : response(fixtureReport(view)));
    const completion = app.load(true, {fresh: true});
    await app.load(false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].options.signal.aborted, false);
    assert.equal(app.getData(), app.initial);
    resolveStart(response({status: "running", jobId, weekStart: week}));
    await completion;
    assert.equal(app.calls.length, 2);
    assert.equal(app.pending().jobId, jobId);
  });

  test(view.name + " keeps a slow automatic pending-job request intact when the next automatic interval fires", async () => {
    const timer = clock();
    const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()})]]);
    let resolveStatus;
    const status = new Promise(resolve => {resolveStatus = resolve;});
    const app = runtime(view, async address => new URL(address, "https://dashboard.test").pathname === "/api/source-sync"
      ? status : response(fixtureReport(view)), timer, "", storage);
    const first = app.load(false);
    assert.equal(app.calls.length, 1);
    timer.advance(35000);
    await app.load(false);
    assert.equal(app.calls.length, 1, "The next automatic interval must not replace the existing source check");
    assert.equal(app.calls[0].options.signal.aborted, false);
    resolveStatus(response({status: "running", jobId, weekStart: week}));
    await first;
    assert.equal(app.calls.length, 2);
    assert.equal(app.state.rendered, 1);
    assert.equal(app.el("refresh").disabled, false);
    assert.equal(timer.pending.size, 0);
  });

  test(view.name + " lets manual Refresh supersede a slow automatic pending-job request", async () => {
    const timer = clock();
    const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()})]]);
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (url.pathname === "/api/source-sync" && options.method !== "POST") return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Superseded", "AbortError")), {once: true});
      });
      if (options.method === "POST") return response({status: "running", jobId, weekStart: week});
      return response(fixtureReport(view));
    }, timer, "", storage);
    const automatic = app.load(false);
    assert.equal(app.calls.length, 1);
    const manual = app.load(true, {fresh: true});
    await Promise.all([automatic, manual]);
    assert.equal(app.calls.length, 3);
    assert.equal(app.calls[0].options.signal.aborted, true);
    assert.equal(app.calls[1].options.method, "POST");
    assert.equal(app.calls[1].options.signal.aborted, false);
    assert.equal(app.state.rendered, 1);
    assert.match(app.el("status").textContent, /updating in background/);
    assert.equal(app.el("weekNoteInput").value, "Unsaved meeting draft");
    assert.equal(app.el("refresh").disabled, false);
    assert.equal(timer.pending.size, 0);
  });

  test(view.name + " rechecks other cards and retains the Cropster reference when the pending status connection fails", async () => {
    let fail = false;
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (options.method === "POST") return response({status: "running", jobId, weekStart: week});
      if (url.pathname === "/api/source-sync" && fail) throw new Error("Connection unavailable");
      return response(fixtureReport(view));
    });
    await app.load(true, {fresh: true});
    const previous = app.state.payload;
    fail = true;
    await app.load(false);
    assert.notEqual(app.state.payload, previous);
    assert.equal(app.state.rendered, 2);
    assert.equal(app.calls.length, 4);
    const lastUrl = new URL(app.calls[3].address, "https://dashboard.test");
    assert.equal(lastUrl.pathname, view.path);
    assert.equal(lastUrl.searchParams.get("sourceSyncCheckUnavailable"), "1");
    assert.equal(lastUrl.searchParams.get("sourceSyncJob"), jobId);
    assert.equal(app.pending().jobId, jobId);
    assert.equal(app.el("weekNoteInput").value, "Unsaved meeting draft");
    assert.match(app.el("status").textContent, /Cropster update status could not be checked\. Other sources were rechecked\./);
    assert.doesNotMatch(app.el("status").textContent, /All connected sources/);
  });

  test(view.name + " still reads other cards after a transient503 from a pending-job GET", async () => {
    const timer = clock();
    const reference = {jobId, weekStart: week, startedAt: timer.Date.now()};
    const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify(reference)]]);
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (url.pathname === "/api/source-sync") {
        assert.notEqual(options.method, "POST");
        return response({error: "Temporarily unavailable"}, 503);
      }
      assert.equal(url.pathname, view.path);
      assert.equal(url.searchParams.get("sourceSyncCheckUnavailable"), "1");
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      assert.equal(url.searchParams.get("sourceSyncWeek"), week);
      return response(fixtureReport(view));
    }, timer, "", storage);
    await app.load(false);
    assert.equal(app.calls.length, 2);
    assert.equal(app.state.rendered, 1);
    assert.deepEqual(app.pending(), reference);
    assert.match(app.el("status").textContent, /Cropster update status could not be checked/);
    assert.doesNotMatch(app.el("status").textContent, /All connected sources/);
    assert.equal(app.el("weekNoteInput").value, "Unsaved meeting draft");
  });

  test(view.name + " bypasses other feed caches without retrying a503 source start in the report", async () => {
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (url.pathname === "/api/source-sync") {
        assert.equal(options.method, "POST");
        return response({error: "Temporarily unavailable"}, 503);
      }
      assert.equal(url.pathname, view.path);
      assert.equal(url.searchParams.get("refresh"), "1");
      assert.equal(url.searchParams.get("sourceSyncCheckUnavailable"), "1");
      assert.equal(url.searchParams.has("sourceSyncJob"), false);
      return response(fixtureReport(view));
    });
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 2);
    assert.equal(app.state.rendered, 1);
    assert.equal(app.pending(), null);
    assert.match(app.el("status").textContent, /Cropster update status could not be checked/);
    assert.doesNotMatch(app.el("status").textContent, /All connected sources/);
  });

  test(view.name + " accepts immediate completion without polling", async () => {
    const app = runtime(view, async (address, options) => {
      if (options.method === "POST") return response({status: "complete", jobId, weekStart: week});
      assert.equal(new URL(address, "https://dashboard.test").searchParams.get("sourceSyncJob"), jobId);
      return response(fixtureReport(view));
    });
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 2);
    assert.equal(app.pending(), null);
    assert.match(app.el("status").textContent, /All connected sources were updated/);
  });
}

test("the same pending reference is joined when moving between all three dashboards", async () => {
  const storage = new Map();
  const timer = clock();
  for (const [index, view] of views.entries()) {
    const app = runtime(view, async (address, options) => {
      const url = new URL(address, "https://dashboard.test");
      if (index === 0 && options.method === "POST") return response({status: "running", jobId, weekStart: week});
      if (url.pathname === "/api/source-sync") {
        assert.notEqual(options.method, "POST");
        assert.equal(url.searchParams.get("jobId"), jobId);
        return response({status: "running", jobId, weekStart: week});
      }
      assert.equal(url.pathname, view.path);
      assert.equal(url.searchParams.get("sourceSyncJob"), jobId);
      return response(fixtureReport(view));
    }, timer, "", storage);
    await app.load(index === 0, {fresh: index === 0});
    assert.equal(app.calls.length, 2);
    assert.equal(app.pending().startedAt, timer.Date.now());
    assert.match(app.el("status").textContent, /updating in background/);
  }
});

test("all three pages use the same background job reference validation and coordinator", () => {
  const implementations = views.map(view => {
    const code = script(view.page);
    return code.slice(code.indexOf("    const sourceSyncStorageKey"), code.indexOf("    function sourceSyncResultText("));
  });
  assert.equal(implementations[0], implementations[1]);
  assert.equal(implementations[0], implementations[2]);
  assert.doesNotMatch(implementations[0], /while\s*\(/);
});

test("malformed, expired and future-dated stored references never cause a status request", async () => {
  const timer = clock();
  const valid = {jobId, weekStart: week, startedAt: timer.Date.now()};
  for (const raw of [
    "{invalid", "x".repeat(251), JSON.stringify([]),
    JSON.stringify({...valid, jobId: "https://untrusted.test/private"}),
    JSON.stringify({...valid, weekStart: "2026-11-17"}),
    JSON.stringify({...valid, startedAt: timer.Date.now() - 2100000}),
    JSON.stringify({...valid, startedAt: timer.Date.now() + 1}),
    JSON.stringify({...valid, extra: "unexpected"}),
  ]) {
    const storage = new Map([["bmc-dashboard-cropster-source-job-v1", raw]]);
    const app = runtime(views[0], async address => {
      assert.equal(new URL(address, "https://dashboard.test").pathname, views[0].path);
      return response(fixtureReport(views[0]));
    }, timer, "", storage);
    await app.load(false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.pending(), null);
    assert.equal(storage.size, 0);
    assert.deepEqual(app.timer.durations.slice(-1), [30000]);
  }
});

test("the original start time is preserved across manual taps on a coalesced job and expires at35minutes", async () => {
  const app = runtime(views[0], async (_address, options) => options.method === "POST"
    ? response({status: "running", jobId, weekStart: week}) : response(fixtureReport(views[0])));
  await app.load(true, {fresh: true});
  const startedAt = app.pending().startedAt;
  app.timer.advance(60000);
  await app.load(true, {fresh: true});
  assert.equal(app.pending().startedAt, startedAt);
  app.timer.advance(2040000);
  assert.equal(app.pending(), null);
  assert.equal(app.storage.size, 0);
});

test("historical Steam Room views do not poll or attach the current-week job and keep it available", async () => {
  const timer = clock();
  const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()})]]);
  const app = runtime(views[0], async address => {
    const url = new URL(address, "https://dashboard.test");
    assert.equal(url.pathname, views[0].path);
    assert.equal(url.searchParams.get("week"), "2026-11-09");
    assert.equal(url.searchParams.has("sourceSyncJob"), false);
    const report = fixtureReport(views[0]);
    report.week = {start: "2026-11-09", isCurrent: false};
    return response(report);
  }, timer, "2026-11-09", storage);
  await app.load(false);
  assert.equal(app.calls.length, 1);
  assert.equal(app.pending().jobId, jobId);
  assert.equal(app.notice(app.state.payload), "Cropster: saved Friday archive.");
});

test("unexpected job IDs or weeks from the source endpoint cannot be applied to cards", async () => {
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
    assert.equal(app.pending(), null);
  }
});

test("a completion for a different pending job is rejected without losing the valid stored reference", async () => {
  const timer = clock();
  const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()})]]);
  const app = runtime(views[0], async () => response({status: "complete", jobId: "99999999-2222-4333-8444-555555555555", weekStart: week}), timer, "", storage);
  await app.load(false);
  assert.equal(app.calls.length, 1);
  assert.equal(app.state.rendered, 0);
  assert.equal(app.pending().jobId, jobId);
});

test("source protocol and permission failures are not treated as transient transport failures", async () => {
  for (const status of [400, 403, 404, 409, 422]) {
    const app = runtime(views[0], async () => response({error: "Invalid request"}, status));
    await app.load(true, {fresh: true});
    assert.equal(app.calls.length, 1);
    assert.equal(app.state.rendered, 0);
    assert.equal(app.pending(), null);
  }
});

test("an aborted pending source request never triggers another report read", async () => {
  const timer = clock();
  const storage = new Map([["bmc-dashboard-cropster-source-job-v1", JSON.stringify({jobId, weekStart: week, startedAt: timer.Date.now()})]]);
  const app = runtime(views[0], async (_address, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), {once: true});
  }), timer, "", storage);
  const completion = app.load(false);
  assert.equal(app.calls.length, 1);
  app.abort();
  await completion;
  assert.equal(app.calls.length, 1);
  assert.equal(app.state.rendered, 0);
  assert.equal(app.pending().jobId, jobId);
});

test("pending state takes precedence over an old all-updated source summary", () => {
  const app = runtime(views[0], async () => {throw Error("No network expected");});
  const report = {sourceSync: {status: "complete", message: "All sources updated."}};
  assert.match(app.summary(report, report, {status: "running", jobId}), /updating in background/);
  assert.doesNotMatch(app.summary(report, report, {status: "running", jobId}), /All sources updated/);
});

test("Lab freshness uses its own saved capture while production has a newer timestamp", () => {
  const app = runtime(views[2], async () => {throw Error("No network expected");});
  const notice = app.notice({source: {asOf: captured}, cropsterRefresh: {mode: "website-reader", status: "refreshed", productionAsOf: checked}});
  assert.ok(notice.includes(captured));
  assert.ok(!notice.includes(checked));
});
