import { ReaderError } from "./errors.mjs";
import { addDays, completedMonths, sydneyDate, weekRange } from "./dates.mjs";
import { captureDocument } from "./dom.mjs";
import {
  CROPSTER_ORIGIN, aggregateSchedule, parseInventory, inventoryPrices, parseMarrickvilleStock,
  parseRoastedCost, parseRoastedOutput, parseScheduleDay, sameProduction, parseMonthlyUse, parseLoss,
  parseBlend, parseProfileGroup, parseProfileInputs, assembleRecipes, blendLoss, sameSchedules, previousProduction,
} from "./parse.mjs";

const PAGE_LIMIT = 2;
const SOURCE_TIMEOUT = 14000;

function paths(range) {
  const query = new URLSearchParams({ dateFrom: range.weekStart, dateTo: range.periodEnd, locations: "lK0G1" });
  return {
    production: `/apps/roast/production-report/profile-group?${query}`,
    cost: `/apps/roast/production-report/inventory?${query}`,
    schedule: Array.from({ length: 5 }, (_, index) => `/apps/roast/schedule/calendar/day?date=${addDays(range.weekStart, index)}`),
    prices: "/app/inventory/overview",
    green: "/apps/lots/inventory-report/location",
  };
}

function createLimit(maximum) {
  let active = 0;
  const waiting = [];
  return async run => {
    if (active >= maximum) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await run(); }
    finally { active--; waiting.shift()?.(); }
  };
}

async function allRequired(tasks) {
  const results = await Promise.allSettled(tasks);
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
  return results.map(result => result.value);
}

// This is the deployed application's browser runtime. Only fixed website views
// and the login form are used. There is no exposed browser-control endpoint.
export function createBrowserReader(configuration, { now = () => new Date(), launch } = {}) {
  let browser = null, context = null, closed = false;
  const launchBrowser = launch || (async options => (await import("playwright")).chromium.launch(options));

  async function reset() {
    const old = browser;
    context = null;
    browser = null;
    if (old) await old.close().catch(() => {});
  }

  async function getContext() {
    if (closed) throw new ReaderError("CROPSTER_UNAVAILABLE");
    if (!browser?.isConnected()) {
      browser = await launchBrowser({
        headless: true,
        chromiumSandbox: configuration.chromiumSandbox,
        args: ["--disable-dev-shm-usage"],
      });
      context = await browser.newContext({
        locale: "en-US", timezoneId: "Australia/Sydney", acceptDownloads: false,
        serviceWorkers: "block", viewport: { width: 1440, height: 1000 },
      });
      await context.route("**/*", route => {
        const request = route.request();
        if (["image", "font", "media"].includes(request.resourceType())) return route.abort();
        // Main documents cannot navigate to arbitrary hosts. The application's
        // own ordinary network requests remain managed by the Cropster website.
        if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
          try { if (new URL(request.url()).origin !== CROPSTER_ORIGIN) return route.abort(); }
          catch { return route.abort(); }
        }
        return route.continue();
      });
    }
    return context;
  }

  async function signIn(page, firstUrl, timeout) {
    await page.goto(firstUrl, { waitUntil: "domcontentloaded", timeout });
    await page.waitForFunction(() => Boolean(document.querySelector('input[type="password"]'))
      || /Production report/.test(document.body?.innerText || ""), null, { timeout });
    if (!await page.locator('input[type="password"]').isVisible().catch(() => false)) return;
    if (await page.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').count()) throw new ReaderError("CROPSTER_AUTH_REQUIRED");
    const candidates = [
      page.getByRole("textbox", { name: "E-mail", exact: true }),
      page.getByLabel("E-mail", { exact: true }),
      page.locator('input[type="email"]'),
      page.locator('input[autocomplete="username"]'),
      page.locator('input[name="email"]'),
      page.locator('input[type="text"]'),
    ];
    let email;
    for (const candidate of candidates) {
      if (await candidate.count() === 1 && await candidate.isVisible()) { email = candidate; break; }
    }
    if (!email) throw new ReaderError("CROPSTER_AUTH_REQUIRED");
    await email.fill(configuration.email, { timeout });
    await page.locator('input[type="password"]').fill(configuration.password, { timeout });
    await page.getByRole("button", { name: "Login", exact: true }).click({ timeout });
    try {
      await page.waitForURL(url => url.origin === CROPSTER_ORIGIN && url.pathname !== "/app/login", { timeout });
    } catch { throw new ReaderError("CROPSTER_AUTH_REQUIRED"); }
  }

  async function read(weekStart, { scope = "weekly" } = {}) {
    if (!["weekly", "all"].includes(scope)) throw new ReaderError("INVALID_REQUEST", 400);
    const startedAt = now();
    const range = weekRange(weekStart, startedAt);
    const sourcePaths = paths(range);
    const deadline = startedAt.getTime() + configuration.timeoutMs;
    const limit = createLimit(PAGE_LIMIT);
    const jobPages = new Set();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      for (const page of jobPages) void page.close().catch(() => {});
    }, configuration.timeoutMs);
    const remaining = () => {
      const left = deadline - now().getTime();
      if (closed) throw new ReaderError("CROPSTER_UNAVAILABLE");
      if (timedOut || left <= 0) throw new ReaderError("CROPSTER_TIMEOUT", 504);
      return Math.min(left, SOURCE_TIMEOUT);
    };
    const newPage = async () => {
      remaining();
      const page = await (await getContext()).newPage();
      page.setDefaultTimeout(remaining());
      page.setDefaultNavigationTimeout(remaining());
      page.on("popup", popup => void popup.close().catch(() => {}));
      page.on("dialog", dialog => void dialog.dismiss().catch(() => {}));
      jobPages.add(page);
      return page;
    };
    const closePage = async page => {
      jobPages.delete(page);
      await page.close().catch(() => {});
    };
    const waitForView = async (page, kind) => {
      await page.waitForFunction(kind => {
        const body = document.body?.innerText || "";
        if (document.querySelector('input[type="password"]')) return true;
        const headings = Array.from(document.querySelectorAll("table thead")).map(item => item.innerText).join(" ");
        if (kind === "blend") return /Blend components/.test(body) && /% of blend/.test(headings) && Boolean(document.querySelector('table tbody a[href*="/profile-groups/"]'));
        if (kind === "group") return /Associated profiles/.test(body) && /Green inventory/.test(body) && Boolean(document.querySelector('a[href*="/apps/roast/profiles/"]'));
        if (kind === "profile") return /Components\s*\/\s*Green lots/i.test(body) && /Blend %/.test(headings) && /Green weight/.test(headings) && Boolean(document.querySelector('table tbody a[href*="/lots/"]'));
        if (kind === "prices") return /ID-Tag/.test(headings) && /Price/.test(headings) && /\d+\s*-\s*\d+\s+of\s+\d+\s+items/.test(body);
        if (kind === "stock") return /Values refer to inventory on/.test(body) && /Location/.test(headings) && /Total value/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
        if (kind === "schedule") return /Scheduled coffees/.test(body) && /Summary per green lot/.test(body) && /To roast/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
        return /Production report/.test(body) && /Amount of green/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
      }, kind, { timeout: remaining() });
      if (new URL(page.url()).pathname === "/app/login") throw new ReaderError("CROPSTER_AUTH_REQUIRED");
    };
    const expandLegacy = async page => {
      const buttons = page.getByRole("button", { name: "100", exact: true });
      const count = await buttons.count();
      for (let index = 0; index < count && index < 5; index++) {
        await buttons.nth(index).click({ timeout: remaining() });
      }
    };
    const snapshotUntilParsed = async (page, parse) => {
      let error;
      for (let attempt = 0; attempt < 8; attempt++) {
        remaining();
        try { return parse(await page.evaluate(captureDocument)); }
        catch (failure) {
          error = failure;
          if (!(failure instanceof ReaderError) || failure.code === "CROPSTER_CHANGED_DURING_READ") throw failure;
          // A table can briefly retain its old rows while its page label changes.
          await page.waitForTimeout(Math.min(150, remaining()));
        }
      }
      throw error;
    };
    const view = (path, kind, parse) => limit(async () => {
      const page = await newPage();
      try {
        await page.goto(CROPSTER_ORIGIN + path, { waitUntil: "domcontentloaded", timeout: remaining() });
        await waitForView(page, kind);
        if (kind === "schedule") for (const status of ["unpublished", "scheduled", "synced", "roasted", "inconsistent"]) {
          const checkbox = page.locator('input[type="checkbox"][id$="-status-' + status + '"]');
          if (await checkbox.count() !== 1) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
          await checkbox.check({ timeout: remaining() });
        }
        if (["production", "stock", "schedule"].includes(kind)) await expandLegacy(page);
        return await snapshotUntilParsed(page, parse);
      } finally { await closePage(page); }
    });
    const inventory = () => limit(async () => {
      const page = await newPage();
      try {
        await page.goto(CROPSTER_ORIGIN + sourcePaths.prices, { waitUntil: "domcontentloaded", timeout: remaining() });
        await waitForView(page, "prices");
        const snapshots = [];
        let previousFirst = null;
        for (let pageNumber = 1; pageNumber <= 20; pageNumber++) {
          if (pageNumber > 1) {
            await page.getByRole("button", { name: String(pageNumber), exact: true }).click({ timeout: remaining() });
            await page.waitForFunction(previous => {
              const rows = Array.from(document.querySelectorAll("table tbody tr")).filter(row => /\[PG-\d+\]/.test(row.innerText));
              return Boolean(rows[0]) && rows[0].innerText !== previous;
            }, previousFirst, { timeout: remaining() });
          }
          const snapshot = await page.evaluate(captureDocument);
          snapshots.push(snapshot);
          const coverage = snapshot.text.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+items/i);
          if (!coverage) throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
          if (Number(coverage[2]) >= Number(coverage[3])) return parseInventory(snapshots, sydneyDate(now()));
          previousFirst = await page.locator("table tbody tr").filter({ hasText: /\[PG-\d+\]/ }).first().innerText();
        }
        throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
      } finally { await closePage(page); }
    });

    try {
      const login = await newPage();
      try { await signIn(login, CROPSTER_ORIGIN + sourcePaths.production, remaining()); }
      finally { await closePage(login); }
      const lab = {}, labObservedAt = {}, labWarnings = [], labSources = [];
      let rawLoss = null, recipeCapture = null, freshDefinitions = null, previous = null, previousProductionObservedAt = null;
      const previousSources = [];
      const optionalLab = async (run, warning) => {
        try { return await run(); }
        catch (error) {
          if (error instanceof ReaderError && ["CROPSTER_AUTH_REQUIRED", "CROPSTER_TIMEOUT"].includes(error.code)) throw error;
          labWarnings.push(warning);
          return null;
        }
      };
      if (scope === "all") {
        const months = completedMonths(startedAt);
        const period = { weekStart: months[0].weekStart, periodEnd: months.at(-1).periodEnd };
        const allLocationPath = (kind, period) => {
          const query = new URLSearchParams({ dateFrom: period.weekStart, dateTo: period.periodEnd });
          const path = `/apps/roast/production-report/${kind}?${query}`;
          labSources.push(CROPSTER_ORIGIN + path);
          return path;
        };
        const readRecipes = async () => {
          const ids = configuration.profileIds || {};
          if (![ids.libertyBlend, ids.rhythmBlend, ids.ohGroup, ids.decafGroup].every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id))) throw new ReaderError("CROPSTER_RECIPE_UNCONFIGURED");
          const blends = await allRequired([[ids.libertyBlend, "Liberty"], [ids.rhythmBlend, "Rhythm"]].map(([id, signature]) => {
            const path = "/app/roast/blend-profiles/" + id;
            labSources.push(CROPSTER_ORIGIN + path);
            return view(path, "blend", snapshot => parseBlend(snapshot, id, signature));
          }));
          freshDefinitions = { rows: blends };
          const groupIds = [...new Set([...blends.flatMap(blend => blend.components.map(component => component.profileGroupId)), ids.ohGroup, ids.decafGroup])];
          const groups = await allRequired(groupIds.map(id => {
            const path = "/app/roast/profile-groups/" + id;
            labSources.push(CROPSTER_ORIGIN + path);
            return view(path, "group", snapshot => parseProfileGroup(snapshot, id));
          }));
          const profileUrls = [...new Set(groups.flatMap(group => group.profileUrls))];
          if (profileUrls.length > 80) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
          const profileInputs = new Map(await allRequired(profileUrls.map(async url => {
            labSources.push(url);
            const input = await view(new URL(url).pathname, "profile", parseProfileInputs);
            return [url, input];
          })));
          return { blends, groups, profileInputs, decafGroupId: ids.decafGroup, ohGroupId: ids.ohGroup };
        };
        await allRequired([
          optionalLab(async () => {
            const previousRange = { weekStart: addDays(range.weekStart, -7), periodEnd: addDays(range.weekStart, -3) };
            const query = new URLSearchParams({ dateFrom: previousRange.weekStart, dateTo: previousRange.periodEnd, locations: "lK0G1" });
            const outputPath = `/apps/roast/production-report/profile-group?${query}`;
            const costPath = `/apps/roast/production-report/inventory?${query}`;
            previousSources.push(CROPSTER_ORIGIN + outputPath, CROPSTER_ORIGIN + costPath);
            const outputCapture = await view(outputPath, "production", snapshot => ({ snapshot, output: parseRoastedOutput(snapshot, previousRange) }));
            const costSnapshot = await view(costPath, "production", snapshot => {
              parseRoastedCost(snapshot, previousRange, outputCapture.output.greenKg);
              return snapshot;
            });
            previous = previousProduction(outputCapture.snapshot, costSnapshot, previousRange);
            previousProductionObservedAt = now().toISOString();
          }, "PREVIOUS_PRODUCTION_UNAVAILABLE"),
          optionalLab(async () => {
            const captured = await allRequired(months.map(month => view(allLocationPath("inventory", month), "production", snapshot => parseMonthlyUse(snapshot, month))));
            lab.use = { months: captured };
            labObservedAt.use = now().toISOString();
          }, "LAB_USE_UNAVAILABLE"),
          optionalLab(async () => {
            rawLoss = await view(allLocationPath("profile-group", period), "production", snapshot => parseLoss(snapshot, period));
            labObservedAt.loss = now().toISOString();
          }, "LAB_LOSS_UNAVAILABLE"),
          optionalLab(async () => {
            recipeCapture = await readRecipes();
            labObservedAt.recipes = now().toISOString();
          }, "LAB_RECIPES_UNAVAILABLE"),
        ]);
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const before = await view(sourcePaths.production, "production", snapshot => parseRoastedOutput(snapshot, range));
          const warnings = [...labWarnings];
          let greenObservedAt = null, mondayObservedAt = null, inventoryObservedAt = null;
          const optional = async (run, warning) => {
            try { return await run(); }
            catch (error) {
              if (error instanceof ReaderError && ["CROPSTER_CHANGED_DURING_READ", "CROPSTER_AUTH_REQUIRED", "CROPSTER_TIMEOUT"].includes(error.code)) throw error;
              warnings.push(warning);
              return null;
            }
          };
          const mondayRange = { ...range, periodEnd: range.weekStart };
          const mondayQuery = new URLSearchParams({ dateFrom: weekStart, dateTo: weekStart, locations: "lK0G1" });
          const mondayPath = `/apps/roast/production-report/profile-group?${mondayQuery}`;
          const [days, roastedValue, inventoryRecord, green, monday] = await allRequired([
            allRequired(sourcePaths.schedule.map((path, index) => view(path, "schedule", snapshot => parseScheduleDay(snapshot, addDays(range.weekStart, index), range)))),
            optional(() => view(sourcePaths.cost, "production", snapshot => parseRoastedCost(snapshot, range, before.greenKg)), "ROASTED_COST_UNAVAILABLE"),
            optional(async () => { const record = await inventory(); inventoryObservedAt = now().toISOString(); return record; }, "INVENTORY_UNAVAILABLE"),
            optional(async () => { const record = await view(sourcePaths.green, "stock", snapshot => parseMarrickvilleStock(snapshot, sydneyDate(now()))); greenObservedAt = now().toISOString(); return record; }, "GREEN_STOCK_UNAVAILABLE"),
            optional(async () => { const record = await view(mondayPath, "production", snapshot => parseRoastedOutput(snapshot, mondayRange)); mondayObservedAt = now().toISOString(); return record; }, "MONDAY_ROASTED_UNAVAILABLE"),
          ]);
          const verifiedDays = await allRequired(sourcePaths.schedule.map((path, index) => view(path, "schedule", snapshot => parseScheduleDay(snapshot, addDays(range.weekStart, index), range))));
          if (!sameSchedules(days, verifiedDays)) throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
          const after = await view(sourcePaths.production, "production", snapshot => parseRoastedOutput(snapshot, range));
          if (!sameProduction(before, after)) throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
          weekRange(weekStart, now());
          const scheduled = aggregateSchedule(days, inventoryRecord ? inventoryPrices(inventoryRecord) : null, range);
          if (scheduled.scheduledValue === null && !warnings.includes("SCHEDULED_COST_UNAVAILABLE")) warnings.push("SCHEDULED_COST_UNAVAILABLE");
          if (roastedValue === null && !warnings.includes("ROASTED_COST_UNAVAILABLE")) warnings.push("ROASTED_COST_UNAVAILABLE");
          if (scope === "all") {
            if (inventoryRecord) { lab.inventory = inventoryRecord; labObservedAt.inventory = inventoryObservedAt; }
            if (recipeCapture && inventoryRecord) {
              try {
                lab.recipes = assembleRecipes({ ...recipeCapture, inventory: inventoryRecord, asOf: sydneyDate(now()), use: lab.use });
                if (lab.recipes.rows.some(recipe => recipe.components.some(component => component.coffee === null))) warnings.push("CURRENT_RECIPE_COFFEE_AMBIGUOUS");
              } catch {
                delete labObservedAt.recipes;
                warnings.push("LAB_RECIPES_UNAVAILABLE");
              }
            } else { delete labObservedAt.recipes; if (!warnings.includes("LAB_RECIPES_UNAVAILABLE")) warnings.push("LAB_RECIPES_UNAVAILABLE"); }
            if (rawLoss) lab.loss = freshDefinitions ? blendLoss(rawLoss, freshDefinitions) : { ...rawLoss, rows: rawLoss.rows.map(({ profileGroupId, ...row }) => row) };
          }
          return {
            schemaVersion: "1.0", sourceSystem: "cropster-website", location: "Marrickville",
            weekStart, periodEnd: range.periodEnd, observedAt: now().toISOString(),
            productionObservedAt: now().toISOString(),
            mondayRoastedKg: monday?.roastedKg ?? null, mondayObservedAt, greenObservedAt,
            production: { roastedKg: after.roastedKg, scheduledKg: scheduled.scheduledKg, roastedValue, scheduledValue: scheduled.scheduledValue },
            green,
            ...(scope === "all" ? { lab, labObservedAt } : {}),
            ...(previous ? { previousProduction: previous, previousProductionObservedAt } : {}),
            sources: { ...Object.fromEntries(Object.entries(sourcePaths).map(([key, value]) => [key, Array.isArray(value) ? value.map(path => CROPSTER_ORIGIN + path) : CROPSTER_ORIGIN + value])), monday: CROPSTER_ORIGIN + mondayPath, ...(scope === "all" ? { lab: labSources, previousProduction: previousSources } : {}) },
            warnings,
          };
        } catch (error) {
          if (error instanceof ReaderError && error.code === "CROPSTER_CHANGED_DURING_READ" && attempt === 0 && deadline - now().getTime() > 18000) continue;
          throw error;
        }
      }
      throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
    } catch (error) {
      if (timedOut || now().getTime() >= deadline) throw new ReaderError("CROPSTER_TIMEOUT", 504);
      if (error instanceof ReaderError) throw error;
      throw new ReaderError("CROPSTER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      await Promise.allSettled([...jobPages].map(closePage));
      if (timedOut) await reset();
    }
  }

  return { read, close: async () => { closed = true; await reset(); } };
}
