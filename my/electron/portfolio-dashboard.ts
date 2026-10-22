import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { PortfolioDashboard, PortfolioDashboardFilters, PortfolioDashboardMonth } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

function isDate(value: string): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateFilters(value: unknown): PortfolioDashboardFilters {
  if (!value || typeof value !== 'object') throw new Error('مرشحات لوحات العقارات والمشاريع غير صالحة.');
  const input = value as Partial<PortfolioDashboardFilters>;
  if (typeof input.from !== 'string' || typeof input.to !== 'string' || !isDate(input.from) || !isDate(input.to)) {
    throw new Error('نطاق التاريخ غير صالح.');
  }
  if (input.from && input.to && input.from > input.to) throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.');
  if (input.projectId !== null && input.projectId !== undefined
    && (!Number.isSafeInteger(input.projectId) || input.projectId < 1)) {
    throw new Error('المشروع المحدد غير صالح.');
  }
  return { from: input.from, to: input.to, projectId: input.projectId ?? null };
}

function listProjects(database: DatabaseSync, range: Pick<PortfolioDashboardFilters, 'from' | 'to'>) {
  const rows = database.prepare(`
    SELECT id, name, start_date, code, status
    FROM projects
    WHERE (? = '' OR (start_date <> '' AND start_date >= ?))
      AND (? = '' OR (start_date <> '' AND start_date <= ?))
    ORDER BY name COLLATE NOCASE, id
  `).all(range.from, range.from, range.to, range.to) as Row[];
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    date: String(row.start_date),
    reference: String(row.code),
    status: String(row.status),
  }));
}

function readPortfolioDashboard(database: DatabaseSync, rawFilters: unknown): PortfolioDashboard {
  const filters = validateFilters(rawFilters);
  const projects = listProjects(database, filters);
  if (filters.projectId !== null && !projects.some((project) => project.id === filters.projectId)) {
    throw new Error('المشروع المحدد غير موجود ضمن الفترة المختارة.');
  }

  const isProjectFiltered = filters.projectId !== null;
  const salesDocuments = database.prepare(`
    SELECT document_type, substr(document_date, 1, 7) AS month, COUNT(*) AS count
    FROM sales_documents
    WHERE status = 'approved'
      AND (? = '' OR document_date >= ?)
      AND (? = '' OR document_date <= ?)
    GROUP BY document_type, substr(document_date, 1, 7)
  `).all(filters.from, filters.from, filters.to, filters.to) as Row[];
  const returns = database.prepare(`
    SELECT substr(return_date, 1, 7) AS month, COUNT(*) AS count
    FROM sales_returns
    WHERE status = 'approved'
      AND (? = '' OR return_date >= ?)
      AND (? = '' OR return_date <= ?)
    GROUP BY substr(return_date, 1, 7)
  `).all(filters.from, filters.from, filters.to, filters.to) as Row[];
  const ledgerLines = database.prepare(`
    SELECT accounts.account_type, substr(entries.entry_date, 1, 7) AS month, COUNT(*) AS count
    FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    INNER JOIN accounts ON accounts.id = lines.account_id
    WHERE entries.status = 'posted'
      AND accounts.account_type IN ('revenue', 'expense')
      AND (? = '' OR entries.entry_date >= ?)
      AND (? = '' OR entries.entry_date <= ?)
    GROUP BY accounts.account_type, substr(entries.entry_date, 1, 7)
  `).all(filters.from, filters.from, filters.to, filters.to) as Row[];
  const unpostedPurchases = Number((database.prepare(`
    SELECT COUNT(*) AS count FROM purchase_invoices
    WHERE status = 'draft' AND (? = '' OR invoice_date >= ?) AND (? = '' OR invoice_date <= ?)
  `).get(filters.from, filters.from, filters.to, filters.to) as Row).count);

  const byMonth = new Map<string, PortfolioDashboardMonth>();
  const now = new Date();
  const startFrom = filters.from
    ? new Date(Number(filters.from.slice(0, 4)), Number(filters.from.slice(5, 7)) - 1, 1)
    : null;
  const endAt = filters.to
    ? new Date(Number(filters.to.slice(0, 4)), Number(filters.to.slice(5, 7)) - 1, 1)
    : null;
  let firstMonth = startFrom ?? (endAt ? new Date(endAt.getFullYear(), endAt.getMonth() - 11, 1)
    : new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const lastMonth = endAt ?? (startFrom && startFrom > new Date(now.getFullYear(), now.getMonth(), 1)
    ? startFrom : new Date(now.getFullYear(), now.getMonth(), 1));
  let monthCount = Math.max(1,
    (lastMonth.getFullYear() - firstMonth.getFullYear()) * 12 + lastMonth.getMonth() - firstMonth.getMonth() + 1);
  if (monthCount > 120) {
    firstMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 119, 1);
    monthCount = 120;
  }
  for (let offset = 0; offset < monthCount; offset += 1) {
    const monthDate = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + offset, 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, {
      month: key, approvedInvoices: 0, approvedReturns: 0, postedRevenueLines: 0, postedExpenseLines: 0,
    });
  }
  let approvedInvoiceCount = 0;
  let approvedReturnCount = 0;
  let approvedWorkOrderCount = 0;
  let postedRevenueLineCount = 0;
  let postedExpenseLineCount = 0;
  for (const row of salesDocuments) {
    const count = Number(row.count);
    const month = byMonth.get(String(row.month));
    if (row.document_type === 'invoice') {
      approvedInvoiceCount += count;
      if (month) month.approvedInvoices += count;
    }
    if (row.document_type === 'work-order') approvedWorkOrderCount += count;
  }
  for (const row of returns) {
    const count = Number(row.count);
    approvedReturnCount += count;
    const month = byMonth.get(String(row.month));
    if (month) month.approvedReturns += count;
  }
  for (const row of ledgerLines) {
    const count = Number(row.count);
    const month = byMonth.get(String(row.month));
    if (row.account_type === 'revenue') {
      postedRevenueLineCount += count;
      if (month) month.postedRevenueLines += count;
    } else {
      postedExpenseLineCount += count;
      if (month) month.postedExpenseLines += count;
    }
  }

  return {
    from: filters.from,
    to: filters.to,
    projectId: filters.projectId,
    projects,
    approvedInvoiceCount: isProjectFiltered ? null : approvedInvoiceCount,
    approvedReturnCount: isProjectFiltered ? null : approvedReturnCount,
    approvedWorkOrderCount: isProjectFiltered ? null : approvedWorkOrderCount,
    approvedInvoiceValue: null,
    brokerageCommissions: null,
    deliveredContracts: null,
    soldUnits: null,
    availableUnits: null,
    overdueInstallments: null,
    partiallyPaidInstallments: null,
    upcomingInstallments: null,
    collections: null,
    ledgerRevenue: null,
    ledgerCosts: null,
    operatingProfit: null,
    profitMargin: null,
    postedRevenueLineCount: isProjectFiltered ? null : postedRevenueLineCount,
    postedExpenseLineCount: isProjectFiltered ? null : postedExpenseLineCount,
    unpostedPurchaseInvoiceCount: isProjectFiltered ? null : unpostedPurchases,
    monthly: [...byMonth.values()].map((month) => isProjectFiltered
      ? { ...month, approvedInvoices: 0, approvedReturns: 0, postedRevenueLines: 0, postedExpenseLines: 0 }
      : month),
  };
}

export function registerPortfolioDashboardHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('portfolio-dashboard:get', (_event, filters: unknown) => {
    const database = requireAuthentication();
    return readPortfolioDashboard(database, filters);
  });
}
