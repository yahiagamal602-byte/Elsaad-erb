import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateContractAmounts,
  generateInstallments,
  validateScheduleTotal,
  type InstallmentFrequency,
} from '../src/shared/property-sales.ts';

test('contract balance excludes the down payment exactly once', () => {
  const result = calculateContractAmounts({
    originalPrice: '600000', discount: '0', fees: '0', downPayment: '100000',
    brokerRate: '0', brokerOnOriginalPrice: false,
  });
  assert.equal(result.contractValue, '600000.00');
  assert.equal(result.remaining, '500000.00');
});

test('periodic installments use the selected frequency and balance the final cent', () => {
  const cases: Array<[InstallmentFrequency, string, string]> = [
    ['monthly', '2026-02-28', '2026-03-31'],
    ['quarterly', '2026-04-30', '2026-07-31'],
    ['semiannual', '2026-07-31', '2027-01-31'],
    ['annual', '2027-01-31', '2028-01-31'],
  ];
  for (const [frequency, secondDate, thirdDate] of cases) {
    const rows = generateInstallments({ frequency, amount: '100.00', count: 3, firstDueDate: '2026-01-31' });
    assert.equal(rows.length, 3);
    assert.equal(rows[1].dueDate, secondDate);
    assert.equal(rows[2].dueDate, thirdDate);
    assert.deepEqual(rows.map((row) => row.amount), ['33.33', '33.33', '33.34']);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.amount), 0), 100);
  }
});

test('monthly plan creates requested count and allocation totals stay bounded', () => {
  const rows = generateInstallments({
    frequency: 'monthly', amount: '100000', count: 10, firstDueDate: '2026-01-15',
  });
  assert.equal(rows.length, 10);
  assert.equal(rows.reduce((sum, row) => sum + Number(row.amount), 0), 100000);
  assert.deepEqual(validateScheduleTotal('500000', rows), {
    allocated: '100000.00', undistributed: '400000.00',
  });
  assert.throws(() => validateScheduleTotal('99999', rows), /يتجاوز المبلغ المتاح/);
});

test('contract rejects invalid down payment and excessive discount', () => {
  const base = { originalPrice: '100', discount: '0', fees: '0', downPayment: '0', brokerRate: '0', brokerOnOriginalPrice: false };
  assert.throws(() => calculateContractAmounts({ ...base, discount: '101' }), /الخصم/);
  assert.throws(() => calculateContractAmounts({ ...base, downPayment: '101' }), /المقدم/);
});

test('percentage and fixed broker commissions use exact contract cents', () => {
  const base = { originalPrice: '600000', discount: '10000', fees: '5000', downPayment: '100000', brokerOnOriginalPrice: false };
  const percentage = calculateContractAmounts({ ...base, brokerRate: '2.50', brokerCommissionMode: 'rate' });
  assert.equal(percentage.contractValue, '595000.00');
  assert.equal(percentage.discountRate, '1.67');
  assert.equal(percentage.brokerCommission, '14875.00');
  const fixed = calculateContractAmounts({ ...base, brokerRate: '1234.56', brokerCommissionMode: 'fixed' });
  assert.equal(fixed.brokerCommission, '1234.56');
});