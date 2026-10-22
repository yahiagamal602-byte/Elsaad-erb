import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, parseAmount } from '../src/shared/accounting.js';
import type { DashboardMonth, DashboardSummary } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

function formatSignedAmount(value: bigint): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function expenseActivity(database: DatabaseSync, from: string, to: string): {
  entries: number;
  balance: bigint;
} {
  const rows = database.prepare(`
    SELECT lines.debit, lines.credit
    FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    INNER JOIN accounts ON accounts.id = lines.account_id
    WHERE accounts.account_type = 'expense'
      AND entries.status = 'posted'
      AND entries.entry_date >= ?
      AND entries.entry_date <= ?
  `).all(from, to) as Row[];

  let balance = 0n;
  let entries = 0;
  for (const row of rows) {
    const debit = parseAmount(String(row.debit));
    const credit = parseAmount(String(row.credit));
    balance += debit - credit;
    if (debit !== 0n || credit !== 0n) entries += 1;
  }
  return { entries, balance };
}

export function readDashboardSummary(database: DatabaseSync, now = new Date()): DashboardSummary {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentTo = localDate(today);
  const currentStart = new Date(today);
  currentStart.setDate(currentStart.getDate() - 29);
  const currentFrom = localDate(currentStart);
  const previousToDate = new Date(currentStart);
  previousToDate.setDate(previousToDate.getDate() - 1);
  const previousTo = localDate(previousToDate);
  const previousStart = new Date(previousToDate);
  previousStart.setDate(previousStart.getDate() - 29);
  const previousFrom = localDate(previousStart);
  const monthStart = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const monthRangeStart = localDate(monthStart);

  const parties = database.prepare(`
    SELECT module, COUNT(DISTINCT TRIM(party)) AS count
    FROM records
    WHERE module IN ('sales', 'purchases') AND TRIM(party) <> ''
    GROUP BY module
  `).all() as Row[];
  const salesParties = Number(parties.find((row) => row.module === 'sales')?.count ?? 0);
  const purchaseParties = Number(parties.find((row) => row.module === 'purchases')?.count ?? 0);

  const recordTotals = database.prepare(`
    SELECT module, COUNT(*) AS count
    FROM records
    WHERE module IN ('sales', 'purchases')
    GROUP BY module
  `).all() as Row[];
  const salesRecords = Number(recordTotals.find((row) => row.module === 'sales')?.count ?? 0);
  const purchaseRecords = Number(recordTotals.find((row) => row.module === 'purchases')?.count ?? 0);

  const recordPeriods = database.prepare(`
    SELECT module,
      SUM(CASE WHEN date >= ? AND date <= ? THEN 1 ELSE 0 END) AS current_count,
      SUM(CASE WHEN date >= ? AND date <= ? THEN 1 ELSE 0 END) AS previous_count
    FROM records
    WHERE module IN ('sales', 'purchases') AND date <> ''
    GROUP BY module
  `).all(currentFrom, currentTo, previousFrom, previousTo) as Row[];
  const salesPeriod = recordPeriods.find((row) => row.module === 'sales');
  const purchasePeriod = recordPeriods.find((row) => row.module === 'purchases');
  const currentExpense = expenseActivity(database, currentFrom, currentTo);
  const previousExpense = expenseActivity(database, previousFrom, previousTo);
  const allExpense = expenseActivity(database, '0000-01-01', currentTo);

  const monthlyRecords = database.prepare(`
    SELECT module, substr(date, 1, 7) AS month, COUNT(*) AS count
    FROM records
    WHERE module IN ('sales', 'purchases') AND date >= ? AND date <= ?
    GROUP BY module, substr(date, 1, 7)
  `).all(monthRangeStart, currentTo) as Row[];
  const monthlyExpenses = database.prepare(`
    SELECT substr(entries.entry_date, 1, 7) AS month,
      lines.debit, lines.credit
    FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    INNER JOIN accounts ON accounts.id = lines.account_id
    WHERE accounts.account_type = 'expense'
      AND entries.status = 'posted'
      AND entries.entry_date >= ?
      AND entries.entry_date <= ?
  `).all(monthRangeStart, currentTo) as Row[];
  const months = new Map<string, DashboardMonth>();
  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth() + offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.set(month, { month, salesRecords: 0, purchaseRecords: 0, expenseDebits: '0', expenseCredits: '0' });
  }
  for (const row of monthlyRecords) {
    const month = months.get(String(row.month));
    if (!month) continue;
    if (row.module === 'sales') month.salesRecords = Number(row.count);
    if (row.module === 'purchases') month.purchaseRecords = Number(row.count);
  }
  const debitByMonth = new Map<string, bigint>();
  const creditByMonth = new Map<string, bigint>();
  for (const row of monthlyExpenses) {
    const month = String(row.month);
    debitByMonth.set(month, (debitByMonth.get(month) ?? 0n) + parseAmount(String(row.debit)));
    creditByMonth.set(month, (creditByMonth.get(month) ?? 0n) + parseAmount(String(row.credit)));
  }
  for (const [key, month] of months) {
    month.expenseDebits = formatAmount(debitByMonth.get(key) ?? 0n);
    month.expenseCredits = formatAmount(creditByMonth.get(key) ?? 0n);
  }

  return {
    salesParties,
    purchaseParties,
    salesRecords,
    purchaseRecords,
    expenseEntries: allExpense.entries,
    expenseBalance: allExpense.entries ? formatSignedAmount(allExpense.balance) : null,
    comparison: {
      currentFrom,
      currentTo,
      previousFrom,
      previousTo,
      salesCurrent: Number(salesPeriod?.current_count ?? 0),
      salesPrevious: Number(salesPeriod?.previous_count ?? 0),
      purchasesCurrent: Number(purchasePeriod?.current_count ?? 0),
      purchasesPrevious: Number(purchasePeriod?.previous_count ?? 0),
      expensesCurrent: currentExpense.entries ? formatSignedAmount(currentExpense.balance) : null,
      expensesPrevious: previousExpense.entries ? formatSignedAmount(previousExpense.balance) : null,
    },
    monthly: [...months.values()],
  };
}
