import { HttpError } from "./auth.js";
import { sydneyDate, validDate } from "./metrics.js";
import { readLabSettings } from "./roastery-lab-settings.js";
import { buildRunoutPools } from "./profile-runout.js";

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

function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)) fail("Use an exact Cropster lot or profile group ID.");
  return value;
}

function optionalBoolean(value) {
  if (value !== undefined && typeof value !== "boolean") fail("Use a true or false report coverage flag.");
  return value === true;
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
    allLocationsComplete: optionalBoolean(data.allLocationsComplete),
    totalKg: optionalAmount(data.totalKg),
    rows: rows(data.rows, 1_200, item => ({
      name: name(item.name),
      location: name(item.location),
      lotId: item.lotId == null ? null : name(item.lotId),
      ...(item.positionId == null ? {} : { positionId: identifier(item.positionId) }),
      kg: amount(item.kg),
      pricePerKg: optionalAmount(item.pricePerKg, 10_000),
    }), row => JSON.stringify([key(row.lotId ?? row.name), key(row.location)])),
    // A current price can also come from an exact Cropster lot price read separately.
    prices: rows(data.prices ?? [], 600, item => ({
      name: name(item.name), pricePerKg: amount(item.pricePerKg, 10_000),
    }), row => key(row.name)),
    contracts: rows(data.contracts ?? [], 1_200, item => {
      const remainingKg = amount(item.remainingKg), includedInventoryKg = optionalAmount(item.includedInventoryKg);
      if (includedInventoryKg !== null && includedInventoryKg > remainingKg) fail("A contract’s included stock cannot exceed its remaining kilograms.");
      if (item.availableFrom != null && !validDate(item.availableFrom)) fail("Use a valid contract availability date or leave it unknown.");
      return { id: identifier(item.id), lotId: identifier(item.lotId), remainingKg, includedInventoryKg, availableFrom: item.availableFrom ?? null };
    }, row => row.id),
  };
}

function recipes(data, today) {
  return {
    asOf: date(data.asOf, today),
    decafProfileGroupId: data.decafProfileGroupId == null ? null : identifier(data.decafProfileGroupId),
    runoutProfiles: rows(data.runoutProfiles ?? [], 300, item => {
      if (!Array.isArray(item.lotIds) || item.lotIds.length > 1_200) fail("Record all related Cropster lot IDs for each profile group.");
      const lotIds = item.lotIds.map(identifier);
      if (new Set(lotIds).size !== lotIds.length) fail("A profile group contains duplicate lot IDs.");
      if (item.note != null && (typeof item.note !== "string" || item.note.length > 1_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(item.note))) fail("Use a short source note for profile eligibility.");
      const provenance = {};
      for (const field of ["cropsterLotIds", "plannedLotIds", "historicalLotIds"]) {
        if (item[field] === undefined) continue;
        if (!Array.isArray(item[field]) || item[field].length > 1_200) fail("Record valid source assignments for each profile group.");
        const ids = item[field].map(identifier);
        if (new Set(ids).size !== ids.length || ids.some(id => !lotIds.includes(id))) fail("Source assignments must match the group’s related lots.");
        provenance[field] = ids;
      }
      return { id: identifier(item.id), name: name(item.name), lotIds, ...provenance, linksComplete: optionalBoolean(item.linksComplete), note: item.note?.replace(/\s+/g, " ").trim() || "" };
    }, row => row.id),
    runoutLotNames: rows(data.runoutLotNames ?? [], 2_400, item => ({ lotId: identifier(item.lotId), name: name(item.name) }), row => JSON.stringify([row.lotId, key(row.name)])),
    rows: rows(data.rows, 150, item => {
      const components = rows(item.components, 20, component => ({
        name: name(component.name),
        coffee: component.coffee == null ? null : name(component.coffee),
        ...(component.profileGroupId == null ? {} : { profileGroupId: identifier(component.profileGroupId) }),
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
          ...(item.lotId == null ? {} : { lotId: identifier(item.lotId) }),
        }), row => row.lotId ? "id:" + row.lotId : "name:" + key(row.name)),
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

const coverageGroups = [
  { name: "Liberty", columns: ["B", "C", "D"] },
  { name: "Rhythm", columns: ["D", "F", "G"] },
  { name: "OH", columns: ["H"] },
  { name: "Decaf", columns: ["I"] },
];
const coverageProfiles = {
  Liberty: { B: "Liberty Ethiopia", C: "Liberty Honduras", D: "Liberty Brazil" },
  Rhythm: { D: "Rhythm Brazil", F: "Rhythm China", G: "Rhythm Indonesia" },
  OH: { H: "OH Peru" },
};
const coverageText = (value, maximum = 600) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) : "";
const monthKey = value => typeof value === "string" && validDate(value + "-01");
const knownQuantity = value => Number.isFinite(value) && value >= 0 ? value : null;

/** Contract cells describe the purchase plan; observed kilograms stay at origin level. */
export function mergeGreenCoverage(consumption = {}, prices = {}, contracts = {}, today = sydneyDate()) {
  const currentMonth = validDate(today) ? today.slice(0, 7) : null;
  const currentYear = currentMonth ? Number(currentMonth.slice(0, 4)) : null;
  const observed = new Map();
  const duplicateOrigins = new Set();
  for (const origin of Array.isArray(consumption.origins) ? consumption.origins : []) {
    if (!object(origin) || typeof origin.name !== "string" || !origin.name.trim()) continue;
    if (observed.has(key(origin.name))) duplicateOrigins.add(key(origin.name));
    observed.set(key(origin.name), origin);
  }
  const sourceColumns = new Map();
  const duplicateColumns = new Set();
  for (const column of Array.isArray(contracts.columns) ? contracts.columns : []) {
    if (!object(column) || !coverageGroups.some(group => group.columns.includes(column.id))) continue;
    if (sourceColumns.has(column.id)) duplicateColumns.add(column.id);
    sourceColumns.set(column.id, column);
  }
  const laneOrigins = new Map();
  const laneProfileGroups = new Map();
  const poolsByProfile = new Map(), ambiguousProfiles = new Set();
  for (const pool of Array.isArray(consumption.runoutPools) ? consumption.runoutPools : []) {
    for (const profileId of Array.isArray(pool?.profileGroupIds) ? pool.profileGroupIds : []) {
      if (poolsByProfile.has(profileId)) ambiguousProfiles.add(profileId);
      poolsByProfile.set(profileId, pool);
    }
  }
  for (const group of coverageGroups) for (const sourceColumn of group.columns) {
    let origin = null;
    if (group.name === "Decaf") {
      laneProfileGroups.set(`${group.name.toLowerCase()}-${sourceColumn}`, consumption.decafProfileGroupId ?? null);
      const source = duplicateColumns.has(sourceColumn) ? null : sourceColumns.get(sourceColumn);
      if (/\bcolombia\b/i.test(source?.origin ?? "")) {
        const candidates = [...observed.values()].filter(item => /decaf/i.test(item.name) && /\bcolombia\b/i.test(item.name));
        if (candidates.length === 1 && !duplicateOrigins.has(key(candidates[0].name))) origin = candidates[0];
      }
    } else {
      const matchingRecipes = (prices.highlights ?? []).filter(item => key(item.name) === key(group.name));
      const components = matchingRecipes.length === 1 ? matchingRecipes[0].components ?? [] : [];
      const profile = coverageProfiles[group.name]?.[sourceColumn];
      let matches = components.filter(component => typeof component.name === "string" && key(component.name) === key(profile));
      if (group.name === "OH" && matches.length === 0 && components.length === 1 && components[0].percent === 100) matches = components;
      if (matches.length === 1 && typeof matches[0].profileGroupId === "string") laneProfileGroups.set(`${group.name.toLowerCase()}-${sourceColumn}`, matches[0].profileGroupId);
      if (matches.length === 1 && typeof matches[0].coffee === "string") {
        const id = key(matches[0].coffee);
        if (!duplicateOrigins.has(id)) origin = observed.get(id) ?? null;
      }
    }
    laneOrigins.set(`${group.name.toLowerCase()}-${sourceColumn}`, origin);
  }
  const lanePools = new Map([...laneProfileGroups].map(([lane, profileId]) => [lane, ambiguousProfiles.has(profileId) ? null : poolsByProfile.get(profileId) ?? null]));
  const forecastYears = [...lanePools.values()].filter(pool => monthKey(pool?.depletionMonth)).map(pool => Number(pool.depletionMonth.slice(0, 4)));
  const years = [...new Set([...(contracts.years ?? []), currentYear, ...forecastYears].filter(year => Number.isInteger(year) && year >= 1900 && year <= 9999))].sort((a, b) => a - b);
  const allMonths = years.flatMap(year => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`));
  const groups = coverageGroups.map(group => ({
    name: group.name,
    columns: group.columns.map(sourceColumn => {
      const source = duplicateColumns.has(sourceColumn) ? null : sourceColumns.get(sourceColumn);
      const byMonth = new Map();
      const duplicates = new Set();
      for (const cell of Array.isArray(source?.cells) ? source.cells : []) {
        if (!object(cell) || !monthKey(cell.month)) continue;
        if (byMonth.has(cell.month)) duplicates.add(cell.month);
        byMonth.set(cell.month, cell);
      }
      const cells = allMonths.map(month => {
        const cell = duplicates.has(month) ? null : byMonth.get(month);
        const state = ["contracted", "gap", "unknown"].includes(cell?.state) ? cell.state : "unknown";
        return { month, state, text: coverageText(cell?.text, 1_000), sourceCell: coverageText(cell?.sourceCell, 20) || null };
      });
      const future = currentMonth ? cells.filter(cell => cell.month >= currentMonth) : [];
      let coverageThrough = null;
      // A missing/unknown month breaks continuity just as a known gap does.
      for (const cell of future) {
        if ((coverageThrough === null && cell.month !== currentMonth) || cell.state !== "contracted") break;
        const expected = coverageThrough === null ? currentMonth :
          new Date(Date.UTC(Number(coverageThrough.slice(0, 4)), Number(coverageThrough.slice(5, 7)), 1)).toISOString().slice(0, 7);
        if (cell.month !== expected) break;
        coverageThrough = cell.month;
      }
      const id = `${group.name.toLowerCase()}-${sourceColumn}`;
      const origin = laneOrigins.get(id);
      const runout = lanePools.get(id) ?? null;
      return {
        id, sourceColumn,
        label: coverageText(source?.origin, 160) || "Origin unavailable",
        rateLabel: coverageText(source?.rateLabel, 256),
        coffee: origin?.name ?? null,
        twoMonthAverageKg: knownQuantity(runout?.twoMonthAverageKg),
        stockDepletionMonth: monthKey(runout?.depletionMonth) ? runout.depletionMonth : null,
        runout,
        runoutNote: runout?.note ?? "Verified complete profile-to-lot links and an all-location inventory are needed for this runout estimate.",
        coverageThrough,
        firstGapMonth: future.find(cell => cell.state === "gap")?.month ?? null,
        cells,
      };
    }),
  }));

  const uses = new Map();
  const originNames = new Map();
  const addUse = (coffee, label, percent) => {
    const id = key(coffee);
    const entries = uses.get(id) ?? new Map();
    const previous = entries.get(label);
    entries.set(label, previous == null || percent == null ? percent : round(previous + percent));
    uses.set(id, entries);
    originNames.set(id, coffee);
  };
  for (const label of signatureNames) {
    const recipe = (prices.highlights ?? []).find(item => key(item.name) === key(label));
    for (const component of recipe?.components ?? []) {
      const coffee = component.coffee ?? component.name;
      if (typeof coffee !== "string" || !coffee.trim() || !Number.isFinite(component.percent) || component.percent <= 0 || component.percent > 100) continue;
      addUse(coffee, label, component.percent);
    }
  }
  const decaf = [...observed.values()].filter(origin => /decaf/i.test(origin.name));
  for (const origin of decaf) addUse(origin.name, "Decaf", null);
  const origins = [...uses].map(([id, blendUses]) => {
    const origin = observed.get(id);
    return {
      name: origin?.name ?? originNames.get(id),
      kg: knownQuantity(origin?.kg), avgMonthlyKg: knownQuantity(origin?.avgMonthlyKg),
      twoMonthAverageKg: knownQuantity(origin?.twoMonthAverageKg),
      lastMonthKg: knownQuantity(origin?.lastMonthKg),
      depletionMonth: monthKey(origin?.depletionMonth) ? origin.depletionMonth : null,
      locations: (Array.isArray(origin?.locations) ? origin.locations : []).filter(location =>
        object(location) && typeof location.name === "string" && knownQuantity(location.kg) !== null)
        .map(location => ({ name: location.name, kg: location.kg })),
      usedFor: [...blendUses].map(([name, percent]) => ({ name, percent })),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en-AU"));
  const status = ["live", "partial"].includes(contracts.status) ? contracts.status : "unavailable";
  return {
    status, asOf: contracts.asOf ?? null, sourceUrl: contracts.sourceUrl ?? null,
    sourceUpdatedLabel: coverageText(contracts.sourceUpdatedLabel, 160),
    note: coverageText(contracts.note) || "The CONTRACTS planning calendar is unavailable. Unknown months are left unconfirmed.",
    years, currentYear, currentMonth,
    twoMonthAverageMonths: validDate(today) ? previousMonths(today).slice(-2) : [],
    groups, origins, runoutPools: Array.isArray(consumption.runoutPools) ? consumption.runoutPools : [],
    originNote: "Observed green use is reported once per actual Cropster coffee across all recorded locations, not allocated to blends. Recipe percentages describe use; shared Brazil also serves other coffees. Projected runout uses verified linked-lot pools and explicitly captured additional contracts without counting supplier stock twice. All recorded coffees explicitly named Decaf or Decaffeinated are shown separately; their recipe shares are not recorded and the contract plan does not allocate their use.",
  };
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
  const monthlyUse = months.map(month => {
    const coffees = new Map();
    for (const coffee of month?.rows ?? []) coffees.set(key(coffee.name), (coffees.get(key(coffee.name)) ?? 0) + coffee.kg);
    return { complete: month?.complete === true, coffees };
  });
  const stockAsOf = data.inventory?.asOf ?? null;
  const originNames = new Map([...stock].map(([id, coffee]) => [id, coffee.name]));
  for (const month of months) for (const coffee of month?.rows ?? []) {
    if (!originNames.has(key(coffee.name))) originNames.set(key(coffee.name), coffee.name);
  }
  const recordedStock = new Set((data.inventory?.rows ?? []).map(coffee => key(coffee.name)));
  const lastMonthUse = monthlyUse.at(-1);
  const origins = [...originNames].map(([id, name]) => {
    const coffee = stock.get(id);
    const total = totalIfKnown(monthlyUse.map(month => month.coffees.get(id) ?? (month.complete ? 0 : null)));
    const twoMonthTotal = totalIfKnown(monthlyUse.slice(-2).map(month => month.complete ? month.coffees.get(id) ?? 0 : null));
    const monthlyKg = total === null ? null : total / 3;
    const avgMonthlyKg = monthlyKg === null ? null : round(monthlyKg);
    const kg = recordedStock.has(id) ? round(coffee.kg) : null;
    return {
      name, kg, avgMonthlyKg,
      twoMonthAverageKg: twoMonthTotal === null ? null : round(twoMonthTotal / 2),
      lastMonthKg: lastMonthUse.coffees.get(id) ?? (lastMonthUse.complete ? 0 : null),
      depletionMonth: stockAsOf && kg !== null && monthlyKg !== null ? forecastMonth(stockAsOf, coffee.kg, monthlyKg) : null,
      locations: [...(coffee?.locations ?? [])].filter(([, kg]) => kg > 0).sort(([left], [right]) => left.localeCompare(right, "en-AU"))
        .map(([name, kg]) => ({ name, kg: round(kg) })),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en-AU"));
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
      origins,
      runoutPools: buildRunoutPools(data, today),
      decafProfileGroupId: data.recipes?.decafProfileGroupId ?? null,
      twoMonthAverageMonths: period.slice(-2),
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
  const partAsOf = Object.fromEntries(parts.map(part => {
    const record = stored.results.find(row => row.part === part);
    return [part, Number.isFinite(record?.recorded_at) ? new Date(record.recorded_at).toISOString() : null];
  }));
  const oldest = parts.every(part => partAsOf[part]) ? Math.min(...Object.values(partAsOf).map(Date.parse)) : null;
  return {
    ...report, settings,
    source: {
      status: latest === null ? "unavailable" : complete ? "recorded" : "partial",
      asOf: oldest === null ? null : new Date(oldest).toISOString(),
      latestAsOf: latest === null ? null : new Date(latest).toISOString(),
      partAsOf,
      note: latest === null ? "A verified Cropster report needs to be recorded." :
        complete ? "Latest verified Cropster reports." : "Latest verified Cropster reports. Unavailable figures are left blank.",
    },
  };
}
