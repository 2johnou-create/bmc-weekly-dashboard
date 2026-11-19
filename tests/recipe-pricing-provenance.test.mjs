import assert from "node:assert/strict";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { labReport, readRoasteryLab, saveLabCropster } from "../worker/roastery-lab.js";
import { roasteryLabPage } from "../worker/roastery-lab-ui.js";

const now = new Date("2026-11-19T01:00:00.000Z");
const asOf = "2026-11-19";
const profile = "https://c-sar.cropster.com/apps/roast/profiles/Example1";
const provenance = {
  currentPricePerKg: 9.25,
  pricingBasis: "current-week-schedule",
  pricingDate: "2026-11-20",
  pricingLotIds: ["PG-0001"],
  pricingProfileUrl: profile,
};

function recipe(component = {}) {
  return {asOf, rows: [{name: "Example signature", signature: "Liberty", components: [
    {name: "Example profile", coffee: "Example coffee", percent: 100, ...component},
  ]}]};
}

const inventory = {
  asOf, rows: [
    {name: "Example coffee", location: "Roastery", lotId: "PG-0001", kg: 20, pricePerKg: 40},
    {name: "Example coffee", location: "Supplier", lotId: "PG-0002", kg: 80, pricePerKg: 80},
  ],
  prices: [{name: "Example coffee", pricePerKg: 100}],
};

test("imports retain exact scheduled-lot price provenance, including a future Friday assignment", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, {inventory, recipes: recipe(provenance)}, now);
    const row = await db.prepare("SELECT data_json FROM dashboard_roastery_lab_cropster WHERE part = 'recipes'").first();
    const component = JSON.parse(row.data_json).rows[0].components[0];
    assert.deepEqual(component, {name: "Example profile", coffee: "Example coffee", percent: 100, ...provenance});
    const report = await readRoasteryLab(db, now);
    assert.equal(report.prices.highlights[0].pricePerKg, 9.25);
    assert.equal(report.prices.highlights[0].components[0].pricePerKg, 9.25);
    assert.deepEqual(report.prices.highlights[0].components[0].pricingLotIds, ["PG-0001"]);
    assert.match(report.prices.highlights[0].components[0].pricingNote, /Scheduled lot price.*2026-11-20.*PG-0001/);
  } finally {db.close();}
});

test("signature prices use raw scheduled-lot prices and recipe shares without inventory-name fallback or roast-loss deductions", () => {
  const recipes = recipe({...provenance, percent: 25});
  recipes.rows[0].components.push({name: "Second profile", coffee: "No matching inventory name", percent: 75,
    ...provenance, currentPricePerKg: 20, pricingLotIds: ["PG-0003"]});
  const report = labReport({inventory, recipes, loss: {asOf, rows: [{name: "Example signature", greenKg: 100, roastedKg: 70, batches: 2}]}}, asOf);
  const blend = report.prices.highlights[0];
  assert.equal(blend.pricePerKg, 17.31);
  assert.equal(blend.lossPercent, 30);
  assert.equal(blend.pricingNote, "Current-week schedule price");
  assert.deepEqual(blend.components.map(row => row.pricePerKg), [9.25, 20]);
});

test("an explicit unknown or unverified current price stays unknown despite known same-name inventory prices", async () => {
  const db = localDatabase(":memory:");
  try {
    for (const component of [
      {...provenance, currentPricePerKg: null},
      {...provenance, currentPricePerKg: null, pricingBasis: "unverified"},
      {...provenance, currentPricePerKg: null, pricingBasis: "default-profile", pricingDate: asOf},
    ]) {
      await saveLabCropster(db, {inventory, recipes: recipe(component)}, now);
      const blend = (await readRoasteryLab(db, now)).prices.highlights[0];
      assert.equal(blend.pricePerKg, null);
      assert.equal(blend.components[0].pricePerKg, null);
      assert.match(blend.components[0].pricingNote, /price unavailable/);
    }
  } finally {db.close();}
});

test("default-profile raw prices are used with an explicit fallback label", async () => {
  const db = localDatabase(":memory:");
  try {
    const component = {...provenance, pricingBasis: "default-profile", pricingDate: asOf, currentPricePerKg: 12};
    await saveLabCropster(db, {inventory, recipes: recipe(component)}, now);
    const blend = (await readRoasteryLab(db, now)).prices.highlights[0];
    assert.equal(blend.pricePerKg, 12);
    assert.equal(blend.pricingNote, "Default profile fallback");
    assert.match(blend.components[0].pricingNote, /Default profile fallback price.*2026-11-19.*PG-0001/);
  } finally {db.close();}
});

test("legacy recipe payloads retain their existing inventory-name calculation and are labelled as saved recipe prices", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, {inventory, recipes: recipe()}, now);
    const stored = await db.prepare("SELECT data_json FROM dashboard_roastery_lab_cropster WHERE part = 'recipes'").first();
    assert.deepEqual(JSON.parse(stored.data_json).rows[0].components[0], {name: "Example profile", coffee: "Example coffee", percent: 100});
    const blend = (await readRoasteryLab(db, now)).prices.highlights[0];
    assert.equal(blend.pricePerKg, 100);
    assert.equal(blend.pricingNote, "Saved recipe price");
    assert.match(blend.components[0].pricingNote, /current-week lot not verified/);
  } finally {db.close();}
});

test("zero raw price is a verified value rather than an unknown-price fallback", () => {
  const blend = labReport({inventory, recipes: recipe({...provenance, currentPricePerKg: 0})}, asOf).prices.highlights[0];
  assert.equal(blend.pricePerKg, 0);
  assert.equal(blend.components[0].pricePerKg, 0);
});

test("invalid price provenance is rejected atomically without replacing the prior verified recipe", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, {inventory, recipes: recipe(provenance)}, now);
    for (const changed of [
      {currentPricePerKg: -1}, {currentPricePerKg: "9.25"}, {currentPricePerKg: 10_001},
      {pricingBasis: "inferred-from-name"}, {pricingBasis: undefined}, {pricingBasis: "unverified"},
      {pricingDate: "2026-11-23"}, {pricingDate: "2026-11-14"}, {pricingDate: "2026-02-30"},
      {pricingBasis: "default-profile", pricingDate: "2026-11-20"},
      {pricingLotIds: []}, {pricingLotIds: ["PG-0001", "PG-0001"]}, {pricingLotIds: ["not-a-green-lot"]},
      {pricingLotIds: "PG-0001"}, {pricingProfileUrl: null},
      {pricingProfileUrl: "https://untrusted.test/apps/roast/profiles/Example1"},
      {pricingProfileUrl: profile + "?redirect=elsewhere"}, {pricingProfileUrl: profile + "#source"},
    ]) {
      await assert.rejects(saveLabCropster(db, {recipes: recipe({...provenance, ...changed})}, now), {status: 400});
      assert.equal((await readRoasteryLab(db, now)).prices.highlights[0].pricePerKg, 9.25);
    }
  } finally {db.close();}
});

test("unverified provenance can preserve a Friday date and known lot IDs without inventing a price", async () => {
  const db = localDatabase(":memory:");
  try {
    await saveLabCropster(db, {recipes: recipe({...provenance, currentPricePerKg: null, pricingBasis: "unverified", pricingProfileUrl: null})}, now);
    const row = (await readRoasteryLab(db, now)).prices.highlights[0].components[0];
    assert.equal(row.pricePerKg, null);
    assert.equal(row.pricingDate, "2026-11-20");
    assert.deepEqual(row.pricingLotIds, ["PG-0001"]);
  } finally {db.close();}
});

test("incomplete provenance in pre-existing stored data never falls back to a same-name inventory price", () => {
  for (const changed of [{pricingLotIds: []}, {pricingProfileUrl: null}, {pricingDate: null}]) {
    const report = labReport({inventory, recipes: recipe({...provenance, ...changed})}, asOf);
    assert.equal(report.prices.highlights[0].pricePerKg, null);
  }
});

test("the Lab renders fallback pricing on its headline and the exact lot/date beside each ingredient", () => {
  function node(tag, content = "") {
    const result = {tag, children: [], append(...values) {this.children.push(...values);}, replaceChildren(...values) {this.children = values;},
      setAttribute() {}, querySelectorAll() {return [];},
      createTHead() {const head = node("thead"); head.insertRow = () => {const row = node("tr"); head.append(row); return row;}; this.append(head); return head;},
      createTBody() {const body = node("tbody"); this.append(body); return body;},
    };
    if (content !== undefined) result.append(content);
    Object.defineProperty(result, "textContent", {get() {return this.children.map(child => typeof child === "object" ? child.textContent : child).join(" ");}, set(value) {this.children = [value];}});
    return result;
  }
  const elements = new Map();
  const el = id => {if (!elements.has(id)) elements.set(id, node("div")); return elements.get(id);};
  const script = roasteryLabPage.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf("    function makeTableRow(");
  const end = script.indexOf("    function forecastName(", start);
  const render = new Function("deps", `
    const {node, el} = deps, blendNames = ['Liberty', 'Rhythm', 'OH'], currency = {}, missing = '—';
    const format = value => Number.isFinite(value) ? String(value) : missing;
    const percent = value => Number.isFinite(value) ? value + '%' : missing;
    const dateText = value => value || '';
    ${script.slice(start, end)}
    return renderPrices;
  `)({node, el});
  const prices = labReport({inventory, recipes: recipe({...provenance, pricingBasis: "default-profile", pricingDate: asOf})}, asOf).prices;
  render(prices);
  assert.match(el("blendHighlights").textContent, /Default profile fallback/);
  assert.match(el("blendDetails").textContent, /Default profile fallback price.*2026-11-19.*PG-0001/);
  assert.match(el("priceDates").textContent, /Inventory prices as of 2026-11-19/);
});
