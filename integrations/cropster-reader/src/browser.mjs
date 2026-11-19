import { ReaderError } from "./errors.mjs";
import { addDays, completedMonths, sydneyDate, weekRange } from "./dates.mjs";
import { captureDocument, renderedViewReady, viewDiagnostics } from "./dom.mjs";
import { createLimiter, settlesWithin } from "./runtime-limits.mjs";
import { browserFailureCode, safeProgress } from "./progress.mjs";
import {
  CROPSTER_ORIGIN, aggregateSchedule, parseInventory, inventoryPrices, parseMarrickvilleStock,
  parseRoastedCost, parseRoastedOutput, parseScheduleDay, sameProduction, parseMonthlyUse, parseLoss,
  parseBlend, parseProfileGroup, parseProfileInputs, assembleRecipes, blendLoss, sameSchedules, previousProduction,
} from "./parse.mjs";

const PAGE_LIMIT = 1;
const SOURCE_TIMEOUT = 45000;

export function captureTimestamps(now = () => new Date()) {
  const capturedAt = now().toISOString();
  return { observedAt: capturedAt, productionObservedAt: capturedAt };
}

export function requireCredentialOrigin(address) {
  let url;
  try { url = new URL(address); } catch { throw new ReaderError("CROPSTER_AUTH_REQUIRED"); }
  if (url.origin !== CROPSTER_ORIGIN || url.pathname !== "/app/login" || url.username || url.password) throw new ReaderError("CROPSTER_AUTH_REQUIRED");
}

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

async function allRequired(tasks) {
  const results = await Promise.allSettled(tasks);
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
  return results.map(result => result.value);
}

// This is the deployed application's browser runtime. Only fixed website views
// and the login form are used. There is no exposed browser-control endpoint.
export function createBrowserReader(configuration, { now = () => new Date(), launch, cleanupTimeoutMs = 2000 } = {}) {
  let browser = null, context = null, closed = false, generation = 0, contextPromise = null, pendingBrowser = null;
  const launchBrowser = launch || (async options => (await import("playwright")).chromium.launch(options));

  async function reset(expectedGeneration = generation) {
    if (expectedGeneration !== generation) return;
    generation++;
    const old = [...new Set([browser, pendingBrowser].filter(Boolean))];
    context = null;
    browser = null;
    pendingBrowser = null;
    contextPromise = null;
    await Promise.all(old.map(instance => settlesWithin(() => instance.close(), cleanupTimeoutMs)));
  }

  async function getContext(emit) {
    if (closed) throw new ReaderError("CROPSTER_UNAVAILABLE");
    if (browser && !browser.isConnected()) await reset();
    if (browser?.isConnected() && context) return context;
    if (!contextPromise) {
      const expected = generation;
      const initialise = async () => {
        emit("browser_launch", "running", "open");
        const candidate = await launchBrowser({ headless: true, chromiumSandbox: configuration.chromiumSandbox, args: ["--disable-dev-shm-usage"] });
        if (closed || expected !== generation) {
          void settlesWithin(() => candidate.close(), cleanupTimeoutMs);
          throw new ReaderError("CROPSTER_UNAVAILABLE");
        }
        pendingBrowser = candidate;
        emit("browser_launch", "complete", "open");
        emit("browser_context", "running", "open");
        const candidateContext = await candidate.newContext({
          locale: "en-US", timezoneId: "Australia/Sydney", acceptDownloads: false,
          serviceWorkers: "block", viewport: { width: 1440, height: 1000 },
        });
        // Request routing disables Chromium's HTTP cache. Keep it off so repeated
        // website views can reuse static assets on the constrained host. All
        // navigations originate from fixed URLs; parsers verify final origins.
        if (closed || expected !== generation) {
          void settlesWithin(() => candidate.close(), cleanupTimeoutMs);
          throw new ReaderError("CROPSTER_UNAVAILABLE");
        }
        browser = candidate;
        context = candidateContext;
        pendingBrowser = null;
        emit("browser_context", "complete", "open");
        return candidateContext;
      };
      contextPromise = initialise().catch(error => {
        if (expected === generation) {
          contextPromise = null;
          const failed = pendingBrowser;
          pendingBrowser = null;
          if (failed) void settlesWithin(() => failed.close(), cleanupTimeoutMs);
        }
        throw error;
      });
    }
    return contextPromise;
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
    requireCredentialOrigin(page.url());
    await email.fill(configuration.email, { timeout });
    requireCredentialOrigin(page.url());
    await page.locator('input[type="password"]').fill(configuration.password, { timeout });
    await page.getByRole("button", { name: "Login", exact: true }).click({ timeout });
    try {
      await page.waitForURL(url => url.origin === CROPSTER_ORIGIN && url.pathname !== "/app/login", { timeout, waitUntil: "domcontentloaded" });
    } catch { throw new ReaderError("CROPSTER_AUTH_REQUIRED"); }
  }

  async function read(weekStart, { scope = "weekly", onProgress } = {}) {
    if (!["weekly", "all"].includes(scope)) throw new ReaderError("INVALID_REQUEST", 400);
    const startedAt = now();
    const range = weekRange(weekStart, startedAt);
    const sourcePaths = paths(range);
    const deadline = startedAt.getTime() + configuration.timeoutMs;
    let jobGeneration = generation;
    const limit = createLimiter(PAGE_LIMIT);
    const jobPages = new Set();
    let timedOut = false, abortError = null, rejectAbort;
    const emit = (stage, state, phase, code, diagnostics) => {
      const progress = safeProgress({ stage, state, phase, ...(code ? { code } : {}), ...(diagnostics ? { diagnostics } : {}) }, now);
      if (progress && typeof onProgress === "function") { try { onProgress(progress); } catch { /* Diagnostics never stop a capture. */ } }
    };
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abortJob = error => {
      if (abortError) return;
      abortError = error;
      timedOut = error.code === "CROPSTER_TIMEOUT";
      emit("capture", "failed", timedOut ? "deadline" : "close", error.code);
      limit.cancel(error);
      rejectAbort(error);
      for (const page of jobPages) void settlesWithin(() => page.close(), cleanupTimeoutMs);
      void reset(jobGeneration);
    };
    const timeout = setTimeout(() => abortJob(new ReaderError("CROPSTER_TIMEOUT", 504)), configuration.timeoutMs);
    const remaining = () => {
      const left = deadline - now().getTime();
      if (abortError) throw abortError;
      if (closed) throw new ReaderError("CROPSTER_UNAVAILABLE");
      if (timedOut || left <= 0) throw new ReaderError("CROPSTER_TIMEOUT", 504);
      return Math.min(left, SOURCE_TIMEOUT);
    };
    const newPage = async () => {
      remaining();
      const activeContext = await getContext(emit);
      remaining();
      jobGeneration = generation;
      const page = await activeContext.newPage();
      jobPages.add(page);
      if (abortError) { void settlesWithin(() => page.close(), cleanupTimeoutMs); throw abortError; }
      page.setDefaultTimeout(remaining());
      page.setDefaultNavigationTimeout(remaining());
      page.on("popup", popup => void popup.close().catch(() => {}));
      page.on("dialog", dialog => void dialog.dismiss().catch(() => {}));
      return page;
    };
    const closePage = async page => {
      const settled = await settlesWithin(() => page.close(), cleanupTimeoutMs);
      jobPages.delete(page);
      if (!settled && !abortError) {
        emit("cleanup", "failed", "close", "CROPSTER_CLEANUP_TIMEOUT");
        abortJob(new ReaderError("CROPSTER_CLEANUP_TIMEOUT"));
      }
    };
    const waitForView = async (page, kind) => {
      await page.waitForFunction(renderedViewReady, kind, { timeout: remaining() });
      if (new URL(page.url()).pathname === "/app/login") throw new ReaderError("CROPSTER_AUTH_REQUIRED");
    };
    const diagnose = async (page, kind, path) => {
      if (!page) return undefined;
      let timer;
      try {
        return await Promise.race([
          page.evaluate(viewDiagnostics, { kind, expectedPath: new URL(path, CROPSTER_ORIGIN).pathname }).catch(() => ({ inspectionTimedOut: true })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ inspectionTimedOut: true }), 2000); }),
        ]);
      } finally { clearTimeout(timer); }
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
    const view = (path, kind, parse, stage) => limit(async () => {
      let page, phase = "open";
      emit(stage, "running", phase);
      try {
        page = await newPage();
        phase = "navigate"; emit(stage, "running", phase);
        await page.goto(CROPSTER_ORIGIN + path, { waitUntil: "domcontentloaded", timeout: remaining() });
        phase = "ready"; emit(stage, "running", phase);
        await waitForView(page, kind);
        phase = "filters"; emit(stage, "running", phase);
        if (kind === "schedule") for (const status of ["unpublished", "scheduled", "synced", "roasted", "inconsistent"]) {
          const checkbox = page.locator('input[type="checkbox"][id$="-status-' + status + '"]');
          if (await checkbox.count() !== 1) throw new ReaderError("CROPSTER_SCOPE_UNVERIFIED");
          await checkbox.check({ timeout: remaining() });
        }
        phase = "pagination"; emit(stage, "running", phase);
        if (["production", "stock", "schedule"].includes(kind)) await expandLegacy(page);
        phase = "parse"; emit(stage, "running", phase);
        const result = await snapshotUntilParsed(page, parse);
        emit(stage, "complete", phase);
        return result;
      } catch (error) {
        const code = browserFailureCode(error);
        emit(stage, "failed", phase, code, await diagnose(page, kind, path));
        throw error instanceof ReaderError ? error : new ReaderError(code);
      } finally { if (page) await closePage(page); }
    });
    const inventory = () => limit(async () => {
      let page, phase = "open";
      emit("inventory", "running", phase);
      try {
        page = await newPage();
        phase = "navigate"; emit("inventory", "running", phase);
        await page.goto(CROPSTER_ORIGIN + sourcePaths.prices, { waitUntil: "domcontentloaded", timeout: remaining() });
        phase = "ready"; emit("inventory", "running", phase);
        await waitForView(page, "prices");
        phase = "pagination"; emit("inventory", "running", phase);
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
          if (Number(coverage[2]) >= Number(coverage[3])) {
            phase = "parse"; emit("inventory", "running", phase);
            const result = parseInventory(snapshots, sydneyDate(now()));
            emit("inventory", "complete", phase);
            return result;
          }
          previousFirst = await page.locator("table tbody tr").filter({ hasText: /\[PG-\d+\]/ }).first().innerText();
        }
        throw new ReaderError("CROPSTER_TABLE_INCOMPLETE");
      } catch (error) {
        const code = browserFailureCode(error);
        emit("inventory", "failed", phase, code, await diagnose(page, "prices", sourcePaths.prices));
        throw error instanceof ReaderError ? error : new ReaderError(code);
      } finally { if (page) await closePage(page); }
    });

    const capture = async () => { try {
      emit("authenticate", "running", "open");
      const login = await newPage();
      try {
        emit("authenticate", "running", "navigate");
        await signIn(login, CROPSTER_ORIGIN + sourcePaths.production, remaining());
        emit("authenticate", "complete", "ready");
      } catch (error) {
        emit("authenticate", "failed", "ready", browserFailureCode(error));
        throw error;
      }
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
            return view(path, "blend", snapshot => parseBlend(snapshot, id, signature), "lab_blend_" + signature.toLowerCase());
          }));
          freshDefinitions = { rows: blends };
          const groupIds = [...new Set([...blends.flatMap(blend => blend.components.map(component => component.profileGroupId)), ids.ohGroup, ids.decafGroup])];
          const groups = await allRequired(groupIds.map((id, index) => {
            const path = "/app/roast/profile-groups/" + id;
            labSources.push(CROPSTER_ORIGIN + path);
            return view(path, "group", snapshot => parseProfileGroup(snapshot, id), "lab_profile_group_" + index);
          }));
          const profileUrls = [...new Set(groups.flatMap(group => group.profileUrls))];
          if (profileUrls.length > 80) throw new ReaderError("CROPSTER_RECIPE_UNAVAILABLE");
          const profileInputs = new Map(await allRequired(profileUrls.map(async (url, index) => {
            labSources.push(url);
            const input = await view(new URL(url).pathname, "profile", parseProfileInputs, "lab_profile_input_" + index);
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
            const outputCapture = await view(outputPath, "production", snapshot => ({ snapshot, output: parseRoastedOutput(snapshot, previousRange) }), "previous_output");
            const costSnapshot = await view(costPath, "production", snapshot => {
              parseRoastedCost(snapshot, previousRange, outputCapture.output.greenKg);
              return snapshot;
            }, "previous_cost");
            previous = previousProduction(outputCapture.snapshot, costSnapshot, previousRange);
            previousProductionObservedAt = now().toISOString();
          }, "PREVIOUS_PRODUCTION_UNAVAILABLE"),
          optionalLab(async () => {
            const captured = await allRequired(months.map((month, index) => view(allLocationPath("inventory", month), "production", snapshot => parseMonthlyUse(snapshot, month), "lab_consumption_month_" + index)));
            lab.use = { months: captured };
            labObservedAt.use = now().toISOString();
          }, "LAB_USE_UNAVAILABLE"),
          optionalLab(async () => {
            rawLoss = await view(allLocationPath("profile-group", period), "production", snapshot => parseLoss(snapshot, period), "lab_loss");
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
          const before = await view(sourcePaths.production, "production", snapshot => parseRoastedOutput(snapshot, range), "weekly_production_before");
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
            allRequired(sourcePaths.schedule.map((path, index) => view(path, "schedule", snapshot => parseScheduleDay(snapshot, addDays(range.weekStart, index), range), "weekly_schedule_" + index))),
            optional(() => view(sourcePaths.cost, "production", snapshot => parseRoastedCost(snapshot, range, before.greenKg), "weekly_roasted_cost"), "ROASTED_COST_UNAVAILABLE"),
            optional(async () => { const record = await inventory(); inventoryObservedAt = now().toISOString(); return record; }, "INVENTORY_UNAVAILABLE"),
            optional(async () => { const record = await view(sourcePaths.green, "stock", snapshot => parseMarrickvilleStock(snapshot, sydneyDate(now())), "green_marrickville"); greenObservedAt = now().toISOString(); return record; }, "GREEN_STOCK_UNAVAILABLE"),
            optional(async () => { const record = await view(mondayPath, "production", snapshot => parseRoastedOutput(snapshot, mondayRange), "weekly_monday"); mondayObservedAt = now().toISOString(); return record; }, "MONDAY_ROASTED_UNAVAILABLE"),
          ]);
          const verifiedDays = await allRequired(sourcePaths.schedule.map((path, index) => view(path, "schedule", snapshot => parseScheduleDay(snapshot, addDays(range.weekStart, index), range), "weekly_schedule_verify_" + index)));
          if (!sameSchedules(days, verifiedDays)) throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
          const after = await view(sourcePaths.production, "production", snapshot => parseRoastedOutput(snapshot, range), "weekly_production_after");
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
            weekStart, periodEnd: range.periodEnd, ...captureTimestamps(now),
            mondayRoastedKg: monday?.roastedKg ?? null, mondayObservedAt, greenObservedAt,
            production: { roastedKg: after.roastedKg, scheduledKg: scheduled.scheduledKg, roastedValue, scheduledValue: scheduled.scheduledValue },
            green,
            ...(scope === "all" ? { lab, labObservedAt } : {}),
            ...(previous ? { previousProduction: previous, previousProductionObservedAt } : {}),
            sources: { ...Object.fromEntries(Object.entries(sourcePaths).map(([key, value]) => [key, Array.isArray(value) ? value.map(path => CROPSTER_ORIGIN + path) : CROPSTER_ORIGIN + value])), monday: CROPSTER_ORIGIN + mondayPath, ...(scope === "all" ? { lab: labSources, previousProduction: previousSources } : {}) },
            warnings,
          };
        } catch (error) {
          if (error instanceof ReaderError && error.code === "CROPSTER_CHANGED_DURING_READ" && attempt === 0 && deadline - now().getTime() > 18000) {
            emit("capture", "retry", "parse", error.code);
            continue;
          }
          throw error;
        }
      }
      throw new ReaderError("CROPSTER_CHANGED_DURING_READ");
    } catch (error) {
      if (timedOut || now().getTime() >= deadline) throw new ReaderError("CROPSTER_TIMEOUT", 504);
      if (error instanceof ReaderError) throw error;
      throw new ReaderError("CROPSTER_UNAVAILABLE");
    } finally {
      await Promise.allSettled([...jobPages].map(closePage));
      if (abortError) await reset(jobGeneration);
    } };
    try {
      const result = await Promise.race([capture(), aborted]);
      emit("capture", "complete", "parse");
      return result;
    } catch (error) {
      emit("capture", "failed", timedOut ? "deadline" : "parse", browserFailureCode(error));
      throw error;
    } finally { clearTimeout(timeout); }
  }

  return { read, close: async () => { closed = true; await reset(); } };
}
