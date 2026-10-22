import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal, firstOpenAccountingDate, requirePostingAccount, reverseAccountingJournal } from './posting.js';
import type {
  InventoryDocumentLine,
  InventoryIssue,
  InventoryIssueInput,
  InventoryMovementLineInput,
  InventoryReceipt,
  InventoryReceiptInput,
  InventoryReceiptLineInput,
  InventoryReceiptLine,
  InventoryStockBalance,
  InventoryTransfer,
  InventoryTransferInput,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
type MovementDocumentKind = 'issue' | 'transfer';
type DocumentKind = MovementDocumentKind | 'receipt';
const SCALE = 10n ** 12n;

export function installInventoryDocumentSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS inventory_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      receipt_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      created_by TEXT NOT NULL DEFAULT 'admin',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS inventory_receipts_invoice_status ON inventory_receipts(invoice_id, status);
    CREATE TABLE IF NOT EXISTS inventory_receipt_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES inventory_receipts(id) ON DELETE CASCADE,
      invoice_line_id INTEGER NOT NULL REFERENCES purchase_invoice_lines(id) ON DELETE RESTRICT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      UNIQUE(receipt_id, invoice_line_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      issue_type TEXT NOT NULL DEFAULT 'internal' CHECK (issue_type IN ('internal', 'project')),
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      cost_center TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      created_by TEXT NOT NULL DEFAULT 'admin',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT NOT NULL DEFAULT '',
      journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      sales_invoice_id INTEGER REFERENCES sales_documents(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS inventory_issue_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES inventory_issues(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
      work_item_id INTEGER REFERENCES project_work_items(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      UNIQUE(issue_id, line_order),
      UNIQUE(issue_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      source_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      destination_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      transfer_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      created_by TEXT NOT NULL DEFAULT 'admin',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source_warehouse_id <> destination_warehouse_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      UNIQUE(transfer_id, line_order),
      UNIQUE(transfer_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_type TEXT NOT NULL CHECK (document_type IN ('opening', 'receipt', 'issue', 'transfer')),
      document_id INTEGER NOT NULL,
      document_line_id INTEGER NOT NULL,
      document_number TEXT NOT NULL,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'receipt', 'issue', 'transfer-out', 'transfer-in', 'reversal')),
      movement_date TEXT NOT NULL,
      quantity_delta TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      reversal_of_id INTEGER REFERENCES inventory_stock_movements(id) ON DELETE RESTRICT,
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(document_type, document_id, document_line_id, warehouse_id, movement_type),
      UNIQUE(reversal_of_id)
    );
    CREATE INDEX IF NOT EXISTS inventory_movements_item_warehouse ON inventory_stock_movements(item_id, warehouse_id, id);
    CREATE INDEX IF NOT EXISTS inventory_movements_document ON inventory_stock_movements(document_type, document_id);
  `);
  const issueColumns = new Set((database.prepare('PRAGMA table_info(inventory_issues)').all() as Row[]).map((row) => String(row.name)));
  if (!issueColumns.has('issue_type')) database.exec("ALTER TABLE inventory_issues ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'internal' CHECK (issue_type IN ('internal', 'project'))");
  if (!issueColumns.has('project_id')) database.exec('ALTER TABLE inventory_issues ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT');
  if (!issueColumns.has('cost_center')) database.exec("ALTER TABLE inventory_issues ADD COLUMN cost_center TEXT NOT NULL DEFAULT ''");
  if (!issueColumns.has('updated_at')) database.exec("ALTER TABLE inventory_issues ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!issueColumns.has('journal_entry_id')) database.exec('ALTER TABLE inventory_issues ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!issueColumns.has('reversal_journal_entry_id')) database.exec('ALTER TABLE inventory_issues ADD COLUMN reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!issueColumns.has('sales_invoice_id')) database.exec('ALTER TABLE inventory_issues ADD COLUMN sales_invoice_id INTEGER REFERENCES sales_documents(id) ON DELETE RESTRICT');
  const receiptColumns = new Set((database.prepare('PRAGMA table_info(inventory_receipts)').all() as Row[]).map((row) => String(row.name)));
  if (!receiptColumns.has('updated_at')) database.exec("ALTER TABLE inventory_receipts ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  const transferColumns = new Set((database.prepare('PRAGMA table_info(inventory_transfers)').all() as Row[]).map((row) => String(row.name)));
  if (!transferColumns.has('updated_at')) database.exec("ALTER TABLE inventory_transfers ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  const issueLineColumns = new Set((database.prepare('PRAGMA table_info(inventory_issue_lines)').all() as Row[]).map((row) => String(row.name)));
  if (!issueLineColumns.has('work_item_id')) database.exec('ALTER TABLE inventory_issue_lines ADD COLUMN work_item_id INTEGER REFERENCES project_work_items(id) ON DELETE RESTRICT');
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS inventory_opening_balance_ledger_insert
    AFTER INSERT ON inventory_opening_balances
    BEGIN
      INSERT OR IGNORE INTO inventory_stock_movements (
        document_type, document_id, document_line_id, document_number, item_id, unit_id, warehouse_id,
        movement_type, movement_date, quantity_delta, unit_cost, created_by, created_at
      )
      SELECT 'opening', NEW.id, NEW.id, 'OPEN-' || printf('%06d', NEW.id),
        NEW.item_id, items.base_unit_id, NEW.warehouse_id, 'opening',
        substr(NEW.created_at, 1, 10), NEW.quantity, NEW.unit_cost, 'admin', NEW.created_at
      FROM inventory_items AS items
      WHERE items.id = NEW.item_id;
    END;
  `);
  database.prepare(`
    INSERT OR IGNORE INTO inventory_stock_movements (
      document_type, document_id, document_line_id, document_number, item_id, unit_id, warehouse_id,
      movement_type, movement_date, quantity_delta, unit_cost, created_by, created_at
    )
    SELECT 'opening', balances.id, balances.id, 'OPEN-' || printf('%06d', balances.id),
      balances.item_id, items.base_unit_id, balances.warehouse_id, 'opening',
      substr(balances.created_at, 1, 10), balances.quantity, balances.unit_cost, 'admin', balances.created_at
    FROM inventory_opening_balances AS balances
    INNER JOIN inventory_items AS items ON items.id = balances.item_id
  `).run();
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
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

function signedAmount(value: string): bigint {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? -parseAmount(trimmed.slice(1)) : parseAmount(trimmed);
}

function formatSigned(value: bigint): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

function product(quantity: bigint, unitCost: bigint): bigint {
  const amount = quantity * unitCost;
  return amount >= 0n ? (amount + SCALE / 2n) / SCALE : -((-amount + SCALE / 2n) / SCALE);
}

function normalizeSigned(value: bigint): string {
  return formatSigned(value);
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`أدخل ${label} صالحًا.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} غير صالح.`);
  return value.trim();
}

function positiveId(value: unknown, label: string): number {
  if (!isId(value)) throw new Error(`${label} غير صالح.`);
  return value;
}

function getBalanceUnits(database: DatabaseSync, itemId: number, warehouseId: number): { quantity: bigint; value: bigint } {
  const rows = database.prepare(`
    SELECT quantity_delta, unit_cost FROM inventory_stock_movements
    WHERE item_id = ? AND warehouse_id = ? ORDER BY id
  `).all(itemId, warehouseId) as Row[];
  return rows.reduce<{ quantity: bigint; value: bigint }>((balance, row) => {
    const quantity = signedAmount(String(row.quantity_delta));
    const cost = parseAmount(String(row.unit_cost));
    return { quantity: balance.quantity + quantity, value: balance.value + product(quantity, cost) };
  }, { quantity: 0n, value: 0n });
}

function formatUnitCost(value: bigint, quantity: bigint): string {
  if (quantity === 0n) return '0';
  const scaled = value * SCALE / quantity;
  return formatSigned(scaled);
}

function listBalances(database: DatabaseSync): InventoryStockBalance[] {
  const rows = database.prepare(`
    SELECT movements.item_id, items.code AS item_code, items.name_ar AS item_name,
      movements.unit_id, units.name_ar AS unit_name, movements.warehouse_id,
      warehouses.code AS warehouse_code, warehouses.name AS warehouse_name,
      movements.quantity_delta, movements.unit_cost
    FROM inventory_stock_movements AS movements
    INNER JOIN inventory_items AS items ON items.id = movements.item_id
    INNER JOIN inventory_units AS units ON units.id = movements.unit_id
    INNER JOIN warehouses ON warehouses.id = movements.warehouse_id
    ORDER BY items.name_ar COLLATE NOCASE, warehouses.name COLLATE NOCASE, movements.id
  `).all() as Row[];
  const balances = new Map<string, InventoryStockBalance & { quantityUnits: bigint; valueUnits: bigint }>();
  for (const row of rows) {
    const itemId = Number(row.item_id);
    const warehouseId = Number(row.warehouse_id);
    const key = `${itemId}:${warehouseId}`;
    const balance = balances.get(key) ?? {
      itemId, itemCode: String(row.item_code), itemName: String(row.item_name),
      unitId: Number(row.unit_id), unitName: String(row.unit_name), warehouseId,
      warehouseCode: String(row.warehouse_code), warehouseName: String(row.warehouse_name),
      quantity: '0', unitCost: '0', totalCost: '0', quantityUnits: 0n, valueUnits: 0n,
    };
    const quantity = signedAmount(String(row.quantity_delta));
    balance.quantityUnits += quantity;
    balance.valueUnits += product(quantity, parseAmount(String(row.unit_cost)));
    balances.set(key, balance);
  }
  return [...balances.values()].map((balance) => ({
    itemId: balance.itemId, itemCode: balance.itemCode, itemName: balance.itemName, unitId: balance.unitId,
    unitName: balance.unitName, warehouseId: balance.warehouseId, warehouseCode: balance.warehouseCode,
    warehouseName: balance.warehouseName, quantity: formatSigned(balance.quantityUnits),
    unitCost: formatUnitCost(balance.valueUnits, balance.quantityUnits), totalCost: formatSigned(balance.valueUnits),
  }));
}

function validateLines(value: unknown): InventoryMovementLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new Error('أضف صنفًا واحدًا على الأقل.');
  const seen = new Set<number>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('بيانات أحد الأصناف غير صالحة.');
    const line = entry as Partial<InventoryMovementLineInput>;
    const itemId = positiveId(line.itemId, 'الصنف');
    const unitId = positiveId(line.unitId, 'الوحدة');
    const workItemId = line.workItemId === null || line.workItemId === undefined
      ? null : positiveId(line.workItemId, 'بند الأعمال');
    if (seen.has(itemId)) throw new Error('لا تكرر الصنف نفسه في السند؛ اجمع الكمية في بند واحد.');
    seen.add(itemId);
    if (typeof line.quantity !== 'string' || typeof line.unitCost !== 'string') throw new Error('الكمية أو التكلفة غير صالحة.');
    const quantity = parseAmount(line.quantity);
    const cost = parseAmount(line.unitCost);
    if (quantity <= 0n || cost < 0n) throw new Error('الكمية يجب أن تكون موجبة والتكلفة غير سالبة.');
    return { itemId, unitId, quantity: normalizeAmount(line.quantity), unitCost: normalizeAmount(line.unitCost), workItemId };
  });
}

function validateMovementLines(database: DatabaseSync, lines: InventoryMovementLineInput[]): void {
  for (const line of lines) {
    const row = database.prepare(`
      SELECT items.status AS item_status, items.base_unit_id, units.status AS unit_status
      FROM inventory_items AS items INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
      WHERE items.id = ?
    `).get(line.itemId) as Row | undefined;
    if (!row || row.item_status !== 'active' || row.unit_status !== 'active') throw new Error('اختر صنفًا ووحدة أساسية نشطين.');
    if (Number(row.base_unit_id) !== line.unitId) throw new Error('يجب استخدام الوحدة الأساسية للصنف؛ لا تتوفر تحويلات وحدات معتمدة.');
  }
}

function validateActiveWarehouse(database: DatabaseSync, warehouseId: number): void {
  const row = database.prepare('SELECT status FROM warehouses WHERE id = ?').get(warehouseId) as Row | undefined;
  if (!row || row.status !== 'active') throw new Error('اختر مخزنًا نشطًا موجودًا.');
}

function quantityTotal(lines: InventoryDocumentLine[]): string {
  return formatAmount(lines.reduce((sum, line) => sum + parseAmount(line.quantity), 0n));
}

function costTotal(lines: InventoryDocumentLine[]): string {
  return formatAmount(lines.reduce((sum, line) => sum + parseAmount(line.totalCost), 0n));
}

function mapDocumentLines(database: DatabaseSync, kind: DocumentKind, id: number, warehouseId: number): InventoryDocumentLine[] {
  const table = kind === 'issue' ? 'inventory_issue_lines' : 'inventory_transfer_lines';
  const fk = kind === 'issue' ? 'issue_id' : 'transfer_id';
  const rows = database.prepare(`
    SELECT lines.*, items.code AS item_code, items.name_ar AS item_name, units.name_ar AS unit_name
      , ${kind === 'issue' ? 'lines.work_item_id' : 'NULL'} AS work_item_id,
      work_items.code AS work_item_code, work_items.name AS work_item_name
    FROM ${table} AS lines
    INNER JOIN inventory_items AS items ON items.id = lines.item_id
    INNER JOIN inventory_units AS units ON units.id = lines.unit_id
    LEFT JOIN project_work_items AS work_items ON work_items.id = ${kind === 'issue' ? 'lines.work_item_id' : 'NULL'}
    WHERE lines.${fk} = ? ORDER BY lines.line_order
  `).all(id) as Row[];
  return rows.map((row) => {
    const balance = getBalanceUnits(database, Number(row.item_id), warehouseId);
    const quantity = String(row.quantity);
    const unitCost = String(row.unit_cost);
    return {
      id: Number(row.id), itemId: Number(row.item_id), unitId: Number(row.unit_id),
      itemCode: String(row.item_code), itemName: String(row.item_name), unitName: String(row.unit_name),
      workItemId: row.work_item_id === null || row.work_item_id === undefined ? null : Number(row.work_item_id),
      workItemCode: String(row.work_item_code ?? ''), workItemName: String(row.work_item_name ?? ''),
      quantity, unitCost, totalCost: formatAmount(product(parseAmount(quantity), parseAmount(unitCost))),
      availableQuantity: formatSigned(balance.quantity),
    };
  });
}

function readIssue(database: DatabaseSync, id: number): InventoryIssue {
  const row = database.prepare(`
    SELECT issues.*, warehouses.name AS warehouse_name, projects.code AS project_code, projects.name AS project_name
      , sales_invoice.document_number AS sales_invoice_number
    FROM inventory_issues AS issues
    INNER JOIN warehouses ON warehouses.id = issues.warehouse_id
    LEFT JOIN projects ON projects.id = issues.project_id
    LEFT JOIN sales_documents AS sales_invoice ON sales_invoice.id = issues.sales_invoice_id
    WHERE issues.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على سند الصرف.');
  const lines = mapDocumentLines(database, 'issue', id, Number(row.warehouse_id));
  return {
    id, number: String(row.number), warehouseId: Number(row.warehouse_id), warehouseName: String(row.warehouse_name),
    date: String(row.issue_date), reason: String(row.reason), notes: String(row.notes),
    projectId: row.project_id === null ? null : Number(row.project_id),
    costCenter: String(row.cost_center), issueType: String(row.issue_type) as InventoryIssue['issueType'],
    projectCode: String(row.project_code ?? ''), projectName: String(row.project_name ?? ''),
    salesInvoiceId: row.sales_invoice_id === null ? null : Number(row.sales_invoice_id),
    salesInvoiceNumber: String(row.sales_invoice_number ?? ''),
    status: String(row.status) as InventoryIssue['status'], createdAt: String(row.created_at),
    approvedAt: String(row.approved_at), cancelledAt: String(row.cancelled_at),
    totalQuantity: quantityTotal(lines), totalCost: costTotal(lines), lines,
  };
}

function readTransfer(database: DatabaseSync, id: number): InventoryTransfer {
  const row = database.prepare(`
    SELECT transfers.*, source.name AS source_name, destination.name AS destination_name
    FROM inventory_transfers AS transfers
    INNER JOIN warehouses AS source ON source.id = transfers.source_warehouse_id
    INNER JOIN warehouses AS destination ON destination.id = transfers.destination_warehouse_id
    WHERE transfers.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على مستند التحويل.');
  const lines = mapDocumentLines(database, 'transfer', id, Number(row.source_warehouse_id));
  return {
    id, number: String(row.number), sourceWarehouseId: Number(row.source_warehouse_id),
    destinationWarehouseId: Number(row.destination_warehouse_id), sourceWarehouseName: String(row.source_name),
    destinationWarehouseName: String(row.destination_name), date: String(row.transfer_date),
    notes: String(row.notes), status: String(row.status) as InventoryTransfer['status'],
    createdAt: String(row.created_at), approvedAt: String(row.approved_at), cancelledAt: String(row.cancelled_at),
    totalQuantity: quantityTotal(lines), totalCost: costTotal(lines), lines,
  };
}

function readReceipt(database: DatabaseSync, id: number): InventoryReceipt {
  const row = database.prepare(`
    SELECT receipts.*, invoice.number AS invoice_number, invoice.supplier_name, warehouse.name AS warehouse_name
    FROM inventory_receipts AS receipts
    INNER JOIN purchase_invoices AS invoice ON invoice.id = receipts.invoice_id
    INNER JOIN warehouses AS warehouse ON warehouse.id = receipts.warehouse_id
    WHERE receipts.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على إذن الاستلام.');
  const receiptRows = database.prepare(`
    SELECT receipt_lines.*, invoice_lines.item_code, invoice_lines.description, invoice_lines.unit,
      invoice_lines.quantity AS ordered_quantity
    FROM inventory_receipt_lines AS receipt_lines
    INNER JOIN purchase_invoice_lines AS invoice_lines ON invoice_lines.id = receipt_lines.invoice_line_id
    WHERE receipt_lines.receipt_id = ? ORDER BY receipt_lines.id
  `).all(id) as Row[];
  const lines: InventoryReceiptLine[] = receiptRows.map((line) => {
    const others = database.prepare(`
      SELECT receipt_lines.quantity FROM inventory_receipt_lines AS receipt_lines
      INNER JOIN inventory_receipts AS receipts ON receipts.id = receipt_lines.receipt_id
      WHERE receipt_lines.invoice_line_id = ? AND receipts.status <> 'cancelled' AND receipts.id <> ?
    `).all(Number(line.invoice_line_id), id) as Row[];
    const received = others.reduce((sum, other) => sum + parseAmount(String(other.quantity)), 0n);
    const ordered = parseAmount(String(line.ordered_quantity));
    const own = row.status === 'cancelled' ? 0n : parseAmount(String(line.quantity));
    return {
      id: Number(line.id), invoiceLineId: Number(line.invoice_line_id), itemId: Number(line.item_id), unitId: Number(line.unit_id),
      itemCode: String(line.item_code), description: String(line.description), unit: String(line.unit),
      quantity: String(line.quantity), orderedQuantity: String(line.ordered_quantity),
      previouslyReceived: formatAmount(received),
      remainingQuantity: formatAmount(ordered > received + own ? ordered - received - own : 0n),
      unitCost: String(line.unit_cost),
    };
  });
  return {
    id, number: String(row.number), invoiceId: Number(row.invoice_id), invoiceNumber: String(row.invoice_number),
    supplierName: String(row.supplier_name), warehouseId: Number(row.warehouse_id), warehouseName: String(row.warehouse_name),
    date: String(row.receipt_date), notes: String(row.notes), status: String(row.status) as InventoryReceipt['status'],
    createdAt: String(row.created_at), approvedAt: String(row.approved_at), cancelledAt: String(row.cancelled_at), lines,
  };
}

function saveReceipt(database: DatabaseSync, value: unknown): InventoryReceipt {
  if (!value || typeof value !== 'object') throw new Error('بيانات إذن الاستلام غير صالحة.');
  const input = value as Partial<InventoryReceiptInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم إذن الاستلام غير صالح.');
  const invoiceId = positiveId(input.invoiceId, 'فاتورة المشتريات');
  const warehouseId = positiveId(input.warehouseId, 'المخزن');
  const date = typeof input.date === 'string' && validDate(input.date) ? input.date : (() => { throw new Error('تاريخ الاستلام غير صالح.'); })();
  const notes = optionalText(input.notes, 'الملاحظات', 2000);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) throw new Error('أضف صنفًا واحدًا على الأقل للاستلام.');
  const seen = new Set<number>();
  const lines = input.lines.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('بيانات بند الاستلام غير صالحة.');
    const line = entry as Partial<InventoryReceiptLineInput>;
    const invoiceLineId = positiveId(line.invoiceLineId, 'بند فاتورة المشتريات');
    if (seen.has(invoiceLineId)) throw new Error('لا تكرر بند الفاتورة في إذن الاستلام.');
    seen.add(invoiceLineId);
    if (typeof line.quantity !== 'string' || parseAmount(line.quantity) <= 0n) throw new Error('كمية الاستلام يجب أن تكون موجبة.');
    return { invoiceLineId, quantity: normalizeAmount(line.quantity) };
  });
  return transaction(database, () => {
    const invoice = database.prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(invoiceId) as Row | undefined;
    if (!invoice || invoice.status === 'cancelled') throw new Error('اختر فاتورة مشتريات موجودة وغير ملغاة.');
    validateActiveWarehouse(database, warehouseId);
    const current = input.id === undefined ? null : database.prepare('SELECT status, invoice_id FROM inventory_receipts WHERE id = ?').get(input.id) as Row | undefined;
    if (input.id !== undefined && (!current || current.status !== 'draft')) throw new Error('يمكن تعديل مسودة إذن الاستلام فقط.');
    if (current && Number(current.invoice_id) !== invoiceId) throw new Error('لا يمكن تغيير فاتورة المصدر بعد إنشاء الإذن.');
    const invoiceLines = database.prepare(`
      SELECT id, item_id, unit_id, quantity, unit_price FROM purchase_invoice_lines WHERE invoice_id = ?
    `).all(invoiceId) as Row[];
    const sourceById = new Map(invoiceLines.map((line) => [Number(line.id), line]));
    for (const line of lines) {
      const source = sourceById.get(line.invoiceLineId);
      if (!source || source.item_id === null || source.unit_id === null) {
        throw new Error('يتطلب إذن الاستلام صنفًا ووحدة مرتبطين بدليل المخزون في الفاتورة.');
      }

      const item = database.prepare(`
        SELECT items.status, units.status AS unit_status, items.base_unit_id
        FROM inventory_items AS items INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
        WHERE items.id = ?
      `).get(Number(source.item_id)) as Row | undefined;
      if (!item || item.status !== 'active' || item.unit_status !== 'active' || Number(item.base_unit_id) !== Number(source.unit_id)) {
        throw new Error('لا يمكن إنشاء استلام لصنف أو وحدة غير نشطين أو بوحدة غير أساسية.');
      }
      const reserved = database.prepare(`
        SELECT receipt_lines.quantity FROM inventory_receipt_lines AS receipt_lines
        INNER JOIN inventory_receipts AS receipts ON receipts.id = receipt_lines.receipt_id
        WHERE receipt_lines.invoice_line_id = ? AND receipts.status <> 'cancelled'
          AND (? IS NULL OR receipts.id <> ?)
      `).all(line.invoiceLineId, input.id ?? null, input.id ?? null) as Row[];
      const alreadyReserved = reserved.reduce((sum, row) => sum + parseAmount(String(row.quantity)), 0n);
      const remaining = parseAmount(String(source.quantity)) - alreadyReserved;
      if (parseAmount(line.quantity) > remaining) {
        throw new Error(`كمية الاستلام تتجاوز المتبقي من الفاتورة (${formatAmount(remaining > 0n ? remaining : 0n)}).`);
      }
    }
    let id: number;
    if (input.id !== undefined) {
      database.prepare(`UPDATE inventory_receipts SET warehouse_id = ?, receipt_date = ?, notes = ?,
        updated_at = datetime('now') WHERE id = ?`).run(warehouseId, date, notes, input.id);
      id = input.id;
      database.prepare('DELETE FROM inventory_receipt_lines WHERE receipt_id = ?').run(id);
    } else {
      const result = database.prepare(`
        INSERT INTO inventory_receipts (number, invoice_id, warehouse_id, receipt_date, notes)
        VALUES ('', ?, ?, ?, ?)
      `).run(invoiceId, warehouseId, date, notes);
      id = Number(result.lastInsertRowid);
      database.prepare('UPDATE inventory_receipts SET number = ? WHERE id = ?').run(`GR-${String(id).padStart(6, '0')}`, id);
    }
    const insert = database.prepare(`
      INSERT INTO inventory_receipt_lines (receipt_id, invoice_line_id, item_id, unit_id, quantity, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      const source = sourceById.get(line.invoiceLineId)!;
      insert.run(id, line.invoiceLineId, Number(source.item_id), Number(source.unit_id), line.quantity, String(source.unit_price));
    }
    return readReceipt(database, id);
  });
}

function approveReceipt(database: DatabaseSync, idValue: unknown): InventoryReceipt {
  if (!isId(idValue)) throw new Error('رقم إذن الاستلام غير صالح.');
  return transaction(database, () => {
    const receipt = database.prepare('SELECT * FROM inventory_receipts WHERE id = ?').get(idValue) as Row | undefined;
    if (!receipt) throw new Error('لم يُعثر على إذن الاستلام.');
    if (receipt.status !== 'draft') throw new Error('لا يمكن اعتماد إذن الاستلام إلا إذا كان مسودة.');
    const invoice = database.prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(Number(receipt.invoice_id)) as Row | undefined;
    if (!invoice || invoice.status !== 'approved') throw new Error('يجب اعتماد فاتورة المشتريات المرتبطة قبل استلام أصنافها.');
    validateActiveWarehouse(database, Number(receipt.warehouse_id));
    const lines = database.prepare('SELECT * FROM inventory_receipt_lines WHERE receipt_id = ? ORDER BY id').all(idValue) as Row[];
    if (lines.length === 0) throw new Error('لا يمكن اعتماد إذن استلام بلا أصناف.');
    const sourceRows = database.prepare(`
      SELECT invoice_line.id, invoice_line.quantity, invoice_line.unit_price,
        item.purchase_account_id, item.inventory_account_id
      FROM purchase_invoice_lines AS invoice_line
      INNER JOIN inventory_items AS item ON item.id = invoice_line.item_id
      WHERE invoice_line.invoice_id = ?
    `).all(Number(receipt.invoice_id)) as Row[];
    const sourceById = new Map(sourceRows.map((row) => [Number(row.id), row]));
    for (const line of lines) {
      const source = sourceById.get(Number(line.invoice_line_id));
      if (!source || Number(line.item_id) < 1 || Number(line.unit_id) < 1) {
        throw new Error('بند الاستلام لا يطابق صنفًا مرتبطًا بفاتورة المشتريات.');
      }
      if (source.purchase_account_id === null || source.inventory_account_id === null
        || Number(source.purchase_account_id) !== Number(source.inventory_account_id)) {
        throw new Error('يجب تطابق حساب الشراء وحساب المخزون قبل استلام الصنف.');
      }
      if (parseAmount(String(line.quantity)) <= 0n
        || parseAmount(String(line.quantity)) > parseAmount(String(source.quantity))
        || String(line.unit_cost) !== String(source.unit_price)) {
        throw new Error('كمية أو تكلفة بند الاستلام لا تطابق الفاتورة الأصلية.');
      }
    }
    for (const line of lines) insertMovement(database, {
      documentType: 'receipt', documentId: Number(idValue), documentLineId: Number(line.id),
      documentNumber: String(receipt.number), itemId: Number(line.item_id), unitId: Number(line.unit_id),
      warehouseId: Number(receipt.warehouse_id), movementType: 'receipt', date: String(receipt.receipt_date),
      quantity: parseAmount(String(line.quantity)), unitCost: String(line.unit_cost),
    });
    database.prepare(`UPDATE inventory_receipts SET status = 'approved', approved_at = datetime('now'),
      approved_by = 'admin' WHERE id = ? AND status = 'draft'`).run(idValue);
    return readReceipt(database, Number(idValue));
  });
}

function validateIssue(value: unknown): InventoryIssueInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات سند الصرف غير صالحة.');
  const input = value as Partial<InventoryIssueInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم سند الصرف غير صالح.');
  const projectId = input.projectId === undefined || input.projectId === null ? null : positiveId(input.projectId, 'المشروع');
  const salesInvoiceId = input.salesInvoiceId === undefined || input.salesInvoiceId === null
    ? null : positiveId(input.salesInvoiceId, 'فاتورة البيع');
  if (projectId !== null && salesInvoiceId !== null) throw new Error('لا يمكن ربط سند الصرف بمشروع وفاتورة بيع معًا.');
  return {
    id: input.id, warehouseId: positiveId(input.warehouseId, 'المخزن'),
    date: validDate(input.date) ? input.date : (() => { throw new Error('تاريخ الصرف غير صالح.'); })(),
    reason: requiredText(input.reason, 'سبب الصرف أو الجهة المستفيدة', 240),
    notes: optionalText(input.notes, 'الملاحظات', 2000),
    projectId,
    salesInvoiceId,
    costCenter: input.costCenter === undefined ? '' : optionalText(input.costCenter, 'مركز التكلفة', 160),
    lines: validateLines(input.lines),
  };
}

function validateProjectIssueLines(database: DatabaseSync, projectId: number, lines: InventoryMovementLineInput[]): string {
  const project = database.prepare('SELECT status, cost_center FROM projects WHERE id = ?').get(projectId) as Row | undefined;
  if (!project) throw new Error('المشروع المرتبط غير موجود.');
  if (project.status === 'completed' || project.status === 'cancelled' || project.status === 'on-hold') {
    throw new Error('لا يمكن صرف مواد لمشروع مكتمل أو متوقف أو ملغي.');
  }
  for (const line of lines) {
    if (line.workItemId === null || line.workItemId === undefined) throw new Error('اختر بند أعمال لكل مادة مصروفة للمشروع.');
    const workItem = database.prepare(`SELECT project_id, status FROM project_work_items WHERE id = ?`).get(line.workItemId) as Row | undefined;
    if (!workItem || Number(workItem.project_id) !== projectId || workItem.status !== 'active') {
      throw new Error('كل بند أعمال يجب أن يكون نشطًا ويتبع المشروع المحدد.');
    }
  }
  return String(project.cost_center);
}

function validateSalesIssueLines(database: DatabaseSync, invoiceId: number, issueId: number | null, lines: Row[]): void {
  const invoice = database.prepare(`SELECT document_type, status FROM sales_documents WHERE id = ?`).get(invoiceId) as Row | undefined;
  if (!invoice || invoice.document_type !== 'invoice' || invoice.status !== 'approved') {
    throw new Error('يرتبط صرف البيع بفاتورة بيع معتمدة فقط.');
  }
  const invoiceLines = database.prepare(`
    SELECT master_item_id, quantity FROM sales_document_lines WHERE document_id = ?
  `).all(invoiceId) as Row[];
  const quantitiesByItem = new Map(invoiceLines.map((line) => [
    Number(line.master_item_id), parseAmount(String(line.quantity)),
  ]));
  const previouslyIssued = database.prepare(`
    SELECT lines.item_id, lines.quantity FROM inventory_issue_lines AS lines
    INNER JOIN inventory_issues AS issues ON issues.id = lines.issue_id
    WHERE issues.sales_invoice_id = ? AND issues.status <> 'cancelled' AND (? IS NULL OR issues.id <> ?)
  `).all(issueId, issueId) as Row[];
  const issuedByItem = new Map<number, bigint>();
  for (const prior of previouslyIssued) {
    const itemId = Number(prior.item_id);
    issuedByItem.set(itemId, (issuedByItem.get(itemId) ?? 0n) + parseAmount(String(prior.quantity)));
  }
  for (const line of lines) {
    const itemId = Number(line.item_id);
    const invoiceQuantity = quantitiesByItem.get(itemId);
    if (invoiceQuantity === undefined) throw new Error('كل صنف في إذن صرف البيع يجب أن يكون ضمن الفاتورة المرتبطة.');
    const nextIssued = (issuedByItem.get(itemId) ?? 0n) + parseAmount(String(line.quantity));
    if (nextIssued > invoiceQuantity) throw new Error('كمية الصرف تتجاوز الكمية المعتمدة في الفاتورة بعد أذون الصرف السابقة.');
    issuedByItem.set(itemId, nextIssued);
  }
}

function validateTransfer(value: unknown): InventoryTransferInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات التحويل غير صالحة.');
  const input = value as Partial<InventoryTransferInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم التحويل غير صالح.');
  const sourceWarehouseId = positiveId(input.sourceWarehouseId, 'مخزن المصدر');
  const destinationWarehouseId = positiveId(input.destinationWarehouseId, 'مخزن الاستلام');
  if (sourceWarehouseId === destinationWarehouseId) throw new Error('يجب اختيار مخزنين مختلفين للتحويل.');
  return {
    id: input.id, sourceWarehouseId, destinationWarehouseId,
    date: validDate(input.date) ? input.date : (() => { throw new Error('تاريخ التحويل غير صالح.'); })(),
    notes: optionalText(input.notes, 'الملاحظات', 2000), lines: validateLines(input.lines),
  };
}

function saveMovementDocument(database: DatabaseSync, kind: MovementDocumentKind, value: unknown): InventoryIssue | InventoryTransfer {
  if (kind === 'issue') {
    const input = validateIssue(value);
    return transaction(database, () => {
      const projectId = input.projectId ?? null;
      const salesInvoiceId = input.salesInvoiceId ?? null;
      validateActiveWarehouse(database, input.warehouseId);
      validateMovementLines(database, input.lines);
      if (salesInvoiceId !== null) {
        const invoice = database.prepare(`SELECT document_type, status FROM sales_documents WHERE id = ?`).get(salesInvoiceId) as Row | undefined;
        if (!invoice || invoice.document_type !== 'invoice' || invoice.status !== 'approved') {
          throw new Error('يرتبط صرف البيع بفاتورة بيع معتمدة فقط.');
        }
      }
      const projectCostCenter = projectId === null ? '' : validateProjectIssueLines(database, projectId, input.lines);
      if (projectId === null && input.lines.some((line) => line.workItemId !== null && line.workItemId !== undefined)) {
        throw new Error('لا يمكن ربط بند أعمال بسند صرف داخلي.');
      }
      let id: number;
      if (input.id !== undefined) {
        const row = database.prepare('SELECT status FROM inventory_issues WHERE id = ?').get(input.id) as Row | undefined;
        if (!row || row.status !== 'draft') throw new Error('يمكن تعديل مسودة سند الصرف فقط.');
        database.prepare(`UPDATE inventory_issues SET warehouse_id = ?, issue_type = ?, project_id = ?, sales_invoice_id = ?,
          cost_center = ?, issue_date = ?, reason = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(input.warehouseId, projectId === null ? 'internal' : 'project', projectId, salesInvoiceId,
            projectCostCenter, input.date, input.reason, input.notes, input.id);
        id = input.id;
        database.prepare('DELETE FROM inventory_issue_lines WHERE issue_id = ?').run(id);
      } else {
        const result = database.prepare(`INSERT INTO inventory_issues
          (number, warehouse_id, issue_type, project_id, sales_invoice_id, cost_center, issue_date, reason, notes)
          VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.warehouseId, projectId === null ? 'internal' : 'project',
          projectId, salesInvoiceId, projectCostCenter, input.date, input.reason, input.notes);
        id = Number(result.lastInsertRowid);
        const prefix = projectId === null ? 'GI' : 'PM';
        database.prepare('UPDATE inventory_issues SET number = ? WHERE id = ?').run(`${prefix}-${String(id).padStart(6, '0')}`, id);
      }
      const insert = database.prepare(`INSERT INTO inventory_issue_lines (issue_id, line_order, item_id, unit_id, work_item_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      input.lines.forEach((line, index) => {
        const balance = projectId === null && salesInvoiceId === null ? null : getBalanceUnits(database, line.itemId, input.warehouseId);
        const unitCost = balance && balance.quantity > 0n ? formatUnitCost(balance.value, balance.quantity) : line.unitCost;
        insert.run(id, index + 1, line.itemId, line.unitId, line.workItemId ?? null, line.quantity, unitCost);
      });
      return readIssue(database, id);
    });
  }
  const input = validateTransfer(value);
  return transaction(database, () => {
    validateActiveWarehouse(database, input.sourceWarehouseId);
    validateActiveWarehouse(database, input.destinationWarehouseId);
    validateMovementLines(database, input.lines);
    let id: number;
    if (input.id !== undefined) {
      const row = database.prepare('SELECT status FROM inventory_transfers WHERE id = ?').get(input.id) as Row | undefined;
      if (!row || row.status !== 'draft') throw new Error('يمكن تعديل مسودة التحويل فقط.');
      database.prepare(`UPDATE inventory_transfers SET source_warehouse_id = ?, destination_warehouse_id = ?,
        transfer_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.sourceWarehouseId, input.destinationWarehouseId, input.date, input.notes, input.id);
      id = input.id;
      database.prepare('DELETE FROM inventory_transfer_lines WHERE transfer_id = ?').run(id);
    } else {
      const result = database.prepare(`INSERT INTO inventory_transfers (number, source_warehouse_id, destination_warehouse_id, transfer_date, notes)
        VALUES ('', ?, ?, ?, ?)`).run(input.sourceWarehouseId, input.destinationWarehouseId, input.date, input.notes);
      id = Number(result.lastInsertRowid);
      database.prepare('UPDATE inventory_transfers SET number = ? WHERE id = ?').run(`TR-${String(id).padStart(6, '0')}`, id);
    }
    const insert = database.prepare(`INSERT INTO inventory_transfer_lines (transfer_id, line_order, item_id, unit_id, quantity, unit_cost)
      VALUES (?, ?, ?, ?, ?, ?)`);
    input.lines.forEach((line, index) => insert.run(id, index + 1, line.itemId, line.unitId, line.quantity, line.unitCost));
    return readTransfer(database, id);
  });
}

function insertMovement(
  database: DatabaseSync,
  value: {
    documentType: 'receipt' | 'issue' | 'transfer';
    documentId: number;
    documentLineId: number;
    documentNumber: string;
    itemId: number;
    unitId: number;
    warehouseId: number;
    movementType: 'receipt' | 'issue' | 'transfer-out' | 'transfer-in' | 'reversal';
    date: string;
    quantity: bigint;
    unitCost: string;
    reversalOfId?: number;
  },
): void {
  database.prepare(`INSERT INTO inventory_stock_movements (
    document_type, document_id, document_line_id, document_number, item_id, unit_id, warehouse_id,
    movement_type, movement_date, quantity_delta, unit_cost, reversal_of_id, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`).run(
    value.documentType, value.documentId, value.documentLineId, value.documentNumber, value.itemId, value.unitId,
    value.warehouseId, value.movementType, value.date, normalizeSigned(value.quantity), value.unitCost, value.reversalOfId ?? null,
  );
}

function assertAvailable(database: DatabaseSync, itemId: number, warehouseId: number, quantity: bigint, cost: bigint): void {
  const balance = getBalanceUnits(database, itemId, warehouseId);
  if (balance.quantity < quantity) throw new Error(`الرصيد المتاح غير كافٍ للصنف (${formatAmount(balance.quantity > 0n ? balance.quantity : 0n)}).`);
  if (balance.value < product(quantity, cost)) throw new Error(`قيمة المخزون لا تكفي للتكلفة المحددة (${formatAmount(balance.value > 0n ? balance.value : 0n)}).`);
}

function approveIssue(database: DatabaseSync, id: unknown): InventoryIssue {
  if (!isId(id)) throw new Error('رقم سند الصرف غير صالح.');
  return transaction(database, () => {
    const issue = database.prepare('SELECT * FROM inventory_issues WHERE id = ?').get(id) as Row | undefined;
    if (!issue) throw new Error('لم يُعثر على سند الصرف.');
    if (issue.status !== 'draft') throw new Error('لا يمكن اعتماد سند إلا إذا كان مسودة.');
    validateActiveWarehouse(database, Number(issue.warehouse_id));
    const lines = database.prepare('SELECT * FROM inventory_issue_lines WHERE issue_id = ? ORDER BY line_order').all(id) as Row[];
    if (lines.length === 0) throw new Error('لا يمكن اعتماد سند صرف بلا أصناف.');
    const salesInvoiceId = issue.sales_invoice_id === null ? null : Number(issue.sales_invoice_id);
    if (issue.issue_type === 'project') {
      if (issue.project_id === null) throw new Error('سند صرف المشروع لا يحتوي على مشروع مرتبط.');
      validateProjectIssueLines(database, Number(issue.project_id), lines.map((line) => ({
        itemId: Number(line.item_id), unitId: Number(line.unit_id), quantity: String(line.quantity),
        unitCost: String(line.unit_cost), workItemId: line.work_item_id === null ? null : Number(line.work_item_id),
      })));
    }
    if (salesInvoiceId !== null) validateSalesIssueLines(database, salesInvoiceId, Number(id), lines);
    validateMovementLines(database, lines.map((line) => ({
      itemId: Number(line.item_id), unitId: Number(line.unit_id), quantity: String(line.quantity), unitCost: String(line.unit_cost),
    })));
    const expenseByAccount = new Map<number, bigint>();
    const inventoryByAccount = new Map<number, bigint>();
    for (const line of lines) {
      const balance = getBalanceUnits(database, Number(line.item_id), Number(issue.warehouse_id));
      if (balance.value < 0n || balance.quantity <= 0n) {
        throw new Error('لا يمكن اعتماد الصرف بسبب رصيد مخزون صفرية أو تكلفة غير سليم. سجّل استلامًا أو رصيدًا افتتاحيًا أولًا.');
      }
      // السياسة المعتمدة: كل الصرف (داخلي أو لمشروع) يقيد بمتوسط تكلفة المخزن وقت الاعتماد
      // حتى تظهر تكلفة صحيحة في تقارير المشروعات ومراكز التكلفة وقيمة المخزون.
      const unitCost = formatUnitCost(balance.value, balance.quantity);
      database.prepare('UPDATE inventory_issue_lines SET unit_cost = ? WHERE id = ?').run(unitCost, Number(line.id));
      assertAvailable(database, Number(line.item_id), Number(issue.warehouse_id), parseAmount(String(line.quantity)), parseAmount(unitCost));
      const item = database.prepare('SELECT inventory_account_id, expense_account_id, cogs_account_id FROM inventory_items WHERE id = ?')
        .get(Number(line.item_id)) as Row | undefined;
      const inventoryAccountId = requirePostingAccount(database,
        item?.inventory_account_id === null || item?.inventory_account_id === undefined ? null : Number(item.inventory_account_id),
        'asset', 'مخزون الصنف');
      const debitAccountId = requirePostingAccount(database,
        salesInvoiceId !== null
          ? item?.cogs_account_id === null || item?.cogs_account_id === undefined ? null : Number(item.cogs_account_id)
          : item?.expense_account_id === null || item?.expense_account_id === undefined ? null : Number(item.expense_account_id),
        'expense', salesInvoiceId !== null ? 'تكلفة البضاعة المباعة' : issue.issue_type === 'project' ? 'مصروف المشروع' : 'مصروف الصرف الداخلي');
      const amount = product(parseAmount(String(line.quantity)), parseAmount(unitCost));
      if (amount <= 0n) throw new Error('قيمة بند الصرف يجب أن تكون أكبر من صفر.');
      expenseByAccount.set(debitAccountId, (expenseByAccount.get(debitAccountId) ?? 0n) + amount);
      inventoryByAccount.set(inventoryAccountId, (inventoryByAccount.get(inventoryAccountId) ?? 0n) + amount);
      line.unit_cost = unitCost;
    }
    const journalLines = [
      ...[...expenseByAccount].map(([accountId, amount]) => ({
        accountId, debit: formatAmount(amount), credit: '0',
        description: salesInvoiceId !== null ? 'تكلفة بضاعة مباعة' : issue.issue_type === 'project' ? 'مصروف مواد المشروع' : 'مصروف مواد منصرفة',
        costCenterId: null,
      })),
      ...[...inventoryByAccount].map(([accountId, amount]) => ({
        accountId, debit: '0', credit: formatAmount(amount), description: 'إخراج من المخزون', costCenterId: null,
      })),
    ];
    const journalEntryId = createAccountingJournal(database, `INVENTORY-ISSUE-${id}`, String(issue.issue_date),
      `إذن صرف ${String(issue.number)}`, journalLines);
    for (const line of lines) insertMovement(database, {
      documentType: 'issue', documentId: Number(id), documentLineId: Number(line.id), documentNumber: String(issue.number),
      itemId: Number(line.item_id), unitId: Number(line.unit_id), warehouseId: Number(issue.warehouse_id),
      movementType: 'issue', date: String(issue.issue_date), quantity: -parseAmount(String(line.quantity)), unitCost: String(line.unit_cost),
    });
    database.prepare(`UPDATE inventory_issues SET status = 'approved', journal_entry_id = ?, approved_at = datetime('now'),
      approved_by = 'admin' WHERE id = ? AND status = 'draft'`).run(journalEntryId, id);
    return readIssue(database, Number(id));
  });
}

function approveTransfer(database: DatabaseSync, id: unknown): InventoryTransfer {
  if (!isId(id)) throw new Error('رقم التحويل غير صالح.');
  return transaction(database, () => {
    const transfer = database.prepare('SELECT * FROM inventory_transfers WHERE id = ?').get(id) as Row | undefined;
    if (!transfer) throw new Error('لم يُعثر على مستند التحويل.');
    if (transfer.status !== 'draft') throw new Error('لا يمكن اعتماد التحويل إلا إذا كان مسودة.');
    validateActiveWarehouse(database, Number(transfer.source_warehouse_id));
    validateActiveWarehouse(database, Number(transfer.destination_warehouse_id));
    const lines = database.prepare('SELECT * FROM inventory_transfer_lines WHERE transfer_id = ? ORDER BY line_order').all(id) as Row[];
    if (!lines.length) throw new Error('لا يمكن اعتماد تحويل بلا أصناف.');
    validateMovementLines(database, lines.map((line) => ({
      itemId: Number(line.item_id), unitId: Number(line.unit_id), quantity: String(line.quantity), unitCost: String(line.unit_cost),
    })));
    for (const line of lines) {
      const balance = getBalanceUnits(database, Number(line.item_id), Number(transfer.source_warehouse_id));
      if (balance.quantity <= 0n || balance.value < 0n) {
        throw new Error('لا يمكن اعتماد التحويل بسبب رصيد مخزون صفري أو تكلفة غير سليمة.');
      }
      const unitCost = formatUnitCost(balance.value, balance.quantity);
      assertAvailable(database, Number(line.item_id), Number(transfer.source_warehouse_id),
        parseAmount(String(line.quantity)), parseAmount(unitCost));
      database.prepare('UPDATE inventory_transfer_lines SET unit_cost = ? WHERE id = ?')
        .run(unitCost, Number(line.id));
      line.unit_cost = unitCost;
      const common = {
        documentType: 'transfer' as const, documentId: Number(id), documentLineId: Number(line.id),
        documentNumber: String(transfer.number), itemId: Number(line.item_id), unitId: Number(line.unit_id),
        date: String(transfer.transfer_date), unitCost,
      };
      insertMovement(database, { ...common, warehouseId: Number(transfer.source_warehouse_id), movementType: 'transfer-out', quantity: -parseAmount(String(line.quantity)) });
      insertMovement(database, { ...common, warehouseId: Number(transfer.destination_warehouse_id), movementType: 'transfer-in', quantity: parseAmount(String(line.quantity)) });
    }
    database.prepare(`UPDATE inventory_transfers SET status = 'approved', approved_at = datetime('now'),
      approved_by = 'admin' WHERE id = ? AND status = 'draft'`).run(id);
    return readTransfer(database, Number(id));
  });
}

function reverseDocument(database: DatabaseSync, kind: DocumentKind, id: number, record: Row): void {
  const movements = database.prepare(`
    SELECT * FROM inventory_stock_movements WHERE document_type = ? AND document_id = ?
      AND movement_type <> 'reversal' ORDER BY id
  `).all(kind, id) as Row[];
  if (movements.length === 0) throw new Error('لا توجد حركات أصلية موثقة لعكس هذا المستند.');
  const pending: Array<{ source: Row; warehouseId: number; quantity: bigint }> = [];
  for (const movement of movements) {
    const quantity = signedAmount(String(movement.quantity_delta));
    const reverseQuantity = -quantity;
    if (reverseQuantity < 0n) {
      const balance = getBalanceUnits(database, Number(movement.item_id), Number(movement.warehouse_id));
      if (balance.quantity < -reverseQuantity) throw new Error('تعذر الإلغاء العكسي: الكمية صُرفت أو نُقلت من المخزن بعد اعتماد المستند.');
      if (balance.value < product(-reverseQuantity, parseAmount(String(movement.unit_cost)))) {
        throw new Error('تعذر الإلغاء العكسي: تكلفة الكمية المتبقية في المخزن لا تكفي لعكس المستند.');
      }
    }
    pending.push({ source: movement, warehouseId: Number(movement.warehouse_id), quantity: reverseQuantity });
  }
  for (const entry of pending) {
    insertMovement(database, {
      documentType: kind, documentId: id, documentLineId: Number(entry.source.document_line_id),
      documentNumber: String(record.number), itemId: Number(entry.source.item_id), unitId: Number(entry.source.unit_id),
      warehouseId: entry.warehouseId, movementType: 'reversal', date: new Date().toISOString().slice(0, 10),
      quantity: entry.quantity, unitCost: String(entry.source.unit_cost), reversalOfId: Number(entry.source.id),
    });
  }
}

function cancelIssue(database: DatabaseSync, id: unknown): InventoryIssue {
  if (!isId(id)) throw new Error('رقم سند الصرف غير صالح.');
  return transaction(database, () => {
    const issue = database.prepare('SELECT * FROM inventory_issues WHERE id = ?').get(id) as Row | undefined;
    if (!issue || issue.status === 'cancelled') throw new Error('سند الصرف غير موجود أو ملغي بالفعل.');
    if (issue.status === 'approved') {
      reverseDocument(database, 'issue', Number(id), issue);
      const reversalDate = firstOpenAccountingDate(database, new Date().toISOString().slice(0, 10));
      const reversalId = reverseAccountingJournal(database, Number(issue.journal_entry_id),
        `INVENTORY-ISSUE-REV-${id}`, reversalDate, `عكس إذن صرف ${String(issue.number)}`);
      database.prepare('UPDATE inventory_issues SET reversal_journal_entry_id = ? WHERE id = ?').run(reversalId, id);
    }
    database.prepare(`UPDATE inventory_issues SET status = 'cancelled', cancelled_at = datetime('now')
      WHERE id = ? AND status <> 'cancelled'`).run(id);
    return readIssue(database, Number(id));
  });
}

function cancelReceipt(database: DatabaseSync, id: unknown): InventoryReceipt {
  if (!isId(id)) throw new Error('رقم إذن الاستلام غير صالح.');
  return transaction(database, () => {
    const receipt = database.prepare('SELECT * FROM inventory_receipts WHERE id = ?').get(id) as Row | undefined;
    if (!receipt || receipt.status === 'cancelled') throw new Error('إذن الاستلام غير موجود أو ملغي بالفعل.');
    if (receipt.status === 'approved') reverseDocument(database, 'receipt', Number(id), receipt);
    database.prepare(`UPDATE inventory_receipts SET status = 'cancelled', cancelled_at = datetime('now')
      WHERE id = ? AND status <> 'cancelled'`).run(id);
    return readReceipt(database, Number(id));
  });
}

function cancelTransfer(database: DatabaseSync, id: unknown): InventoryTransfer {
  if (!isId(id)) throw new Error('رقم التحويل غير صالح.');
  return transaction(database, () => {
    const transfer = database.prepare('SELECT * FROM inventory_transfers WHERE id = ?').get(id) as Row | undefined;
    if (!transfer || transfer.status === 'cancelled') throw new Error('التحويل غير موجود أو ملغي بالفعل.');
    if (transfer.status === 'approved') reverseDocument(database, 'transfer', Number(id), transfer);
    database.prepare(`UPDATE inventory_transfers SET status = 'cancelled', cancelled_at = datetime('now')
      WHERE id = ? AND status <> 'cancelled'`).run(id);
    return readTransfer(database, Number(id));
  });
}

function deleteDraft(database: DatabaseSync, table: 'inventory_receipts' | 'inventory_issues' | 'inventory_transfers', id: unknown): boolean {
  if (!isId(id)) throw new Error('رقم المستند غير صالح.');
  const result = database.prepare(`DELETE FROM ${table} WHERE id = ? AND status = 'draft'`).run(id);
  if (!result.changes) throw new Error('يمكن حذف المسودة فقط؛ ألغِ المستند المعتمد بعكس موثق.');
  return true;
}

export const inventoryDocumentService = {
  listBalances,
  saveReceipt,
  approveReceipt,
  cancelReceipt,
  saveMovementDocument,
  approveIssue,
  approveTransfer,
  cancelIssue,
  cancelTransfer,
  deleteDraft,
};

export function registerInventoryDocumentHandlers(getDatabase: () => DatabaseSync): void {
  ipcMain.handle('inventory:balances:list', () => listBalances(getDatabase()));
  ipcMain.handle('inventory:receipts:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT id FROM inventory_receipts ORDER BY receipt_date DESC, id DESC').all() as Row[])
      .map((row) => readReceipt(database, Number(row.id)));
  });
  ipcMain.handle('inventory:receipts:save', (_event, value: unknown) => saveReceipt(getDatabase(), value));
  ipcMain.handle('inventory:receipts:approve', (_event, id: unknown) => approveReceipt(getDatabase(), id));
  ipcMain.handle('inventory:receipts:cancel', (_event, id: unknown) => cancelReceipt(getDatabase(), id));
  ipcMain.handle('inventory:receipts:delete', (_event, id: unknown) => deleteDraft(getDatabase(), 'inventory_receipts', id));
  ipcMain.handle('inventory:issues:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT id FROM inventory_issues ORDER BY issue_date DESC, id DESC').all() as Row[])
      .map((row) => readIssue(database, Number(row.id)));
  });
  ipcMain.handle('inventory:issues:save', (_event, value: unknown) => saveMovementDocument(getDatabase(), 'issue', value));
  ipcMain.handle('inventory:issues:approve', (_event, id: unknown) => approveIssue(getDatabase(), id));
  ipcMain.handle('inventory:issues:cancel', (_event, id: unknown) => cancelIssue(getDatabase(), id));
  ipcMain.handle('inventory:issues:delete', (_event, id: unknown) => deleteDraft(getDatabase(), 'inventory_issues', id));
  ipcMain.handle('inventory:transfers:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT id FROM inventory_transfers ORDER BY transfer_date DESC, id DESC').all() as Row[])
      .map((row) => readTransfer(database, Number(row.id)));
  });
  ipcMain.handle('inventory:transfers:save', (_event, value: unknown) => saveMovementDocument(getDatabase(), 'transfer', value));
  ipcMain.handle('inventory:transfers:approve', (_event, id: unknown) => approveTransfer(getDatabase(), id));
  ipcMain.handle('inventory:transfers:cancel', (_event, id: unknown) => cancelTransfer(getDatabase(), id));
  ipcMain.handle('inventory:transfers:delete', (_event, id: unknown) => deleteDraft(getDatabase(), 'inventory_transfers', id));
}
