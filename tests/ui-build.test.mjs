import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';
import {buildUiDocument} from '../worker/ui-build.js';
import {weeklyPage} from '../worker/weekly-ui.js';

const origin = 'https://dashboard.test';
test('UI fingerprints match the served script and its CSP, without exposing business data', async () => {
  const build = await worker.fetch(new Request(origin + '/api/ui-build?view=steam-room'), {});
  assert.equal(build.status, 200);
  const {buildId, ...rest} = await build.json();
  assert.match(buildId, /^[a-f0-9]{64}$/);
  assert.deepEqual(rest, {});
  const response = await worker.fetch(new Request(origin), {});
  const html = await response.text();
  assert.match(html, new RegExp('const uiBuildId = "' + buildId + '"'));
  assert.doesNotMatch(html, /__BMC_UI_BUILD_ID__/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script))).toString('base64');
  assert.ok(response.headers.get('Content-Security-Policy').includes("'sha256-" + hash + "'"));
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const changed = await buildUiDocument(weeklyPage + '<!-- different UI -->');
  assert.notEqual(changed.buildId, buildId);
});

test('every view has a fixed local build endpoint and invalid views do not resolve arbitrary pages', async () => {
  for (const view of ['steam-room', 'roastery-lab', 'warehouse', 'details']) {
    const response = await worker.fetch(new Request(origin + '/api/ui-build?view=' + view), {});
    assert.equal(response.status, 200);
    assert.match((await response.json()).buildId, /^[a-f0-9]{64}$/);
  }
  for (const view of ['constructor', '__proto__', 'https://external.test/']) {
    const response = await worker.fetch(new Request(origin + '/api/ui-build?view=' + encodeURIComponent(view)), {});
    assert.equal(response.status, 400);
  }
});

function runtime({dirtyNote = false, reading = '', match = false, fail = false} = {}) {
  const source = weeklyPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const block = source.slice(source.indexOf('    const uiResumeKey'), source.indexOf('    async function load('));
  const elements = new Map(), storage = new Map(), notes = new Map();
  const buildId = 'a'.repeat(64), nextId = 'b'.repeat(64);
  const state = {reloads: 0, loads: [], fetches: [], dirty: dirtyNote};
  const el = id => {
    if (!elements.has(id)) elements.set(id, {hidden: true, disabled: false, textContent: '', querySelectorAll: () => [{value: id === 'captureForm' ? reading : ''}]});
    return elements.get(id);
  };
  notes.set('2026-11-16', {draft: 'Unsaved note', saving: false});
  const deps = {el, notes, state, buildId, storage, fetch: async (url, options) => {
    state.fetches.push({url, options});
    if (fail) throw new Error('Temporarily unavailable');
    return Response.json({buildId: match ? buildId : nextId});
  }};
  const app = new Function('deps', `
    const {el, notes: weekNotes, state, buildId: uiBuildId, fetch, storage} = deps;
    const sessionStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)};
    const location = {reload: () => state.reloads++};
    const set = (id, text) => el(id).textContent = text;
    const noteWasChanged = () => state.dirty;
    const readJson = response => response.json();
    const load = (...args) => state.loads.push(args);
    let signedIn = true, currentRequest = null;
    ${block}
    return {manualRefresh, reloadUpdatedDashboard, renderUiUpdate, consumeUiRefreshIntent, hasUnsavedDashboardEdits,
      save: () => {state.dirty = false; renderUiUpdate();}, signOut: () => {signedIn = false;}};
  `)(deps);
  return {...app, state, storage, el, notes};
}

test('manual Refresh reloads a changed clean UI and leaves a bounded one-time refresh intent', async () => {
  const app = runtime();
  await app.manualRefresh();
  assert.equal(app.state.reloads, 1);
  assert.equal(app.state.loads.length, 0);
  const value = JSON.parse([...app.storage.values()][0]);
  assert.equal(value.buildId, 'b'.repeat(64));
  assert.ok(Date.now() - value.at < 1000);
  // An intent for a different build is discarded, never replayed indefinitely.
  assert.equal(app.consumeUiRefreshIntent(), false);
  assert.equal(app.storage.size, 0);
});

test('a dashboard update retains unsaved notes, refreshes data, and only enables Reload after saving', async () => {
  const app = runtime({dirtyNote: true});
  await app.manualRefresh();
  assert.equal(app.state.reloads, 0);
  assert.equal(app.notes.get('2026-11-16').draft, 'Unsaved note');
  assert.equal(app.el('uiUpdate').hidden, false);
  assert.equal(app.el('uiReload').disabled, true);
  assert.match(app.el('uiUpdateText').textContent, /Save your notes/);
  assert.deepEqual(app.state.loads, [[true, {fresh: true}]]);
  assert.equal(app.reloadUpdatedDashboard(), false);
  app.save();
  assert.equal(app.el('uiReload').disabled, false);
  assert.equal(app.reloadUpdatedDashboard(), true);
  assert.equal(app.state.reloads, 1);
});

test('entered source readings also prevent UI reload; version-check failure never blocks data refresh', async () => {
  const draft = runtime({reading: '123.45'});
  await draft.manualRefresh();
  assert.equal(draft.state.reloads, 0);
  assert.equal(draft.el('uiReload').disabled, true);
  for (const options of [{match: true}, {fail: true}]) {
    const app = runtime(options);
    await app.manualRefresh();
    assert.equal(app.state.reloads, 0);
    assert.deepEqual(app.state.loads, [[true, {fresh: true}]]);
  }
});

test('a reload refresh intent is consumed once and rejects malformed, expired, or future timestamps', () => {
  const app = runtime();
  const key = 'bmc-dashboard-ui-refresh-v1';
  app.storage.set(key, JSON.stringify({buildId: 'a'.repeat(64), at: Date.now()}));
  assert.equal(app.consumeUiRefreshIntent(), true);
  assert.equal(app.consumeUiRefreshIntent(), false);
  for (const value of ['{', JSON.stringify({buildId: 'a'.repeat(64), at: Date.now() - 180000}), JSON.stringify({buildId: 'a'.repeat(64), at: Date.now() + 180000})]) {
    app.storage.set(key, value);
    assert.equal(app.consumeUiRefreshIntent(), false);
    assert.equal(app.storage.size, 0);
  }
});
