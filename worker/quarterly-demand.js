// These pure functions also run in Roastery Lab's browser script.
export const maxDemandIncrease = 1000;

export function quarterlyIncrease(month, increases) {
  const quarter = Math.ceil(Number(month.slice(5, 7)) / 3);
  const value = increases[month.slice(0, 4) + '-Q' + quarter];
  return Number.isFinite(value) && value > 0 && value <= maxDemandIncrease ? value : 0;
}

export function adjustedRunoutMonth(pool, currentMonth, increases) {
  const baseline = pool?.depletionMonth;
  if (!baseline) return null;
  if (typeof pool.asOf !== "string" || typeof currentMonth !== "string") return baseline;
  const monthIndex = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const start = monthIndex(pool.asOf);
  const first = monthIndex(currentMonth);
  const last = monthIndex(baseline);
  const use = pool.projectionInputs?.monthlyKg ?? pool.avgMonthlyKg;
  const quantity = pool.projectionInputs?.quantityKg ?? pool.totalKg;
  if (!(use > 0 && quantity > 0) || ![start, first, last].every(Number.isFinite) || first > last) return baseline;

  // Express stock as months of baseline use. The first month's use is prorated
  // from the inventory date, exactly as in the unadjusted stock estimate.
  const year = Math.floor(start / 12);
  const month = start % 12;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let cursor = start + Number(pool.asOf.slice(8, 10)) / days;
  let remaining = quantity / use;
  const finish = position => {
    const at = Math.max(start, Math.ceil(position - 1e-9) - 1);
    return Math.floor(at / 12) + '-' + String(at % 12 + 1).padStart(2, '0');
  };
  const relevant = Object.keys(increases).filter(key => /^\d{4}-Q[1-4]$/.test(key)).sort();
  let usedOverride = false;
  for (const key of relevant) {
    const from = Number(key.slice(0, 4)) * 12 + (Number(key.at(-1)) - 1) * 3;
    const to = from + 3;
    const applicable = Math.max(cursor, first, from);
    if (applicable >= to || applicable > last + 1) continue;
    const increase = increases[key];
    if (!(Number.isFinite(increase) && increase > 0 && increase <= maxDemandIncrease)) continue;
    const baselineSpan = applicable - cursor;
    if (remaining <= baselineSpan) return usedOverride ? finish(cursor + remaining) : baseline;
    remaining -= baselineSpan;
    const factor = 1 + increase / 100;
    if (remaining <= (to - applicable) * factor) return finish(applicable + remaining / factor);
    remaining -= (to - applicable) * factor;
    cursor = to;
    usedOverride = true;
  }
  return usedOverride ? finish(cursor + remaining) : baseline;
}
