import { validDate } from "./metrics.js";

const key = value => value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const quantity = value => Number.isFinite(value) && value >= 0 && value <= 100_000_000;
const named = value => typeof value === "string" && value.trim() && value.length <= 160;
const round = value => value === null ? null : Math.round(value * 100) / 100;
const periodFor = today => [3, 2, 1].map(offset => new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - offset, 1)).toISOString().slice(0, 7));

function finishMonth(asOf, kg, use) {
  if (!validDate(asOf) || kg === null || use === null || use <= 0) return null;
  if (kg === 0) return asOf.slice(0, 7);
  const start = new Date(asOf + "T00:00:00Z");
  const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = Math.max(0, Math.ceil(start.getUTCDate() / days + kg / use - 1e-9) - 1);
  const finish = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
  return Number.isFinite(finish.getTime()) && finish.getUTCFullYear() < 10_000 ? finish.toISOString().slice(0, 7) : null;
}

/** One global ledger and connected profile pools. No names are used to infer
 * profile membership; exact unique names only identify historical lot rows. */
export function buildRunoutPools(data = {}, today) {
  if (!validDate(today)) return [];
  const recipe = data.recipes ?? {}, stock = data.inventory ?? {};
  const profiles = new Map();
  for (const row of Array.isArray(recipe.runoutProfiles) ? recipe.runoutProfiles : []) {
    if (!id(row?.id) || !named(row.name)) continue;
    const lotIds = Array.isArray(row.lotIds) ? row.lotIds.filter(id) : [];
    const complete = row.linksComplete === true && Array.isArray(row.lotIds) && lotIds.length === row.lotIds.length && new Set(lotIds).size === lotIds.length;
    if (profiles.has(row.id)) {
      const previous = profiles.get(row.id);
      previous.lotIds = [...new Set([...previous.lotIds, ...lotIds])]; previous.complete = false;
    } else profiles.set(row.id, { id: row.id, name: row.name, lotIds: [...new Set(lotIds)], complete,
      note: typeof row.note === "string" ? row.note.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1_000) : "" });
  }
  const parents = new Map([...profiles.keys()].map(value => [value, value]));
  const root = value => { let cursor = value; while (parents.get(cursor) !== cursor) cursor = parents.get(cursor); return cursor; };
  const owner = new Map();
  for (const profile of profiles.values()) for (const lotId of profile.lotIds) {
    if (owner.has(lotId)) parents.set(root(profile.id), root(owner.get(lotId)));
    else owner.set(lotId, profile.id);
  }
  const groups = new Map();
  for (const profile of profiles.values()) { const group = root(profile.id); groups.set(group, [...(groups.get(group) ?? []), profile]); }

  const aliases = new Map(), names = new Map(), ledger = new Map();
  const addName = (lotId, name) => {
    if (!id(lotId) || !named(name)) return;
    const normalized = key(name), matches = aliases.get(normalized) ?? new Set();
    matches.add(lotId); aliases.set(normalized, matches);
    if (!names.has(lotId)) names.set(lotId, name);
  };
  let validInventory = Array.isArray(stock.rows) && stock.allLocationsComplete === true && validDate(stock.asOf) && stock.asOf <= today;
  for (const row of Array.isArray(stock.rows) ? stock.rows : []) {
    addName(row?.lotId, row?.name);
    if (!id(row?.lotId) || !named(row.location) || !quantity(row.kg)) { validInventory = false; continue; }
    const positions = ledger.get(row.lotId) ?? new Map(), location = key(row.location), previous = positions.get(location);
    if (previous && previous.kg !== row.kg) validInventory = false;
    else if (!previous) positions.set(location, { name: row.location, kg: row.kg });
    ledger.set(row.lotId, positions);
  }
  for (const row of Array.isArray(recipe.runoutLotNames) ? recipe.runoutLotNames : []) addName(row?.lotId, row?.name);

  const contracts = new Map(), invalidContracts = new Set();
  let unknownContracts = stock.contracts !== undefined && !Array.isArray(stock.contracts);
  for (const row of Array.isArray(stock.contracts) ? stock.contracts : []) {
    if (!id(row?.id) || !id(row.lotId)) { unknownContracts = true; continue; }
    const previous = contracts.get(row.id);
    if (previous) {
      if (previous.lotId !== row.lotId || previous.remainingKg !== row.remainingKg || previous.includedInventoryKg !== row.includedInventoryKg || previous.availableFrom !== row.availableFrom) {
        invalidContracts.add(previous.lotId); invalidContracts.add(row.lotId);
      }
      continue;
    }
    contracts.set(row.id, row);
    if (!quantity(row.remainingKg) || !quantity(row.includedInventoryKg) || row.includedInventoryKg > row.remainingKg
      || row.availableFrom != null && !validDate(row.availableFrom)) invalidContracts.add(row.lotId);
  }
  const extra = new Map(), included = new Map(), arrivalUnverified = new Set();
  for (const row of contracts.values()) {
    if (invalidContracts.has(row.lotId)) continue;
    extra.set(row.lotId, (extra.get(row.lotId) ?? 0) + row.remainingKg - row.includedInventoryKg);
    included.set(row.lotId, (included.get(row.lotId) ?? 0) + row.includedInventoryKg);
    if (row.remainingKg > row.includedInventoryKg && (!row.availableFrom || row.availableFrom > stock.asOf)) arrivalUnverified.add(row.lotId);
  }
  const inventoryFor = lotId => [...(ledger.get(lotId)?.values() ?? [])].reduce((sum, row) => sum + row.kg, 0);
  if (validInventory) for (const [lotId, amount] of included) if (amount > inventoryFor(lotId) + 0.000001) invalidContracts.add(lotId);

  const period = periodFor(today), byMonth = new Map(), duplicateMonths = new Set();
  for (const month of Array.isArray(data.use?.months) ? data.use.months : []) {
    if (byMonth.has(month?.month)) duplicateMonths.add(month.month);
    byMonth.set(month?.month, month);
  }
  const monthly = period.map(month => {
    const source = byMonth.get(month), quantities = new Map(), invalidIds = new Set(), ambiguous = [];
    let unknown = !source || source.complete !== true || !Array.isArray(source.rows) || duplicateMonths.has(month);
    for (const row of Array.isArray(source?.rows) ? source.rows : []) {
      if (!quantity(row?.kg)) { unknown = true; continue; }
      let lotId = row.lotId;
      if (lotId != null) {
        if (!id(lotId)) { unknown = true; continue; }
      } else {
        const candidates = named(row.name) ? aliases.get(key(row.name)) : null;
        if (!candidates?.size) { unknown = true; continue; }
        if (candidates.size > 1) { ambiguous.push(candidates); continue; }
        lotId = [...candidates][0];
      }
      if (quantities.has(lotId)) invalidIds.add(lotId);
      else quantities.set(lotId, row.kg);
    }
    return { unknown, quantities, invalidIds, ambiguous };
  });

  return [...groups.values()].map(group => {
    const profileGroupIds = group.map(profile => profile.id).sort();
    const lotIds = [...new Set(group.flatMap(profile => profile.lotIds))].sort();
    const partialOverlap = new Set(group.map(profile => [...profile.lotIds].sort().join("\0"))).size > 1;
    const completeLinks = group.every(profile => profile.complete) && lotIds.length > 0;
    const completeContracts = !unknownContracts && lotIds.every(lotId => !invalidContracts.has(lotId));
    const inventoryKg = completeLinks && validInventory ? lotIds.reduce((sum, lotId) => sum + inventoryFor(lotId), 0) : null;
    const additionalContractKg = completeLinks && completeContracts ? lotIds.reduce((sum, lotId) => sum + (extra.get(lotId) ?? 0), 0) : null;
    const totalKg = inventoryKg === null || additionalContractKg === null ? null : inventoryKg + additionalContractKg;
    const use = monthly.map(month => completeLinks && !month.unknown && lotIds.every(lotId => !month.invalidIds.has(lotId))
      && month.ambiguous.every(candidates => lotIds.every(lotId => !candidates.has(lotId)))
      ? lotIds.reduce((sum, lotId) => sum + (month.quantities.get(lotId) ?? 0), 0) : null);
    const average = values => values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const avgMonthlyKg = average(use), twoMonthAverageKg = average(use.slice(-2));
    const availabilityUnknown = lotIds.some(lotId => arrivalUnverified.has(lotId));
    const locations = new Map();
    const lotRows = lotIds.map(lotId => {
      const positions = [...(ledger.get(lotId)?.values() ?? [])].sort((left, right) => left.name.localeCompare(right.name, "en-AU"));
      for (const position of positions) {
        const identity = key(position.name), previous = locations.get(identity);
        locations.set(identity, { name: previous?.name ?? position.name, kg: (previous?.kg ?? 0) + position.kg });
      }
      return {
        lotId, name: names.get(lotId) ?? lotId,
        kg: completeLinks && validInventory && completeContracts ? round(inventoryFor(lotId) + (extra.get(lotId) ?? 0)) : null,
        locations: positions.map(position => ({ ...position, kg: round(position.kg) })),
      };
    });
    const usedFor = new Set();
    for (const row of recipe.rows ?? []) if ((row.components ?? []).some(component => profileGroupIds.includes(component.profileGroupId))) usedFor.add(row.signature ?? row.name);
    if (profileGroupIds.includes(recipe.decafProfileGroupId)) usedFor.add("Decaf");
    const notes = ["Quantity coverage estimate from every recorded warehouse and supplier balance for the explicitly related lots. Shared lots and their consumption across all products are counted once."];
    for (const profile of group) if (profile.note) notes.push(`${profile.name}: ${profile.note}`);
    if (partialOverlap) notes.push("The related profile groups have partially overlapping eligible lots; individual coverage cannot be determined from pooled quantity.");
    if (!completeLinks) notes.push("All profile-to-lot links must be verified before projecting runout.");
    if (!validInventory) notes.push("A complete all-location inventory with unambiguous lot IDs is needed.");
    if (!completeContracts) notes.push("Additional contract quantities or their overlap with recorded stock are unknown.");
    if (avgMonthlyKg === null) notes.push("Three complete months with unambiguous consumption lot identities are needed.");
    else if (avgMonthlyKg === 0) notes.push("No related green use was recorded in the three-month window, so no runout month is projected.");
    if (availabilityUnknown) notes.push("This is a quantity coverage estimate. Additional contract arrival timing is unverified or future; timely delivery is not guaranteed.");
    else notes.push("Assumes steady use; arrival timing and substitutions are not modeled. Contract calendar colours do not add kilograms.");
    return {
      poolId: "pool:" + profileGroupIds[0], profileGroupIds, profileNames: group.sort((left, right) => left.id.localeCompare(right.id)).map(profile => profile.name), usedFor: [...usedFor].sort(),
      status: completeLinks && validInventory && completeContracts && avgMonthlyKg !== null && !availabilityUnknown && !partialOverlap ? "recorded" : "partial",
      totalKg: round(totalKg), inventoryKg: round(inventoryKg), additionalContractKg: round(additionalContractKg),
      avgMonthlyKg: round(avgMonthlyKg), twoMonthAverageKg: round(twoMonthAverageKg), lotCount: lotIds.length, lotRows,
      locations: [...locations.values()].sort((left, right) => left.name.localeCompare(right.name, "en-AU")).map(position => ({ ...position, kg: round(position.kg) })),
      depletionMonth: partialOverlap ? null : finishMonth(stock.asOf, totalKg, avgMonthlyKg), note: notes.join(" "), asOf: validDate(stock.asOf) ? stock.asOf : null,
    };
  }).sort((left, right) => left.poolId.localeCompare(right.poolId));
}
