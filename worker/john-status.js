const sourceNote = "Playful game estimates for virtual John using this week’s recorded work. Workload uses the largest comparable volume change. Energy and Emotion use available production and Dispatch progress equally. Empty verified queues count as clear. These scores do not measure a person.";
const labels = {
  energy: ["Recharging", "Low battery", "Steady", "Bright", "Full beans"],
  workload: ["Light", "Easy", "Steady", "Busy", "Big week"],
  emotion: ["Warming up", "Finding rhythm", "Chipper", "Cheerful", "Delighted"],
};
const format = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const amount = value => Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
const count = value => Number.isSafeInteger(value) && amount(value) !== null ? value : null;
const readable = metric => metric && typeof metric === "object" && metric.status !== "unavailable";
const clampScore = score => Math.min(5, Math.max(1, Math.round(score)));
const changePercent = (current, previous) => Math.round((current - previous) / previous * 1000) / 10;

function stat(name, score, reason) {
  return { score, label: score === null ? "Unknown" : labels[name][score - 1], reason };
}

function sourceWarning(metric, name) {
  if (metric?.stale === true || metric?.status === "stale") return `${name} reading is stale.`;
  if (metric?.status === "partial") return `${name} has partial source coverage.`;
  return "";
}

function productionPlan(metric, previous = false) {
  if (!readable(metric)) return null;
  const roasted = amount(metric[previous ? "previousRoastedKg" : "roastedKg"]);
  const scheduled = amount(metric[previous ? "previousScheduledKg" : "scheduledKg"]);
  if (roasted === null || scheduled === null) return null;
  const total = roasted + scheduled;
  const published = metric[previous ? "previousKg" : "totalKg"];
  if (published !== undefined && published !== null && (amount(published) === null || Math.abs(published - total) > 0.01)) return null;
  return { roasted, scheduled, total };
}

function wholesalePlan(metric) {
  if (!readable(metric)) return null;
  const provisional = metric.provisional === true;
  const done = count(metric.done);
  const pending = count(provisional ? metric.scheduledPendingOrders : metric.pending);
  const total = count(provisional ? metric.scheduledOrders : metric.orders);
  if (done === null || pending === null || total === null || done + pending !== total) return null;
  return { done, pending, total, provisional };
}

function workloadBand(change) {
  if (change <= -25) return 1;
  if (change <= -10) return 2;
  if (change < 10) return 3;
  if (change < 25) return 4;
  return 5;
}

export function deriveJohnStatus(weekly) {
  const candidateWeek = weekly?.week?.start;
  const parsedWeek = typeof candidateWeek === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidateWeek) ? new Date(candidateWeek + "T00:00:00Z") : null;
  const weekStart = parsedWeek && Number.isFinite(parsedWeek.getTime()) && parsedWeek.toISOString().slice(0, 10) === candidateWeek && parsedWeek.getUTCDay() === 1 ? candidateWeek : null;
  if (!weekStart || weekly?.week?.isCurrent !== true || !weekly?.metrics) {
    const reason = "A current-week report is needed for this game estimate.";
    return {
      energy: stat("energy", null, reason), workload: stat("workload", null, reason), emotion: stat("emotion", null, reason),
      summary: "John is waiting for the current week’s data.", sourceNote, weekStart,
    };
  }

  const { demand, production, wholesale } = weekly.metrics;
  const currentPlan = productionPlan(production);
  const previousPlan = productionPlan(production, true);
  const dispatch = wholesalePlan(wholesale);
  const comparisons = [], comparisonGaps = [];
  const currentDemand = readable(demand) ? amount(demand.kg) : null;
  const previousDemand = readable(demand) ? amount(demand.previousKg) : null;
  if (currentDemand !== null && previousDemand > 0) {
    comparisons.push({ name: "Demand", current: currentDemand, previous: previousDemand, change: changePercent(currentDemand, previousDemand), warning: sourceWarning(demand, "Demand") });
  } else comparisonGaps.push("Demand comparison needs current kilograms and a positive last-week baseline.");
  if (currentPlan && previousPlan?.total > 0) {
    comparisons.push({ name: "Production plan", current: currentPlan.total, previous: previousPlan.total, change: changePercent(currentPlan.total, previousPlan.total), warning: sourceWarning(production, "Cropster") });
  } else comparisonGaps.push("Production comparison needs roasted and outstanding scheduled kilograms for both weeks, with a positive last-week total.");

  const highest = comparisons.reduce((best, item) => !best || item.change > best.change ? item : best, null);
  const workloadScore = highest ? workloadBand(highest.change) : null;
  const workloadReason = highest
    ? `${highest.name}: ${format.format(highest.current)} kg versus ${format.format(highest.previous)} kg last week (${highest.change >= 0 ? "+" : ""}${format.format(highest.change)}%). The largest of ${comparisons.length} available volume comparisons sets this game band. ${[...comparisons.map(item => item.warning), ...comparisonGaps].filter(Boolean).join(" ")}`.trim()
    : comparisonGaps.join(" ");

  const progress = [], progressNotes = [], progressGaps = [];
  if (currentPlan) {
    progress.push(currentPlan.total === 0 ? 1 : currentPlan.roasted / currentPlan.total);
    progressNotes.push(currentPlan.total === 0 ? "Cropster records zero roasted kilograms and zero outstanding scheduled kilograms."
      : `Cropster: ${format.format(currentPlan.roasted)} of ${format.format(currentPlan.total)} kg roasted; ${format.format(currentPlan.scheduled)} kg remains scheduled.`);
    const warning = sourceWarning(production, "Cropster");
    if (warning) progressNotes.push(warning);
  } else progressGaps.push("Cropster progress is unknown without both roasted and outstanding scheduled kilograms.");
  if (dispatch) {
    progress.push(dispatch.total === 0 ? 1 : dispatch.done / dispatch.total);
    const prefix = dispatch.provisional ? "Dispatch’s unconfirmed saved schedule" : "Dispatch";
    progressNotes.push(dispatch.total === 0 ? `${prefix} has no primary orders recorded.`
      : `${prefix}: ${dispatch.done} of ${dispatch.total} primary orders done; ${dispatch.pending} pending.`);
    const warning = sourceWarning(wholesale, "Dispatch");
    if (warning) progressNotes.push(warning);
  } else progressGaps.push("Dispatch progress is unknown without a matching primary-order total, done and pending count.");

  const meanProgress = progress.length ? progress.reduce((sum, value) => sum + value, 0) / progress.length : null;
  const coverage = [...progressNotes, ...progressGaps].join(" ");
  const emotionScore = meanProgress === null ? null : clampScore(1 + 4 * meanProgress);
  const pressure = workloadScore === null ? null : 1 + Math.max(workloadScore - 3, 0) / 4;
  const energyScore = meanProgress === null || pressure === null ? null : clampScore(5 - 4 * (1 - meanProgress) * pressure);
  const emotionReason = meanProgress === null ? coverage
    : `${format.format(meanProgress * 100)}% average progress across ${progress.length} available workstreams sets this game score. ${coverage}`;
  const energyReason = energyScore === null
    ? `${meanProgress === null ? "Work progress is unavailable. " : "A comparable weekly workload is unavailable. "}${coverage}`
    : `${format.format(meanProgress * 100)}% average plan progress, adjusted for workload ${workloadScore}/5. Heavier volume lowers game energy while work remains. ${coverage}`;
  const known = [energyScore, workloadScore, emotionScore].filter(score => score !== null).length;
  return {
    energy: stat("energy", energyScore, energyReason),
    workload: stat("workload", workloadScore, workloadReason),
    emotion: stat("emotion", emotionScore, emotionReason),
    summary: known === 0 ? "John is waiting for enough weekly data."
      : `${known} of 3 game estimates available.${known < 3 || comparisonGaps.length || progressGaps.length ? " Some source coverage is missing." : ""}`,
    sourceNote, weekStart,
  };
}
