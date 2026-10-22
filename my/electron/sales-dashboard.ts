import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, parseAmount } from '../src/shared/accounting.js';
import type { SalesDashboardSummary } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const SCALE = 10n ** 12n;

function validDate(value: string): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function invoiceTotal(database: DatabaseSync, documentId: number): bigint {
  const lines = database.prepare(`
    SELECT quantity, unit_price FROM sales_document_lines WHERE document_id = ?
  `).all(documentId) as Row[];
  return lines.reduce((total, line) => {
    const product = parseAmount(String(line.quantity)) * parseAmount(String(line.unit_price));
    return total + (product + SCALE / 2n) / SCALE;
  }, 0n);
}

function returnTotal(database: DatabaseSync, returnId: number): bigint {
  const lines = database.prepare(`
    SELECT returned.quantity, invoice_line.unit_price
    FROM sales_return_lines AS returned
    INNER JOIN sales_document_lines AS invoice_line ON invoice_line.id = returned.invoice_line_id
    WHERE returned.return_id = ?
  `).all(returnId) as Row[];
  return lines.reduce((total, line) => {
    const product = parseAmount(String(line.quantity)) * parseAmount(String(line.unit_price));
    return total + (product + SCALE / 2n) / SCALE;
  }, 0n);
}

function getSummary(database: DatabaseSync, value: unknown): SalesDashboardSummary {
  if (!value || typeof value !== 'object') throw new Error('مرشحات لوحة المبيعات غير صالحة.');
  const filters = value as { from?: unknown; to?: unknown; customerId?: unknown; status?: unknown };
  if (typeof filters.from !== 'string' || typeof filters.to !== 'string'
    || !validDate(filters.from) || !validDate(filters.to)) throw new Error('نطاق تاريخ لوحة المبيعات غير صالح.');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.');
  if (filters.customerId !== null && filters.customerId !== undefined
    && (!Number.isSafeInteger(filters.customerId) || Number(filters.customerId) < 1)) {
    throw new Error('مرشح العميل غير صالح.');
  }
  const status = filters.status ?? 'all';
  if (status !== 'all' && status !== 'draft' && status !== 'approved' && status !== 'cancelled') {
    throw new Error('مرشح حالة المبيعات غير صالح.');
  }
  const customerId = filters.customerId === null || filters.customerId === undefined ? null : Number(filters.customerId);
  const range = (date: string): boolean => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  const statusMatches = (documentStatus: string): boolean => status === 'all' || status === documentStatus;

  const invoices = (database.prepare(`
    SELECT id, master_client_id, client_name, document_date, status
    FROM sales_documents WHERE document_type = 'invoice'
    ORDER BY document_date, id
  `).all() as Row[]).filter((row) =>
    range(String(row.document_date))
    && statusMatches(String(row.status))
    && (customerId === null || Number(row.master_client_id) === customerId),
  );
  const returns = (database.prepare(`
    SELECT id, customer_id, return_date, status
    FROM sales_returns ORDER BY return_date, id
  `).all() as Row[]).filter((row) =>
    range(String(row.return_date))
    && statusMatches(String(row.status))
    && (customerId === null || Number(row.customer_id) === customerId),
  );
  const actualInvoices = invoices.filter((row) => row.status === 'approved');
  const actualReturns = returns.filter((row) => row.status === 'approved');
  const grossSales = actualInvoices.reduce((sum, row) => sum + invoiceTotal(database, Number(row.id)), 0n);
  const approvedReturns = actualReturns.reduce((sum, row) => sum + returnTotal(database, Number(row.id)), 0n);

  const today = new Date();
  const firstMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const monthly = Array.from({ length: 12 }, (_value, index) => {
    const monthDate = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
    return {
      month: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
      sales: 0n,
      returns: 0n,
    };
  });
  const monthlyByKey = new Map(monthly.map((item) => [item.month, item]));
  for (const invoice of actualInvoices) {
    const item = monthlyByKey.get(String(invoice.document_date).slice(0, 7));
    if (item) item.sales += invoiceTotal(database, Number(invoice.id));
  }
  for (const salesReturn of actualReturns) {
    const item = monthlyByKey.get(String(salesReturn.return_date).slice(0, 7));
    if (item) item.returns += returnTotal(database, Number(salesReturn.id));
  }

  const customerTotals = new Map<number | null, { name: string; total: bigint }>();
  for (const invoice of actualInvoices) {
    const id = invoice.master_client_id === null ? null : Number(invoice.master_client_id);
    const existing = customerTotals.get(id) ?? {
      name: id === null ? String(invoice.client_name) : String(invoice.client_name),
      total: 0n,
    };
    existing.total += invoiceTotal(database, Number(invoice.id));
    customerTotals.set(id, existing);
  }
  const groups = (database.prepare(`
    SELECT master_client_id, MIN(client_name) AS name, SUM(1) AS invoice_count
    FROM sales_documents WHERE document_type = 'invoice' AND status = 'approved'
      AND (? = '' OR document_date >= ?)
      AND (? = '' OR document_date <= ?)
      AND (? IS NULL OR master_client_id = ?)
    GROUP BY master_client_id
  `).all(filters.from, filters.from, filters.to, filters.to, customerId, customerId) as Row[]);
  const names = new Map<number | null, string>(groups.map((row) => [
    row.master_client_id === null ? null : Number(row.master_client_id),
    String(row.name),
  ]));
  const topCustomers = [...customerTotals.entries()]
    .map(([id, value]) => ({ customerId: id, name: names.get(id) ?? value.name, total: formatAmount(value.total) }))
    .sort((left, right) => {
      const leftTotal = parseAmount(left.total);
      const rightTotal = parseAmount(right.total);
      return leftTotal === rightTotal ? left.name.localeCompare(right.name, 'ar') : leftTotal > rightTotal ? -1 : 1;
    })
    .slice(0, 5);
  const customers = Number((database.prepare('SELECT COUNT(*) AS count FROM customers').get() as Row).count);
  return {
    from: String(filters.from),
    to: String(filters.to),
    customerId,
    status,
    customers,
    invoices: invoices.length,
    returns: returns.length,
    grossSales: formatAmount(grossSales),
    approvedReturns: formatAmount(approvedReturns),
    netSales: formatAmount(grossSales - approvedReturns),
    monthly: monthly.map((item) => ({ month: item.month, sales: formatAmount(item.sales), returns: formatAmount(item.returns) })),
    topCustomers,
  };
}

export function registerSalesDashboardHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('sales:dashboard', (_event, filters: unknown) => getSummary(requireAuthentication(), filters));
}
