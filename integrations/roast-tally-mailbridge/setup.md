# Roast Schedule email intake

This is a **separate Apps Script project** from the existing read-only Expenses bridge. It does not change that bridge or its permissions. It runs as `roaster@blackmarketroasters.com.au`, checks matching Roast Schedule messages every five minutes, and makes their verified weekly tally available in the dashboard's fixed shared folder.

Prepared project: [BMC Roast Schedule Intake](https://script.google.com/home/projects/1NMdtubP9JyRAQU3Y1HB_Dp689b4LMKBwZEpCAYOVnuh0D4qx8jeqQVng/edit). On23November, Code.gs was saved, but the manifest, OAuth grant and trigger were **not activated**. Approval review stopped the manifest save pending the user's explicit approval for the scopes below and the existing folder's sharing. Reuse this project after approval; do not create another one or change the Expenses project.

The actual verified source flow is **Black Market Coffee `<info@blackmarketroasters.com.au>`**, subject **`Roast Schedule - 16/11/2026`**, with a **HERE link to a Google Sheet**. Other attachments in that message are client orders. The intake therefore supports the linked-sheet flow and ignores unrelated order attachments. It does not assume the display name “Emily” identifies a sender.

## What it does

- Reads only messages matching the approved exact sender addresses and Roast Schedule subject. It validates From again after the Gmail search; forwarded/reply subjects are excluded.
- Verifies that the executing Gmail mailbox is the Roaster address. A personal Gmail account cannot run the intake.
- Extracts only exact `https://docs.google.com/spreadsheets/d/<id>` links from the matching messages' HTML/plain text. It never follows links from the message. It reads source metadata through Google's Drive API, then requires a `ROAST TALLY D MON YYYY` name with a valid Monday matching the dated email subject.
- If that original Sheet/file is already in the fixed folder, leaves it untouched. The dashboard continues reading the original as it changes.
- For a linked source outside the folder, exports one complete XLSX snapshot to a new app-owned file named `ROAST TALLY D MON YYYY.xlsx` in the fixed folder. Later checks refresh **only that owned copy**, keeping its file ID stable. The original source is never edited, moved, renamed or shared.
- Also accepts strictly dated `.xlsx` attachments; legacy `.xls` attachments are converted into a new Google Sheet. Attachment filename, MIME, size and signature are checked. The dashboard separately validates the workbook tab and actual `3. Roast Planning!C18` value before using demand.
- Only accepts the current or previous Sydney week, never a future or inferred week. Missing current-week mail remains `awaiting-tally`; a previous-week file is not substituted as current.
- Preserves existing human-managed sources. Conflicting same-week sources require review rather than creating duplicates or choosing an arbitrary file.
- Uses a script lock and a pending-upload ledger. An uncertain create is not repeated automatically. If the first upload succeeded but its acknowledgement was lost, the next check recognizes the owned file.

The fixed destination is [the existing Roast Tally folder](https://drive.google.com/drive/folders/1rxLbvoqyaxEdRJWJeWBOwmnmDqxnHXEo). Its existing sharing applies to new files normally; this script never calls a sharing/permission API. That destination can be publicly readable for the dashboard's existing download path. Review this data destination before authorizing the first import.

## Google permissions

The manifest requests:

| Scope | Reason |
|---|---|
| `gmail.readonly` | Read the Roaster mailbox and matching message/attachment data. Code filters to approved senders and Roast Schedule; Google's permission itself covers reading the mailbox. It cannot send, archive, mark read or modify email. |
| `drive.readonly` | Read the linked source's metadata and export/download its workbook. Google's permission covers accessible Drive files; code reads only verified tally links and the fixed folder. |
| `drive.file` | Create imported files and refresh the app-owned copy. It does not grant unrestricted Drive write permission. |
| `script.scriptapp` | Install the five-minute time trigger. |
| `script.external_request` | Download/export workbook bytes from the fixed `www.googleapis.com/drive/v3/files/…` API. OAuth is sent only there; redirects are refused. |

This avoids the full Drive-write scope and all Gmail send/modify scopes. It contains no web app endpoint, credentials, external email destination or financial calculations. No message bodies, workbook cells, credentials or raw API errors are logged. Returned status is bounded metadata: filenames, weeks, counts and fixed error codes.

Because this adds persistent Gmail/Drive access beyond the existing Expenses bridge, review the concrete code and Google consent before activation. **Do not add these scopes to the Expenses project.**

## Setup and activation

1. Sign in to Apps Script as `roaster@blackmarketroasters.com.au` and create a standalone project named **BMC Roast Schedule Intake**.
2. Paste `Code.gs` and the adjacent manifest into this new project. Enable Advanced **Gmail API v1** and **Drive API v3**. The default Apps Script Google Cloud project normally manages their enablement; a manually managed Cloud project must have both APIs enabled too.
3. In Script Properties, optionally set `APPROVED_SENDERS` to comma-separated exact addresses, with a maximum of five. The default is the verified `info@blackmarketroasters.com.au`. Never enter display names, wildcards or an unverified sender. No token is required.
4. Run `previewRoastTallyIntake`. Review the Google permissions and approve only after the intended account, fixed folder and source destinations are clear.
5. Inspect the returned preview. It must verify the Roaster account and writable fixed folder. `ready-to-import` or `ready-to-update-copy` is only a preview: no file, property or trigger has changed. For the already-linked 16 November source, `source-already-in-folder` is expected. If 23 November's email is absent, `awaiting-tally` is expected.
6. Run `runRoastTallyIntake` once for an initial controlled run. Read back the destination file metadata and let the dashboard validate its C18 demand. Do not create a duplicate test copy of an already-linked source just to test permissions.
7. Run `installRoastTallyIntake`. It installs one five-minute trigger, keeps an existing intake trigger and removes only accidental duplicates of that exact handler. Other project triggers are untouched.
8. Verify one later trigger execution and its returned metadata. Continue to use the original shared tally file directly whenever it is already in the folder.

The Apps Script editor does not automatically display a function's returned object. To inspect the safe preview metadata in its execution log, temporarily add and run this owner-only helper:

```javascript
function reviewRoastTallyPreview() {
  console.log(JSON.stringify(previewRoastTallyIntake()));
}
```

For the source state verified on 23 November, expect `status: "awaiting-tally"`, `weekStart: "2026-11-23"`, `currentWeekSourcePresent: false`, and a 16 November item with `status: "source-already-in-folder"`. A newly arrived current-week source will change that result. The helper prints only the bounded metadata returned by the preview, never the message body or workbook values.

No Web app deployment, public endpoint, mail send, original-file edit, permission change or full Drive-write grant is part of this setup.

## Review and recovery

- `awaiting-tally`: no verified current-week source is available yet. Wait for the matching message/source; do not reuse last week.
- `EXISTING_WEEK_SOURCE_PRESERVED`: a weekly source already exists but cannot be proved to be the same imported content/owned copy. Leave it intact and review which source should be used.
- `CONFLICTING_WEEK_ATTACHMENTS`: more than one distinct source claims the week. Review them rather than creating duplicate dated files.
- `UPLOAD_CONFIRMATION_REQUIRED`: a create may or may not have completed. Inspect the fixed folder and private app properties. Do not clear the `TALLY_INTAKE_…` pending property or retry a create until the absence of the intended file is verified. If the file exists with the matching intake hash, the next run deduplicates it automatically.
- `OWNED_COPY_REVIEW_REQUIRED`: an owned copy was moved or its provenance changed. The script will not move it back or overwrite a different file.
- `SOURCE_EXPORT_FAILED`: the source could not be exported from Google Drive; no OAuth token is replayed to a redirect.

Original and imported source sharing is not changed by this script. Local synthetic tests do not grant cloud access or prove that a new Google permission has been approved.

Official references: [Advanced Gmail service](https://developers.google.com/apps-script/advanced/gmail), [Gmail scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive uploads and conversion](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).
