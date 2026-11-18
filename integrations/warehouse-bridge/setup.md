# Warehouse Expenses connection

This read-only bridge connects the private Warehouse expenses sheet to the dashboard. It reads the fixed spreadsheet `1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik` and range `Sheet1!A1:W36`.

The manifest requests only `spreadsheets.readonly`. The deploying Google account must already have access to that spreadsheet. The code fixes the source and range, and the endpoint requires the server-held `BRIDGE_TOKEN`. Keep that token in Script Properties and hosting secrets.

The [Google web app manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable) defines the deployment audience and execution identity.

## Setup

1. Sign in to the account that can read the sheet at [Google Apps Script](https://script.google.com/home).
2. Create a standalone project named `Black Market Warehouse Expenses Bridge`.
3. Replace `Code.gs` with the adjacent source file.
4. Enable **Show appsscript.json manifest file in editor** in Project Settings. Replace the manifest with the adjacent `appsscript.json`.
5. Confirm Google Sheets API v4 is enabled under **Services**. A separately managed Google Cloud project also needs the Sheets API enabled there.
6. Add Script Property `BRIDGE_TOKEN`, with a newly generated random value of 32–256 characters. Keep it out of source and URLs.
7. Run `authorizeBridge` and review the read-only Sheets permission.
8. Choose **Deploy → New deployment → Web app**. Execute as the deploying account and allow access by **Anyone**. The token check protects the data endpoint.
9. Set hosting secrets `GOOGLE_BRIDGE_URL` to the deployed `/exec` URL and `GOOGLE_BRIDGE_TOKEN` to the matching Script Property value.
10. Deploy the dashboard with those secrets and confirm its weekly expense reading loads.

Keep the existing deployment URL when updating the bridge. This bridge has no email permission or message action.

## Data contract

The dashboard server makes an HTTPS JSON POST with `action: "expenses"` and adds the private token. The response returns `sheetName`, `range`, `asOf`, and two 36-row by 23-column grids with formatted and numeric values. Displayed Monday headers choose the reporting week, so malformed underlying date serials cannot change the selected week.

The monthly Green Buy forecast uses the separate live Roasting Forward Planning workbook, second tab `ORDER PLAN`, column I. That public feed does not require this private bridge.
