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
    emptySchedule: ["No coffees scheduled", "No profiles scheduled", "No green lots scheduled"].every(marker => body.includes(marker)),
    challenge: Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')) || /checking your browser|verify you are human/i.test(body),
    accessDenied: /access denied|you have been blocked|not authorized|forbidden/i.test(body),
  };
}

export function captureDocument() {
  const text = element => (element?.innerText || "").replace(/\r/g, "").trim();
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  return {
    url: location.href,
    title: document.title,
    text: text(document.body).slice(0, 200000),
    links: Array.from(document.querySelectorAll("a[href]")).slice(0, 1500).map(link => ({ text: text(link), href: link.href })),
    activeFilters: Array.from(document.querySelectorAll('[role="status"]')).map(text).filter(value => /^Filters\s*:/.test(value)),
    scheduleStatuses: Object.fromEntries(Array.from(document.querySelectorAll('input[type="checkbox"][id*="-status-"]')).map(input => [input.id.split("-status-").at(-1), input.checked])),
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
