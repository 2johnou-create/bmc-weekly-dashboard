import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { labReport, readRoasteryLab, saveLabCropster } from "../worker/roastery-lab.js";
import { saveLabSettings } from "../worker/roastery-lab-settings.js";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { SOURCE_ORIGINS } from "../worker/metrics.js";

const now = new Date("2026-11-19T08:00:00Z");
const report = {
  inventory: {
    asOf: "2026-11-18",
    rows: [
      { name: "Example Brazil", location: "Roastery", lotId: "LOT-A", kg: 30, pricePerKg: 8 },
      { name: "Example Brazil", location: "Supplier", lotId: "LOT-A", kg: 90, pricePerKg: 12 },
      { name: "Example Ethiopia", location: "Roastery", kg: 50, pricePerKg: 20 },
      { name: "Example Honduras", location: "Supplier", kg: 25 },
    ],
  },
  recipes: {
    asOf: "2026-11-18",
    rows: [
      { name: "Liberty Blend", signature: "Liberty", components: [
        { name: "Profile Brazil", coffee: "Example Brazil", percent: 75 },
        { name: "Profile Ethiopia", coffee: "Example Ethiopia", percent: 25 },
      ] },
      { name: "Rhythm Blend", signature: "Rhythm", components: [
        { name: "Example Honduras", percent: 60 },
        { name: "Example Brazil", percent: 40 },
      ] },
    ],
  },
  use: {
    months: [
      { month: "2026-08", complete: true, kg: 50, rows: [{ name: "Example Brazil", kg: 50, bags: 1 }] },
      { month: "2026-09", complete: true, kg: 100, rows: [{ name: "Example Brazil", kg: 70 }, { name: "Example Ethiopia", kg: 30 }] },
      { month: "2026-10", complete: true, kg: 60, rows: [{ name: "Example Brazil", kg: 60, bags: 1.2 }] },
    ],
  },
  loss: {
    from: "2026-08-01", asOf: "2026-10-31",
    rows: [{ name: "Liberty Blend", greenKg: 260, roastedKg: 221, batches: 12 }],
  },
};

test("Lab values the raw weighted recipe, measures loss separately and keeps incomplete prices blank", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, report, now);
    const saved = await readRoasteryLab(db, now);
    assert.deepEqual(saved.prices.highlights.map(item => [item.name, item.pricePerKg, item.lossPercent]), [
      ["Liberty", 13.25, 15],
      ["Rhythm", null, null],
      ["OH", null, null],
    ]);
    assert.equal(saved.source.status, "partial");
    assert.equal(saved.prices.lossFrom, "2026-08-01");
    assert.equal(saved.prices.highlights[0].lossBatchCount, 12);
    assert.equal(saved.consumption.averageKg, 70);
    assert.equal(saved.consumption.averageBags, null);
    assert.deepEqual(saved.consumption.months[2], { month: "2026-10", kg: 60, bags: 1.2 });

    assert.deepEqual(saved.consumption.forecasts.find(coffee => coffee.name === "Example Brazil"), {
      name: "Example Brazil", kg: 120, avgMonthlyKg: 60, depletionMonth: "2027-01",
      locations: [{ name: "Roastery", kg: 30 }, { name: "Supplier", kg: 90 }],
    });
    assert.equal(saved.consumption.forecasts.find(coffee => coffee.name === "Example Honduras").avgMonthlyKg, 0);
    assert.equal(saved.consumption.forecasts.find(coffee => coffee.name === "Example Honduras").depletionMonth, null);
    const december = await readRoasteryLab(db, new Date("2026-11-30T13:00:00Z"));
    assert.deepEqual(december.consumption.months.map(month => month.month), ["2026-09", "2026-10", "2026-11"]);
    assert.equal(december.consumption.averageKg, null);
    assert.equal(december.consumption.forecasts[0].depletionMonth, null);
  } finally { db.close(); }
});

test("Cropster imports preserve other sections and reject mismatched full-month coverage", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, report, now);
    await saveLabCropster(db, { loss: { asOf: "2026-11-18", rows: [] } }, now);
    const saved = await readRoasteryLab(db, now);
    assert.equal(saved.prices.highlights[0].pricePerKg, 13.25);
    assert.equal(saved.prices.highlights[0].lossPercent, null);
    await assert.rejects(saveLabCropster(db, { use: { months: [{ month: "2026-10", complete: true, kg: 10, rows: [] }] } }, now), { status: 400 });
    const checked = await readRoasteryLab(db, now);
    assert.equal(checked.consumption.averageKg, 70);
  } finally { db.close(); }
});

test("Release rows and QA notes share the saved revision across devices", async () => {
  const db = localDatabase(":memory:");
  try {
    const initial = await readRoasteryLab(db, now);
    assert.deepEqual(initial.settings, { releases: [], qa: "", revision: 0, updatedAt: null });
    const releases = [{ name: " New coffee ", date: "2026-12-05" }, { name: "Later release", date: null }];
    const saved = await saveLabSettings(db, { releases, qa: "Checked\nReady for review", expectedRevision: 0 });
    assert.deepEqual(saved.releases, [{ name: "New coffee", date: "2026-12-05" }, { name: "Later release", date: null }]);
    assert.equal(saved.revision, 1);
    assert.equal((await readRoasteryLab(db, now)).settings.qa, "Checked\nReady for review");
    await assert.rejects(saveLabSettings(db, { releases: [], qa: "", expectedRevision: 0 }), { status: 409 });
    await assert.rejects(saveLabSettings(db, { releases: [{ name: "New coffee", date: "2026-02-30" }], qa: "", expectedRevision: 1 }), { status: 400 });
    assert.deepEqual((await saveLabSettings(db, { releases: [releases[1]], qa: "", expectedRevision: 1 })).releases, [releases[1]]);
  } finally { db.close(); }
});

test("Missing report sections use blank figures instead of accidental zeros", () => {
  const missing = labReport({}, "2026-11-19");
  assert.equal(missing.consumption.stockTotalKg, null);
  assert.equal(missing.consumption.averageKg, null);
  assert.equal(missing.prices.highlights[0].pricePerKg, null);
  assert.deepEqual(missing.consumption.months.map(month => month.kg), [null, null, null]);
});

test("The Lab protects source data and edits with a current Stock Take session and the dashboard origin", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-roastery-lab-test-session-secret-1234567890" };
  const base = "https://dashboard.test";
  const fetcher = globalThis.fetch;
  let authorised = true;
  let requests = 0;
  globalThis.fetch = async address => {
    requests += 1;
    assert.equal(address, SOURCE_ORIGINS.stockroom + "/api/inventory");
    return Response.json({ items: [] }, { status: authorised ? 200 : 401 });
  };
  try {
    const page = await worker.fetch(new Request(base + "/roastery-lab"), env);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Roastery Lab/);
    assert.equal(requests, 0);
    assert.equal((await worker.fetch(new Request(base + "/api/roastery-lab"), env)).status, 401);
    const cookie = (await sealSession(new Request(base), env, "bmc_stockroom_session=synthetic_lab_source_session")).split(";")[0];
    const edit = origin => new Request(base + "/api/roastery-lab/settings", {
      method: "PUT", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ releases: [], qa: "Checked", expectedRevision: 0 }),
    });
    assert.equal((await worker.fetch(edit("https://other.test"), env)).status, 403);
    assert.equal(requests, 0);
    assert.equal((await worker.fetch(edit(base), env)).status, 200);
    const read = () => worker.fetch(new Request(base + "/api/roastery-lab", { headers: { Cookie: cookie } }), env);
    const saved = await read();
    assert.equal(saved.headers.get("cache-control"), "no-store, private");
    const savedReport = await saved.json();
    assert.equal(savedReport.settings.qa, "Checked");
    assert.equal(savedReport.consumption.coverage.status, "unavailable");
    assert.deepEqual(savedReport.consumption.coverage.groups.map(group => group.name), ["Liberty", "Rhythm", "OH", "Decaf"]);
    authorised = false;
    assert.equal((await read()).status, 401);
  } finally { globalThis.fetch = fetcher; db.close(); }
});
