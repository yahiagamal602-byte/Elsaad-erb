import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerAccountingHandlers, installAccountingSchema } from '../electron/accounting.js';
import { firstOpenAccountingDate } from '../electron/posting.js';
import { ipcHandlers } from './electron-stub.js';

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  installAccountingSchema(database);
  registerAccountingHandlers(() => database);
  return database;
}

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = ipcHandlers.get(channel);
  assert.ok(handler, `Missing IPC handler ${channel}`);
  return handler({}, ...args) as T;
}

const account = (code: string, name: string, type: 'asset' | 'revenue' | 'expense', parentId: number | null = null, postable = true) => ({
  code, name, nameEn: '', type, parentId, postable, notes: '',
});

const center = (code: string, name: string, parentId: number | null = null, postable = true) => ({
  code, name, nameEn: '', parentId, type: 'تشغيلي', postable, notes: '',
});

test('account and cost-center hierarchies prevent duplicate codes, cycles, and aggregate posting', () => {
  const database = fixture();
  const root = invoke<{ id: number; postable: boolean }>('accounts:save', account('1000', 'الأصول', 'asset'));
  const child = invoke<{ id: number }>('accounts:save', account('1100', 'النقدية', 'asset', root.id));
  const editedAccount = invoke<{ id: number; name: string }>('accounts:save', { ...account('1100', 'الصندوق المعدل', 'asset', root.id), id: child.id });
  assert.equal(editedAccount.id, child.id);
  assert.equal(editedAccount.name, 'الصندوق المعدل');
  assert.equal(invoke<{ postable: boolean }[]>('accounts:list').find((item) => item.id === root.id)?.postable, false);
  assert.throws(() => invoke('accounts:save', account('1100', 'مكرر', 'asset')), /مستخدم بالفعل/);
  assert.throws(() => invoke('accounts:save', { ...account('1000', 'دورة', 'asset', child.id), id: root.id }), /علاقة دائرية/);
  assert.throws(() => invoke('accounts:save', { ...account('1000', 'ترحيل تجميعي', 'asset', null, true), id: root.id }), /حسابات فرعية/);

  const centerRoot = invoke<{ id: number }>('cost-centers:save', center('CC-0', 'المشاريع'));
  const centerLeaf = invoke<{ id: number }>('cost-centers:save', center('CC-1', 'موقع 1', centerRoot.id));
  const editedCenter = invoke<{ id: number; name: string }>('cost-centers:save', { ...center('CC-1', 'موقع معدل', centerRoot.id), id: centerLeaf.id });
  assert.equal(editedCenter.id, centerLeaf.id);
  assert.equal(editedCenter.name, 'موقع معدل');
  assert.equal(invoke<{ postable: boolean }[]>('cost-centers:list').find((item) => item.id === centerRoot.id)?.postable, false);
  assert.throws(() => invoke('cost-centers:save', center('cc-1', 'مكرر')), /مستخدم بالفعل/);
  assert.throws(() => invoke('cost-centers:save', { ...center('CC-0', 'دورة', centerLeaf.id), id: centerRoot.id }), /علاقة دائرية/);
  assert.throws(() => invoke('cost-centers:delete', centerRoot.id), /فرعية/);
  database.close();
});

test('posted journals save atomically, link real cost centers, search, reopen, and deduplicate retries', () => {
  const database = fixture();
  const expense = invoke<{ id: number }>('accounts:save', account('5000', 'مصروف', 'expense'));
  const revenue = invoke<{ id: number }>('accounts:save', account('4000', 'إيراد', 'revenue'));
  const costCenter = invoke<{ id: number }>('cost-centers:save', center('CC-POST', 'مركز مرحل'));
  const payload = {
    requestKey: 'journal-request-00001', date: '2026-10-20', reference: 'REF-01', description: 'قيد اختبار',
    lines: [
      { accountId: expense.id, description: 'مصروف تجريبي', debit: '100.25', credit: '0', costCenterId: costCenter.id },
      { accountId: revenue.id, description: 'إيراد تجريبي', debit: '0', credit: '100.25', costCenterId: null },
    ],
  };
  const posted = invoke<{ id: number; totalDebit: string; totalCredit: string; lines: Array<{ costCenterId: number | null }> }>('journals:post', payload);
  const retried = invoke<{ id: number }>('journals:post', payload);
  assert.equal(retried.id, posted.id);
  assert.equal(posted.totalDebit, '100.25');
  assert.equal(posted.totalCredit, '100.25');
  assert.equal(posted.lines[0].costCenterId, costCenter.id);
  assert.equal(invoke<unknown[]>('journals:list', 'REF-01').length, 1);
  assert.equal(invoke<{ lines: unknown[] }>('journals:get', posted.id).lines.length, 2);
  assert.throws(() => invoke('journals:post', { ...payload, requestKey: 'bad-balance-0001', lines: [payload.lines[0], { ...payload.lines[1], credit: '100.24' }] }), /غير متوازن/);
  assert.throws(() => invoke('journals:post', { ...payload, requestKey: 'aggregate-post-0001', lines: [{ ...payload.lines[0], accountId: 9999 }, payload.lines[1]] }), /غير موجود/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 1);
  assert.throws(() => invoke('accounts:delete', expense.id), /قيود/);
  assert.throws(() => invoke('cost-centers:delete', costCenter.id), /قيود/);
  const disabledAccount = invoke<{ id: number; postable: boolean }>('accounts:save', { ...account('5000', 'مصروف', 'expense', null, false), id: expense.id });
  const disabledCenter = invoke<{ id: number; postable: boolean }>('cost-centers:save', { ...center('CC-POST', 'مركز مرحل', null, false), id: costCenter.id });
  assert.equal(disabledAccount.postable, false);
  assert.equal(disabledCenter.postable, false);
  database.close();
});

test('budgets persist linked details atomically, calculate confirmed net, validate dates, and never post journals', () => {
  const database = fixture();
  const sales = invoke<{ id: number }>('accounts:save', account('4100', 'مبيعات', 'revenue'));
  const purchases = invoke<{ id: number }>('accounts:save', account('5100', 'مشتريات', 'expense'));
  const expenses = invoke<{ id: number }>('accounts:save', account('5200', 'مصروفات', 'expense'));
  const costCenter = invoke<{ id: number }>('cost-centers:save', center('CC-BUD', 'مركز الموازنة'));
  const saved = invoke<{ id: number; number: string; sales: string; cashPurchases: string; cashExpenses: string; net: string; lines: unknown[] }>('budgets:save', {
    from: '2026-01-01', to: '2026-12-31', costCenterId: costCenter.id, notes: 'موازنة سنوية',
    lines: [
      { accountId: sales.id, costCenterId: costCenter.id, category: 'sales', amount: '1000', notes: '' },
      { accountId: purchases.id, costCenterId: costCenter.id, category: 'cash-purchases', amount: '250', notes: '' },
      { accountId: expenses.id, costCenterId: costCenter.id, category: 'cash-expenses', amount: '125', notes: '' },
    ],
  });

  assert.match(saved.number, /^BUD-2026-/);
  assert.deepEqual([saved.sales, saved.cashPurchases, saved.cashExpenses, saved.net], ['1000', '250', '125', '625']);
  assert.equal(saved.lines.length, 3);
  assert.equal(invoke<{ id: number }[]>('budgets:list', 'سنوية')[0].id, saved.id);
  assert.equal(invoke<{ id: number }>('budgets:get', saved.id).id, saved.id);
  const edited = invoke<{ id: number; sales: string; net: string; lines: unknown[] }>('budgets:save', {
    id: saved.id, from: '2026-02-01', to: '2026-06-30', costCenterId: costCenter.id, notes: 'تعديل',
    lines: [
      { accountId: sales.id, costCenterId: costCenter.id, category: 'sales', amount: '100', notes: '' },
      { accountId: expenses.id, costCenterId: costCenter.id, category: 'cash-expenses', amount: '200', notes: '' },
    ],
  });
  assert.equal(edited.id, saved.id);
  assert.equal(edited.sales, '100');
  assert.equal(edited.net, '-100');
  assert.equal(edited.lines.length, 2);
  assert.throws(() => invoke('budgets:save', {
    from: '2026-12-31', to: '2026-01-01', costCenterId: null, notes: '',
    lines: [{ accountId: sales.id, costCenterId: null, category: 'sales', amount: '10', notes: '' }],
  }), /يسبق بدايتها/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 0);
  assert.throws(() => invoke('cost-centers:delete', costCenter.id), /موازنات/);
  assert.equal(invoke<boolean>('budgets:delete', saved.id), true);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM budget_lines').get() as { count: number }).count), 0);
  database.close();
});

test('closed accounting periods reject postings, cannot overlap, and reversals resolve to the first open date', () => {
  const database = fixture();
  const expense = invoke<{ id: number }>('accounts:save', account('5010', 'مصروف فترة', 'expense'));
  const revenue = invoke<{ id: number }>('accounts:save', account('4010', 'إيراد فترة', 'revenue'));
  invoke('accounting-periods:close', { from: '2026-01-01', to: '2026-01-31' });
  invoke('accounting-periods:close', { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(firstOpenAccountingDate(database, '2026-01-15'), '2026-03-01');
  assert.equal(firstOpenAccountingDate(database, '2026-02-28'), '2026-03-01');
  assert.equal(firstOpenAccountingDate(database, '2026-03-01'), '2026-03-01');
  assert.throws(() => invoke('accounting-periods:close', { from: '2026-01-20', to: '2026-02-05' }), /تتداخل/);
  assert.throws(() => invoke('accounting-periods:close', { from: '2026-03-02', to: '2026-03-01' }), /فترة صحيحة/);
  assert.throws(() => invoke('journals:post', {
    requestKey: 'closed-period-entry-01', date: '2026-02-15', reference: 'CLOSED',
    description: 'قيد داخل فترة مغلقة',
    lines: [
      { accountId: expense.id, description: '', debit: '10', credit: '0', costCenterId: null },
      { accountId: revenue.id, description: '', debit: '0', credit: '10', costCenterId: null },
    ],
  }), /الفترة المحاسبية مغلقة/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as Row).count), 0);
  assert.equal(invoke<{ id: number }[]>('accounting-periods:list').length, 2);
  database.close();
});

test('additive accounting migration preserves legacy accounts and posted journal lines', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      account_type TEXT NOT NULL, parent_id INTEGER REFERENCES accounts(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE journal_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL DEFAULT '', entry_date TEXT NOT NULL,
      description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'posted' CHECK (status = 'posted'), created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE journal_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
      line_order INTEGER NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id), debit TEXT NOT NULL, credit TEXT NOT NULL,
      UNIQUE(entry_id, line_order));
    INSERT INTO accounts (code, name, account_type) VALUES ('OLD-1', 'حساب قديم', 'asset');
    INSERT INTO journal_entries (reference, entry_date, description) VALUES ('OLD-REF', '2026-01-01', 'قيد قديم');
    INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit) VALUES (1, 1, 1, '1', '0');`);
  installAccountingSchema(database);
  const oldAccount = database.prepare('SELECT name, name_en, postable FROM accounts WHERE id = 1').get() as { name: string; name_en: string; postable: number };
  const oldLine = database.prepare('SELECT debit, description, cost_center_id FROM journal_lines WHERE id = 1').get() as { debit: string; description: string; cost_center_id: number | null };
  assert.equal(oldAccount.name, 'حساب قديم');
  assert.equal(oldAccount.name_en, '');
  assert.equal(oldAccount.postable, 1);
  assert.equal(oldLine.debit, '1');
  assert.equal(oldLine.description, '');
  assert.equal(oldLine.cost_center_id, null);
  database.close();
});
