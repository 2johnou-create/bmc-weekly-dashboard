// Passed to page.evaluate. It reads rendered DOM only; no app state, cookies,
// storage, request interception, or Cropster data endpoints are inspected.
export function renderedViewReady(kind) {
  const compact = value => (value || "").replace(/\s+/g, " ").trim();
  const body = compact(document.body?.innerText);
  if (document.querySelector('input[type="password"]')) return true;
  const headings = compact(Array.from(document.querySelectorAll("table thead")).map(item => item.innerText).join(" "));
  if (kind === "blend") return /Blend components/.test(body) && /% of blend/.test(headings) && Boolean(document.querySelector('table tbody a[href*="/profile-groups/"]'));
  if (kind === "group") return /Associated profiles/.test(body) && /Green inventory/.test(body) && Boolean(document.querySelector('a[href*="/apps/roast/profiles/"]'));
  if (kind === "profile") return /Components\s*\/\s*Green lots/i.test(body) && /Blend %/.test(headings) && /Green weight/.test(headings) && Boolean(document.querySelector('table tbody a[href*="/lots/"]'));
  if (kind === "prices") return /ID-Tag/.test(headings) && /Price/.test(headings) && /\d+\s*-\s*\d+\s+of\s+\d+\s+items/.test(body);
  if (kind === "legacyPrices") {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return /Green Inventory Report/.test(body) && /Lot ID-Tag/.test(headings) && /Price/.test(headings) && rows.length > 0
      && rows.every(row => Array.from(row.querySelectorAll('a[href*="/apps/lots/inventory/"]')).some(link => /^PG-\d+$/.test(compact(link.innerText))))
      && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
  }
  if (kind === "stock") return /Values refer to (?:the )?inventory on/.test(body) && /Location/.test(headings) && /Total value/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
  if (kind === "schedule") {
    const empty = ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"].every(marker => body.includes(marker));
    if (empty && document.querySelectorAll("table").length === 0) return true;
    return /Scheduled coffees/.test(body) && /Summary per green lot/.test(body) && /To roast/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
  }
  return /Production report/.test(body) && /Amount of green/.test(headings) && /Show\s+\d+\s*-\s*\d+\s+of\s+\d+/.test(body);
}

// Structural failure evidence only. Never return titles, URLs, body strings,
// field values or any source quantities from this diagnostic.
export function viewDiagnostics({ kind, expectedPath }) {
  const compact = value => (value || "").replace(/\s+/g, " ").trim();
  const body = compact(document.body?.innerText);
  const headings = compact(Array.from(document.querySelectorAll("table thead")).map(item => item.innerText).join(" "));
  const sameOrigin = location.origin === "https://c-sar.cropster.com";
  const urlClass = sameOrigin && location.pathname === "/app/login" ? "login"
    : sameOrigin && location.pathname === expectedPath ? "expected" : "other";
  let expectedBody, expectedHeaders;
  if (kind === "blend") { expectedBody = /Blend components/.test(body); expectedHeaders = /% of blend/.test(headings); }
  else if (kind === "group") { expectedBody = /Associated profiles/.test(body) && /Green inventory/.test(body); expectedHeaders = false; }
  else if (kind === "profile") { expectedBody = /Components\s*\/\s*Green lots/i.test(body); expectedHeaders = /Blend %/.test(headings) && /Green weight/.test(headings); }
  else if (kind === "prices") { expectedBody = /Green Inventory/i.test(body); expectedHeaders = /ID-Tag/.test(headings) && /Price/.test(headings); }
  else if (kind === "legacyPrices") { expectedBody = /Green Inventory Report/.test(body); expectedHeaders = /Lot ID-Tag/.test(headings) && /Price/.test(headings); }
  else if (kind === "stock") { expectedBody = /Values refer to (?:the )?inventory on/.test(body); expectedHeaders = /Location/.test(headings) && /Total value/.test(headings); }
  else if (kind === "schedule") { expectedBody = /Scheduled coffees/.test(body) && /Summary per green lot/.test(body); expectedHeaders = /To roast/.test(headings); }
  else { expectedBody = /Production report/.test(body); expectedHeaders = /Amount of green/.test(headings); }
  return {
    urlClass, sameOrigin,
    readyState: document.readyState,
    passwordInput: Boolean(document.querySelector('input[type="password"]')),
    expectedBody, expectedHeaders,
    pager: /Show\s+\d+\s*-\s*\d+\s+of\s+\d+|\d+\s*-\s*\d+\s+of\s+\d+\s+items/.test(body),
    tableCount: Math.min(document.querySelectorAll("table").length, 30),
    loadingCount: Math.min(document.querySelectorAll('[role="progressbar"],[aria-busy="true"],.loading,.spinner').length, 30),
    errorPanelCount: Math.min(document.querySelectorAll('[role="alert"],.error-message,.error-panel').length, 30),
    emptySchedule: ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"].every(marker => body.includes(marker)),
    challenge: Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')) || /checking your browser|verify you are human/i.test(body),
    accessDenied: /access denied|you have been blocked|not authorized|forbidden/i.test(body),
  };
}

export function captureDocument() {
  const text = element => (element?.innerText || "").replace(/\r/g, "").trim();
  const state = tile => {
    const classes = tile.closest?.(".calendar__item")?.classList;
    const found = ["unpublished", "scheduled", "synced", "roasted", "inconsistent"].filter(value => classes?.contains("calendar__item--" + value));
    return found.length === 1 ? found[0] : null;
  };
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  return {
    url: location.href,
    title: document.title,
    text: text(document.body).slice(0, 200000),
    links: Array.from(document.querySelectorAll("a[href]")).slice(0, 1500).map(link => ({ text: text(link), href: link.href })),
    activeFilters: Array.from(document.querySelectorAll('[role="status"]')).map(text).filter(value => /^Filters\s*:/.test(value)),
    legacyInventoryScope: {
      locationControls: Array.from(document.querySelectorAll(".ember-power-select-multiple-options")).map(control => ({ text: text(control), selected: Array.from(control.querySelectorAll(".ember-power-select-multiple-option")).map(text) })),
      consumedControls: Array.from(document.querySelectorAll("input.toggle[data-test-checkbox]")).map(input => ({ checked: input.checked })),
      snapshotButtons: Array.from(document.querySelectorAll('button,[role="button"]')).filter(button => ["Snapshot Report", "Timeframe Report"].includes(text(button))).map(button => ({ text: text(button), class: button.className, pressed: button.getAttribute("aria-pressed") })),
      nonCheckboxInputs: Array.from(document.querySelectorAll("table input")).filter(input => input.type !== "checkbox").map(input => ({ type: input.type, value: input.value })),
      checkedRows: Array.from(document.querySelectorAll('table input[type="checkbox"]')).filter(input => input.checked).length,
    },
    scheduleStatuses: Object.fromEntries(Array.from(document.querySelectorAll('input[type="checkbox"][id*="-status-"]')).map(input => [input.id.split("-status-").at(-1), input.checked])),
    scheduleMachines: Object.fromEntries(Array.from(document.querySelectorAll('input[type="checkbox"][id*="-machine-"]')).map(input => [input.id.split("-machine-").at(-1), input.checked])),
    calendarDay: {
      tiles: Array.from(document.querySelectorAll(".calendar__item__main")).map(text),
      states: Array.from(document.querySelectorAll(".calendar__item__main")).map(state),
    },
    calendarWeek: {
      dates: Array.from(document.querySelectorAll('.calendar--week__row--header .calendar--week__header a[href*="/calendar/day?date="]')).map(link => {
        try { return new URL(link.href).searchParams.get("date"); } catch { return null; }
      }),
      rows: Array.from(document.querySelectorAll(".calendar--week__row--main")).map(row => {
        const cells = Array.from(row.children);
        const days = cells.slice(1);
        return {
          machineId: cells[0]?.querySelector("[data-test-schedule-create-for-machine]")?.getAttribute("data-test-schedule-create-for-machine") || null,
          cellCount: cells.length, summary: text(cells[0]),
          batchCounts: days.map(cell => cell.querySelectorAll(".calendar__item__main").length),
          emptyCells: days.map(cell => text(cell) === ""),
          tiles: days.map(cell => Array.from(cell.querySelectorAll(".calendar__item__main")).map(text)),
          states: days.map(cell => Array.from(cell.querySelectorAll(".calendar__item__main")).map(state)),
        };
      }),
    },
    tables: Array.from(document.querySelectorAll("table")).slice(0, 30).map(table => {
      const head = table.querySelector("thead tr") || table.querySelector("tr");
      const heading = headings.filter(item => item.compareDocumentPosition(table) & 4).at(-1);
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      let pagination = "", scope = table.parentElement;
      // Each legacy table has its own pager. Never borrow a different section's
      // matching row count from the page-wide text.
      while (scope && scope !== document.body && scope.querySelectorAll("table").length === 1) {
        const match = text(scope).match(/Show\s+\d+\s*-\s*\d+\s+of\s+\d+|No results|No records/i);
        if (match) { pagination = match[0]; break; }
        scope = scope.parentElement;
      }
      return {
        heading: text(heading),
        pagination,
        headers: head ? Array.from(head.querySelectorAll("th,td")).map(text) : [],
        rows: rows.slice(0, 1000).map(row => Array.from(row.querySelectorAll("td")).map(text)),
        rowLinks: rows.slice(0, 1000).map(row => Array.from(row.querySelectorAll("a[href]")).map(link => ({ text: text(link), href: link.href }))),
        footers: Array.from(table.querySelectorAll("tfoot tr")).map(row => Array.from(row.querySelectorAll("td,th")).map(text)),
      };
    }),
  };
}
