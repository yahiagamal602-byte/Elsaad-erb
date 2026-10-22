import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installAccountingSchema, registerAccountingHandlers } from '../electron/accounting.js';
import { installSalesMasterSchema } from '../electron/sales-masters.js';
import { installPurchaseSchema } from '../electron/purchases.js';
import { installTreasurySchema } from '../electron/treasury.js';
import { installFinancialDocumentSchema, registerFinancialDocumentHandlers } from '../electron/financial-documents.js';
import { ipcHandlers } from './electron-stub.js';

type Row = Record<string, unknown>;

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  installAccountingSchema(database);
  installSalesMasterSchema(database);
  installPurchaseSchema(database);
  installTreasurySchema(database);
  database.exec('CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, status TEXT DEFAULT \'new\')');
  installFinancialDocumentSchema(database);
  registerAccountingHandlers(() => database);
  registerFinancialDocumentHandlers(() => database);
  return database;
}

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = ipcHandlers.get(channel);
  assert.ok(handler, `Missing IPC handler ${channel}`);
  return handler({}, ...args) as T;
}

function account(code: string, name: string, type: 'asset' | 'liability' | 'expense'): { id: number } {
  return invoke<{ id: number }>('accounts:save', { code, name, nameEn: '', type, parentId: null, postable: true, notes: '' });
}

function count(database: DatabaseSync, sql: string): number {
  return Number((database.prepare(sql).get() as Row).count);
}

test('customer and supplier vouchers save, search, reopen, post once, and stay immutable after posting', () => {
  const database = fixture();
  const cashAccount = account('1100', 'الصندوق', 'asset');
  const customerAccount = account('1200', 'عملاء', 'asset');
  const supplierAccount = account('2100', 'موردون', 'liability');
  database.prepare(`INSERT INTO treasury_cash_boxes (code, name, account_id, currency, opening_balance, opening_date, status)
    VALUES ('CB-T', 'خزينة اختبار', ?, 'EGP', '0', '2026-01-01', 'active')`).run(cashAccount.id);
  const cashBoxId = Number((database.prepare('SELECT id FROM treasury_cash_boxes').get() as Row).id);
  database.prepare(`INSERT INTO customers (code, name, account_id, status) VALUES ('C-T', 'عميل اختبار', ?, 'active')`).run(customerAccount.id);
  const customerId = Number((database.prepare('SELECT id FROM customers').get() as Row).id);
  database.prepare(`INSERT INTO suppliers (code, name, account_id, status) VALUES ('S-T', 'مورد اختبار', ?, 'active')`).run(supplierAccount.id);
  const supplierId = Number((database.prepare('SELECT id FROM suppliers').get() as Row).id);

  const customerVoucher = invoke<{ id: number; number: string; status: string; partyName: string }>('financial-vouchers:save', {
    partyKind: 'customer', date: '2026-10-21', partyId: customerId, amount: '150.50', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, costCenterId: null, projectId: null, reference: 'CR-REF-1', notes: '',
  });
  assert.match(customerVoucher.number, /^CR-\d{7}$/);
  assert.equal(customerVoucher.status, 'draft');
  assert.equal(customerVoucher.partyName, 'عميل اختبار');
  assert.equal(invoke<unknown[]>('financial-vouchers:list', 'customer').length, 1);
  assert.equal(invoke<unknown[]>('financial-vouchers:list', 'customer', 'CR-REF-1').length, 1);
  assert.equal(invoke<unknown[]>('financial-vouchers:list', 'customer', customerVoucher.number).length, 1);
  assert.equal(invoke<unknown[]>('financial-vouchers:list', 'supplier').length, 0);

  const postedCustomer = invoke<{ status: string; journalEntryId: number | null }>('financial-vouchers:approve', { id: customerVoucher.id, partyKind: 'customer' });
  assert.equal(postedCustomer.status, 'posted');
  assert.ok(postedCustomer.journalEntryId);
  const rePostedCustomer = invoke<{ journalEntryId: number | null }>('financial-vouchers:approve', { id: customerVoucher.id, partyKind: 'customer' });
  assert.equal(rePostedCustomer.journalEntryId, postedCustomer.journalEntryId);
  assert.equal(count(database, 'SELECT COUNT(*) AS count FROM journal_entries'), 1);
  const journalLines = database.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY line_order')
    .all(postedCustomer.journalEntryId) as Row[];
  assert.equal(journalLines.length, 2);
  assert.deepEqual(
    journalLines.map((line) => ({ account: Number(line.account_id), debit: String(line.debit), credit: String(line.credit) })),
    [
      { account: cashAccount.id, debit: '150.5', credit: '0' },
      { account: customerAccount.id, debit: '0', credit: '150.5' },
    ],
  );
  assert.throws(() => invoke('financial-vouchers:save', {
    id: customerVoucher.id, partyKind: 'customer', date: '2026-10-21', partyId: customerId, amount: '200',
    paymentMethod: 'cash', cashBoxId, bankAccountId: null, costCenterId: null, projectId: null, reference: '', notes: '',
  }), /مرحّل/);
  assert.throws(() => invoke('financial-vouchers:delete', { id: customerVoucher.id, partyKind: 'customer' }), /المرحّل/);
  assert.throws(() => invoke('financial-vouchers:save', {
    partyKind: 'customer', date: '2026-10-21', partyId: customerId, amount: '0', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, costCenterId: null, projectId: null, reference: '', notes: '',
  }), /أكبر من صفر/);

  const supplierVoucher = invoke<{ id: number; number: string }>('financial-vouchers:save', {
    partyKind: 'supplier', date: '2026-10-22', partyId: supplierId, amount: '75', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, costCenterId: null, projectId: null, reference: 'SP-REF-1', notes: '',
  });
  assert.match(supplierVoucher.number, /^SP-\d{7}$/);
  assert.notEqual(supplierVoucher.number, customerVoucher.number);
  const postedSupplier = invoke<{ status: string; journalEntryId: number | null }>('financial-vouchers:approve', { id: supplierVoucher.id, partyKind: 'supplier' });
  assert.equal(postedSupplier.status, 'posted');
  assert.equal(count(database, 'SELECT COUNT(*) AS count FROM journal_entries'), 2);
  assert.equal(invoke<unknown[]>('financial-vouchers:list', 'supplier', 'SP-REF-1').length, 1);
  const supplierLines = database.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY line_order')
    .all(postedSupplier.journalEntryId) as Row[];
  assert.deepEqual(
    supplierLines.map((line) => ({ account: Number(line.account_id), debit: String(line.debit), credit: String(line.credit) })),
    [
      { account: supplierAccount.id, debit: '75', credit: '0' },
      { account: cashAccount.id, debit: '0', credit: '75' },
    ],
  );
  database.close();
});

test('expenses keep total/paid/remaining accurate, post a single journal, and reject edits after posting', () => {
  const database = fixture();
  const cashAccount = account('1100', 'الصندوق', 'asset');
  const expenseAccount = account('5000', 'مصروفات تشغيلية', 'expense');
  const payableAccount = account('2200', 'دائنون', 'liability');
  database.prepare(`INSERT INTO treasury_cash_boxes (code, name, account_id, currency, opening_balance, opening_date, status)
    VALUES ('CB-E', 'خزينة مصروفات', ?, 'EGP', '0', '2026-01-01', 'active')`).run(cashAccount.id);
  const cashBoxId = Number((database.prepare('SELECT id FROM treasury_cash_boxes').get() as Row).id);

  const saved = invoke<{
    id: number; number: string; total: string; paidAmount: string; remaining: string;
    settlementStatus: string; status: string; allocations: unknown[];
  }>('expenses:save', {
    date: '2026-10-21', operationType: 'صيانة', description: 'بند اختبار', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, payableAccountId: payableAccount.id, costCenterId: null, projectId: null,
    paidAmount: '40', totalAmount: '100', notes: 'ملاحظة اختبار',
    allocations: [{ expenseAccountId: expenseAccount.id, projectId: null, costCenterId: null, amount: '100', notes: '' }],
  });
  assert.match(saved.number, /^EXP-\d{7}$/);
  assert.deepEqual([saved.total, saved.paidAmount, saved.remaining, saved.settlementStatus], ['100', '40', '60', 'partial']);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.allocations.length, 1);
  assert.equal(invoke<unknown[]>('expenses:list').length, 1);
  assert.equal(invoke<unknown[]>('expenses:list', 'بند اختبار').length, 1);
  assert.equal(invoke<unknown[]>('expenses:list', saved.number).length, 1);

  const edited = invoke<{ id: number; paidAmount: string; remaining: string; settlementStatus: string; number: string }>('expenses:save', {
    id: saved.id, date: '2026-10-21', operationType: 'صيانة', description: 'بند اختبار', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, payableAccountId: payableAccount.id, costCenterId: null, projectId: null,
    paidAmount: '60', totalAmount: '100', notes: 'تعديل',
    allocations: [{ expenseAccountId: expenseAccount.id, projectId: null, costCenterId: null, amount: '100', notes: '' }],
  });
  assert.equal(edited.id, saved.id);
  assert.equal(edited.number, saved.number);
  assert.deepEqual([edited.remaining, edited.settlementStatus], ['40', 'partial']);

  const posted = invoke<{ status: string; journalEntryId: number | null }>('expenses:approve', saved.id);
  assert.equal(posted.status, 'posted');
  assert.ok(posted.journalEntryId);
  const rePosted = invoke<{ journalEntryId: number | null }>('expenses:approve', saved.id);
  assert.equal(rePosted.journalEntryId, posted.journalEntryId);
  assert.equal(count(database, 'SELECT COUNT(*) AS count FROM journal_entries'), 1);
  const lines = database.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY line_order')
    .all(posted.journalEntryId) as Row[];
  assert.deepEqual(
    lines.map((line) => ({ account: Number(line.account_id), debit: String(line.debit), credit: String(line.credit) })),
    [
      { account: expenseAccount.id, debit: '100', credit: '0' },
      { account: cashAccount.id, debit: '0', credit: '60' },
      { account: payableAccount.id, debit: '0', credit: '40' },
    ],
  );
  assert.throws(() => invoke('expenses:save', {
    id: saved.id, date: '2026-10-21', operationType: 'صيانة', description: 'بند اختبار', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, payableAccountId: payableAccount.id, costCenterId: null, projectId: null,
    paidAmount: '10', totalAmount: '100', notes: '',
    allocations: [{ expenseAccountId: expenseAccount.id, projectId: null, costCenterId: null, amount: '100', notes: '' }],
  }), /مرحّل/);
  assert.throws(() => invoke('expenses:delete', saved.id), /المرحّل/);
  assert.throws(() => invoke('expenses:save', {
    date: '2026-10-21', operationType: 'صيانة', description: 'بند اختبار', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, payableAccountId: payableAccount.id, costCenterId: null, projectId: null,
    paidAmount: '0', totalAmount: '100', notes: '',
    allocations: [{ expenseAccountId: expenseAccount.id, projectId: null, costCenterId: null, amount: '90', notes: '' }],
  }), /يساوي إجمالي المصروف/);

  const duplicated = invoke<{ id: number; number: string; status: string; settlementStatus: string }>('expenses:save', {
    date: '2026-10-23', operationType: 'صيانة', description: 'بند اختبار', paymentMethod: 'cash',
    cashBoxId, bankAccountId: null, payableAccountId: payableAccount.id, costCenterId: null, projectId: null,
    paidAmount: '0', totalAmount: '100', notes: 'نسخة',
    allocations: [{ expenseAccountId: expenseAccount.id, projectId: null, costCenterId: null, amount: '100', notes: '' }],
  });
  assert.notEqual(duplicated.id, saved.id);
  assert.notEqual(duplicated.number, saved.number);
  assert.equal(duplicated.status, 'draft');
  assert.equal(duplicated.settlementStatus, 'unpaid');
  assert.equal(count(database, 'SELECT COUNT(*) AS count FROM journal_entries'), 1);
  database.close();
});
