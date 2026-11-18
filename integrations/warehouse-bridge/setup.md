# Warehouse Google connection

This bridge connects two Warehouse actions to a Google account. It reads the fixed expenses range and sends messages submitted by signed-in staff to `roaster@blackmarketroasters.com.au`.

The source files are ready for review. No email is sent by installation, authorization, deployment, or the `authorizeBridge` check. Email is sent only by an authenticated `message` request with a new message reference.

## Review the access

The manifest requests these two Google permissions.

- `spreadsheets.readonly` lets the script read Google Sheets. The code fixes the spreadsheet to `1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik` and the range to `Sheet1!A1:W36`.
- `script.send_mail` lets `MailApp` send email from the deploying account. The code fixes the recipient, subject, and plain-text format. It accepts a message of up to 500 characters.

The account that deploys the script must already have permission to read the expenses spreadsheet. The web app runs as that account. Its endpoint requires the server-held `BRIDGE_TOKEN` for either action. Keep the token in Script Properties and the hosting secrets.

The [Google web app manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable) defines the deployment audience and execution identity. The [MailApp reference](https://developers.google.com/apps-script/reference/mail/mail-app) describes its send-only permission.

## Create and authorize

1. Sign in to the intended sending account at [Google Apps Script](https://script.google.com/home).
2. Create a standalone project named `Black Market Warehouse Bridge`.
3. Replace `Code.gs` with the adjacent source file.
4. In Project Settings, enable **Show appsscript.json manifest file in editor**. Replace the manifest with the adjacent `appsscript.json`.
5. In **Services**, confirm the Google Sheets API v4 advanced service is enabled. If the project uses a separately managed Google Cloud project, enable the Google Sheets API in that project too.
6. Add a Script Property named `BRIDGE_TOKEN`. Use a newly generated random value of 32–256 characters. This value must also be configured in the Warehouse server environment. Do not place it in source code or in the deployment URL.
7. Run `authorizeBridge` in the editor. Review and approve the displayed Sheets read and email-send permissions. This function reads the fixed range and checks the remaining mail quota. It does not call `sendEmail`.
8. Choose **Deploy → New deployment → Web app**. Set the script to execute as the deploying account, and allow access by **Anyone**. The token check protects the data endpoint.
9. Copy the deployed `/exec` URL. In the Warehouse hosting environment, set `GOOGLE_BRIDGE_URL` to that URL and `GOOGLE_BRIDGE_TOKEN` to the matching Script Property value.
10. Publish the Warehouse release with those server secrets. Confirm that expense data loads and the John message form becomes available. Submit a real message only when the user intends to send it.

For later source changes, edit the existing web app deployment to use a new version. Keeping the deployment preserves its URL and its message receipts.

## Request and response shapes

Both operations use an HTTPS JSON POST. The Warehouse server adds `token` before sending the request.

```json
{ "action": "expenses", "token": "SERVER_SECRET" }
```

The response contains a 36-row by 23-column grid twice, with both displayed and numeric values. It also returns `sheetName`, `range`, and `asOf`. Headers are read from the displayed date cells so malformed underlying date serials cannot choose the reporting week.

```json
{
  "action": "message",
  "token": "SERVER_SECRET",
  "id": "00000000-0000-4000-8000-000000000001",
  "message": "Text the staff member chooses to send"
}
```

The response returns the same `id` and a `status` of `sent`, `queued`, or `unavailable`. The UI displays **sent** only after a successful MailApp response. Google accepting the send does not establish recipient inbox delivery.

## Duplicate protection

The Warehouse database stores each message UUID, its SHA-256 digest, status, and timestamps. It stores no message body. The bridge keeps a digest and receipt in Script Properties under a ScriptLock.

A new UUID is reserved as `queued` before calling MailApp. Once reserved, that UUID cannot send another email. A same-ID retry checks the existing receipt. A reused UUID with different message text is rejected.

If sending is interrupted after the reservation, the receipt remains `queued`. It is never resent automatically. Staff can use **Check delivery** with the same message and UUID to retrieve a later confirmed receipt. They can keep their draft while delivery remains uncertain.

Keep the script's `message_…` receipt properties. Deleting receipts or replacing the script project removes that duplicate protection. If Script Properties storage is exhausted, new reservations fail before an email is attempted. Review retention with the Warehouse database before removing any receipt.
