/** Warehouse bridge. The recipient and spreadsheet are fixed in source. */
const BRIDGE_RECIPIENT = 'roaster@blackmarketroasters.com.au';
const EXPENSES_SPREADSHEET = '1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik';
const EXPENSES_RANGE = "'Sheet1'!A1:W36";
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function bridgeJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function bridgeHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function bridgeTokenMatches_(given, expected) {
  if (typeof given !== 'string' || given.length < 32 || given.length > 256 ||
      typeof expected !== 'string' || expected.length < 32 || expected.length > 256) return false;
  const left = bridgeHash_(given), right = bridgeHash_(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function bridgeFields_(input, allowed) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).every(function (key) { return allowed.includes(key); });
}

function doGet() {
  return bridgeJson_({ ok: true, service: 'warehouse-bridge', authenticated: false });
}

function doPost(event) {
  try {
    const content = event && event.postData;
    if (!content || typeof content.contents !== 'string' || content.contents.length > 20000 ||
        !/^application\/json(?:;|$)/i.test(content.type || '')) {
      return bridgeJson_({ ok: false, error: 'Invalid request.' });
    }
    const input = JSON.parse(content.contents);
    const properties = PropertiesService.getScriptProperties();
    if (!input || !bridgeTokenMatches_(input.token, properties.getProperty('BRIDGE_TOKEN'))) {
      return bridgeJson_({ ok: false, error: 'Unauthorized.' });
    }
    if (input.action === 'expenses' && bridgeFields_(input, ['token', 'action'])) {
      return bridgeJson_(readExpenses_());
    }
    if (input.action === 'message' && bridgeFields_(input, ['token', 'action', 'id', 'message'])) {
      return bridgeJson_(sendWarehouseMessage_(input, properties));
    }
    return bridgeJson_({ ok: false, error: 'Unsupported request.' });
  } catch (_) {
    return bridgeJson_({ ok: false, error: 'The bridge could not complete this request.' });
  }
}

function expenseGrid_(renderOption) {
  const response = Sheets.Spreadsheets.Values.batchGet(EXPENSES_SPREADSHEET, {
    ranges: [EXPENSES_RANGE],
    majorDimension: 'ROWS',
    valueRenderOption: renderOption,
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const grid = response.valueRanges && response.valueRanges[0] && response.valueRanges[0].values || [];
  // Fix the response shape to the reviewed A1:W36 range, including blank cells.
  return Array.from({ length: 36 }, function (_, row) {
    return Array.from({ length: 23 }, function (_, column) {
      const value = grid[row] && grid[row][column];
      return value === undefined || value === null ? '' : value;
    });
  });
}

function readExpenses_() {
  return {
    ok: true,
    sheetName: 'Sheet1',
    range: 'A1:W36',
    values: expenseGrid_('FORMATTED_VALUE'),
    numericValues: expenseGrid_('UNFORMATTED_VALUE'),
    asOf: new Date().toISOString(),
  };
}

function sendWarehouseMessage_(input, properties) {
  if (typeof input.id !== 'string' || !MESSAGE_ID.test(input.id) ||
      typeof input.message !== 'string' || MESSAGE_CONTROLS.test(input.message)) {
    return { ok: false, status: 'unavailable', error: 'Invalid message.' };
  }
  const id = input.id.toLowerCase();
  const message = input.message.replace(/\r\n?/g, '\n').trim();
  if (!message || message.length > 500) return { ok: false, id: id, status: 'unavailable', error: 'Invalid message.' };
  const digest = bridgeHash_(message);
  const key = 'message_' + id;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, id: id, status: 'queued' };
  try {
    const previous = properties.getProperty(key);
    if (previous) {
      const receipt = JSON.parse(previous);
      if (receipt.digest !== digest) return { ok: false, id: id, status: 'unavailable', error: 'Message reference conflict.' };
      return { ok: true, id: id, status: receipt.status === 'sent' ? 'sent' : 'queued' };
    }
    if (MailApp.getRemainingDailyQuota() < 1) return { ok: true, id: id, status: 'unavailable' };

    // Reserve before touching MailApp. An interrupted/uncertain send remains
    // queued. It is never resent automatically by a retry with this UUID.
    const receipt = { digest: digest, status: 'queued', createdAt: Date.now() };
    properties.setProperty(key, JSON.stringify(receipt));
    try {
      MailApp.sendEmail({
        to: BRIDGE_RECIPIENT,
        subject: 'Warehouse message for John',
        body: 'Message from the Black Market Coffee Warehouse dashboard\n\n' + message + '\n\nMessage reference: ' + id,
        name: 'Black Market Coffee Warehouse',
      });
    } catch (_) {
      return { ok: true, id: id, status: 'queued' };
    }
    receipt.status = 'sent';
    try { properties.setProperty(key, JSON.stringify(receipt)); } catch (_) {
      // The earlier reservation still prevents a duplicate even if receipt
      // storage is unavailable after MailApp has confirmed the send.
    }
    return { ok: true, id: id, status: 'sent' };
  } finally {
    lock.releaseLock();
  }
}

/** Run once in the editor to review Google permissions. This sends no email. */
function authorizeBridge() {
  const expenses = readExpenses_();
  return {
    sheetName: expenses.sheetName,
    range: expenses.range,
    recipient: BRIDGE_RECIPIENT,
    remainingDailyEmailRecipients: MailApp.getRemainingDailyQuota(),
  };
}
