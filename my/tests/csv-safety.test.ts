import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCsv, encodeCsvCell } from '../src/shared/csv.ts';

test('CSV cells neutralize formula prefixes after whitespace and control characters', () => {
  const dangerousValues = [
    '=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1:A2)',
    ' =1+1', '\t=1+1', '\r\n+cmd', '\u0000-1+2', '\u001f@SUM(A1:A2)', '\u200e=1+1',
  ];
  for (const value of dangerousValues) {
    assert.equal(encodeCsvCell(value), `"\'${value.replaceAll('"', '""')}"`, `Unsafe formula value: ${JSON.stringify(value)}`);
  }
  assert.equal(encodeCsvCell('حساب عادي'), '"حساب عادي"');
});

test('CSV encoding preserves BOM, quoting, commas, quotes, and embedded newlines', () => {
  const csv = encodeCsv([
    ['code', 'name', 'notes'],
    ['1000', 'اسم، بفاصلة', 'قال "مرحبًا"'],
    ['2000', 'سطر أول\r\nسطر ثان', 'نص عادي'],
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv, '\uFEFF"code","name","notes"\r\n"1000","اسم، بفاصلة","قال ""مرحبًا"""\r\n"2000","سطر أول\r\nسطر ثان","نص عادي"');
});

test('formula protection composes with CSV quoting and does not strip submitted values', () => {
  assert.equal(encodeCsvCell(' =HYPERLINK("https://example.invalid","open")'), '"\' =HYPERLINK(""https://example.invalid"",""open"")"');
  assert.equal(encodeCsvCell('1,2'), '"1,2"');
  assert.equal(encodeCsvCell('line1\nline2'), '"line1\nline2"');
});
