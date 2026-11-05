# BMC Weekly Dashboard

A password-protected weekly operations board for Black Market Coffee. The public page contains only the sign-in interface; business figures are returned after the server verifies the existing Stock Take App password.

[Open the live dashboard](https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site)

## Live sources

| Figure | Source and definition |
| --- | --- |
| Weekly demand | Exact-week roast tally from the existing public 2026 Drive folder. The workbook's internal Monday and totals must agree. Copied channel-reference dates are flagged. |
| Weekly roasted | Active, unmerged Stockroom roast batches dated within the selected Sydney week. |
| Green stock | Current physical Green Forecast lots: kilograms and remaining kg × price/kg. Supplier-held contracts are excluded. |
| Non-coffee stock | Current Stockroom inventory: counted stock × pieces per stock unit × unit cost, grouped by category. Missing prices make the known value partial. |
| Wholesale orders | Confirmed Dispatch delivery jobs, excluding follow-up jobs. This is partial coverage: collection/postal orders and sales values require the main order ledger. |
| Online orders | CSV exports in the linked Dashboard Folder, counted by unique order number and Sydney placement week. Duplicate line items/files count once; only consistent AUD order totals are summed. |
| Customer order issues | Notes entered in this dashboard, with current open counts across all weeks. Staff can add, edit, resolve and reopen notes; resolved notes remain available. |
| Roasting rate | Recorded kg/week and kg per day with recorded roast output; not labour productivity. |
| Packing rate | Stockroom's timer-linked kg per active hour, excluding breaks; kg per day with packing output. Timing coverage is shown. |
| Delivery | Actual recorded runs and completed deliveries, with measured start-to-handover time excluding recorded breaks. Untimed orders are excluded from the average. |

Weeks are Monday–Sunday in Australia/Sydney. Previous weeks can be selected; inventory always means latest saved inventory. Missing information is null, never a fabricated zero. Current open issue notes, like inventory, are shown independently of the selected reporting week. The page refreshes every minute while visible and identifies each source date or lack of a timestamp.

Demand discovery reads Google's existing public folder listing and validates the matching workbook. This depends on Google's HTML structure; renamed, missing, private or changed-format workbooks become unavailable. No Google sharing permissions are changed. A known workbook is only a fallback when its internal week matches the requested week. This is a live read, not a committed copy of business data.

## Online order uploads

Use the existing [Dashboard Folder](https://drive.google.com/drive/folders/1ziyEe7KOPe9IIlmpckhyl_75FaV-o71n). The app reads the folder without changing its sharing settings.

Download the [CSV template](https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site/online-orders-template.csv), fill it with the exported orders and save as UTF-8 comma-separated CSV. Headers are:

```csv
Order Number,Order Date,Order Total,Currency
```

Order number and order date are required. Use a date such as `2026-11-05` (Sydney calendar date), or a timestamp with its UTC offset such as `2026-11-05T09:00:00+11:00`. Local timestamps without an offset and ambiguous day/month formats are not inferred. Use `AUD` for Australian-dollar totals. Order total and currency can be omitted when only order counts are needed; the value then remains unknown.

Use the same order numbers in every export. Repeated rows for the same order must repeat the order-level total rather than line-item values. Conflicting dates or totals are flagged. Recognised explicit cancelled/test orders are excluded. A Google Sheet's first worksheet can also be read, with a partial-coverage notice. Excel/PDF files are not parsed by this online-order connection.

An empty folder, a template with no orders, or exports with no orders dated in the selected week do not establish a zero-order week. The dashboard shows a missing-file or missing-date notice instead. Reads are bounded to 12 files, 2 MB per file and 8 MB overall; exceeding limits marks known counts partial. The folder listing depends on Google's public HTML structure. Uploaded files are read live, not copied into the source repository.

## Customer issue notes

Select **Manage issue notes** on the dashboard. Enter the issue date and a short note; customer and order reference are optional. Resolve a note once handled, or reopen it when further work is needed. Editing checks the saved revision so an older screen cannot overwrite another device's change. Drafts stay in the form after a failed save or refresh. Resolve/reopen retains the note; there is no delete action.

Notes are stored in the Site's D1 database, shared across staff devices behind the same Stockroom password. New databases begin with an empty note register. Real notes and local preview databases must never be committed to GitHub.

## Access

- Sign-in forwards the submitted password only to BMC Stockroom's existing login endpoint.
- A 12-hour HttpOnly, SameSite cookie encrypts the upstream session using AES-GCM. Passwords are not stored in the dashboard cookie or browser storage.
- Every dashboard read checks the upstream Stockroom authorization. Revoked sessions cannot obtain the dashboard. Sign-out revokes that upstream session.
- Issue reads and writes recheck the live Stockroom session; writes also require the dashboard origin and bounded JSON.
- All data responses are private/no-store. Credentials remain server-side runtime secrets. The shipped HTML contains no operational snapshot.
- Login attempts are bounded per IP in the running Worker isolate. This is not a global distributed rate limiter.
- Dispatch uses a dedicated read-only machine credential and a bounded summary, without addresses, contact details, proof files, signatures or driver credentials.

GitHub stores source code. The server runs on Sites because a static GitHub Pages password screen cannot protect upstream credentials or private operational APIs.

## Development

Node >=22.13, pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm validate
pnpm dev
```

Configure `SESSION_SECRET`, `SOURCE_GREEN_PASSWORD`, `DISPATCH_READ_TOKEN` and `DASHBOARD_DISPATCH_URL` in the hosting runtime. Local preview generates a temporary session key when none is supplied. It needs source credentials in its process environment for non-Stockroom feeds. Never commit credentials, cookies, exported operational data or `.env` files.

`worker/index.js` handles routes; `issues.js` stores current issue notes; `online-orders.js` reads and summarises the linked order exports; `auth.js` verifies sign-in and seals sessions; `metrics.js` aggregates app reads; `demand.js` discovers and validates weekly workbooks; `ui.js` contains the self-contained interface. The build bundles these modules and vendored MIT-licensed fflate into one ESM Worker and includes the generated SQL migrations under `dist/.openai/drizzle`. Schema changes are defined in `db/schema.js`; run `pnpm db:generate` and review the generated migration before publishing. The local preview applies migrations to `.sites-runtime/issues.sqlite`; hosted Sites applies them to D1. `vendor/fflate.LICENSE` retains the upstream license.

Publish through the Sites source/version workflow with the exact pushed source and matching `dist` archive. Preserve `.openai/hosting.json` project identity. The Dispatch source update is isolated in the sibling `BMC Dashboard Dispatch Feed` checkout; it does not alter delivery records.
