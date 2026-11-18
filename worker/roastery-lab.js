import { HttpError } from "./auth.js";
import { sydneyDate, validDate } from "./metrics.js";
import { readLabSettings } from "./roastery-lab-settings.js";

const signatureNames = ["Liberty", "Rhythm", "OH"];
const parts = ["inventory", "recipes", "use", "loss"];
const key = name => name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const round = (value, digits = 2) => Number(value.toFixed(digits));
const sum = values => values.reduce((total, value) => total + value, 0);
const totalIfKnown = values => values.length && values.every(Number.isFinite) ? sum(values) : null;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function fail(message) {
  throw new HttpError(message);
}

function name(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    fail("Use a short Cropster coffee or location name.");
  }
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function amount(value, maximum = 100_000_000) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) fail("Enter a valid Cropster quantity, price or percentage.");
  return value;
}

function optionalAmount(value, maximum) {
  return value == null ? null : amount(value, maximum);
}

function date(value, today) {
  if (!validDate(value) || value > today) fail("Use a valid Cropster report date on or before today.");
  return value;
}

function rows(value, maximum, parse, identity) {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => !object(item))) fail("Check the rows in the Cropster report.");
  const seen = new Set();
  return value.map(item => {
    const parsed = parse(item);
    const id = identity(parsed);
    if (seen.has(id)) fail("A Cropster report contains duplicate rows.");
    seen.add(id);
    return parsed;
  });
}

function inventory(data, today) {
  return {
    asOf: date(data.asOf, today),
    totalKg: optionalAmount(data.totalKg),
    rows: rows(data.rows, 1_200, item => ({
      name: name(item.name),
      location: name(item.location),
      lotId: item.lotId == null ? null : name(item.lotId),
      kg: amount(item.kg),
      pricePerKg: optionalAmount(item.pricePerKg, 10_000),
    }), row => JSON.stringify([key(row.lotId ?? row.name), key(row.location)])),
    // A current price can also come from an exact Cropster lot price read separately.
    prices: rows(data.prices ?? [], 600, item => ({
      name: name(item.name), pricePerKg: amount(item.pricePerKg, 10_000),
    }), row => key(row.name)),
  };
}

function recipes(data, today) {
  return {
    asOf: date(data.asOf, today),
    rows: rows(data.rows, 150, item => {
      const components = rows(item.components, 20, component => ({
        name: name(component.name),
        coffee: component.coffee == null ? null : name(component.coffee),
        percent: amount(component.percent, 100),
      }), row => key(row.name));
      if (!components.length || components.some(component => component.percent === 0) ||
          Math.abs(sum(components.map(component => component.percent)) - 100) > 0.051) {
        fail("Each verified Cropster blend recipe must add up to 100%.");
      }
      const label = item.signature == null ? null : signatureNames.find(signature => key(signature) === key(name(item.signature)));
      if (item.signature != null && !label) fail("Use Liberty, Rhythm or OH as the signature label.");
      return { name: name(item.name), signature: label, components };
    }, row => key(row.signature ?? row.name)),
  };
}

function use(data, today) {
  return {
    months: rows(data.months, 18, month => {
      if (typeof month.month !== "string" || !validDate(month.month + "-01") || month.month >= today.slice(0, 7)) {
        fail("Use completed Sydney months for green coffee consumption.");
      }
      const reading = {
        month: month.month,
        complete: month.complete === true,
        kg: optionalAmount(month.kg),
        bags: optionalAmount(month.bags),
        rows: rows(month.rows ?? [], 1_200, item => ({
          name: name(item.name), kg: amount(item.kg), bags: optionalAmount(item.bags),
        }), row => key(row.name)),
      };
      if (reading.complete && reading.kg != null &&
          Math.abs(sum(reading.rows.map(row => row.kg)) - reading.kg) > 0.1) fail("The complete monthly rows must add up to the reported kilograms.");
      return reading;
    }, row => row.month),
  };
}

function loss(data, today) {
  const asOf = date(data.asOf, today);
  const from = data.from == null ? null : date(data.from, asOf);
  return {
    from,
    asOf,
    rows: rows(data.rows, 400, item => {
      const greenKg = amount(item.greenKg);
      const roastedKg = amount(item.roastedKg);
      const batches = optionalAmount(item.batches, 100_000);
      if (greenKg <= 0 || roastedKg > greenKg || !Number.isInteger(batches ?? 0)) fail("Check the measured roast weights and batch count.");
      return { name: name(item.name), greenKg, roastedKg, batches };
    }, row => key(row.name)),
  };
}

const parsePart = { inventory, recipes, use, loss };

export async function saveLabCropster(db, input, now = new Date()) {
  if (!object(input)) fail("Use a Cropster report object.");
  const entries = Object.entries(input);
  if (!entries.length || entries.some(([part, report]) => !parts.includes(part) || !object(report))) {
    fail("Use inventory, recipes, use or loss sections from the Cropster reports.");
  }
  const today = sydneyDate(now);
  const records = entries.map(([part, report]) => [part, JSON.stringify(parsePart[part](report, today))]);
  try {
    const statements = records.map(([part, payload]) => db.prepare(
      "INSERT INTO dashboard_roastery_lab_cropster (part, data_json, recorded_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(part) DO UPDATE SET data_json = excluded.data_json, recorded_at = excluded.recorded_at " +
      "WHERE excluded.recorded_at >= dashboard_roastery_lab_cropster.recorded_at",
    ).bind(part, payload, now.getTime()));
    await db.batch(statements);
  } catch {
    throw new HttpError("The Cropster report could not be saved. Try again.", 503);
  }
}

function previousMonths(today) {
  const [year, month] = today.split("-").map(Number);
  return [3, 2, 1].map(offset => new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7));
}

function groupStock(stock = {}) {
  const items = new Map();
  for (const row of stock.rows ?? []) {
    const id = key(row.name);
    if (!items.has(id)) items.set(id, { name: row.name, kg: 0, pricedKg: 0, value: 0, pricePerKg: null, locations: new Map() });
    const item = items.get(id);
    item.kg += row.kg;
    if (row.pricePerKg !== null) {
      item.pricedKg += row.kg;
      item.value += row.pricePerKg * row.kg;
    }
    item.locations.set(row.location, (item.locations.get(row.location) ?? 0) + row.kg);
  }
  for (const item of items.values()) {
    if (item.kg > 0 && Math.abs(item.kg - item.pricedKg) < 0.000001) item.pricePerKg = item.value / item.kg;
  }
  for (const price of stock.prices ?? []) {
    const id = key(price.name);
    if (!items.has(id)) items.set(id, { name: price.name, kg: 0, locations: new Map() });
    items.get(id).pricePerKg = price.pricePerKg;
  }
  return items;
}

function priceReport(stock, recipeList = {}, measuredLoss = {}) {
  const lossByName = new Map((measuredLoss.rows ?? []).map(row => [key(row.name), row]));
  const signatureRecipes = new Map();
  const otherRecipes = [];
  for (const recipe of recipeList.rows ?? []) {
    const label = recipe.signature ?? signatureNames.find(signature => key(signature) === key(recipe.name));
    if (label) signatureRecipes.set(label, recipe);
    else otherRecipes.push(recipe);
  }
  function report(name, sourceName, components, unitPrice) {
    const observation = lossByName.get(key(sourceName)) ?? lossByName.get(key(name));
    return {
      name,
      pricePerKg: Number.isFinite(unitPrice) ? round(unitPrice) : null,
      lossPercent: observation ? round((1 - observation.roastedKg / observation.greenKg) * 100, 1) : null,
      lossBatchCount: observation?.batches ?? null,
      components,
    };
  }
  function blend(label, recipe) {
    const resolved = (recipe?.components ?? []).map(component => ({
      ...component, pricePerKg: stock.get(key(component.coffee ?? component.name))?.pricePerKg ?? null,
    }));
    const contributions = resolved.map(component => component.pricePerKg === null ? null : component.percent / 100 * component.pricePerKg);
    return report(label, recipe?.name ?? label,
      resolved.map(component => ({ ...component, pricePerKg: component.pricePerKg === null ? null : round(component.pricePerKg) })),
      totalIfKnown(contributions));
  }
  const others = new Map();
  for (const coffee of stock.values()) others.set(key(coffee.name), report(coffee.name, coffee.name, [], coffee.pricePerKg));
  for (const coffee of otherRecipes) others.set(key(coffee.name), blend(coffee.name, coffee));
  return {
    highlights: signatureNames.map(label => blend(label, signatureRecipes.get(label))),
    others: [...others.values()].sort((left, right) => left.name.localeCompare(right.name, "en-AU")),
    recipeAsOf: recipeList.asOf ?? null,
    lossFrom: measuredLoss.from ?? null,
    lossAsOf: measuredLoss.asOf ?? null,
    lossNote: "Loss uses recorded green and roasted weights in Cropster. Cropster can prefill roasted weights.",
  };
}

function forecastMonth(asOf, kg, perMonth) {
  if (!(kg > 0 && perMonth > 0)) return null;
  const date = new Date(asOf + "T00:00:00Z");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const elapsedMonth = date.getUTCDate() / monthDays;
  const offset = Math.max(0, Math.ceil(elapsedMonth + kg / perMonth - 1e-9) - 1);
  const finish = new Date(Date.UTC(year, month + offset, 1));
  return Number.isFinite(finish.getTime()) && finish.getUTCFullYear() < 10_000 ? finish.toISOString().slice(0, 7) : null;
}

export function labReport(data = {}, today = sydneyDate()) {
  const stock = groupStock(data.inventory);
  const prices = priceReport(stock, data.recipes, data.loss);
  prices.priceAsOf = data.inventory?.asOf ?? null;
  const monthsByDate = new Map((data.use?.months ?? []).map(month => [month.month, month]));
  const period = previousMonths(today);
  const months = period.map(date => monthsByDate.get(date));
  const summary = months.map((month, index) => ({
    month: period[index],
    kg: month?.kg ?? (month?.complete ? sum(month.rows.map(coffee => coffee.kg)) : null),
    bags: month?.bags ?? (month?.complete ? totalIfKnown(month.rows.map(coffee => coffee.bags)) ?? (month.rows.length === 0 ? 0 : null) : null),
  }));
  const latestMonth = summary.at(-1);
  const latestRows = months.at(-1)?.rows ?? [];
  const sumKg = totalIfKnown(summary.map(month => month.kg));
  const sumBags = totalIfKnown(summary.map(month => month.bags));
  const monthlyUse = months.map(month => ({
    complete: month?.complete === true,
    coffees: new Map((month?.rows ?? []).map(coffee => [key(coffee.name), coffee.kg])),
  }));
  const stockAsOf = data.inventory?.asOf ?? null;
  const forecasts = [...stock.values()].filter(coffee => coffee.kg > 0).map(coffee => {
    const total = totalIfKnown(monthlyUse.map(month => month.coffees.get(key(coffee.name)) ?? (month.complete ? 0 : null)));
    const monthlyKg = total === null ? null : total / 3;
    return {
      name: coffee.name,
      kg: round(coffee.kg),
      avgMonthlyKg: monthlyKg === null ? null : round(monthlyKg),
      depletionMonth: stockAsOf && monthlyKg !== null ? forecastMonth(stockAsOf, coffee.kg, monthlyKg) : null,
      locations: [...coffee.locations].filter(([, kg]) => kg > 0).sort(([left], [right]) => left.localeCompare(right, "en-AU"))
        .map(([name, kg]) => ({ name, kg: round(kg) })),
    };
  }).sort((left, right) => (left.depletionMonth ?? "\uffff").localeCompare(right.depletionMonth ?? "\uffff") ||
    left.name.localeCompare(right.name, "en-AU"));
  return {
    prices,
    consumption: {
      averageKg: sumKg === null ? null : round(sumKg / 3),
      averageBags: sumBags === null ? null : round(sumBags / 3, 1),
      months: summary,
      lastMonth: { month: latestMonth.month, rows: [...latestRows].sort((left, right) => right.kg - left.kg) },
      stockAsOf,
      stockTotalKg: data.inventory?.totalKg ?? (stockAsOf && stock.size > 0 ? round(sum([...stock.values()].map(coffee => coffee.kg))) : null),
      forecasts,
      note: sumKg === null ? "Three completed Cropster months are needed for the average." :
        sumBags === null ? "Bag counts need recorded bag sizes or counts from Cropster." : "",
      forecastNote: "Estimated from the last three completed months and all recorded locations. Assumes the same use and no incoming deliveries. New coffees with no recorded use have no projected finish month.",
    },
  };
}

export async function readRoasteryLab(db, now = new Date()) {
  const [stored, settings] = await Promise.all([
    db.prepare("SELECT part, data_json, recorded_at FROM dashboard_roastery_lab_cropster").all(),
    readLabSettings(db),
  ]);
  const data = Object.fromEntries(stored.results.map(row => [row.part, JSON.parse(row.data_json)]));
  const report = labReport(data, sydneyDate(now));
  const complete = report.prices.highlights.every(item => item.pricePerKg !== null && item.lossPercent !== null) &&
    report.consumption.averageKg !== null && report.consumption.averageBags !== null &&
    report.consumption.forecasts.some(item => item.depletionMonth !== null);
  const latest = stored.results.length ? Math.max(...stored.results.map(row => row.recorded_at)) : null;
  return {
    ...report, settings,
    source: {
      status: latest === null ? "unavailable" : complete ? "recorded" : "partial",
      asOf: latest === null ? null : new Date(latest).toISOString(),
      note: latest === null ? "A verified Cropster report needs to be recorded." :
        complete ? "Latest verified Cropster reports." : "Latest verified Cropster reports. Unavailable figures are left blank.",
    },
  };
}
