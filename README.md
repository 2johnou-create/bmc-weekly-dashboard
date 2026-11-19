# Steam Room Weekly Dashboard

A password-protected weekly operations board for Black Market Coffee. The public page contains only the sign-in interface; business figures are returned after the server verifies the existing Stock Take App password.

[Open the live dashboard](https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site)

The landing page shows the weekly report. The previous operations view and saved customer issue notes are under **Operations details and issue notes**.

| Weekly report | Figure |
| --- | --- |
| Demand | Kilograms from `3. Roast Planning!C18` in the dated weekly ROAST TALLY. The comparison uses last week’s demand. Carry-forward uses the current tally’s `D6:D17` brown stock less Monday’s completed roast output from Cropster. |
| Roasted and scheduled | Cropster Production Report output and recorded green cost, plus the remaining schedule’s estimated output and green cost. Expand for last week’s figures and the capture time. |
| Current green bean stock | The most recent Marrickville location reading from Cropster’s Green Inventory Report, in kg and AUD. |
| Current non-coffee stock | All active items’ latest saved counts from the Stock Take App, valued in AUD to the cent. Missing prices or quantities are flagged and the known-price subtotal is shown. |
| Wholesale orders | Primary delivery orders for all seven days of the selected Sydney week. Done counts completed orders. An inherited plan’s scheduled and pending counts are provisional until the weekly import is confirmed. |
| Expenses | The selected Monday’s column in Cost Sheet Warehouse Expenses, Sheet1. The recorded total is row 36, with purchases in rows 3–35. Values strictly above $18,900 appear in red. Source dollars retain their recorded currency symbol. |

## Operations details sources

| Figure | Source and definition |
| --- | --- |
| Weekly demand | The saved numeric value in `3. Roast Planning!C18` of the dated ROAST TALLY in the shared Drive folder. |
| Weekly roasted | Completed output recorded from the Cropster Production Report for the selected Sydney week. |
| Green stock | Cropster Green Inventory Report’s Marrickville location, in kilograms and AUD. |
| Non-coffee stock | Current Stockroom inventory: counted stock × pieces per stock unit × unit cost, grouped by category. Missing prices make the known value partial. |
| Wholesale orders | Confirmed Dispatch delivery jobs, excluding follow-up jobs. This is partial coverage: collection/postal orders and sales values require the main order ledger. |
| Online orders | CSV exports in the linked Dashboard Folder, counted by unique order number and Sydney placement week. Duplicate line items/files count once; only consistent AUD order totals are summed. |
| Customer order issues | Notes entered in this dashboard, with current open counts across all weeks. Staff can add, edit, resolve and reopen notes; resolved notes remain available. |
| Roasting rate | Cropster completed kg per week and per day with recorded roast output. |
| Packing rate | Stockroom's timer-linked kg per active hour, excluding breaks; kg per day with packing output. Timing coverage is shown. |
| Delivery | Actual recorded runs and completed deliveries, with measured start-to-handover time excluding recorded breaks. Untimed orders are excluded from the average. |

The current week runs Monday–Sunday in Australia/Sydney and shows the latest stock figures. Previous weeks use Monday–Friday. The historical production and Marrickville stock cards use saved readings from Cropster’s dated reports. Historical non-coffee quantities are reconstructed from Stock Take App movements through Friday close and valued at today’s catalogue prices. Missing source readings appear as a dash. The page checks its sources every minute while visible.

The top **Refresh** buttons recheck connected feeds and bypass the dashboard's short-lived feed caches. Purchases re-download the live ORDER PLAN worksheet. Cropster is a saved-reading source: Refresh does not sign in to Cropster or fetch its schedule, production or green inventory again. Changing a schedule in Cropster therefore does not appear until a new verified website reading is saved. Steam Room and Warehouse explicitly show this limitation, the original production and green-stock capture times, and a separate dashboard check time. A recent dashboard check must never be treated as a fresh Cropster observation. No automatic direct-website connection is currently installed.

Dispatch status also refreshes independently every 15 seconds while the page is visible. It reads the protected Dispatch App feed for unique clients with fully completed deliveries in the selected Sydney period. The latest client names and completion times appear in the Dispatch detail. Resolved carry-over follow-ups count in the period when their final handover completed. Scheduled-order Done and Pending figures remain separate. Partial source coverage is labelled, and an unavailable feed clears its client total and list.

The **Note** card stores one editable list of points per reporting week. Each line becomes a separate point. Notes use Stock Take App access and stay with the selected week.

## Roastery Lab

Switch between **Steam Room** and **Roastery Lab** in the header. Both pages use the Stock Take App sign-in.

The **Warehouse** page adds an interactive 3D cutaway of the roastery. Select the roaster, packing benches, green pallets, dispatch, lab or purchasing area to see figures from the same dashboard sources. The view uses the current Sydney week and refreshes every minute while visible. Staff, vehicles, sacks and machine motion illustrate activity. Their movement does not represent tracked people or vehicle positions. Scene controls support orbit, zoom, area focus, pause and reduced motion. The source readings retain their dates, scope and missing-data labels.

The round analogue corner clock uses Australia/Sydney, including daylight saving. Temperature is the nearest hourly outdoor forecast for Marrickville from MET Norway, with source attribution and a freshness label. It is not an indoor sensor reading. Source checks respect the provider’s minimum three-hour interval while manual refresh recalculates the current forecast hour.

Select John beside the roaster for a small game status card. Energy, Workload and Emotion are playful estimates for the virtual character, with five icon slots and source explanations. Workload uses comparable week-over-week demand and production volume. Energy and Emotion use the available completed-roast and dispatch progress; scheduled work stays pending. Missing source inputs leave dependent ratings unknown.

The high-five button adds one local cheer per tap. Cheers lift known Energy and Emotion ratings to a maximum of five while Workload remains tied to the report. Rapid taps build a combo, produce stacking +1 feedback and release larger bursts of 3D dollar coins around John. Coins and character motion are visual game effects. Counters belong to the current visit and reporting week, survive automatic report refreshes, and clear on sign-out. Reduced motion and paused activity keep the interaction’s numerical feedback while limiting visual effects. The coin pool and popup count are bounded for mobile performance.

New high-fives are also saved to the shared private cheer log in the dashboard database. Each tap has an immutable random event ID, client-reported occurrence time and server receipt time. The weekly log uses the Sydney week when the server received it. Retried requests cannot count the same event twice. No staff names, email addresses or IP addresses are stored in this log. Pending events stay on the device until acknowledged, with background batches that keep the game responsive. The game’s visible visit counter remains separate from the durable log. Logging begins with this release; earlier unsaved visits cannot be reconstructed.

Expenses use a read-only private Google bridge to re-read the sheet. A saved verified reading can also be imported under Data sources. It remains labelled with its capture time and never claims a live sheet check. Date matching uses the displayed Monday header, including the sheet’s day/month date conventions; blank future columns do not count as recorded zero spending. The source remains private and its operational data stays out of GitHub. See [bridge setup](integrations/warehouse-bridge/setup.md).

Expanded Expenses also shows the current Sydney calendar month’s Green Buy estimate from column I, **Monthly Predicted Spend**, in the second tab, **ORDER PLAN**, of Roasting Forward Planning. This is the recorded total for the monthly plan, including placed and estimated orders. It remains separate from weekly expenses and continues to show the current month when an earlier reporting week is selected. Missing or ambiguous month totals remain unavailable. Refresh re-reads the live workbook.

- Signature blend green cost uses the saved Cropster recipe shares multiplied by the matching current lot's raw AUD price per kilogram. Roast loss is shown separately, using the recorded green and roasted weights over the stated period. Missing ingredient prices leave the blend price blank.
- Green consumption averages the last three completed Sydney calendar months. It uses green input in the Production Report, excluding transfers. The latest completed month has its own actuals. Bag figures require recorded bags or verified conversion data and remain blank where only kilograms are available.
- Projected runout uses the complete related-lot set for each verified Cropster profile group, summing the available balance of each lot across every warehouse and supplier location. Explicitly recorded contract replacements can join the eligible set with their source notes. Contract balances already held in Cropster locations count once; any additional quantitative contracts require a verified overlap with those balances. A shared pool uses all related lots' observed consumption across products over three complete months, without allocating whole-lot use by recipe percentage. Missing lot links, inventory coverage, historical identities or contract overlap leave the date unavailable. Partially overlapping eligibility sets cannot establish an individual profile runout date. The estimate describes quantity coverage and assumes steady use; it does not guarantee delivery timing.
- The expanded consumption card shows a January–December contract calendar for Liberty, Rhythm, OH and Decaf, using the active NEW block in the planning workbook's CONTRACTS tab. Green cells are recorded contract coverage, red cells are recorded gaps, and unverified cells stay unknown. Supplier and coffee changes remain as written in the source. The year can be changed without losing the selection on refresh. The calendar follows the sheet's displayed month/year planning labels rather than treating its copied date serials as the contract year.
- Each calendar ingredient header includes its related-lot pool's Cropster consumption average in kg/month from the last two completed Sydney months, with the exact period shown above the calendar. Both months must be complete; missing data stays unavailable and verified unused lots count as zero. Shared pools repeat the same total across blend lanes. The headline monthly summary and projected runout retain their three-month basis.
- Amber calendar markers show the verified related-lot pool's projected runout and retain the underlying contract colour. Expanded cell details and a unique-pool overview show the input kilograms, contracts, lot IDs, locations, consumption, source date and eligibility notes. Shared stock is listed once in the overview. A separate actual-coffee table retains origin quantities and recipe shares without the old selected-coffee runout dates. Manual Refresh re-reads the same workbook for the purchase, spend and contract projections; a broken section does not hide the others.
- Upcoming Release and QA Status save to the shared dashboard. Changes use a saved revision so an older draft cannot overwrite a newer edit.
- Coffee C reads ICE's public Coffee C futures feed. The card states the front contract, US cents per pound, source quote time in Sydney, and minimum exchange delay. It rolls the front contract after the recorded last trading date. Missing or old quotes are labelled.
- The purchase calendar reads the second tab, `ORDER PLAN`, of the shared Roasting Forward Planning workbook on refresh. It uses `DATE ORDERED` for calendar markers and treats `EST` as planned orders. Payment due dates remain separate. Gift-box purchases are excluded. Quantities and dollar amounts retain the source's units and currency symbol. Entries with missing or invalid dates are excluded and flagged. A text date without a year is resolved only when its labelled month section has one unambiguous year from dated orders.

Roastery Lab reads the latest verified reports saved from the signed-in Cropster website. Update them with **Cropster reports → Record Cropster reports** using the contract below. Each supplied section replaces its prior reading. Other sections stay available. When a month closes, include all three completed consumption months in the new reading. Raw reports belong in the dashboard's private database and should never be committed.

| Section | Fields |
| --- | --- |
| `inventory` | `asOf` (Sydney date), optional `totalKg`, `allLocationsComplete`, and `rows` of `{name,location,lotId,positionId,kg,pricePerKg}` from all available stock locations. Lot IDs and complete location coverage are required for runout; prices use AUD. Optional `contracts` rows use `{id,lotId,remainingKg,includedInventoryKg,availableFrom}`. Subtract the verified included kilograms to avoid counting supplier-held balances twice; unknown overlap prevents a date. |
| `recipes` | `asOf` and `rows` of `{name,signature,components}`; components use `{name,coffee,percent,profileGroupId}`. Current `coffee` drives raw price. `runoutProfiles` rows `{id,name,lotIds,linksComplete,note}` explicitly record every eligible/current, historical and planned replacement lot; `runoutLotNames` supplies `{lotId,name}` aliases for historical identity. `decafProfileGroupId` links Decaf explicitly. Source notes distinguish Cropster profile links from planned replacements. |
| `use` | `months` of `{month,complete,kg,bags,rows}`. Use `YYYY-MM`, matching whole-month roast input, and one `{name,lotId,kg,bags}` row per lot. Exact unique source names may identify older rows, but ambiguous lot identities prevent a runout date. `complete` is true only when all consumed coffees in the month are represented. Bag fields are optional. |
| `loss` | `asOf`, optional `from`, and `rows` of `{name,greenKg,roastedKg,batches}` from the same period. Use the total weight of the matched roasts for each profile, blend, or origin. |

## Cropster readings

Read actual kilograms and historical green-ingredient cost from **Reports → Production Report**. Read remaining estimated roast output in **Roasts → Schedule**, including Friday and excluding completed batches. Estimate remaining green cost from the scheduled lot inputs and their Cropster AUD per-kg prices when all prices are available. Read the **Marrickville** row in **Green Inventory Report → By location** for current green stock and value.

While signed in to the dashboard, save production totals under **Data sources → Record Cropster readings** and green stock under **Data sources → Record Marrickville green stock**. Cropster credentials stay in the browser or password manager. The dashboard stores the figures and capture time in its password-protected database.

Record Monday’s completed kilograms separately using the Cropster Production Report filtered to Monday only. That reading supplies the Demand card’s carry-forward calculation.

For a previous week, use the Friday capture under **Data sources** with the Cropster Production Report filtered to that week’s Monday and Friday and the Green Inventory Report snapshot filtered to that Friday’s Marrickville row.

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
