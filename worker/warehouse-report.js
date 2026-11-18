import { collectWeeklyReport } from "./weekly-report.js";
import { fetchSourceJson, mapPacking, SOURCE_ORIGINS, sydneyDate } from "./metrics.js";
import { labReport, readRoasteryLab } from "./roastery-lab.js";
import { readCoffeeC } from "./coffee-c.js";
import { PURCHASE_SOURCE_URL, PURCHASE_SHEET, readPurchases } from "./purchases.js";
import { readWeeklyNote } from "./weekly-note.js";

function settled(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function labUnavailable(now) {
  return {
    ...labReport({}, sydneyDate(now)),
    settings: { releases: [], qa: "", revision: null, updatedAt: null, status: "unavailable" },
    source: { status: "unavailable", asOf: null, note: "Roastery Lab reports and notes could not be loaded. Try refreshing." },
  };
}

async function readPacking(weekStart, stockroomCookie, fetcher) {
  const source = await fetchSourceJson(`${SOURCE_ORIGINS.stockroom}/api/coffee/packing-timer?week=${weekStart}`, {
    Cookie: stockroomCookie,
    Origin: SOURCE_ORIGINS.stockroom,
  }, fetcher);
  return mapPacking(source, weekStart);
}

export async function collectWarehouse({ env = {}, stockroomCookie, now = new Date(), fetcher = fetch }) {
  // The weekly report verifies Stockroom access before any supplemental source is read.
  const weekly = await collectWeeklyReport({ env, stockroomCookie, now, fetcher });
  const weekStart = weekly.week.start;
  const [lab, coffeeC, purchases, packing, notes] = await Promise.allSettled([
    readRoasteryLab(env.DB, now),
    readCoffeeC({ now, fetcher }),
    readPurchases({ now, fetcher }),
    readPacking(weekStart, stockroomCookie, fetcher),
    readWeeklyNote(env.DB, weekStart),
  ]);

  return {
    weekly,
    lab: {
      ...settled(lab, labUnavailable(now)),
      coffeeC: settled(coffeeC, {
        status: "unavailable", price: null, currency: "USD", unit: "US¢/lb", asOf: null,
        contract: null, delayMinutes: 15, marketStatus: "unknown", change: null, changePercent: null,
        sourceUrl: "https://www.ice.com/products/15/Coffee-C-Futures/data", note: "The delayed ICE Coffee C quote could not be loaded. Try refreshing.",
      }),
      purchases: settled(purchases, {
        status: "unavailable", events: [], asOf: null, sheetName: PURCHASE_SHEET, sourceUrl: PURCHASE_SOURCE_URL,
        note: "The ORDER PLAN purchase calendar could not be loaded. Try refreshing.",
      }),
    },
    packing: settled(packing, {
      status: "unavailable", source: "stockroom", asOf: null, kgPerHour: null, kgPerDay: null,
      packedKg: null, timedCoveragePercent: null, note: "Stockroom packing performance could not be loaded for this week. Try refreshing.",
    }),
    notes: settled(notes, {
      weekStart, lines: [], revision: null, updatedAt: null, status: "unavailable",
      note: "The weekly note could not be loaded. Try refreshing.",
    }),
    generatedAt: now.toISOString(),
  };
}
