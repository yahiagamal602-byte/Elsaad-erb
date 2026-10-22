import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal, firstOpenAccountingDate, requirePostingAccount, reverseAccountingJournal } from './posting.js';
import type {
  PurchaseDashboardSummary,
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLineInput,
  PurchaseReturn,
  PurchaseReturnLineInput,
  PurchaseStatus,
  Supplier,
  SupplierGroup,
  SupplierGroupInput,
  SupplierInput,
  SupplierStatus,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const SCALE = 10n ** 12n;

export function installPurchaseSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS supplier_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      trade_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      tax_number TEXT NOT NULL DEFAULT '',
      commercial_register TEXT NOT NULL DEFAULT '',
      group_id INTEGER REFERENCES supplier_groups(id) ON DELETE RESTRICT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS suppliers_group_status ON suppliers(group_id, status, name);
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      supplier_invoice_number TEXT NOT NULL DEFAULT '',
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      supplier_code TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      supplier_tax_number TEXT NOT NULL DEFAULT '',
      supplier_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      payment_link TEXT NOT NULL DEFAULT 'unlinked' CHECK (payment_link IN ('unlinked', 'cash', 'bank')),
      category TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      cost_center TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_date ON purchase_invoices(supplier_id, invoice_date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      item_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL,
      unit_price TEXT NOT NULL,
      UNIQUE(invoice_id, line_order)
    );
    CREATE INDEX IF NOT EXISTS purchase_invoice_lines_invoice ON purchase_invoice_lines(invoice_id, line_order);
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      return_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS purchase_returns_invoice_status ON purchase_returns(invoice_id, status);
    CREATE TABLE IF NOT EXISTS purchase_return_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      invoice_line_id INTEGER NOT NULL REFERENCES purchase_invoice_lines(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      UNIQUE(return_id, invoice_line_id)
    );
  `);
  const columns = database.prepare('PRAGMA table_info(purchase_invoice_lines)').all() as Row[];
  const columnNames = new Set(columns.map((column) => String(column.name)));
  if (!columnNames.has('item_id')) {
    database.exec('ALTER TABLE purchase_invoice_lines ADD COLUMN item_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT');
  }
  if (!columnNames.has('unit_id')) {
    database.exec('ALTER TABLE purchase_invoice_lines ADD COLUMN unit_id INTEGER REFERENCES inventory_units(id) ON DELETE RESTRICT');
  }
  const invoiceColumns = new Set((database.prepare('PRAGMA table_info(purchase_invoices)').all() as Row[]).map((column) => String(column.name)));
  if (!invoiceColumns.has('journal_entry_id')) database.exec('ALTER TABLE purchase_invoices ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!invoiceColumns.has('reversal_journal_entry_id')) database.exec('ALTER TABLE purchase_invoices ADD COLUMN reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  database.exec('CREATE INDEX IF NOT EXISTS purchase_invoice_lines_item ON purchase_invoice_lines(item_id)');
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function lineAmount(quantity: string, price: string): bigint {
  const product = parseAmount(quantity) * parseAmount(price);
  return (product + SCALE / 2n) / SCALE;
}

function validateSupplierGroup(value: unknown): SupplierGroupInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات مجموعة الموردين غير صالحة.');
  const input = value as Partial<SupplierGroupInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم المجموعة غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 40) throw new Error('أدخل كودًا صالحًا للمجموعة.');
  if (typeof input.nameAr !== 'string' || !input.nameAr.trim() || input.nameAr.length > 160) throw new Error('أدخل الاسم العربي للمجموعة.');
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 160) throw new Error('الاسم الإنجليزي للمجموعة غير صالح.');
  if (input.accountId !== null && !isId(input.accountId)) throw new Error('الحساب المرتبط بالمجموعة غير صالح.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة المجموعة غير صالحة.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات المجموعة تجاوزت الحد المسموح.');
  return { id: input.id, code: input.code.trim(), nameAr: input.nameAr.trim(), nameEn: input.nameEn.trim(), accountId: input.accountId, status: input.status, notes: input.notes.trim() };
}

function validateSupplier(value: unknown): SupplierInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات المورد غير صالحة.');
  const input = value as Partial<SupplierInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم المورد غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 40) throw new Error('أدخل كودًا صالحًا للمورد.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180) throw new Error('أدخل اسم المورد.');
  const limits = { tradeName: 180, phone: 60, email: 180, address: 500, city: 100, country: 100, taxNumber: 100, commercialRegister: 100, notes: 2000 } as const;
  const fields = Object.keys(limits) as Array<keyof typeof limits>;
  for (const field of fields) {
    const current = input[field];
    if (typeof current !== 'string' || current.length > limits[field]) throw new Error('أحد حقول المورد غير صالح أو تجاوز الحد المسموح.');
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error('صيغة البريد الإلكتروني غير صالحة.');
  if (input.groupId !== null && !isId(input.groupId)) throw new Error('مجموعة المورد غير صالحة.');
  if (input.accountId !== null && !isId(input.accountId)) throw new Error('الحساب المرتبط بالمورد غير صالح.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة المورد غير صالحة.');
  return {
    id: input.id, code: input.code.trim(), name: input.name.trim(),
    tradeName: input.tradeName!, phone: input.phone!, email: input.email!,
    address: input.address!, city: input.city!, country: input.country!,
    taxNumber: input.taxNumber!, commercialRegister: input.commercialRegister!,
    groupId: input.groupId, accountId: input.accountId, notes: input.notes!, status: input.status,
  };
}

function asSupplierGroup(row: Row): SupplierGroup {
  return {
    id: Number(row.id), code: String(row.code), nameAr: String(row.name_ar), nameEn: String(row.name_en),
    accountId: row.account_id === null ? null : Number(row.account_id), accountCode: String(row.account_code ?? ''),
    accountName: String(row.account_name ?? ''), status: String(row.status) as SupplierStatus,
    notes: String(row.notes), supplierCount: Number(row.supplier_count),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function asSupplier(row: Row): Supplier {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), tradeName: String(row.trade_name),
    phone: String(row.phone), email: String(row.email), address: String(row.address),
    city: String(row.city), country: String(row.country), taxNumber: String(row.tax_number),
    commercialRegister: String(row.commercial_register), groupId: row.group_id === null ? null : Number(row.group_id),
    accountId: row.account_id === null ? null : Number(row.account_id), accountCode: String(row.account_code ?? ''),
    accountName: String(row.account_name ?? ''), groupName: String(row.group_name ?? ''),
    notes: String(row.notes), status: String(row.status) as SupplierStatus,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function readSupplier(database: DatabaseSync, id: number): Supplier {
  const row = database.prepare(`
    SELECT suppliers.*, accounts.code AS account_code, accounts.name AS account_name, groups.name_ar AS group_name
    FROM suppliers LEFT JOIN accounts ON accounts.id = suppliers.account_id
    LEFT JOIN supplier_groups AS groups ON groups.id = suppliers.group_id
    WHERE suppliers.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على المورد.');
  return asSupplier(row);
}

function validateInvoice(value: unknown): PurchaseInvoiceInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات فاتورة المشتريات غير صالحة.');
  const input = value as Partial<PurchaseInvoiceInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم الفاتورة غير صالح.');
  if (!isId(input.supplierId)) throw new Error('اختر موردًا صالحًا.');
  if (typeof input.invoiceDate !== 'string' || !validDate(input.invoiceDate)) throw new Error('تاريخ الفاتورة غير صالح.');
  if (typeof input.dueDate !== 'string' || (input.dueDate !== '' && !validDate(input.dueDate))) throw new Error('تاريخ الاستحقاق غير صالح.');
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error('تاريخ الاستحقاق لا يسبق تاريخ الفاتورة.');
  if (typeof input.supplierInvoiceNumber !== 'string' || input.supplierInvoiceNumber.length > 100) throw new Error('رقم فاتورة المورد غير صالح.');
  if (input.paymentLink !== 'unlinked' && input.paymentLink !== 'cash' && input.paymentLink !== 'bank') throw new Error('اختيار ربط الدفع غير صالح.');
  const textFields = ['category', 'project', 'costCenter', 'notes'] as const;
  const limits = { category: 120, project: 160, costCenter: 160, notes: 2000 };
  for (const field of textFields) if (typeof input[field] !== 'string' || input[field].length > limits[field]) throw new Error('أحد حقول الفاتورة غير صالح.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) throw new Error('أضف بندًا واحدًا على الأقل للفاتورة.');
  const lines = input.lines.map((valueLine) => {
    if (!valueLine || typeof valueLine !== 'object') throw new Error('بيانات أحد بنود الفاتورة غير صالحة.');
    const line = valueLine as Partial<PurchaseInvoiceLineInput>;
    if (line.id !== undefined && !isId(line.id)) throw new Error('رقم بند الفاتورة غير صالح.');
    if (line.itemId !== undefined && line.itemId !== null && !isId(line.itemId)) throw new Error('الصنف المختار غير صالح.');
    if (line.unitId !== undefined && line.unitId !== null && !isId(line.unitId)) throw new Error('وحدة الصنف غير صالحة.');
    const itemId = line.itemId ?? null;
    const unitId = line.unitId ?? null;
    if ((itemId === null) !== (unitId === null)) throw new Error('اختر الصنف ووحدته معًا من الدليل.');
    if (typeof line.itemCode !== 'string' || line.itemCode.length > 80
      || typeof line.description !== 'string' || !line.description.trim() || line.description.length > 240
      || typeof line.unit !== 'string' || line.unit.length > 40
      || typeof line.quantity !== 'string' || typeof line.unitPrice !== 'string') {
      throw new Error('بيانات بند الفاتورة غير صالحة.');
    }
    const quantity = parseAmount(line.quantity);
    const price = parseAmount(line.unitPrice);
    if (quantity <= 0n || price < 0n) throw new Error('يجب أن تكون الكمية موجبة والسعر غير سالب.');
    return {
      id: line.id, itemId, unitId, itemCode: line.itemCode.trim(), description: line.description.trim(),
      unit: line.unit.trim(), quantity: normalizeAmount(line.quantity), unitPrice: normalizeAmount(line.unitPrice),
    };
  });
  return {
    id: input.id, supplierId: input.supplierId, invoiceDate: input.invoiceDate, dueDate: input.dueDate,
    supplierInvoiceNumber: input.supplierInvoiceNumber.trim(), paymentLink: input.paymentLink,
    category: input.category!.trim(), project: input.project!.trim(), costCenter: input.costCenter!.trim(),
    notes: input.notes!.trim(), lines,
  };
}

function readInvoice(database: DatabaseSync, id: number): PurchaseInvoice {
  const row = database.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على فاتورة المشتريات.');
  const lines = (database.prepare('SELECT * FROM purchase_invoice_lines WHERE invoice_id = ? ORDER BY line_order').all(id) as Row[]).map((line) => {
    const returns = database.prepare(`
      SELECT lines.quantity FROM purchase_return_lines AS lines
      INNER JOIN purchase_returns AS returns ON returns.id = lines.return_id
      WHERE lines.invoice_line_id = ? AND returns.status <> 'cancelled'
    `).all(Number(line.id)) as Row[];
    const returned = returns.reduce((sum, item) => sum + parseAmount(String(item.quantity)), 0n);
    const quantity = parseAmount(String(line.quantity));
    return {
      id: Number(line.id), itemId: line.item_id === null ? null : Number(line.item_id),
      unitId: line.unit_id === null ? null : Number(line.unit_id),
      itemCode: String(line.item_code), description: String(line.description), unit: String(line.unit),
      quantity: String(line.quantity), unitPrice: String(line.unit_price),
      amount: formatAmount(lineAmount(String(line.quantity), String(line.unit_price))),
      previouslyReturned: formatAmount(returned), remainingQuantity: formatAmount(quantity > returned ? quantity - returned : 0n),
    };
  });
  const total = lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  return {
    id: Number(row.id), number: String(row.number), supplierInvoiceNumber: String(row.supplier_invoice_number),
    supplierId: Number(row.supplier_id), supplierName: String(row.supplier_name), supplierCode: String(row.supplier_code),
    supplierTaxNumber: String(row.supplier_tax_number), invoiceDate: String(row.invoice_date), dueDate: String(row.due_date),
    paymentLink: String(row.payment_link) as PurchaseInvoice['paymentLink'], category: String(row.category),
    project: String(row.project), costCenter: String(row.cost_center), notes: String(row.notes),
    status: String(row.status) as PurchaseStatus, total: formatAmount(total),
    paidAmount: null, dueAmount: null, paymentStatus: 'unavailable',
    createdAt: String(row.created_at), lines,
  };
}

function validateReturnLines(value: unknown): PurchaseReturnLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new Error('أضف صنفًا واحدًا على الأقل للمرتجع.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('بيانات بند المرتجع غير صالحة.');
    const line = entry as Partial<PurchaseReturnLineInput>;
    if (!isId(line.invoiceLineId) || typeof line.quantity !== 'string') throw new Error('الصنف أو الكمية المرتجعة غير صالحة.');
    if (parseAmount(line.quantity) <= 0n) throw new Error('يجب أن تكون كمية المرتجع أكبر من صفر.');
    return { invoiceLineId: line.invoiceLineId, quantity: normalizeAmount(line.quantity) };
  });
}

function readReturn(database: DatabaseSync, id: number): PurchaseReturn {
  const row = database.prepare(`
    SELECT returns.*, invoice.number AS invoice_number, invoice.supplier_name
    FROM purchase_returns AS returns
    INNER JOIN purchase_invoices AS invoice ON invoice.id = returns.invoice_id
    WHERE returns.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على مرتجع المشتريات.');
  const lines = (database.prepare(`
    SELECT returned.*, invoice_line.item_code, invoice_line.description, invoice_line.unit,
      invoice_line.quantity AS sold_quantity, invoice_line.unit_price
    FROM purchase_return_lines AS returned
    INNER JOIN purchase_invoice_lines AS invoice_line ON invoice_line.id = returned.invoice_line_id
    WHERE returned.return_id = ? ORDER BY returned.id
  `).all(id) as Row[]).map((line) => {
    const other = database.prepare(`
      SELECT prior_line.quantity FROM purchase_return_lines AS prior_line
      INNER JOIN purchase_returns AS prior ON prior.id = prior_line.return_id
      WHERE prior_line.invoice_line_id = ? AND prior.status <> 'cancelled' AND prior.id <> ?
    `).all(Number(line.invoice_line_id), id) as Row[];
    const reserved = other.reduce((sum, item) => sum + parseAmount(String(item.quantity)), 0n);
    const sold = parseAmount(String(line.sold_quantity));
    const own = row.status === 'cancelled' ? 0n : parseAmount(String(line.quantity));
    return {
      id: Number(line.id), invoiceLineId: Number(line.invoice_line_id), quantity: String(line.quantity),
      itemCode: String(line.item_code), description: String(line.description), unit: String(line.unit),
      unitPrice: String(line.unit_price), soldQuantity: String(line.sold_quantity),
      previouslyReturned: formatAmount(reserved), remainingQuantity: formatAmount(sold > reserved + own ? sold - reserved - own : 0n),
      amount: formatAmount(lineAmount(String(line.quantity), String(line.unit_price))),
    };
  });
  return {
    id: Number(row.id), number: String(row.number), invoiceId: Number(row.invoice_id),
    invoiceNumber: String(row.invoice_number), supplierName: String(row.supplier_name),
    date: String(row.return_date), reason: String(row.reason), notes: String(row.notes),
    status: String(row.status) as PurchaseStatus,
    total: formatAmount(lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n)),
    createdAt: String(row.created_at), lines,
  };
}

function checkReturnQuantities(database: DatabaseSync, invoiceId: number, lines: PurchaseReturnLineInput[], exceptId: number | null): void {
  const invoiceLines = database.prepare('SELECT id, quantity FROM purchase_invoice_lines WHERE invoice_id = ?').all(invoiceId) as Row[];
  const available = new Map(invoiceLines.map((line) => [Number(line.id), parseAmount(String(line.quantity))]));
  const seen = new Set<number>();
  for (const line of lines) {
    const sold = available.get(line.invoiceLineId);
    if (sold === undefined || seen.has(line.invoiceLineId)) throw new Error('اختر كل بند مرة واحدة من الفاتورة الأصلية.');
    seen.add(line.invoiceLineId);
    const previous = database.prepare(`
      SELECT lines.quantity FROM purchase_return_lines AS lines
      INNER JOIN purchase_returns AS returns ON returns.id = lines.return_id
      WHERE lines.invoice_line_id = ? AND returns.status <> 'cancelled'
        AND (? IS NULL OR returns.id <> ?)
    `).all(line.invoiceLineId, exceptId, exceptId) as Row[];
    const reserved = previous.reduce((sum, item) => sum + parseAmount(String(item.quantity)), 0n);
    if (parseAmount(line.quantity) + reserved > sold) throw new Error(`الكمية تتجاوز المتبقي من الفاتورة: ${formatAmount(sold - reserved)}.`);
  }
}

function saveReturn(database: DatabaseSync, value: unknown): PurchaseReturn {
  if (!value || typeof value !== 'object') throw new Error('بيانات مرتجع المشتريات غير صالحة.');
  const input = value as { id?: unknown; invoiceId?: unknown; date?: unknown; reason?: unknown; notes?: unknown; lines?: unknown };
  const id = input.id;
  const invoiceId = input.invoiceId;
  const date = input.date;
  const reason = input.reason;
  const notes = input.notes;
  if (id !== undefined && !isId(id)) throw new Error('رقم المرتجع غير صالح.');
  if (!isId(invoiceId)) throw new Error('اختر فاتورة مشتريات أصلية.');
  if (typeof date !== 'string' || !validDate(date)) throw new Error('تاريخ المرتجع غير صالح.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 240) throw new Error('أدخل سبب المرتجع.');
  if (typeof notes !== 'string' || notes.length > 2000) throw new Error('ملاحظات المرتجع غير صالحة.');
  const lines = validateReturnLines(input.lines);
  return transaction(database, () => {
    const invoice = database.prepare('SELECT id, supplier_id, status FROM purchase_invoices WHERE id = ?').get(invoiceId) as Row | undefined;
    if (!invoice || invoice.status !== 'approved') throw new Error('يرتبط المرتجع بفاتورة مشتريات معتمدة فقط.');
    let returnId: number;
    if (id !== undefined) {
      const current = database.prepare('SELECT invoice_id, status FROM purchase_returns WHERE id = ?').get(id) as Row | undefined;
      if (!current || current.status !== 'draft') throw new Error('يمكن تعديل مسودة المرتجع فقط.');
      if (Number(current.invoice_id) !== invoiceId) throw new Error('لا يمكن تغيير الفاتورة الأصلية بعد إنشاء المسودة.');
      returnId = id;
      checkReturnQuantities(database, invoiceId, lines, returnId);
      database.prepare('DELETE FROM purchase_return_lines WHERE return_id = ?').run(returnId);
      database.prepare('UPDATE purchase_returns SET return_date = ?, reason = ?, notes = ? WHERE id = ?')
        .run(date, reason.trim(), notes.trim(), returnId);
    } else {
      checkReturnQuantities(database, invoiceId, lines, null);
      const result = database.prepare(`
        INSERT INTO purchase_returns (number, invoice_id, supplier_id, return_date, reason, notes)
        VALUES ('', ?, ?, ?, ?, ?)
      `).run(invoiceId, invoice.supplier_id, date, reason.trim(), notes.trim());
      returnId = Number(result.lastInsertRowid);
      database.prepare('UPDATE purchase_returns SET number = ? WHERE id = ?').run(`PR-${String(returnId).padStart(6, '0')}`, returnId);
    }
    const insert = database.prepare('INSERT INTO purchase_return_lines (return_id, invoice_line_id, quantity) VALUES (?, ?, ?)');
    for (const line of lines) insert.run(returnId, line.invoiceLineId, line.quantity);
    return readReturn(database, returnId);
  });
}

function setSupplierStatus(database: DatabaseSync, idValue: unknown, statusValue: unknown): Supplier {
  if (!isId(idValue) || (statusValue !== 'active' && statusValue !== 'inactive')) throw new Error('بيانات حالة المورد غير صالحة.');
  const changed = database.prepare("UPDATE suppliers SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(statusValue, idValue);
  if (!changed.changes) throw new Error('لم يُعثر على المورد.');
  return readSupplier(database, idValue);
}

function registerMasterHandlers(getDatabase: () => DatabaseSync): void {
  ipcMain.handle('purchases:supplier-groups:list', () => {
    const database = getDatabase();
    return (database.prepare(`
      SELECT groups.*, accounts.code AS account_code, accounts.name AS account_name, COUNT(suppliers.id) AS supplier_count
      FROM supplier_groups AS groups
      LEFT JOIN accounts ON accounts.id = groups.account_id
      LEFT JOIN suppliers ON suppliers.group_id = groups.id
      GROUP BY groups.id ORDER BY groups.name_ar COLLATE NOCASE
    `).all() as Row[]).map(asSupplierGroup);
  });
  ipcMain.handle('purchases:supplier-groups:save', (_event, value: unknown) => {
    const database = getDatabase();
    const group = validateSupplierGroup(value);
    if (group.accountId !== null) {
      const account = database.prepare('SELECT account_type FROM accounts WHERE id = ?').get(group.accountId) as Row | undefined;
      if (!account || account.account_type !== 'liability') throw new Error('يجب ربط المجموعة بحساب التزام موجود، أو ترك الحساب دون ربط.');
    }
    if (group.id !== undefined) {
      const result = database.prepare(`
        UPDATE supplier_groups SET code = ?, name_ar = ?, name_en = ?, account_id = ?, status = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(group.code, group.nameAr, group.nameEn, group.accountId, group.status, group.notes, group.id);
      if (!result.changes) throw new Error('لم يُعثر على مجموعة الموردين.');
      return asSupplierGroup(database.prepare(`
        SELECT groups.*, accounts.code AS account_code, accounts.name AS account_name, COUNT(suppliers.id) AS supplier_count
        FROM supplier_groups AS groups LEFT JOIN accounts ON accounts.id = groups.account_id
        LEFT JOIN suppliers ON suppliers.group_id = groups.id WHERE groups.id = ? GROUP BY groups.id
      `).get(group.id) as Row);
    }
    const result = database.prepare(`
      INSERT INTO supplier_groups (code, name_ar, name_en, account_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)
    `).run(group.code, group.nameAr, group.nameEn, group.accountId, group.status, group.notes);
    const id = Number(result.lastInsertRowid);
    return asSupplierGroup(database.prepare(`
      SELECT groups.*, accounts.code AS account_code, accounts.name AS account_name, 0 AS supplier_count
      FROM supplier_groups AS groups LEFT JOIN accounts ON accounts.id = groups.account_id WHERE groups.id = ?
    `).get(id) as Row);
  });
  ipcMain.handle('purchases:supplier-groups:status', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('بيانات حالة المجموعة غير صالحة.');
    const input = value as { id?: unknown; status?: unknown };
    if (!isId(input.id) || (input.status !== 'active' && input.status !== 'inactive')) throw new Error('بيانات حالة المجموعة غير صالحة.');
    const result = getDatabase().prepare("UPDATE supplier_groups SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.status, input.id);
    if (!result.changes) throw new Error('لم يُعثر على مجموعة الموردين.');
    const rows = (getDatabase().prepare(`
      SELECT groups.*, accounts.code AS account_code, accounts.name AS account_name, COUNT(suppliers.id) AS supplier_count
      FROM supplier_groups AS groups LEFT JOIN accounts ON accounts.id = groups.account_id
      LEFT JOIN suppliers ON suppliers.group_id = groups.id WHERE groups.id = ? GROUP BY groups.id
    `).get(input.id) as Row);
    return asSupplierGroup(rows);
  });
  ipcMain.handle('purchases:supplier-groups:delete', (_event, value: unknown) => {
    const database = getDatabase();
    if (!isId(value)) throw new Error('رقم المجموعة غير صالح.');
    if (database.prepare('SELECT 1 AS found FROM suppliers WHERE group_id = ? LIMIT 1').get(value)) {
      throw new Error('لا يمكن حذف مجموعة مرتبطة بموردين؛ عطّلها بدلًا من ذلك.');
    }
    const result = database.prepare('DELETE FROM supplier_groups WHERE id = ?').run(value);
    if (!result.changes) throw new Error('لم يُعثر على مجموعة الموردين.');
    return true;
  });
  ipcMain.handle('purchases:suppliers:list', () => {
    const database = getDatabase();
    return (database.prepare(`
      SELECT suppliers.*, accounts.code AS account_code, accounts.name AS account_name, groups.name_ar AS group_name
      FROM suppliers LEFT JOIN accounts ON accounts.id = suppliers.account_id
      LEFT JOIN supplier_groups AS groups ON groups.id = suppliers.group_id
      ORDER BY suppliers.name COLLATE NOCASE, suppliers.id
    `).all() as Row[]).map(asSupplier);
  });
  ipcMain.handle('purchases:suppliers:save', (_event, value: unknown) => {
    const database = getDatabase();
    const supplier = validateSupplier(value);
    if (supplier.groupId !== null) {
      const group = database.prepare('SELECT status FROM supplier_groups WHERE id = ?').get(supplier.groupId) as Row | undefined;
      const existing = supplier.id === undefined ? undefined : database.prepare('SELECT group_id FROM suppliers WHERE id = ?').get(supplier.id) as Row | undefined;
      const retainInactive = group?.status === 'inactive' && existing?.group_id !== null
        && existing?.group_id !== undefined && Number(existing.group_id) === supplier.groupId;
      if (!group || (group.status !== 'active' && !retainInactive)) throw new Error('اختر مجموعة موردين موجودة ونشطة.');
    }
    if (supplier.accountId !== null) {
      const account = database.prepare('SELECT account_type FROM accounts WHERE id = ?').get(supplier.accountId) as Row | undefined;
      if (!account || account.account_type !== 'liability') throw new Error('يجب اختيار حساب التزام موجود، أو ترك الحساب دون ربط.');
    }
    const fields = [supplier.code, supplier.name, supplier.tradeName, supplier.phone, supplier.email, supplier.address,
      supplier.city, supplier.country, supplier.taxNumber, supplier.commercialRegister, supplier.groupId,
      supplier.accountId, supplier.notes, supplier.status];
    if (supplier.id !== undefined) {
      const result = database.prepare(`
        UPDATE suppliers SET code=?, name=?, trade_name=?, phone=?, email=?, address=?, city=?, country=?,
          tax_number=?, commercial_register=?, group_id=?, account_id=?, notes=?, status=?, updated_at=datetime('now')
        WHERE id=?
      `).run(...fields, supplier.id);
      if (!result.changes) throw new Error('لم يُعثر على المورد.');
      return readSupplier(database, supplier.id);
    }
    const result = database.prepare(`
      INSERT INTO suppliers (code, name, trade_name, phone, email, address, city, country, tax_number,
        commercial_register, group_id, account_id, notes, status) VALUES (${fields.map(() => '?').join(',')})
    `).run(...fields);
    return readSupplier(database, Number(result.lastInsertRowid));
  });
  ipcMain.handle('purchases:suppliers:status', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('بيانات حالة المورد غير صالحة.');
    const input = value as { id?: unknown; status?: unknown };
    return setSupplierStatus(getDatabase(), input.id, input.status);
  });
  ipcMain.handle('purchases:suppliers:delete', (_event, value: unknown) => {
    const database = getDatabase();
    if (!isId(value)) throw new Error('رقم المورد غير صالح.');
    if (database.prepare(`
      SELECT 1 AS found FROM purchase_invoices WHERE supplier_id = ?
      UNION ALL SELECT 1 AS found FROM purchase_returns WHERE supplier_id = ? LIMIT 1
    `).get(value, value)) throw new Error('المورد مرتبط بفواتير أو مرتجعات؛ عطّله بدلًا من حذفه.');
    const result = database.prepare('DELETE FROM suppliers WHERE id = ?').run(value);
    if (!result.changes) throw new Error('لم يُعثر على المورد.');
    return true;
  });
}

function saveInvoice(database: DatabaseSync, value: unknown): PurchaseInvoice {
  const invoice = validateInvoice(value);
  return transaction(database, () => {
    const supplier = database.prepare('SELECT code, name, tax_number, account_id, status FROM suppliers WHERE id = ?')
      .get(invoice.supplierId) as Row | undefined;
    if (!supplier || supplier.status !== 'active') throw new Error('اختر موردًا موجودًا ونشطًا.');
    let id: number;
    if (invoice.id !== undefined) {
      const current = database.prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(invoice.id) as Row | undefined;
      if (!current || current.status !== 'draft') throw new Error('يمكن تعديل مسودة فاتورة المشتريات فقط.');
      database.prepare(`
        UPDATE purchase_invoices SET supplier_id=?, supplier_code=?, supplier_name=?, supplier_tax_number=?,
          supplier_account_id=?, supplier_invoice_number=?, invoice_date=?, due_date=?, payment_link=?,
          category=?, project=?, cost_center=?, notes=? WHERE id=?
      `).run(invoice.supplierId, supplier.code, supplier.name, supplier.tax_number, supplier.account_id,
        invoice.supplierInvoiceNumber, invoice.invoiceDate, invoice.dueDate, invoice.paymentLink, invoice.category,
        invoice.project, invoice.costCenter, invoice.notes, invoice.id);
      id = invoice.id;
      database.prepare('DELETE FROM purchase_invoice_lines WHERE invoice_id = ?').run(id);
    } else {
      const result = database.prepare(`
        INSERT INTO purchase_invoices (number, supplier_invoice_number, supplier_id, supplier_code, supplier_name,
          supplier_tax_number, supplier_account_id, invoice_date, due_date, payment_link, category, project, cost_center, notes)
        VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(invoice.supplierInvoiceNumber, invoice.supplierId, supplier.code, supplier.name, supplier.tax_number,
        supplier.account_id, invoice.invoiceDate, invoice.dueDate, invoice.paymentLink, invoice.category,
        invoice.project, invoice.costCenter, invoice.notes);
      id = Number(result.lastInsertRowid);
      database.prepare('UPDATE purchase_invoices SET number = ? WHERE id = ?').run(`PI-${String(id).padStart(6, '0')}`, id);
    }

    const insert = database.prepare(`
      INSERT INTO purchase_invoice_lines (invoice_id, line_order, item_code, description, unit, quantity, unit_price, item_id, unit_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    invoice.lines.forEach((line, index) => {
      const itemId = line.itemId ?? null;
      const unitId = line.unitId ?? null;
      let snapshot = line;
      if (itemId !== null && unitId !== null) {
        const item = database.prepare(`
          SELECT items.code, items.name_ar, items.status, items.purchasable, items.base_unit_id, units.status AS unit_status,
            units.name_ar AS unit_name
          FROM inventory_items AS items INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
          WHERE items.id = ?
        `).get(itemId) as Row | undefined;
        if (!item || item.status !== 'active' || Number(item.purchasable) !== 1 || item.unit_status !== 'active') {
          throw new Error('لا يمكن استخدام صنف أو وحدة غير نشطة أو صنف غير قابل للشراء في فاتورة جديدة.');
        }
        if (Number(item.base_unit_id) !== unitId) throw new Error('وحدة الشراء يجب أن تطابق الوحدة الأساسية للصنف؛ لا يتوفر تحويل وحدات تلقائي.');
        snapshot = { ...line, itemCode: String(item.code), description: String(item.name_ar), unit: String(item.unit_name) };
      }
      insert.run(id, index + 1, snapshot.itemCode, snapshot.description, snapshot.unit, snapshot.quantity,
        snapshot.unitPrice, itemId, unitId);
    });
    return readInvoice(database, id);
  });
}

function approveInvoice(database: DatabaseSync, idValue: unknown): PurchaseInvoice {
  if (!isId(idValue)) throw new Error('رقم الفاتورة غير صالح.');
  return transaction(database, () => {
    const invoice = database.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(idValue) as Row | undefined;
    if (!invoice) throw new Error('لم يُعثر على فاتورة المشتريات.');
    if (invoice.status !== 'draft') throw new Error('لا يمكن اعتماد فاتورة إلا إذا كانت مسودة.');
    const supplierAccountId = requirePostingAccount(database,
      invoice.supplier_account_id === null ? null : Number(invoice.supplier_account_id), 'liability', 'ذمم المورد');
    const lines = database.prepare(`
      SELECT lines.*, items.status AS item_status, items.purchasable, items.inventory_account_id, items.purchase_account_id,
        items.base_unit_id, units.status AS unit_status
      FROM purchase_invoice_lines AS lines
      LEFT JOIN inventory_items AS items ON items.id = lines.item_id
      LEFT JOIN inventory_units AS units ON units.id = lines.unit_id
      WHERE lines.invoice_id = ? ORDER BY lines.line_order
    `).all(idValue) as Row[];
    if (lines.length === 0) throw new Error('لا يمكن اعتماد فاتورة مشتريات بلا بنود.');
    const debits = new Map<number, bigint>();
    let total = 0n;
    for (const line of lines) {
      if (line.item_id === null || line.unit_id === null || line.item_status !== 'active'
        || Number(line.purchasable) !== 1 || line.unit_status !== 'active'
        || Number(line.base_unit_id) !== Number(line.unit_id)) {
        throw new Error('اعتماد المشتريات يتطلب صنفًا قابلًا للشراء ووحدة أساسية مرتبطة في كل بند.');
      }
      if (line.purchase_account_id === null || line.inventory_account_id === null
        || Number(line.purchase_account_id) !== Number(line.inventory_account_id)) {
        throw new Error(`حساب الشراء للصنف «${String(line.description)}» يجب أن يطابق حساب المخزون المعتمد.`);
      }
      const accountId = requirePostingAccount(database, Number(line.purchase_account_id), 'asset', 'المشتريات/المخزون');
      const amount = lineAmount(String(line.quantity), String(line.unit_price));
      if (amount <= 0n) throw new Error(`قيمة بند «${String(line.description)}» يجب أن تكون أكبر من صفر.`);
      total += amount;
      debits.set(accountId, (debits.get(accountId) ?? 0n) + amount);
    }
    if (total <= 0n) throw new Error('لا يمكن اعتماد فاتورة بإجمالي صفري.');
    const journalLines = [
      ...[...debits].map(([accountId, amount]) => ({
        accountId, debit: formatAmount(amount), credit: '0', description: 'مشتريات مخزنية', costCenterId: null,
      })),
      { accountId: supplierAccountId, debit: '0', credit: formatAmount(total), description: 'ذمم المورد', costCenterId: null },
    ];
    const entryId = createAccountingJournal(database, `PURCHASE-INV-${idValue}`, String(invoice.invoice_date),
      `فاتورة مشتريات ${String(invoice.number)}`, journalLines);
    database.prepare(`UPDATE purchase_invoices SET status = 'approved', journal_entry_id = ?, approved_at = datetime('now')
      WHERE id = ? AND status = 'draft'`).run(entryId, idValue);
    return readInvoice(database, idValue);
  });
}

function cancelInvoice(database: DatabaseSync, idValue: unknown): PurchaseInvoice {
  if (!isId(idValue)) throw new Error('رقم الفاتورة غير صالح.');
  return transaction(database, () => {
    const invoice = database.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(idValue) as Row | undefined;
    if (!invoice || invoice.status !== 'approved') throw new Error('يمكن إلغاء فاتورة مشتريات معتمدة فقط.');
    const activeReturn = database.prepare("SELECT 1 FROM purchase_returns WHERE invoice_id = ? AND status <> 'cancelled' LIMIT 1").get(idValue);
    const activeReceipt = database.prepare("SELECT 1 FROM inventory_receipts WHERE invoice_id = ? AND status <> 'cancelled' LIMIT 1").get(idValue);
    if (activeReturn || activeReceipt) throw new Error('ألغِ المرتجعات وأذون الاستلام المرتبطة أولًا.');
    const reversalDate = firstOpenAccountingDate(database, new Date().toISOString().slice(0, 10));
    const reversalId = reverseAccountingJournal(database, Number(invoice.journal_entry_id),
      `PURCHASE-INV-REV-${idValue}`, reversalDate, `عكس فاتورة مشتريات ${String(invoice.number)}`);
    database.prepare(`UPDATE purchase_invoices SET status = 'cancelled', reversal_journal_entry_id = ?
      WHERE id = ? AND status = 'approved'`).run(reversalId, idValue);
    return readInvoice(database, idValue);
  });
}

function validFilterDate(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || validDate(value));
}

function getDashboard(database: DatabaseSync, value: unknown): PurchaseDashboardSummary {
  if (!value || typeof value !== 'object') throw new Error('فلاتر لوحة المشتريات غير صالحة.');
  const filters = value as { from?: unknown; to?: unknown; supplierId?: unknown; status?: unknown; category?: unknown };
  if (!validFilterDate(filters.from) || !validFilterDate(filters.to)) throw new Error('تاريخ فلتر المشتريات غير صالح.');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.');
  if (filters.supplierId !== null && filters.supplierId !== undefined && !isId(filters.supplierId)) throw new Error('المورد المحدد غير صالح.');
  const status = filters.status ?? 'all';
  if (status !== 'all' && status !== 'draft' && status !== 'approved' && status !== 'cancelled') throw new Error('حالة الفاتورة غير صالحة.');
  if (typeof filters.category !== 'string') throw new Error('تصنيف المشتريات غير صالح.');
  const supplierId = filters.supplierId === null || filters.supplierId === undefined ? null : filters.supplierId;
  const from = filters.from;
  const to = filters.to;
  const category = filters.category.trim();
  const invoiceRows = database.prepare(`
    SELECT * FROM purchase_invoices
    WHERE (? = '' OR invoice_date >= ?) AND (? = '' OR invoice_date <= ?)
      AND (? IS NULL OR supplier_id = ?) AND (? = '' OR category = ?)
      AND (? = 'all' OR status = ?)
    ORDER BY invoice_date, id
  `).all(from, from, to, to, supplierId, supplierId, category, category, status, status) as Row[];
  const returnRows = database.prepare(`
    SELECT returns.id, returns.return_date, returns.status, returns.supplier_id, invoice.category
    FROM purchase_returns AS returns INNER JOIN purchase_invoices AS invoice ON invoice.id = returns.invoice_id
    WHERE (? = '' OR returns.return_date >= ?) AND (? = '' OR returns.return_date <= ?)
      AND (? IS NULL OR returns.supplier_id = ?) AND (? = '' OR invoice.category = ?)
      AND (? = 'all' OR returns.status = ?)
    ORDER BY returns.return_date, returns.id
  `).all(from, from, to, to, supplierId, supplierId, category, category, status, status) as Row[];
  const approvedInvoices = invoiceRows.filter((row) => row.status === 'approved');
  const approvedReturns = returnRows.filter((row) => row.status === 'approved');
  const invoiceTotal = (id: number): bigint => (database.prepare('SELECT quantity, unit_price FROM purchase_invoice_lines WHERE invoice_id = ?').all(id) as Row[])
    .reduce((sum, line) => sum + lineAmount(String(line.quantity), String(line.unit_price)), 0n);
  const returnTotal = (id: number): bigint => {
    const lines = database.prepare(`
      SELECT returned.quantity, invoice_line.unit_price FROM purchase_return_lines AS returned
      INNER JOIN purchase_invoice_lines AS invoice_line ON invoice_line.id = returned.invoice_line_id
      WHERE returned.return_id = ?
    `).all(id) as Row[];
    return lines.reduce((sum, line) => sum + lineAmount(String(line.quantity), String(line.unit_price)), 0n);
  };
  const gross = approvedInvoices.reduce((sum, row) => sum + invoiceTotal(Number(row.id)), 0n);
  const returnedTotal = approvedReturns.reduce((sum, row) => sum + returnTotal(Number(row.id)), 0n);
  const firstMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);
  const months = Array.from({ length: 12 }, (_unused, index) => {
    const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
    return { month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, purchases: 0n, returns: 0n };
  });
  const monthMap = new Map(months.map((month) => [month.month, month]));
  for (const row of approvedInvoices) monthMap.get(String(row.invoice_date).slice(0, 7))!.purchases += invoiceTotal(Number(row.id));
  for (const row of approvedReturns) monthMap.get(String(row.return_date).slice(0, 7))!.returns += returnTotal(Number(row.id));
  const supplierTotals = new Map<number, { name: string; total: bigint }>();
  for (const row of approvedInvoices) {
    const id = Number(row.supplier_id);
    const existing = supplierTotals.get(id) ?? { name: String(row.supplier_name), total: 0n };
    existing.total += invoiceTotal(Number(row.id));
    supplierTotals.set(id, existing);
  }
  const topSuppliers = [...supplierTotals.entries()].map(([id, item]) => ({ supplierId: id, name: item.name, total: formatAmount(item.total) }))
    .sort((a, b) => parseAmount(a.total) === parseAmount(b.total) ? a.name.localeCompare(b.name, 'ar') : parseAmount(a.total) > parseAmount(b.total) ? -1 : 1)
    .slice(0, 5);
  const itemTotals = new Map<string, { code: string; name: string; total: bigint }>();
  for (const row of approvedInvoices) {
    for (const line of database.prepare('SELECT item_code, description, quantity, unit_price FROM purchase_invoice_lines WHERE invoice_id = ?').all(Number(row.id)) as Row[]) {
      const code = String(line.item_code);
      const key = code ? `code:${code}` : `name:${String(line.description).trim().toLocaleLowerCase('ar')}`;
      const existing = itemTotals.get(key) ?? { code, name: String(line.description), total: 0n };
      existing.total += lineAmount(String(line.quantity), String(line.unit_price));
      itemTotals.set(key, existing);
    }
  }
  const topItems = [...itemTotals.values()].map((item) => ({ code: item.code, name: item.name, total: formatAmount(item.total) }))
    .sort((a, b) => parseAmount(a.total) > parseAmount(b.total) ? -1 : parseAmount(a.total) < parseAmount(b.total) ? 1 : a.name.localeCompare(b.name, 'ar'))
    .slice(0, 5);
  const statusRows = (database.prepare(`
    SELECT status, COUNT(*) AS count FROM purchase_invoices
    WHERE (? = '' OR invoice_date >= ?) AND (? = '' OR invoice_date <= ?)
      AND (? IS NULL OR supplier_id = ?) AND (? = '' OR category = ?)
    GROUP BY status
  `).all(from, from, to, to, supplierId, supplierId, category, category) as Row[]);
  const countFor = (key: PurchaseStatus): number => Number(statusRows.find((row) => row.status === key)?.count ?? 0);
  return {
    from, to, supplierId, status, category,
    invoiceCount: invoiceRows.length, returnCount: returnRows.length,
    grossPurchases: formatAmount(gross), returnsTotal: formatAmount(returnedTotal), netPurchases: formatAmount(gross - returnedTotal),
    paidAmount: null, dueAmount: null,
    monthly: months.map((month) => ({ month: month.month, purchases: formatAmount(month.purchases), returns: formatAmount(month.returns) })),
    statuses: (['draft', 'approved', 'cancelled'] as const).map((key) => ({ status: key, count: countFor(key) })),
    topSuppliers, topItems,
  };
}

export function registerPurchaseHandlers(getDatabase: () => DatabaseSync): void {
  registerMasterHandlers(getDatabase);
  ipcMain.handle('purchases:invoices:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT id FROM purchase_invoices ORDER BY invoice_date DESC, id DESC').all() as Row[])
      .map((row) => readInvoice(database, Number(row.id)));
  });
  ipcMain.handle('purchases:invoices:save', (_event, value: unknown) => saveInvoice(getDatabase(), value));
  ipcMain.handle('purchases:invoices:approve', (_event, value: unknown) => {
    return approveInvoice(getDatabase(), value);
  });
  ipcMain.handle('purchases:invoices:cancel', (_event, value: unknown) => cancelInvoice(getDatabase(), value));
  ipcMain.handle('purchases:invoices:delete', (_event, value: unknown) => {
    if (!isId(value)) throw new Error('رقم الفاتورة غير صالح.');
    const result = getDatabase().prepare("DELETE FROM purchase_invoices WHERE id = ? AND status = 'draft'").run(value);
    if (!result.changes) throw new Error('يمكن حذف مسودة الفاتورة فقط.');
    return true;
  });
  ipcMain.handle('purchases:returns:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT id FROM purchase_returns ORDER BY return_date DESC, id DESC').all() as Row[])
      .map((row) => readReturn(database, Number(row.id)));
  });
  ipcMain.handle('purchases:returns:save', (_event, value: unknown) => saveReturn(getDatabase(), value));
  ipcMain.handle('purchases:returns:approve', (_event, value: unknown) => {
    getDatabase();
    if (!isId(value)) throw new Error('رقم المرتجع غير صالح.');
    throw new Error('تعذّر اعتماد المرتجع: لا توجد خدمة مخزون أو ترحيل محاسبي موثق؛ لم يتغير المخزون أو رصيد المورد أو أي دفعة.');
  });
  ipcMain.handle('purchases:returns:delete', (_event, value: unknown) => {
    if (!isId(value)) throw new Error('رقم المرتجع غير صالح.');
    const result = getDatabase().prepare("DELETE FROM purchase_returns WHERE id = ? AND status = 'draft'").run(value);
    if (!result.changes) throw new Error('يمكن حذف مسودة المرتجع فقط.');
    return true;
  });
  ipcMain.handle('purchases:dashboard', (_event, value: unknown) => getDashboard(getDatabase(), value));
}
