import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installAccountingSchema } from '../electron/accounting.js';
import { installAssetSchema, registerAssetHandlers } from '../electron/assets.js';
import { ipcHandlers } from './electron-stub.js';

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  installAccountingSchema(database);
  database.prepare('INSERT INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run('E2E-ASSET', 'الأصول', 'asset');
  database.prepare('INSERT INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run('E2E-ACCUM', 'مجمع الإهلاك', 'asset');
  database.prepare('INSERT INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run('E2E-EXP', 'مصروف الإهلاك', 'expense');
  installAssetSchema(database);
  registerAssetHandlers(() => database);
  return database;
}

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = ipcHandlers.get(channel);
  assert.ok(handler, `Missing IPC handler ${channel}`);
  return handler({}, ...args) as T;
}

const groupInput = {
  code: 'VEH', name: 'سيارات', nameEn: 'Vehicles', assetAccountId: 1,
  accumulatedDepreciationAccountId: 2, depreciationExpenseAccountId: 3, notes: 'مجموعة اختبار',
};

test('asset groups and assets persist real account links and validate unique codes', () => {
  const database = fixture();
  const group = invoke<{ id: number; assetCount: number }>('assets:groups:save', groupInput);
  assert.equal(group.assetCount, 0);
  assert.throws(() => invoke('assets:groups:save', { ...groupInput, code: 'veh' }));
  const asset = invoke<{ id: number; groupCode: string; groupName: string }>('assets:save', {
    code: 'CAR-01', name: 'سيارة اختبار', nameEn: 'Test car', groupId: group.id,
    purchaseDate: '2025-01-01', purchaseValue: '12100', salvageValue: '100', usefulLifeYears: 1,
    depreciationMethod: 'straight-line', assetAccountId: 1, accumulatedDepreciationAccountId: 2,
    depreciationExpenseAccountId: 3, status: 'active', notes: 'أصل تجريبي',
  });
  assert.deepEqual([asset.groupCode, asset.groupName], ['VEH', 'سيارات']);
  const reopened = invoke<{ id: number; purchaseValue: string }[]>('assets:list', 'CAR-01');
  assert.equal(reopened[0].id, asset.id);
  assert.equal(reopened[0].purchaseValue, '12100');
  assert.equal(invoke<{ assetCount: number }[]>('assets:groups:list')[0].assetCount, 1);
  assert.throws(() => invoke('assets:groups:delete', group.id), /FOREIGN KEY constraint failed/);
  database.close();
});

test('straight-line depreciation posts one balanced journal transaction and rejects repeats or overlap', () => {
  const database = fixture();
  const group = invoke<{ id: number }>('assets:groups:save', groupInput);
  const asset = invoke<{ id: number }>('assets:save', {
    code: 'CAR-POST', name: 'سيارة مرحّلة', nameEn: '', groupId: group.id,
    purchaseDate: '2025-01-01', purchaseValue: '12100', salvageValue: '100', usefulLifeYears: 1,
    depreciationMethod: 'straight-line', assetAccountId: 1, accumulatedDepreciationAccountId: 2,
    depreciationExpenseAccountId: 3, status: 'active', notes: '',
  });
  const range = { from: '2025-01-01', to: '2025-12-31' };
  const report = invoke<{ total: string; dueCount: number }>('assets:depreciation:get', range);
  assert.deepEqual([report.total, report.dueCount], ['12000', 1]);

  const run = invoke<{ id: number; total: string; journalEntryId: number; assetCount: number }>('assets:depreciation:post', range);
  assert.deepEqual([run.total, run.assetCount], ['12000', 1]);
  const journal = database.prepare('SELECT status, entry_date FROM journal_entries WHERE id = ?').get(run.journalEntryId) as { status: string; entry_date: string };
  assert.equal(journal.status, 'posted');
  assert.equal(journal.entry_date, range.to);
  const lines = (database.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY line_order').all(run.journalEntryId) as Array<{ account_id: number; debit: string; credit: string }>).map((line) => ({ ...line }));
  assert.deepEqual(lines, [{ account_id: 3, debit: '12000', credit: '0' }, { account_id: 2, debit: '0', credit: '12000' }]);
  assert.throws(() => invoke('assets:depreciation:post', range), /تم ترحيل هذه الفترة/);
  assert.throws(() => invoke('assets:depreciation:post', { from: '2025-06-01', to: '2025-12-31' }), /متداخل/);
  assert.throws(() => invoke('assets:save', { id: asset.id, code: 'CAR-POST', name: 'تعديل', nameEn: '', groupId: group.id,
    purchaseDate: '2025-01-01', purchaseValue: '12100', salvageValue: '100', usefulLifeYears: 1, depreciationMethod: 'straight-line',
    assetAccountId: 1, accumulatedDepreciationAccountId: 2, depreciationExpenseAccountId: 3, status: 'active', notes: '' }), /سبق ترحيل إهلاكه/);
  assert.throws(() => invoke('assets:delete', asset.id), /إهلاك مرحّل/);
  const after = invoke<{ postedTotal: string; dueCount: number; runs: Array<{ journalEntryId: number }> }>('assets:depreciation:get', range);
  assert.deepEqual([after.postedTotal, after.dueCount, after.runs.length, after.runs[0].journalEntryId], ['12000', 0, 1, run.journalEntryId]);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 1);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM asset_depreciation_runs').get() as { count: number }).count), 1);
  database.close();
});