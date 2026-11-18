# BMC Weekly Dashboard

A password-protected weekly operations board for Black Market Coffee. The public page contains only the sign-in interface; business figures are returned after the server verifies the existing Stock Take App password.

[Open the live dashboard](https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site)

The landing page shows the weekly report. The previous operations view and saved customer issue notes are under **Operations details and issue notes**.

| Weekly report | Figure |
| --- | --- |
| Demand | Kilograms from `3. Roast Planning!C18` in the dated weekly ROAST TALLY. Percentage change uses last week's tally as its baseline when the previous total is above zero. |
| Roasted and scheduled | Cropster Production Report output and recorded green cost, plus the remaining schedule’s estimated output and green cost. Expand for last week’s figures and the capture time. |
| Current green bean stock | The most recent Cropster Green Inventory Report snapshot across all locations, in kg and AUD. |
| Current non-coffee stock | Latest Stockroom value, using counted stock × pieces per stock unit × unit cost. Items without prices are flagged. |
| Wholesale orders | Primary delivery orders from Dispatch. Done counts completed primary orders. Scheduled and pending counts use the confirmed weekly import. |

## Operations details sources

| Figure | Source and definition |
| --- | --- |
| Weekly demand | The saved numeric value in `3. Roast Planning!C18` of the dated ROAST TALLY in the shared Drive folder. |
| Weekly roasted | Completed output recorded from the Cropster Production Report for the selected Sydney week. |
| Green stock | Current physical Cropster green lots, reported in kilograms. |
| Non-coffee stock | Current Stockroom inventory: counted stock × pieces per stock unit × unit cost, grouped by category. Missing prices make the known value partial. |
| Wholesale orders | Confirmed Dispatch delivery jobs, excluding follow-up jobs. This is partial coverage: collection/postal orders and sales values require the main order ledger. |
| Online orders | CSV exports in the linked Dashboard Folder, counted by unique order number and Sydney placement week. Duplicate line items/files count once; only consistent AUD order totals are summed. |
| Customer order issues | Notes entered in this dashboard, with current open counts across all weeks. Staff can add, edit, resolve and reopen notes; resolved notes remain available. |
| Roasting rate | Cropster completed kg per week and per day with recorded roast output. |
| Packing rate | Stockroom's timer-linked kg per active hour, excluding breaks; kg per day with packing output. Timing coverage is shown. |
| Delivery | Actual recorded runs and completed deliveries, with measured start-to-handover time excluding recorded breaks. Untimed orders are excluded from the average. |

Weeks are Monday–Sunday in Australia/Sydney. Previous weeks can be selected; inventory always means latest saved inventory. Missing information appears as a dash. Current open issue notes, like inventory, are shown independently of the selected reporting week. The page checks its sources every minute while visible. Cropster readings display the saved snapshot date and time.

## Cropster readings

Read actual kilograms and historical green-ingredient cost from **Reports → Production Report**. Read remaining estimated roast output in **Roasts → Schedule**, including Friday and excluding completed batches. Estimate remaining green cost from the scheduled lot inputs and their Cropster AUD per-kg prices when all prices are available. Use **Green Inventory Report → By location** for the total current stock and value.

While signed in to the dashboard, open **Data sources → Record Cropster readings** to save the current week’s verified aggregates. Cropster credentials stay in the browser or password manager. The dashboard stores the figures and capture time in its password-protected database.

The demand feed reads the shared-drive copy of the workbook used for Emily’s Monday Roast Schedule. It looks for `ROAST TALLY <day> <MMM> <year>.xlsx` for the reporting week. The date in that filename identifies the week. Older filename formats also need a matching internal week. An ambiguous file or missing numeric C18 result is shown as unavailable. The dashboard reads the live Drive workbook on refresh.

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

Configure `SESSION_SECRET`, `DISPATCH_READ_TOKEN` and `DASHBOARD_DISPATCH_URL` in the hosting runtime. Local preview generates a temporary session key when none is supplied. Never commit credentials, cookies, exported operational data or `.env` files.

`worker/index.js` handles routes; `issues.js` stores current issue notes; `online-orders.js` reads and summarises the linked order exports; `auth.js` verifies sign-in and seals sessions; `metrics.js` aggregates app reads; `demand.js` discovers and validates weekly workbooks; `ui.js` contains the self-contained interface. The build bundles these modules and vendored MIT-licensed fflate into one ESM Worker and includes the generated SQL migrations under `dist/.openai/drizzle`. Schema changes are defined in `db/schema.js`; run `pnpm db:generate` and review the generated migration before publishing. The local preview applies migrations to `.sites-runtime/issues.sqlite`; hosted Sites applies them to D1. `vendor/fflate.LICENSE` retains the upstream license.

Publish through the Sites source/version workflow with the exact pushed source and matching `dist` archive. Preserve `.openai/hosting.json` project identity. The Dispatch source update is isolated in the sibling `BMC Dashboard Dispatch Feed` checkout; it does not alter delivery records.
