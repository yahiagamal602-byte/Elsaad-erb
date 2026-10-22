import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  approveContract,
  collectReceipt,
  installPropertySalesSchema,
  deletePropertyBroker,
  listPropertyBrokers,
  registerPropertySalesHandlers,
  savePropertyBroker,
  saveAndApproveContract,
  saveContract,
} from '../electron/property-sales.ts';
import { runReport } from '../electron/reports.js';
import { ipcHandlers } from './electron-stub.ts';
import type { PropertyContractInput, PropertyUnit } from '../src/shared/types.js';

function fixture(): { database: DatabaseSync; projectId: number; customerId: number; cashBoxId: number; bankId: number; expenseId: number; receivableId: number } {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, code TEXT, name TEXT, account_type TEXT NOT NULL);
    CREATE TABLE journal_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL, entry_date TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'posted');
    CREATE TABLE journal_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entries(id), line_order INTEGER, account_id INTEGER NOT NULL REFERENCES accounts(id), debit TEXT NOT NULL, credit TEXT NOT NULL);
    CREATE TABLE treasury_cash_boxes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id), opening_balance TEXT NOT NULL, opening_date TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE treasury_bank_accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id), opening_balance TEXT NOT NULL, opening_date TEXT NOT NULL, status TEXT NOT NULL);
  `);
  database.prepare('INSERT INTO projects (id, code, name) VALUES (1, ?, ?)').run('PRJ-1', 'مشروع اختبار');
  database.prepare('INSERT INTO customers (id, code, name, status) VALUES (1, ?, ?, ?)').run('CUS-1', 'عميل اختبار', 'active');
  database.prepare('INSERT INTO accounts (id, code, name, account_type) VALUES (1, ?, ?, ?)').run('101', 'خزينة اختبار', 'asset');
  database.prepare('INSERT INTO accounts (id, code, name, account_type) VALUES (2, ?, ?, ?)').run('102', 'بنك اختبار', 'asset');
  database.prepare('INSERT INTO accounts (id, code, name, account_type) VALUES (3, ?, ?, ?)').run('113', 'ذمم مدينة', 'asset');
  database.prepare('INSERT INTO accounts (id, code, name, account_type) VALUES (4, ?, ?, ?)').run('501', 'مصروف عمولات', 'expense');
  database.prepare('INSERT INTO treasury_cash_boxes (id, name, account_id, opening_balance, opening_date, status) VALUES (1, ?, 1, ?, ?, ?)').run('خزينة اختبار', '100000', '2026-01-01', 'active');
  database.prepare('INSERT INTO treasury_bank_accounts (id, name, account_id, opening_balance, opening_date, status) VALUES (1, ?, 2, ?, ?, ?)').run('بنك اختبار', '100000', '2026-01-01', 'active');
  installPropertySalesSchema(database);
  return { database, projectId: 1, customerId: 1, cashBoxId: 1, bankId: 1, expenseId: 4, receivableId: 3 };
}

function contractInput(unitId: number, options: Partial<PropertyContractInput> = {}): PropertyContractInput {
  return {
    projectId: 1, unitId, customerId: 1, contractDate: '2026-01-01', downPaymentDueDate: '2026-01-01', originalPrice: '600000', discount: '0', fees: '0', feeItems: [],
    downPayment: '100000', brokerId: null, brokerCommissionMode: 'rate', brokerRate: '0', brokerOnOriginalPrice: false,
    schedules: [
      { frequency: 'monthly', amount: '100000', count: 1, firstDueDate: '2026-02-01', description: 'شهري', notes: '' },
      { frequency: 'quarterly', amount: '100000', count: 1, firstDueDate: '2026-03-01', description: 'ربع سنوي', notes: '' },
      { frequency: 'semiannual', amount: '100000', count: 1, firstDueDate: '2026-04-01', description: 'نصف سنوي', notes: '' },
      { frequency: 'annual', amount: '100000', count: 1, firstDueDate: '2026-05-01', description: 'سنوي', notes: '' },
    ],
    freePayments: [
      { amount: '50000', dueDate: '2026-06-01', description: 'دفعة حرة أولى', notes: '' },
      { amount: '50000', dueDate: '2026-07-15', description: 'دفعة حرة ثانية', notes: 'اختبار' },
    ],
    notes: '', ...options,
  };
}

function addUnit(database: DatabaseSync, id: number, price = '600000'): void {
  database.prepare(`INSERT INTO property_units (id, project_id, code, name, original_price, status)
    VALUES (?, 1, ?, ?, ?, 'available')`).run(id, `U-${id}`, `وحدة ${id}`, price);
}

test('mixed schedules save and approve atomically, and reopening does not duplicate installments', () => {
  const { database } = fixture();
  addUnit(database, 1);
  const approved = saveAndApproveContract(database, {
    contract: contractInput(1), commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
  });
  assert.equal(approved.contractValue, '600000.00');
  assert.equal(approved.remainingToSchedule, '500000.00');
  assert.equal(approved.installments.length, 7);
  assert.equal(approved.installments.filter((item) => item.frequency === 'free').length, 2);
  assert.equal(approved.installments.reduce((sum, item) => sum + Number(item.amount), 0), 600000);
  const before = Number((database.prepare('SELECT COUNT(*) AS count FROM property_installments WHERE contract_id = ?').get(approved.id) as { count: number }).count);
  const reopened = approveContract(database, { id: approved.id, commissionTreatment: null });
  const after = Number((database.prepare('SELECT COUNT(*) AS count FROM property_installments WHERE contract_id = ?').get(approved.id) as { count: number }).count);
  assert.equal(reopened.installments.length, before);
  assert.equal(after, before);
  database.close();
});

test('unit sale distributes full price and bank receipt updates balance and installment report', () => {
  const { database, bankId, receivableId } = fixture();
  registerPropertySalesHandlers(() => database);
  const saveUnit = ipcHandlers.get('property-sales:units:save');
  assert.ok(saveUnit);
  const unit = saveUnit({}, {
    projectId: 1, code: 'U-CYCLE-1', name: 'وحدة دورة الاختبار', floor: '1', area: '100',
    originalPrice: '500000', status: 'available',
  }) as PropertyUnit;
  assert.equal(unit.originalPrice, '500000');
  assert.equal(unit.status, 'available');

  const contract = saveAndApproveContract(database, {
    contract: contractInput(unit.id, {
      originalPrice: unit.originalPrice,
      downPayment: '100000',
      schedules: [
        { frequency: 'monthly', amount: '100000', count: 2, firstDueDate: '2026-02-01', description: 'شهري', notes: '' },
        { frequency: 'annual', amount: '200000', count: 1, firstDueDate: '2027-01-01', description: 'سنوي', notes: '' },
      ],
      freePayments: [{ amount: '100000', dueDate: '2026-06-01', description: 'دفعة حرة', notes: '' }],
    }),
    commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
  });

  const scheduledTotal = contract.installments
    .filter((installment) => installment.frequency !== 'down-payment')
    .reduce((sum, installment) => sum + Number(installment.amount), 0);
  const distributedTotal = Number(contract.downPayment) + scheduledTotal;
  assert.equal(contract.status, 'approved');
  assert.equal(contract.unitCode, unit.code);
  assert.equal(contract.remainingToSchedule, '400000.00');
  assert.equal(Number(contract.remainingToSchedule) - scheduledTotal, 0);
  assert.equal(distributedTotal, Number(unit.originalPrice));
  assert.equal(Number(unit.originalPrice) - distributedTotal, 0);
  assert.equal(contract.installments.length, 5);
  assert.equal(contract.installments.filter((item) => item.frequency === 'monthly').length, 2);
  assert.equal(contract.installments.filter((item) => item.frequency === 'annual').length, 1);
  assert.equal(contract.installments.filter((item) => item.frequency === 'free').length, 1);
  assert.equal((database.prepare('SELECT status FROM property_units WHERE id = ?').get(unit.id) as { status: string }).status, 'sold');

  const beforeReceipt = runReport(database, {
    key: 'installments',
    filters: { from: '2026-01-01', to: '2027-12-31', customerId: 1, projectId: 1, unitId: unit.id },
  });
  assert.equal(beforeReceipt.rows.length, 5);
  assert.equal(beforeReceipt.totals.find((total) => total.label === 'إجمالي الأقساط')?.value, '500000');
  assert.equal(beforeReceipt.totals.find((total) => total.label === 'المحصّل')?.value, '0');
  assert.equal(beforeReceipt.totals.find((total) => total.label === 'المتبقي')?.value, '500000');

  const monthlyInstallment = contract.installments.find((item) => item.frequency === 'monthly')!;
  const receiptRequest = {
    contractId: contract.id, date: '2026-02-01', channel: 'bank' as const, cashBoxId: null, bankAccountId: bankId,
    receivableAccountId: receivableId, requestKey: 'unit-bank-receipt-0001', reference: 'BANK-001', notes: 'تحصيل بنكي تجريبي',
    allocations: [{ installmentId: monthlyInstallment.id, amount: '25000' }],
  };
  const collected = collectReceipt(database, receiptRequest);
  assert.equal(collected.outstanding, '475000.00');
  assert.equal(collected.installments.find((item) => item.id === monthlyInstallment.id)?.paid, '25000.00');
  assert.equal(collected.installments.find((item) => item.id === monthlyInstallment.id)?.remaining, '25000.00');
  assert.equal(collected.receipts.length, 1);
  assert.equal(collected.receipts[0].channel, 'bank');
  assert.equal(collected.receipts[0].accountName, 'بنك اختبار');
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_receipts WHERE contract_id = ?').get(contract.id) as { count: number }).count), 1);

  const bankMovement = () => Number((database.prepare(`SELECT CAST(opening_balance AS REAL)
      + COALESCE(SUM(CAST(lines.debit AS REAL) - CAST(lines.credit AS REAL)), 0) AS balance
    FROM treasury_bank_accounts AS banks
    LEFT JOIN journal_lines AS lines ON lines.account_id = banks.account_id
    LEFT JOIN journal_entries AS entries ON entries.id = lines.entry_id AND entries.status = 'posted'
    WHERE banks.id = ?`).get(bankId) as { balance: number }).balance);
  assert.equal(bankMovement(), 125000);
  collectReceipt(database, receiptRequest);
  assert.equal(bankMovement(), 125000);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_receipts WHERE contract_id = ?').get(contract.id) as { count: number }).count), 1);

  const afterReceipt = runReport(database, {
    key: 'installments',
    filters: { from: '2026-01-01', to: '2027-12-31', customerId: 1, projectId: 1, unitId: unit.id },
  });
  assert.equal(afterReceipt.rows.length, 5);
  assert.equal(afterReceipt.totals.find((total) => total.label === 'إجمالي الأقساط')?.value, '500000');
  assert.equal(afterReceipt.totals.find((total) => total.label === 'المحصّل')?.value, '25000');
  assert.equal(afterReceipt.totals.find((total) => total.label === 'المتبقي')?.value, '475000');
  database.close();
});

test('incomplete plan leaves no saved contract when approval is rejected', () => {
  const { database } = fixture();
  addUnit(database, 1);
  assert.throws(() => saveAndApproveContract(database, {
    contract: contractInput(1, { schedules: [], freePayments: [] }),
    commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
  }), /غير موزع/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_contracts').get() as { count: number }).count), 0);
  database.close();
});

test('missing commission choice and insufficient payout balance leave no partial contract', () => {
  const { database } = fixture();
  database.prepare('INSERT INTO property_brokers (id, code, name, status) VALUES (1, ?, ?, ?)').run('B1', 'سمسار اختبار', 'active');
  addUnit(database, 1, '200000');
  const input = contractInput(1, {
    originalPrice: '200000', downPayment: '0', brokerId: 1, brokerCommissionMode: 'fixed', brokerRate: '100001',
    schedules: [{ frequency: 'monthly', amount: '200000', count: 1, firstDueDate: '2026-02-01', description: 'قسط', notes: '' }],
    freePayments: [],
  });
  assert.throws(() => saveAndApproveContract(database, {
    contract: input, commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
  }), /اختر طريقة معالجة عمولة/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_contracts').get() as { count: number }).count), 0);
  assert.throws(() => saveAndApproveContract(database, {
    contract: input, commissionTreatment: 'cash', payoutAccountId: 1, expenseAccountId: 4,
  }), /الرصيد المتاح.*غير كاف/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_contracts').get() as { count: number }).count), 0);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 0);
  database.close();
});

test('broker commission deduction is not a cash movement, while cash and bank treatments post once', () => {
  const { database, cashBoxId, bankId, expenseId } = fixture();
  database.prepare('INSERT INTO property_brokers (id, code, name, status) VALUES (1, ?, ?, ?)').run('B1', 'سمسار اختبار', 'active');
  const treatmentCases = [
    { unitId: 1, treatment: 'deduct' as const, payoutAccountId: null, mode: 'rate' as const, commission: '100.00', rate: '1' },
    { unitId: 2, treatment: 'cash' as const, payoutAccountId: cashBoxId, mode: 'rate' as const, commission: '100.00', rate: '1' },
    { unitId: 3, treatment: 'bank' as const, payoutAccountId: bankId, mode: 'rate' as const, commission: '100.00', rate: '1' },
    { unitId: 4, treatment: 'cash' as const, payoutAccountId: cashBoxId, mode: 'fixed' as const, commission: '250.00', rate: '250' },
  ];
  for (const entry of treatmentCases) {
    addUnit(database, entry.unitId, '10000');
    const expectsJournal = entry.treatment !== 'deduct';
    const result = saveAndApproveContract(database, {
      contract: contractInput(entry.unitId, {
        originalPrice: '10000', downPayment: '0', brokerId: 1, brokerCommissionMode: entry.mode, brokerRate: entry.rate,
        schedules: [{ frequency: 'monthly', amount: '10000', count: 1, firstDueDate: '2026-02-01', description: 'قسط', notes: '' }],
        freePayments: [],
      }), commissionTreatment: entry.treatment, payoutAccountId: entry.payoutAccountId, expenseAccountId: expectsJournal ? expenseId : null,
    });
    assert.equal(result.brokerCommission, entry.commission);
    assert.equal(result.commissionTreatment, entry.treatment);
    assert.equal(result.commissionJournalId !== null, expectsJournal);
    if (result.commissionJournalId !== null) {
      const lines = database.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ? ORDER BY line_order')
        .all(result.commissionJournalId) as Array<{ account_id: number; debit: string; credit: string }>;
      assert.equal(lines.length, 2);
      assert.equal(lines[0].account_id, expenseId);
      assert.equal(lines[0].debit, entry.commission);
      assert.equal(lines[1].credit, entry.commission);
    }
  }
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 3);
  assert.equal(Number((database.prepare("SELECT COUNT(*) AS count FROM property_installment_adjustments WHERE adjustment_type = 'broker-commission-offset'").get() as { count: number }).count), 1);
  database.close();
});

test('receipt allocations accept partial payments and reject duplicate requests without duplicate ledger entries', () => {
  const { database, cashBoxId, receivableId } = fixture();
  addUnit(database, 1);
  const contract = saveAndApproveContract(database, {
    contract: contractInput(1), commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
  });
  const installment = contract.installments.find((item) => item.frequency === 'monthly')!;
  const request = {
    contractId: contract.id, date: '2026-02-01', channel: 'cash' as const, cashBoxId, bankAccountId: null,
    receivableAccountId: receivableId, requestKey: 'receipt-test-0001', reference: 'RCT-01', notes: 'تحصيل تجريبي',
    allocations: [{ installmentId: installment.id, amount: '25000' }],
  };
  const partial = collectReceipt(database, request);
  assert.equal(partial.installments.find((item) => item.id === installment.id)?.status, 'partial');
  assert.equal(partial.installments.find((item) => item.id === installment.id)?.remaining, '75000.00');
  assert.equal(partial.receipts.length, 1);
  assert.equal(partial.receipts[0].reference, 'RCT-01');
  assert.equal(partial.receipts[0].notes, 'تحصيل تجريبي');
  collectReceipt(database, request);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_receipts').get() as { count: number }).count), 1);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as { count: number }).count), 1);
  assert.throws(() => collectReceipt(database, {
    ...request, requestKey: 'receipt-test-0002', allocations: [{ installmentId: installment.id, amount: '75000.01' }],
  }), /يتجاوز المتبقي/);
  const paid = collectReceipt(database, {
    ...request, requestKey: 'receipt-test-0003', allocations: [{ installmentId: installment.id, amount: '75000' }],
  });
  assert.equal(paid.installments.find((item) => item.id === installment.id)?.status, 'paid');
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_receipts').get() as { count: number }).count), 2);
  assert.equal(paid.receipts.length, 2);
  database.close();
});

test('draft schedule edits replace temporary data and over-allocation is rejected', () => {
  const { database } = fixture();
  addUnit(database, 1);
  const draft = saveContract(database, contractInput(1, { schedules: [], freePayments: [] }));
  const edited = saveContract(database, {
    ...contractInput(1, { schedules: [{ frequency: 'monthly', amount: '500000', count: 10, firstDueDate: '2026-01-31', description: '', notes: '' }], freePayments: [] }),
    id: draft.id,
  });
  assert.equal(edited.schedules.length, 1);
  assert.throws(() => saveContract(database, {
    ...contractInput(1, { schedules: [{ frequency: 'monthly', amount: '500001', count: 10, firstDueDate: '2026-01-31', description: '', notes: '' }], freePayments: [] }),
    id: draft.id,
  }), /يتجاوز المبلغ المتاح/);
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM property_contract_schedules WHERE contract_id = ?').get(draft.id) as { count: number }).count), 1);
  database.close();
});

test('itemized fees and down-payment due date persist with the draft contract', () => {
  const { database } = fixture();
  addUnit(database, 1);
  const saved = saveContract(database, contractInput(1, {
    originalPrice: '600000', fees: '1250.50', feeItems: [
      { description: 'مصاريف إدارية', amount: '1000.00' },
      { description: 'رسوم تعاقد', amount: '250.50' },
    ],
    downPaymentDueDate: '2026-01-15', schedules: [], freePayments: [],
  }));
  assert.equal(saved.contractValue, '601250.50');
  assert.equal(saved.downPaymentDueDate, '2026-01-15');
  assert.equal(saved.feeItems.length, 2);
  database.close();
});

test('broker records validate commission, search, update in place, and protect contract references', () => {
  const { database } = fixture();
  const created = savePropertyBroker(database, {
    code: 'BR-E2E-1', name: 'سمسار اختبار', phone: '01000000000', commissionRate: '2.5', status: 'active',
  });
  assert.equal(created.commissionRate, '2.5');
  assert.equal(listPropertyBrokers(database, '0100000')[0].id, created.id);
  assert.throws(() => savePropertyBroker(database, {
    code: 'BR-BAD', name: 'نسبة غير صالحة', phone: '', commissionRate: 'Infinity', status: 'active',
  }), /نسبة العمولة/);
  assert.throws(() => savePropertyBroker(database, {
    code: 'BR-BAD', name: 'نسبة تتجاوز الحد الحالي', phone: '', commissionRate: '100.01', status: 'active',
  }), /بين 0 و100/);
  assert.throws(() => savePropertyBroker(database, {
    code: 'br-e2e-1', name: 'كود مكرر', phone: '', commissionRate: '0', status: 'active',
  }), /كود السمسار مسجل/);

  const updated = savePropertyBroker(database, {
    ...created, name: 'سمسار بعد التعديل', commissionRate: '3',
  });
  assert.equal(updated.id, created.id);
  assert.equal(listPropertyBrokers(database, 'بعد التعديل').length, 1);

  addUnit(database, 1);
  database.prepare(`INSERT INTO property_contracts
    (number, project_id, unit_id, customer_id, contract_date, original_price, discount, fees, down_payment, broker_id)
    VALUES (?, 1, 1, 1, '2026-01-01', '1000', '0', '0', '0', ?)`)
    .run('BR-LINKED-1', created.id);
  assert.throws(() => deletePropertyBroker(database, created.id), /مرتبط بعقد/);
  const removable = savePropertyBroker(database, {
    code: 'BR-E2E-2', name: 'سمسار للحذف', phone: '', commissionRate: '0', status: 'active',
  });
  assert.equal(deletePropertyBroker(database, removable.id), true);
  database.close();
});

test('existing broker tables gain a default commission rate without losing rows', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE property_brokers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  database.prepare('INSERT INTO property_brokers (code, name, phone) VALUES (?, ?, ?)')
    .run('LEGACY-BROKER', 'سمسار موجود', '01000000000');
  installPropertySalesSchema(database);
  const migrated = database.prepare('SELECT code, commission_rate FROM property_brokers WHERE code = ?').get('LEGACY-BROKER') as { code: string; commission_rate: string };
  assert.equal(migrated.code, 'LEGACY-BROKER');
  assert.equal(migrated.commission_rate, '0');
  database.close();
});