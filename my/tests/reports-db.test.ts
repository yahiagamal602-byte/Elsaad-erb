import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installAccountingSchema } from '../electron/accounting.js';
import { runReport } from '../electron/reports.js';

test('trial balance shows cumulative net account balances through the end date', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  installAccountingSchema(database);
  database.prepare('INSERT INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run('1000', 'النقدية', 'asset');
  database.prepare('INSERT INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run('3000', 'رأس المال', 'equity');

  const insertEntry = database.prepare('INSERT INTO journal_entries (reference, entry_date, description) VALUES (?, ?, ?)');
  const insertLine = database.prepare('INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)');
  const postBalanced = (date: string, value: string): void => {
    const entry = insertEntry.run(date, date, 'قيد ميزان مراجعة');
    const entryId = Number(entry.lastInsertRowid);
    insertLine.run(entryId, 1, 1, value, '0');
    insertLine.run(entryId, 2, 2, '0', value);
  };
  postBalanced('2025-12-31', '1000');
  postBalanced('2026-01-15', '250');
  postBalanced('2026-02-01', '500');

  const result = runReport(database, {
    key: 'trial-balance',
    filters: { from: '', to: '2026-01-31' },
  });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => [row.code, row.debit, row.credit, row.balance]), [
    ['1000', '1250', '0', '1250'],
    ['3000', '0', '1250', '-1250'],
  ]);
  assert.deepEqual(result.totals.map((total) => [total.label, total.value]), [
    ['إجمالي المدين', '1250'], ['إجمالي الدائن', '1250'], ['الفرق', '0'],
  ]);
  assert.match(result.note, /حتى تاريخ النهاية/);
  database.close();
});