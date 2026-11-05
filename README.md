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
| Online orders | Awaiting the owner's chosen source. |
| Customer order issues | Awaiting the owner's chosen register. Dispatch exceptions are described only in the delivery note. |
| Roasting rate | Recorded kg/week and kg per day with recorded roast output; not labour productivity. |
| Packing rate | Stockroom's timer-linked kg per active hour, excluding breaks; kg per day with packing output. Timing coverage is shown. |
| Delivery | Actual recorded runs and completed deliveries, with measured start-to-handover time excluding recorded breaks. Untimed orders are excluded from the average. |

Weeks are Monday–Sunday in Australia/Sydney. Previous weeks can be selected; inventory always means latest saved inventory. Missing information is null, never a fabricated zero. The page refreshes every minute while visible and identifies each source date or lack of a timestamp.

Demand discovery reads Google's existing public folder listing and validates the matching workbook. This depends on Google's HTML structure; renamed, missing, private or changed-format workbooks become unavailable. No Google sharing permissions are changed. A known workbook is only a fallback when its internal week matches the requested week. This is a live read, not a committed copy of business data.

## Access

- Sign-in forwards the submitted password only to BMC Stockroom's existing login endpoint.
- A 12-hour HttpOnly, SameSite cookie encrypts the upstream session using AES-GCM. Passwords are not stored in the dashboard cookie or browser storage.
- Every dashboard read checks the upstream Stockroom authorization. Revoked sessions cannot obtain the dashboard. Sign-out revokes that upstream session.
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

`worker/index.js` handles routes; `auth.js` verifies sign-in and seals sessions; `metrics.js` aggregates app reads; `demand.js` discovers and validates weekly workbooks; `ui.js` contains the self-contained interface. The build bundles these modules and vendored MIT-licensed fflate into one ESM Worker. `vendor/fflate.LICENSE` retains the upstream license.

Publish through the Sites source/version workflow with the exact pushed source and matching `dist` archive. Preserve `.openai/hosting.json` project identity. The Dispatch source update is isolated in the sibling `BMC Dashboard Dispatch Feed` checkout; it does not alter delivery records.
