import { ReaderError } from "./errors.mjs";

export function sydneyDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day, count) {
  return new Date(new Date(day + "T12:00:00.000Z").getTime() + count * 86400000).toISOString().slice(0, 10);
}

export function currentMonday(now = new Date()) {
  const day = sydneyDate(now);
  const weekday = new Date(day + "T12:00:00.000Z").getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function weekRange(weekStart, now = new Date()) {
  if (typeof weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    || !Number.isFinite(Date.parse(weekStart + "T12:00:00.000Z"))
    || new Date(weekStart + "T12:00:00.000Z").toISOString().slice(0, 10) !== weekStart
    || weekStart !== currentMonday(now)) throw new ReaderError("INVALID_REPORTING_WEEK", 400);
  return { weekStart, periodEnd: addDays(weekStart, 4), sunday: addDays(weekStart, 6) };
}

export function dateLabel(day) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(day + "T12:00:00.000Z"));
}

export function completedMonths(now = new Date()) {
  const [year, month] = sydneyDate(now).split("-").map(Number);
  return [3, 2, 1].map(offset => {
    const from = new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 10);
    const next = new Date(Date.UTC(year, month - offset, 1)).toISOString().slice(0, 10);
    return { month: from.slice(0, 7), weekStart: from, periodEnd: addDays(next, -1) };
  });
}
