import assert from "node:assert/strict";
import test from "node:test";
import { mapGreenBuy, mapGreenForecast, readGreenBuy } from "../worker/green-buy.js";

const week = "2026-11-09";
const now = new Date("2026-11-14T22:00:00Z");
const source = "https://bmc-green-forecast.misty-jelly-1931.chatgpt.site";
const settings = { currency: "AUD", forecastWeeks: 16 };
const buildState = (options = {}) => ({ state: {
  recipes: [{ id: "blend", active: true }],
  demand: [{ weekStart: week, recipeId: "blend" }],
  settings,
  purchaseOrders: [],
  ...options,
} });
const purchase = (id, orderDate, invoiceAmount, status = "ordered") => ({ id, orderDate, invoiceAmount, status, lines: [{ quantityKg: 69 }] });

function sheet(name, rows) {
  return `<Worksheet ss:Name="${name}"><Table>${rows.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${value}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
}

function workbook(lines, cash = []) {
  const columns = ["Order week", "Deliver by", "Cash due date", "Timing", "Planning source", "Supplier", "Pallet bags", "Pallet valid", "Green", "Contract", "Line bags", "Bag kg", "Line kg", "Price per kg", "Line value", "Reason"];
  const items = lines.map(line => [line.date, "", "", "on-time", "automatic", "Supplier &amp; Co", 16, line.valid ?? "Yes", "Green", "Contract", 1, 60, 60, line.price ?? 10, line.value, "shortage"]);
  return `<?xml version="1.0"?><Workbook>${sheet("Purchase forecast", [columns, ...items])}${sheet("Cash forecast", [["Week", "Reference", "Supplier", "Source", "Due date", "Amount"], ...cash])}</Workbook>`;
}

test("green buy counts actual order dates including Friday and sums invoices once", () => {
  const state = buildState({ purchaseOrders: [
    purchase("one", "2026-11-09", 3200),
    purchase("two", "2026-11-13", 1800, "delivered"),
    purchase("three", "2026-11-15", 620, "paid"),
    purchase("planned", "2026-11-13", 5000, "planned"),
    purchase("older", "2026-11-08", 6000, "paid"),
    purchase("later", "2026-11-16", 790),
  ], stockLots: [{ receivedDate: "2026-11-13", quantityKg: 100 }], manualForecastOrders: [purchase("plan", "2026-11-13", 9000)] });
  const result = mapGreenBuy(state, week, now);
  assert.equal(result.status, "live");
  assert.equal(result.orders, 3);
  assert.equal(result.kg, 207);
  assert.equal(result.value, 5620);
});

test("an old purchase register leaves the current buying total unknown", () => {
  const actual = mapGreenBuy(buildState({ purchaseOrders: [purchase("older", "2026-08-28", 1000)] }), week, now);
  assert.equal(actual.orders, null);
  assert.equal(actual.value, null);
  assert.match(actual.note, /28 Aug 2026/);
});

test("supplier purchase records with missing quantities or incomplete prices disclose partial coverage", () => {
  const actual = mapGreenBuy(buildState({ purchaseOrders: [
    purchase("one", week, 300),
    { ...purchase("two", week, 0), lines: [] },
  ] }), week, now);
  assert.equal(actual.status, "partial");
  assert.equal(actual.orders, 2);
  assert.equal(actual.kg, 69);
  assert.equal(actual.value, 300);
});

test("monthly spend follows order month and excludes invoices by due date", () => {
  const report = workbook([
    { date: "2026-11-09", value: 1250.36 },
    { date: "2026-11-30", value: 749.64 },
    { date: "2026-12-07", value: 6000 },
  ], [["2026-11-09", "Invoice", "Supplier", "invoice", "2026-11-11", 50_000]]);
  const forecast = mapGreenForecast(report, buildState(), now);
  assert.equal(forecast.month, "2026-11");
  assert.equal(forecast.value, 2000);
  assert.deepEqual(forecast.months.slice(0, 3), [
    { month: "2026-11", value: 2000, status: "live" },
    { month: "2026-12", value: 6000, status: "live" },
    { month: "2027-01", value: 0, status: "live" },
  ]);
});

test("forecast marks old demand, blocked pallets and incomplete horizon", () => {
  const data = buildState({ demand: [{ weekStart: "2026-08-24", recipeId: "blend" }], settings: { ...settings, forecastWeeks: 2 } });
  const plan = workbook([{ date: week, value: 400, valid: "No" }, { date: "2026-11-16", value: 530 }]);
  const forecast = mapGreenForecast(plan, data, now);
  assert.equal(forecast.value, 530);
  assert.equal(forecast.status, "partial");
  assert.match(forecast.note, /24 Aug 2026/);
  assert.match(forecast.note, /unfilled pallets/);
  assert.match(forecast.note, /partly covered/);
  assert.deepEqual(forecast.months[1], { month: "2026-12", value: null, status: "unavailable" });
  assert.equal(mapGreenForecast(workbook([{ date: week, value: 0, valid: "No" }]), data, now).value, null);
});

test("server source reads are restricted to the Green Forecast host and report failure preserves actual buys", async () => {
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, source);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["x-green-password"], "synthetic-local-test-password");
    if (new URL(url).pathname === "/api/roaster") return Response.json(buildState({ purchaseOrders: [purchase("one", week, 300)] }));
    return new Response("<html>Login</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  const result = await readGreenBuy({ weekStart: week, now, env: { SOURCE_GREEN_PASSWORD: "synthetic-local-test-password" }, fetcher });
  assert.equal(result.greenBuy.value, 300);
  assert.equal(result.greenForecast.value, null);
  assert.equal(result.greenForecast.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-local-test-password/);
});
