import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal, firstOpenAccountingDate, requirePostingAccount, reverseAccountingJournal } from './posting.js';
import type { SalesReturn, SalesReturnLineInput } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const SCALE = 10n ** 12n;

export function installSalesReturnSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sales_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT NOT NULL UNIQUE,
      invoice_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE RESTRICT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
      return_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sales_returns_invoice ON sales_returns(invoice_id, status);
    CREATE TABLE IF NOT EXISTS sales_return_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
      invoice_line_id INTEGER NOT NULL REFERENCES sales_document_lines(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      UNIQUE(return_id, invoice_line_id)
    );
    CREATE INDEX IF NOT EXISTS sales_return_lines_invoice_line ON sales_return_lines(invoice_line_id);
  `);
  const columns = new Set((database.prepare('PRAGMA table_info(sales_returns)').all() as Row[]).map((row) => String(row.name)));
  if (!columns.has('journal_entry_id')) database.exec('ALTER TABLE sales_returns ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!columns.has('reversal_journal_entry_id')) database.exec('ALTER TABLE sales_returns ADD COLUMN reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function transact<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function amount(quantity: string, price: string): bigint {
  const product = parseAmount(quantity) * parseAmount(price);
  return (product + SCALE / 2n) / SCALE;
}

function validateLines(value: unknown): SalesReturnLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new Error('أضف صنفًا واحدًا على الأقل للمرتجع.');
  return value.map((lineValue) => {
    if (!lineValue || typeof lineValue !== 'object') throw new Error('بيانات صنف المرتجع غير صالحة.');
    const line = lineValue as Partial<SalesReturnLineInput>;
    if (!isId(line.invoiceLineId) || typeof line.quantity !== 'string') throw new Error('الصنف أو الكمية المرتجعة غير صالحة.');
    const quantity = parseAmount(line.quantity);
    if (quantity <= 0n) throw new Error('يجب إدخال كمية مرتجعة أكبر من صفر.');
    return { invoiceLineId: line.invoiceLineId, quantity: normalizeAmount(line.quantity) };
  });
}

function asReturn(database: DatabaseSync, id: number): SalesReturn {
  const row = database.prepare(`
    SELECT returns.*, invoice.document_number AS invoice_number, invoice.document_date AS invoice_date,
      invoice.client_name AS customer_name
    FROM sales_returns AS returns
    INNER JOIN sales_documents AS invoice ON invoice.id = returns.invoice_id
    WHERE returns.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على مستند المرتجع.');
  const lines = database.prepare(`
    SELECT return_line.*, invoice_line.description, invoice_line.unit, invoice_line.quantity AS sold_quantity,
      invoice_line.unit_price
    FROM sales_return_lines AS return_line
    INNER JOIN sales_document_lines AS invoice_line ON invoice_line.id = return_line.invoice_line_id
    WHERE return_line.return_id = ?
    ORDER BY return_line.id
  `).all(id) as Row[];

  const mapped = lines.map((line) => {
    const quantity = String(line.quantity);
    const otherRows = database.prepare(`
      SELECT prior_line.quantity
      FROM sales_return_lines AS prior_line
      INNER JOIN sales_returns AS prior_return ON prior_return.id = prior_line.return_id
      WHERE prior_line.invoice_line_id = ?
        AND prior_return.status <> 'cancelled'
        AND prior_return.id <> ?
    `).all(Number(line.invoice_line_id), id) as Row[];
    const otherReserved = otherRows.reduce((sum, other) => sum + parseAmount(String(other.quantity)), 0n);
    const ownQuantity = row.status === 'cancelled' ? 0n : parseAmount(quantity);
    const returned = otherReserved + ownQuantity;
    const sold = parseAmount(String(line.sold_quantity));
    return {
      id: Number(line.id),
      invoiceLineId: Number(line.invoice_line_id),
      quantity,
      description: String(line.description),
      unit: String(line.unit),
      soldQuantity: String(line.sold_quantity),
      previouslyReturned: formatAmount(otherReserved),
      remainingQuantity: formatAmount(sold > returned ? sold - returned : 0n),
      unitPrice: String(line.unit_price),
      amount: formatAmount(amount(quantity, String(line.unit_price))),
    };
  });
  const total = mapped.reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  return {
    id: Number(row.id),
    number: String(row.return_number),
    invoiceId: Number(row.invoice_id),
    invoiceNumber: String(row.invoice_number),
    invoiceDate: String(row.invoice_date),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerName: String(row.customer_name),
    date: String(row.return_date),
    reason: String(row.reason),
    notes: String(row.notes),
    status: String(row.status) as SalesReturn['status'],
    total: formatAmount(total),
    createdAt: String(row.created_at),
    lines: mapped,
  };
}

function checkLineQuantities(
  database: DatabaseSync,
  invoiceId: number,
  lines: SalesReturnLineInput[],
  excludeReturnId: number | null,
): void {
  const invoiceLines = database.prepare(`
    SELECT id, quantity FROM sales_document_lines WHERE document_id = ?
  `).all(invoiceId) as Row[];
  const available = new Map<number, bigint>(invoiceLines.map((line) => [Number(line.id), parseAmount(String(line.quantity))]));
  const seen = new Set<number>();
  for (const line of lines) {
    const sold = available.get(line.invoiceLineId);
    if (sold === undefined || seen.has(line.invoiceLineId)) throw new Error('اختر كل صنف مرة واحدة من بنود الفاتورة الأصلية.');
    seen.add(line.invoiceLineId);
    const existingRows = database.prepare(`
      SELECT return_line.quantity
      FROM sales_return_lines AS return_line
      INNER JOIN sales_returns AS prior ON prior.id = return_line.return_id
      WHERE return_line.invoice_line_id = ?
        AND prior.status <> 'cancelled'
        AND (? IS NULL OR prior.id <> ?)
    `).all(line.invoiceLineId, excludeReturnId, excludeReturnId) as Row[];
    const alreadyReserved = existingRows.reduce((sum, row) => sum + parseAmount(String(row.quantity)), 0n);
    const nextQuantity = parseAmount(line.quantity);
    if (nextQuantity + alreadyReserved > sold) {
      throw new Error(`كمية المرتجع للصنف تتجاوز المتاح من الفاتورة بعد المرتجعات والمسودات السابقة (المتبقي: ${formatAmount(sold - alreadyReserved)}).`);
    }
  }
}

function saveReturn(database: DatabaseSync, value: unknown): SalesReturn {
  if (!value || typeof value !== 'object') throw new Error('بيانات المرتجع غير صالحة.');
  const input = value as { id?: unknown; invoiceId?: unknown; date?: unknown; reason?: unknown; notes?: unknown; lines?: unknown };
  const id = input.id;
  const invoiceId = input.invoiceId;
  const date = input.date;
  const reason = input.reason;
  const notes = input.notes;
  if (id !== undefined && !isId(id)) throw new Error('رقم المرتجع غير صالح.');
  if (!isId(invoiceId)) throw new Error('اختر فاتورة بيع أصلية معتمدة.');
  if (typeof date !== 'string' || !validDate(date)) throw new Error('تاريخ المرتجع غير صالح.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 240) throw new Error('أدخل سبب المرتجع.');
  if (typeof notes !== 'string' || notes.length > 2000) throw new Error('ملاحظات المرتجع تجاوزت الحد المسموح.');
  const lines = validateLines(input.lines);
  return transact(database, () => {
    const invoice = database.prepare(`
      SELECT id, document_type, status, master_client_id
      FROM sales_documents WHERE id = ?
    `).get(invoiceId) as Row | undefined;
    if (!invoice || invoice.document_type !== 'invoice' || invoice.status !== 'approved') {
      throw new Error('المرتجع مرتبط بفواتير البيع المعتمدة فقط.');
    }
    let returnId: number;
    if (id !== undefined) {
      const existing = database.prepare('SELECT invoice_id, status FROM sales_returns WHERE id = ?').get(id) as Row | undefined;
      if (!existing || existing.status !== 'draft') throw new Error('يمكن تعديل مسودة المرتجع فقط.');
      if (Number(existing.invoice_id) !== invoiceId) throw new Error('لا يمكن تغيير الفاتورة الأصلية بعد إنشاء المسودة.');
      returnId = id;
      checkLineQuantities(database, invoiceId, lines, returnId);
      database.prepare('DELETE FROM sales_return_lines WHERE return_id = ?').run(returnId);
      database.prepare(`
        UPDATE sales_returns SET return_date = ?, reason = ?, notes = ? WHERE id = ?
      `).run(date, reason.trim(), notes.trim(), returnId);
    } else {
      checkLineQuantities(database, invoiceId, lines, null);
      const result = database.prepare(`
        INSERT INTO sales_returns (return_number, invoice_id, customer_id, return_date, reason, notes)
        VALUES ('', ?, ?, ?, ?, ?)
      `).run(invoiceId, invoice.master_client_id, date, reason.trim(), notes.trim());
      returnId = Number(result.lastInsertRowid);
      database.prepare('UPDATE sales_returns SET return_number = ? WHERE id = ?')
        .run(`RET-${String(returnId).padStart(6, '0')}`, returnId);
    }
    const insert = database.prepare('INSERT INTO sales_return_lines (return_id, invoice_line_id, quantity) VALUES (?, ?, ?)');
    for (const line of lines) insert.run(returnId, line.invoiceLineId, line.quantity);
    return asReturn(database, returnId);
  });
}

export function registerSalesReturnHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('sales:returns:list', () => {
    const database = requireAuthentication();
    const rows = database.prepare('SELECT id FROM sales_returns ORDER BY return_date DESC, id DESC').all() as Row[];
    return rows.map((row) => asReturn(database, Number(row.id)));
  });
  ipcMain.handle('sales:returns:save', (_event, value: unknown) => saveReturn(requireAuthentication(), value));
  ipcMain.handle('sales:returns:approve', (_event, value: unknown) => approveReturn(requireAuthentication(), value));
  ipcMain.handle('sales:returns:cancel', (_event, value: unknown) => cancelReturn(requireAuthentication(), value));
  ipcMain.handle('sales:returns:delete', (_event, value: unknown) => {
    const database = requireAuthentication();
    if (!isId(value)) throw new Error('رقم المرتجع غير صالح.');
    const result = database.prepare("DELETE FROM sales_returns WHERE id = ? AND status = 'draft'").run(value);
    if (!result.changes) throw new Error('يمكن حذف مسودة المرتجع فقط.');
    return true;
  });
}

function approveReturn(database: DatabaseSync, value: unknown): SalesReturn {
  if (!isId(value)) throw new Error('رقم المرتجع غير صالح.');
  return transact(database, () => {
    const salesReturn = database.prepare('SELECT * FROM sales_returns WHERE id = ?').get(value) as Row | undefined;
    if (!salesReturn || salesReturn.status !== 'draft') throw new Error('يمكن اعتماد مسودة مرتجع فقط.');
    const invoice = database.prepare(`SELECT document_type, status, posted_customer_account_id
      FROM sales_documents WHERE id = ?`).get(Number(salesReturn.invoice_id)) as Row | undefined;
    if (!invoice || invoice.document_type !== 'invoice' || invoice.status !== 'approved') {
      throw new Error('يرتبط المرتجع بفاتورة بيع معتمدة فقط.');
    }
    const customerAccountId = requirePostingAccount(database,
      invoice.posted_customer_account_id === null ? null : Number(invoice.posted_customer_account_id), 'asset', 'ذمم العميل');
    const lines = database.prepare(`
      SELECT returns.invoice_line_id, returns.quantity, invoice_lines.posted_sales_account_id, invoice_lines.unit_price
      FROM sales_return_lines AS returns
      INNER JOIN sales_document_lines AS invoice_lines ON invoice_lines.id = returns.invoice_line_id
      WHERE returns.return_id = ? ORDER BY returns.id
    `).all(value) as Row[];
    if (lines.length === 0) throw new Error('لا يمكن اعتماد مرتجع بلا بنود.');
    const revenueByAccount = new Map<number, bigint>();
    let total = 0n;
    for (const line of lines) {
      const revenueAccountId = requirePostingAccount(database,
        line.posted_sales_account_id === null ? null : Number(line.posted_sales_account_id), 'revenue', 'إيراد الصنف المرتجع');
      const valueAmount = amount(String(line.quantity), String(line.unit_price));
      if (valueAmount <= 0n) throw new Error('قيمة بند المرتجع يجب أن تكون أكبر من صفر.');
      total += valueAmount;
      revenueByAccount.set(revenueAccountId, (revenueByAccount.get(revenueAccountId) ?? 0n) + valueAmount);
    }
    const journalLines = [
      ...[...revenueByAccount].map(([accountId, amountValue]) => ({
        accountId, debit: formatAmount(amountValue), credit: '0', description: 'عكس إيراد مرتجع مبيعات', costCenterId: null,
      })),
      { accountId: customerAccountId, debit: '0', credit: formatAmount(total), description: 'تخفيض ذمم العميل', costCenterId: null },
    ];
    const journalEntryId = createAccountingJournal(database, `SALES-RETURN-${value}`, String(salesReturn.return_date),
      `مرتجع مبيعات ${String(salesReturn.return_number)}`, journalLines);
    database.prepare(`UPDATE sales_returns SET status = 'approved', journal_entry_id = ?, approved_at = datetime('now')
      WHERE id = ? AND status = 'draft'`).run(journalEntryId, value);
    return asReturn(database, value);
  });
}

function cancelReturn(database: DatabaseSync, value: unknown): SalesReturn {
  if (!isId(value)) throw new Error('رقم المرتجع غير صالح.');
  return transact(database, () => {
    const salesReturn = database.prepare('SELECT * FROM sales_returns WHERE id = ?').get(value) as Row | undefined;
    if (!salesReturn || salesReturn.status !== 'approved') throw new Error('يمكن إلغاء مرتجع معتمد فقط.');
    const reversalDate = firstOpenAccountingDate(database, new Date().toISOString().slice(0, 10));
    const reversalId = reverseAccountingJournal(database, Number(salesReturn.journal_entry_id),
      `SALES-RETURN-REV-${value}`, reversalDate, `عكس مرتجع مبيعات ${String(salesReturn.return_number)}`);
    database.prepare(`UPDATE sales_returns SET status = 'cancelled', reversal_journal_entry_id = ?
      WHERE id = ? AND status = 'approved'`).run(reversalId, value);
    return asReturn(database, value);
  });
}
