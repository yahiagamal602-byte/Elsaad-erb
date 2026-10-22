import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runReport } from '../electron/reports.js';

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE property_units (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE property_contracts (id INTEGER PRIMARY KEY, number TEXT NOT NULL, customer_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, unit_id INTEGER NOT NULL, status TEXT NOT NULL);
    CREATE TABLE property_installments (id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL, sequence INTEGER NOT NULL,
      due_date TEXT NOT NULL, description TEXT NOT NULL, frequency TEXT NOT NULL, amount TEXT NOT NULL);
    CREATE TABLE property_receipt_allocations (id INTEGER PRIMARY KEY, installment_id INTEGER NOT NULL, amount TEXT NOT NULL);
    CREATE TABLE property_installment_adjustments (id INTEGER PRIMARY KEY, installment_id INTEGER NOT NULL, amount TEXT NOT NULL);
    INSERT INTO customers VALUES (1, 'CUS-1', 'عميل اختبار');
    INSERT INTO projects VALUES (1, 'PRJ-1', 'مشروع الاختبار');
    INSERT INTO property_units VALUES (1, 'UNIT-1', 'الوحدة الأولى'), (2, 'UNIT-2', 'الوحدة الثانية');
    INSERT INTO property_contracts VALUES
      (1, 'CTR-1', 1, 1, 1, 'approved'),
      (2, 'CTR-CANCELLED', 1, 1, 1, 'cancelled'),
      (3, 'CTR-2', 1, 1, 2, 'approved');
    INSERT INTO property_installments VALUES
      (1, 1, 1, '2025-01-10', 'قسط كامل', 'monthly', '100'),
      (2, 1, 2, '2025-02-10', 'قسط جزئي', 'monthly', '200'),
      (3, 1, 3, '2025-03-10', 'قسط متأخر', 'quarterly', '300'),
      (4, 2, 1, '2025-04-10', 'قسط عقد ملغي', 'monthly', '999'),
      (5, 3, 1, '2025-05-10', 'قسط وحدة أخرى', 'monthly', '500'),
      (6, 1, 4, '2027-01-10', 'قسط قادم', 'annual', '80');
    INSERT INTO property_receipt_allocations VALUES
      (1, 1, '40'), (2, 1, '60'), (3, 2, '50'), (4, 3, '25');
    INSERT INTO property_installment_adjustments VALUES (1, 3, '25');
  `);
  return database;
}

test('installment report counts allocated receipts once, honors approved contracts, filters units and classifies balances', () => {
  const database = fixture();
  const result = runReport(database, {
    key: 'installments',
    filters: { from: '2025-01-01', to: '2027-12-31', customerId: 1, projectId: 1, unitId: 1 },
  });

  assert.deepEqual(result.rows.map((row) => [row.sequence, row.amount, row.paid, row.remaining, row.status, row.timeStatus]), [
    ['1', '100', '100', '0', 'مسدد', 'upcoming'],
    ['2', '200', '50', '150', 'متأخر (مسدد جزئيًا)', 'overdue'],
    ['3', '300', '25', '250', 'متأخر (مسدد جزئيًا)', 'overdue'],
    ['4', '80', '0', '80', 'غير مسدد', 'upcoming'],
  ]);
  assert.deepEqual(result.rows.map((row) => [row.unitId, row.unitCode, row.customerCode, row.projectCode]), [
    ['1', 'UNIT-1', 'CUS-1', 'PRJ-1'], ['1', 'UNIT-1', 'CUS-1', 'PRJ-1'],
    ['1', 'UNIT-1', 'CUS-1', 'PRJ-1'], ['1', 'UNIT-1', 'CUS-1', 'PRJ-1'],
  ]);
  assert.deepEqual(result.totals.map((card) => [card.label, card.value]), [
    ['عدد الأقساط', '4'], ['إجمالي الأقساط', '680'], ['المحصّل', '175'],
    ['المتبقي', '480'], ['عدد المتأخرات', '2'],
  ]);

  const dueOrUpcoming = runReport(database, {
    key: 'installments', filters: { from: '2025-01-01', to: '2027-12-31', installmentStatus: 'due-upcoming' },
  });
  assert.deepEqual(dueOrUpcoming.rows.map((row) => row.sequence), ['4']);
  const unitTwo = runReport(database, { key: 'installments', filters: { unitId: 2 } });
  assert.deepEqual(unitTwo.rows.map((row) => [row.unitCode, row.amount]), [['UNIT-2', '500']]);
  database.close();
});