# Cropster website reader

This is a separate Node/Chromium service for the dashboard. It reads the signed-in Cropster website through rendered DOM. It does not call Cropster's public or private data APIs, inspect application state, or modify Cropster records. Its only submitted source form is the normal Cropster sign-in. Report filters and table page sizes are read-only display settings.

The service is application runtime software. Building it does not install a browser reader into the dashboard's Cloudflare Worker. Hosting, runtime secrets and an end-to-end source read must be configured and verified separately before claiming automatic sync works.

## Run and deploy

Use this directory as the Docker build context and its `Dockerfile` as the image definition. The image and npm dependency both pin Playwright **1.64.1**. Dependencies are locked, the process runs as `pwuser`, HTTP binds `0.0.0.0:$PORT`, and `GET /health` is the health-check path. Run a single service instance; in-memory jobs and the signed-in browser context belong to that instance. A process restart safely loses pending/results jobs and browser cookies, after which the dashboard must start a new capture.

Configure the server-only values listed in `.env.example` through the host's runtime secret/environment settings. Never pass credentials as Docker build arguments or put them in source, files served to visitors, logs, screenshots, HARs or trace recordings. `CROPSTER_READER_TOKEN` is an independent random bearer token of at least 32 URL-safe characters; the dashboard stores the matching value only as a runtime secret.

The four nonsecret profile IDs select the two signature blend profiles and the OH/Decaf profile groups. Component group IDs and associated roast profiles are then read from their actual website links. Missing IDs leave the recipe section unavailable; they never select an invented recipe.

Optional completion delivery uses the paired runtime values `DASHBOARD_SYNC_URL` and `DASHBOARD_SYNC_TOKEN`. The URL must be HTTPS, with the exact path `/api/integrations/cropster` and no credentials, query, fragment or custom port. Its host must be a `.chatgpt.site`, or exactly match a configured `DASHBOARD_SYNC_HOST`. The callback token is independent from the reader's inbound token and matches `CROPSTER_SYNC_WRITE_TOKEN` on the dashboard. Leave both callback values blank to use polling only.

The base image contains Chromium and its system dependencies. Chromium's sandbox is off by default under Playwright; this is a fixed-view Cropster reader, not a general browsing endpoint. Every final view URL is validated, and the exact HTTPS Cropster login origin/path is checked immediately before typing either credential. Set `CHROMIUM_SANDBOX=true` only on a host supporting the necessary Linux namespaces/seccomp configuration. The process is nonroot in either mode. The `--disable-dev-shm-usage` launch setting avoids relying on a large shared-memory mount.

The free-host trial uses one active page and a 45-second navigation/readiness cap. Global request routing is disabled because Playwright routing disables Chromium's HTTP cache. Static website assets can therefore be reused between the fixed views. No source API is called and no data-result cache replaces a new capture.

Production dependencies install with `npm ci --omit=dev --ignore-scripts`. `npm test` runs pure synthetic DOM/parser/protocol tests and does not launch a browser. The service starts with `npm start` only after secrets are configured.

## Asynchronous refresh protocol

All data routes require `Authorization: Bearer <CROPSTER_READER_TOKEN>`. Tokens never appear in URLs. Responses use private/no-store headers and contain no credentials.

1. `POST /v1/sync` with JSON `{ "weekStart": "YYYY-MM-DD" }` starts a complete capture and immediately returns HTTP 202 with `{schemaVersion:"1.0",jobId,status:"running",weekStart}`.
2. `GET /v1/sync/<jobId>` returns HTTP 200 and status `running`, `complete` with `result`, or `failed` with a safe string `error` code. A missing/expired/restarted job returns HTTP 404. No browser stack, page body or authentication response is returned.
3. Simultaneous requests for the same current week share the active capture. A new POST after completion always starts a new website read. Completed jobs expire after ten minutes; at most ten jobs are retained, with the oldest completed job evicted when capacity is needed.

When configured, a completed async job also POSTs `{schemaVersion:"1.0",jobId,weekStart,result}` to the fixed dashboard ingestion route. This keeps saving independent of a visitor leaving the page open. The job becomes `complete` before delivery starts, so the dashboard may independently poll and ingest the result without a deadlock. The writer must be idempotent by job ID.

Delivery requires a successful JSON `{ok:true}` acknowledgement. There are at most three attempts, each with a 12-second timeout, separated by one- and two-second backoffs for temporary failures. Redirects are never followed; authentication/configuration failures stop delivery without forwarding a token. Optional job field `delivery` becomes `saved`, `failed` or `not-configured` after delivery settles. A failed delivery retains the completed capture for authenticated polling and does not turn its source result into a capture failure. No callback token, payload or raw transport error is logged.

The job deadline defaults to 600 seconds, which is also the configured maximum. The dashboard should use short HTTP requests to start/poll, show progress and then reload its cards after a completed job is validated and persisted. There is no completed-result TTL cache hiding a new manual refresh.

Job status can include `progress:{stage,state,phase,at,code?,diagnostics?}` and up to eight recent `failures` with the same shape. Stages are fixed report labels and bounded indices; phases identify navigation, readiness, pagination, parsing or cleanup. Failure diagnostics contain only URL-path class (`login`/`expected`/`other`), document readiness, bounded DOM table count and boolean body/header/pager/challenge flags. They never contain raw page text, title, URLs, credentials or operational quantities. The corresponding `reader_stage` logs follow the same restrictions. A capture deadline rejects independently of a hung browser operation. Queued work is cancelled, page/browser cleanup is bounded, and late operations from an older browser generation cannot replace a newer session.

For compatibility, `POST /v1/weekly` accepts `{weekStart,scope?:"weekly"|"all"}` and waits for a capture. Prefer the job protocol for full captures. Only the current Sydney Monday is accepted. Historical dashboard archives are independent and must not be replaced with a current reading.

`GET /health` is public and returns process health only. It does not sign in, run a browser, disclose source data or prove that a source capture succeeded.

## Observation contract

A successful observation contains:

- `schemaVersion:"1.0"`, `sourceSystem:"cropster-website"`, `location:"Marrickville"`, exact `weekStart` and Friday `periodEnd`.
- `observedAt` and `productionObservedAt` UTC ISO timestamps from the completed source capture, never the dashboard button time.
- `production:{roastedKg,scheduledKg,roastedValue,scheduledValue}`. Both kilogram totals must be verified. Missing prices remain `null`; a verified empty remaining schedule is zero.
- `mondayRoastedKg` and `mondayObservedAt` from Monday's completed output report, or `null` with a warning.
- `green:{location:"Marrickville",kg,value}` and `greenObservedAt` from the dated Green Inventory Report's exact location row, or `null` with a warning. Supplier stock is excluded from this facility headline.
- Full captures add `lab` with only successfully read `inventory`, `recipes`, `use` and `loss` sections, plus `labObservedAt` mapping each supplied section to its actual source capture time. Omitted sections must retain their prior observation date and show their failed/stale state.
- Full captures also read the previous Sydney week's Monday–Friday output and cost reports. When both are verified, `previousProduction` contains their exact week/range, `roastedKg`, `roastedValue`, and closed-period `scheduledKg:0` / `scheduledValue:0`, with `previousProductionObservedAt`. No historical schedule is queried. A missing/error result is omitted with `PREVIOUS_PRODUCTION_UNAVAILABLE`, so known prior comparison fields can remain unchanged and be labelled unrefreshed. These comparison reads must never overwrite Friday stock/production archives.
- `sources` contains only fixed Cropster website source URLs. `warnings` contains bounded codes for unavailable costs/sections or ambiguous current recipe inputs.

The dashboard must validate every field and the reporting week before saving. Persist each Lab section using its own timestamp. Do not advance an old section's date just because another source succeeded.

## Data rules

Weekly production reads Monday–Friday at Marrickville. Five dated daily schedules include unpublished, published and synced outstanding batches. All schedule status filters are explicitly enabled and verified. Completed schedule rows have blank `To roast` cells and add no pending output. The all-time `Total scheduled` figure is never used.

Partly completed schedules use remaining green weight relative to the same period's total and estimated output. Post-roast blends apply the ratio separately to each component; a component cannot borrow another component's roast loss. Remaining input must reconcile with the daily lot summary. Scheduled value uses those exact lot inputs and their current Cropster AUD/kg prices. Green input is never displayed as roasted output.

An empty day can use Cropster's table-free layout. Zero is accepted only when the exact requested day/Marrickville and all five checked status filters are verified, there are no tables, and all three explicit panels say “No coffees scheduled”, “No profiles scheduled” and “No green lots scheduled”. A partial empty layout, wrong scope or unchecked status is not zero.

The reader checks completed kilograms, green kilograms and batch count immediately before/after the weekly capture, and rechecks all five daily pending summaries for plan edits during the read. A changing production/schedule report or mismatched cost-report green weight triggers one bounded retry, then a safe failure instead of a mixed-time total. Historical Lab reports are read first, so the weekly cycle runs at the end of a full job.

Lab inventory includes every available location, verifies the active filter is only `Status Available`, reconciles complete pagination and retains exact lot/position IDs. Already registered supplier balances are stock positions; no extra contract quantity is invented. Monthly use reads three completed Sydney months from all-location green-input reports, with exact lot IDs and complete totals. Bag counts remain unavailable where the website supplies only kilograms.

Loss uses measured green/roasted totals over the same three completed months. Liberty/Rhythm aggregate rows are built from their freshly read component profile groups by summing observed green weight, roasted weight and roast batches. They describe all output from those component groups, not an allocation of post-blend consumption by recipe percentage. OH uses its measured group row.

Recipe inputs come from each displayed blend percentage, linked profile group and associated roast profile. A single unambiguous current coffee can be resolved from the default profile's eligible available stock; multiple local coffees remain `null` rather than guessing. Raw `runoutProfiles` contain **current Cropster links only**. The dashboard must merge separately verified planned replacements and historical assignments with their provenance before persistence. Never blindly replace a combined old plan with Cropster-only links, or blindly union unknown old links into fresh membership.

Every table must have its own complete pager. A different section's matching count cannot establish coverage. Unknown layouts, wrong dates/locations, missing output, ambiguous recipe inputs and missing prices cannot silently become zero.

## Verified documentation

Implementation references checked while preparing this service:

- [Official Playwright Docker guidance](https://playwright.dev/docs/docker), including matching browser/package versions and nonroot/sandbox considerations.
- [Playwright Page API](https://playwright.dev/docs/api/class-page) and [Locator API](https://playwright.dev/docs/api/class-locator) for navigation, rendered DOM reads and login locators.
- [Official npm package metadata for Playwright 1.64.1](https://registry.npmjs.org/playwright/1.64.1) and [matching playwright-core](https://registry.npmjs.org/playwright-core/1.64.1), including the integrity values recorded in the lockfile.

Pure tests do not prove the live Cropster layout or hosting environment works. The authenticated website capture, pagination, login selectors, profile inputs and source timestamps require a deployed integration check before enabling the reader for staff.
