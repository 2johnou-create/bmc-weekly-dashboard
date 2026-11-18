/** Read-only Warehouse expenses bridge. The spreadsheet and range are fixed. */
const EXPENSES_SPREADSHEET = '1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik';
const EXPENSES_RANGE = "'Sheet1'!A1:W36";

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

/** Run once in the editor to review the read-only Google Sheets permission. */
function authorizeBridge() {
  const expenses = readExpenses_();
  return { sheetName: expenses.sheetName, range: expenses.range };
}
