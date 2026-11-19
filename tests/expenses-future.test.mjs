import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseExpenses, validateExpenseReading, readExpenses } from '../worker/expenses.js';

function reading() {
  const values = Array.from({ length: 36 }, () => Array(130).fill(''));
  const numericValues = structuredClone(values);
  values[0][17] = '16/11/2026';
  values[0][23] = '28/12/2026';
  values[0][24] = '4/1/2027';
  values[0][26] = '1/2/2027';
  values[0][129] = '3/1/2028';
  values[4][1] = 'Packaging';
  for (const [column, amount] of [[17, 20], [23, 30], [24, 40], [26, 50], [129, 60]]) {
    values[4][column] = '$' + amount.toFixed(2);
    values[35][column] = '$' + amount.toFixed(2);
    numericValues[4][column] = amount;
    numericValues[35][column] = amount;
  }
  return { sheetName: 'Sheet1', range: 'A1:DZ36', values, numericValues, asOf: '2028-01-05T01:00:00.000Z' };
}

test('appended Monday columns cross the year boundary and produce correct source cells after Z', () => {
  const source = reading();
  for (const [week, value, cell] of [
    ['2026-11-16', 20, 'R36'], ['2026-12-28', 30, 'X36'],
    ['2027-01-04', 40, 'Y36'], ['2027-02-01', 50, 'AA36'], ['2028-01-03', 60, 'DZ36'],
  ]) {
    const result = parseExpenses(source, week);
    assert.equal(result.status, 'live');
    assert.equal(result.value, value);
    assert.equal(result.sourceCell, cell);
  }
  source.values[0][24] = '4/1';
  assert.equal(parseExpenses(source, '2027-01-04').status, 'unavailable', 'mixed-year source cannot establish a yearless January header');
});

test('new readings retain their bounded range while legacy snapshots stay compatible', () => {
  const source = reading();
  const current = validateExpenseReading({ ...source, weekStart: '2028-01-03' }, new Date(source.asOf));
  assert.equal(current.range, 'A1:DZ36');
  const withoutRange = structuredClone(source);
  delete withoutRange.range;
  assert.equal(validateExpenseReading({ ...withoutRange, weekStart: '2028-01-03' }, new Date(source.asOf)).range, 'A1:DZ36');
  const legacy = { ...source, range: 'A1:W36', values: source.values.map(row => row.slice(0, 23)), numericValues: source.numericValues.map(row => row.slice(0, 23)) };
  assert.equal(validateExpenseReading({ ...legacy, weekStart: '2026-11-16' }, new Date(source.asOf)).range, 'A1:W36');
  assert.equal(parseExpenses(legacy, '2026-11-16').value, 20);
  assert.equal(parseExpenses(legacy, '2026-12-28').status, 'unavailable');
  assert.throws(() => validateExpenseReading({ ...source, range: 'A1:W36', weekStart: '2028-01-03' }, new Date(source.asOf)));
  source.values[0].push('10/1/2028');
  assert.equal(parseExpenses(source, '2028-01-03').status, 'unavailable', 'columns beyond DZ must not be silently truncated');
});

test('a later-week refresh reads a changed amount without retaining the preceding week total', async () => {
  const source = reading();
  let reads = 0;
  const env = { GOOGLE_BRIDGE_URL: 'https://script.google.com/macros/s/synthetic_future_expenses_bridge_identifier/exec', GOOGLE_BRIDGE_TOKEN: 'synthetic-future-expenses-token-only-1234567890' };
  const fetcher = async () => {
    reads++;
    const value = structuredClone(source);
    if (reads === 2) value.numericValues[4][26] = value.numericValues[35][26] = 75;
    return Response.json(value);
  };
  const initial = await readExpenses({ env, week: '2027-02-01', now: new Date(source.asOf), fetcher });
  const updated = await readExpenses({ env, week: '2027-02-01', now: new Date(source.asOf), fetcher, fresh: true });
  assert.equal(initial.value, 50);
  assert.equal(updated.value, 75);
  assert.equal(updated.sourceCell, 'AA36');
  assert.equal(reads, 2);
});

test('Apps Script reads formatted headers and effective values from one bounded Sheets snapshot', async () => {
  const script = await readFile(new URL('../integrations/warehouse-bridge/Code.gs', import.meta.url), 'utf8');
  const calls = [];
  const rows = Array.from({ length: 36 }, () => ({ values: [] }));
  rows[0].values[26] = { formattedValue: '1/2/2027', effectiveValue: { numberValue: 99999 } };
  rows[4].values[1] = { formattedValue: 'Packaging', effectiveValue: { stringValue: 'Packaging' } };
  rows[4].values[26] = { formattedValue: '$0.00', effectiveValue: { numberValue: 0 } };
  rows[35].values[26] = { formattedValue: '$0.00', effectiveValue: { numberValue: 0 } };
  const context = vm.createContext({ Sheets: { Spreadsheets: { get(id, options) {
    calls.push({ id, options });
    return { sheets: [{ properties: { title: 'Sheet1' }, data: [{ rowData: rows }] }] };
  }, Values: { batchGet() { assert.fail('A second values read could mix a different header/amount snapshot'); } } } } });
  vm.runInContext(script, context);
  const source = JSON.parse(JSON.stringify(context.readExpenses_()));
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0].options.ranges), ["'Sheet1'!A1:DZ36"]);
  assert.match(calls[0].options.fields, /formattedValue,effectiveValue/);
  assert.equal(source.range, 'A1:DZ36');
  assert.equal(source.values.length, 36);
  assert.ok(source.values.every(row => row.length === 130));
  assert.equal(source.values[0][26], '1/2/2027');
  assert.equal(source.numericValues[0][26], 99999);
  assert.equal(source.numericValues[4][26], 0);
  assert.equal(source.numericValues[4][25], '');
  const result = parseExpenses(source, '2027-02-01');
  assert.equal(result.value, 0);
  assert.equal(result.sourceCell, 'AA36');
  rows[4].values[26] = { formattedValue: '#REF!', effectiveValue: { errorValue: { type: 'REF' } } };
  const errored = JSON.parse(JSON.stringify(context.readExpenses_()));
  assert.equal(errored.numericValues[4][26], '#REF!');
  assert.equal(parseExpenses(errored, '2027-02-01').status, 'unavailable');
  const manifest = JSON.parse(await readFile(new URL('../integrations/warehouse-bridge/appsscript.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
});
