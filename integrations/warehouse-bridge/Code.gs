/** Read-only Warehouse expenses bridge. The spreadsheet and bounded range are fixed. */
const EXPENSES_SPREADSHEET = '1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik';
const EXPENSES_RANGE = "'Sheet1'!A1:DZ36";
const EXPENSES_COLUMNS = 130;

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

function expenseCellValue_(cell) {
  const value = cell && cell.effectiveValue;
  if (!value) return '';
  if (Object.prototype.hasOwnProperty.call(value, 'numberValue')) return value.numberValue;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'boolValue')) return value.boolValue ? 'TRUE' : 'FALSE';
  // A source formula error must remain an error, never a missing/zero amount.
  if (value.errorValue) return cell.formattedValue || '#' + (value.errorValue.type || 'ERROR');
  return '';
}

function readExpenses_() {
  // One API response supplies displayed date headers and effective amounts from
  // the same source snapshot. Copying/appending weekly columns cannot mix two reads.
  const response = Sheets.Spreadsheets.get(EXPENSES_SPREADSHEET, {
    ranges: [EXPENSES_RANGE],
    fields: 'sheets(properties(title),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue))))',
  });
  const sheets = response.sheets || [];
  if (sheets.length !== 1 || !sheets[0].properties || sheets[0].properties.title !== 'Sheet1') throw new Error('The expense source is invalid.');
  const data = sheets[0].data || [];
  if (data.length !== 1 || (data[0].startRow || 0) !== 0 || (data[0].startColumn || 0) !== 0) throw new Error('The expense range is invalid.');
  const rows = data[0].rowData || [];
  if (rows.length > 36 || rows.some(function (row) { return (row.values || []).length > EXPENSES_COLUMNS; })) throw new Error('The expense range is too large.');
  const numericValues = Array.from({ length: 36 }, function (_, row) {
    return Array.from({ length: EXPENSES_COLUMNS }, function (_, column) {
      return expenseCellValue_(rows[row] && rows[row].values && rows[row].values[column]);
    });
  });
  const values = Array.from({ length: 36 }, function (_, row) {
    return Array.from({ length: EXPENSES_COLUMNS }, function (_, column) {
      const cell = rows[row] && rows[row].values && rows[row].values[column];
      return cell && typeof cell.formattedValue === 'string' ? cell.formattedValue : numericValues[row][column];
    });
  });
  return {
    ok: true,
    sheetName: 'Sheet1',
    range: 'A1:DZ36',
    values: values,
    numericValues: numericValues,
    asOf: new Date().toISOString(),
  };
}

/** Run once in the editor to review the read-only Google Sheets permission. */
function authorizeBridge() {
  const expenses = readExpenses_();
  return { sheetName: expenses.sheetName, range: expenses.range };
}
