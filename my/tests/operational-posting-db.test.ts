import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { installAccountingSchema } from '../electron/accounting.js';
import { installInventoryDocumentSchema, registerInventoryDocumentHandlers } from '../electron/inventory-documents.js';
import { installInventorySchema } from '../electron/inventory.js';
import { installPurchaseSchema, registerPurchaseHandlers } from '../electron/purchases.js';
import { installSalesSchema, registerSalesHandlers } from '../electron/sales.js';
import { installSalesMasterSchema } from '../electron/sales-masters.js';
import { installSalesReturnSchema, registerSalesReturnHandlers } from '../electron/sales-returns.js';
import { runReport } from '../electron/reports.js';
import { ipcHandlers } from './electron-stub.js';

type Row = Record<string, unknown>;

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  installAccountingSchema(database);
  database.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  installSalesMasterSchema(database);
  installSalesSchema(database);
  installSalesReturnSchema(database);
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      cost_center TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE project_work_items (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), code TEXT NOT NULL,
      name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  installInventorySchema(database);
  installPurchaseSchema(database);
  installInventoryDocumentSchema(database);
  ipcHandlers.clear();
  registerPurchaseHandlers(() => database);
  registerInventoryDocumentHandlers(() => database);
  registerSalesHandlers(() => database);
  registerSalesReturnHandlers(() => database);
  return database;
}

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = ipcHandlers.get(channel);
  assert.ok(handler, `Missing IPC handler ${channel}`);
  return handler({}, ...args) as T;
}

function addAccount(database: DatabaseSync, code: string, type: string): number {
  const result = database.prepare('INSERT INTO accounts (code, name, account_type, postable) VALUES (?, ?, ?, 1)')
    .run(code, code, type);
  return Number(result.lastInsertRowid);
}

function scalar(database: DatabaseSync, sql: string): number {
  return Number((database.prepare(sql).get() as Row).value);
}

test('purchase invoice, receipt, issue, and their reversals post once and keep stock and journals aligned', () => {
  const database = fixture();
  const inventoryAccount = addAccount(database, '1200', 'asset');
  const supplierAccount = addAccount(database, '2100', 'liability');
  const expenseAccount = addAccount(database, '5100', 'expense');
  database.prepare(`INSERT INTO suppliers (code, name, account_id, status) VALUES ('SUP-T', 'مورد اختبار', ?, 'active')`)
    .run(supplierAccount);
  database.prepare(`INSERT INTO inventory_units (code, name_ar) VALUES ('EA-T', 'قطعة')`).run();
  database.prepare(`INSERT INTO warehouses (code, name) VALUES ('WH-T', 'مخزن الاختبار')`).run();
  const unitId = Number((database.prepare('SELECT id FROM inventory_units').get() as Row).id);
  const warehouseId = Number((database.prepare('SELECT id FROM warehouses').get() as Row).id);
  database.prepare(`INSERT INTO inventory_items (
    code, name_ar, base_unit_id, inventory_account_id, purchase_account_id, expense_account_id
  ) VALUES ('ITEM-T', 'صنف اختبار', ?, ?, ?, ?)`).run(unitId, inventoryAccount, inventoryAccount, expenseAccount);
  const itemId = Number((database.prepare('SELECT id FROM inventory_items').get() as Row).id);
  const supplierId = Number((database.prepare('SELECT id FROM suppliers').get() as Row).id);

  const invoice = invoke<{ id: number; status: string; lines: Array<{ id: number }> }>('purchases:invoices:save', {
    supplierId, invoiceDate: '2026-04-01', dueDate: '', supplierInvoiceNumber: 'SUP-INV-1',
    paymentLink: 'unlinked', category: 'مخزون', project: '', costCenter: '', notes: '',
    lines: [{ itemId, unitId, itemCode: 'ITEM-T', description: 'صنف اختبار', unit: 'قطعة', quantity: '10', unitPrice: '10' }],
  });
  assert.equal(invoice.status, 'draft');
  assert.throws(() => invoke('inventory:receipts:approve', 999), /يُعثر/);

  const approvedInvoice = invoke<{ status: string }>('purchases:invoices:approve', invoice.id);
  assert.equal(approvedInvoice.status, 'approved');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 1);
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM inventory_stock_movements WHERE document_type <> 'opening'"), 0);
  assert.throws(() => invoke('purchases:invoices:approve', invoice.id), /مسودة/);

  const receipt = invoke<{ id: number; status: string }>('inventory:receipts:save', {
    invoiceId: invoice.id, warehouseId, date: '2026-04-02', notes: '',
    lines: [{ invoiceLineId: invoice.lines[0].id, quantity: '10' }],
  });
  assert.equal(invoke<{ status: string }>('inventory:receipts:approve', receipt.id).status, 'approved');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].quantity, '10');

  const issue = invoke<{ id: number; status: string }>('inventory:issues:save', {
    warehouseId, date: '2026-04-03', reason: 'صرف داخلي للاختبار', notes: '',
    projectId: null, costCenter: '',
    lines: [{ itemId, unitId, quantity: '3', unitCost: '0', workItemId: null }],
  });
  assert.equal(invoke<{ status: string }>('inventory:issues:approve', issue.id).status, 'approved');
  const remaining = invoke<Array<{ quantity: string; unitCost: string; totalCost: string }>>('inventory:balances:list')[0];
  assert.equal(remaining.quantity, '7');
  assert.equal(remaining.totalCost, '70');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 2);
  const issueJournal = database.prepare(`
    SELECT lines.account_id, lines.debit, lines.credit FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id WHERE entries.request_key = ?
    ORDER BY lines.line_order
  `).all(`INVENTORY-ISSUE-${issue.id}`) as Row[];
  assert.deepEqual(issueJournal.map((line) => [Number(line.account_id), String(line.debit), String(line.credit)]), [
    [expenseAccount, '30', '0'], [inventoryAccount, '0', '30'],
  ]);

  assert.equal(invoke<{ status: string }>('inventory:issues:cancel', issue.id).status, 'cancelled');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].quantity, '10');
  assert.equal(invoke<{ status: string }>('inventory:receipts:cancel', receipt.id).status, 'cancelled');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].quantity, '0');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].totalCost, '0');
  assert.equal(invoke<{ status: string }>('purchases:invoices:cancel', invoice.id).status, 'cancelled');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 4);
  assert.throws(() => invoke('purchases:invoices:cancel', invoice.id), /معتمدة فقط/);
  database.close();
});

test('purchase posting rejects missing or mismatched stock accounts without partial journals', () => {
  const database = fixture();
  const stockAccount = addAccount(database, '1200', 'asset');
  const otherAccount = addAccount(database, '1210', 'asset');
  const supplierAccount = addAccount(database, '2100', 'liability');
  database.prepare(`INSERT INTO suppliers (code, name, account_id, status) VALUES ('SUP-T', 'مورد اختبار', ?, 'active')`)
    .run(supplierAccount);
  database.prepare(`INSERT INTO inventory_units (code, name_ar) VALUES ('EA-T', 'قطعة')`).run();
  const unitId = Number((database.prepare('SELECT id FROM inventory_units').get() as Row).id);
  database.prepare(`INSERT INTO inventory_items (code, name_ar, base_unit_id, inventory_account_id, purchase_account_id)
    VALUES ('ITEM-T', 'صنف اختبار', ?, ?, ?)`).run(unitId, stockAccount, otherAccount);
  const itemId = Number((database.prepare('SELECT id FROM inventory_items').get() as Row).id);
  const supplierId = Number((database.prepare('SELECT id FROM suppliers').get() as Row).id);
  const invoice = invoke<{ id: number }>('purchases:invoices:save', {
    supplierId, invoiceDate: '2026-04-01', dueDate: '', supplierInvoiceNumber: '',
    paymentLink: 'unlinked', category: '', project: '', costCenter: '', notes: '',
    lines: [{ itemId, unitId, itemCode: 'ITEM-T', description: 'صنف اختبار', unit: 'قطعة', quantity: '1', unitPrice: '10' }],
  });
  assert.throws(() => invoke('purchases:invoices:approve', invoice.id), /يجب أن يطابق حساب المخزون/);
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 0);
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM purchase_invoices WHERE status = 'draft'"), 1);
  database.close();
});

test('sales estimate flows through work order and certificate to one receivable/revenue journal, then reverses once', () => {
  const database = fixture();
  const receivableAccount = addAccount(database, '1100', 'asset');
  const revenueAccount = addAccount(database, '4100', 'revenue');
  const inventoryAccount = addAccount(database, '1200', 'asset');
  const cogsAccount = addAccount(database, '5100', 'expense');
  database.prepare(`INSERT INTO customers (code, name, account_id, status) VALUES ('CUS-T', 'عميل اختبار', ?, 'active')`)
    .run(receivableAccount);
  database.prepare(`INSERT INTO inventory_units (code, name_ar) VALUES ('EA-T', 'قطعة')`).run();
  const unitId = Number((database.prepare('SELECT id FROM inventory_units').get() as Row).id);
  database.prepare(`INSERT INTO warehouses (code, name) VALUES ('WH-S', 'مخزن البيع')`).run();
  const warehouseId = Number((database.prepare('SELECT id FROM warehouses').get() as Row).id);
  database.prepare(`INSERT INTO inventory_items (code, name_ar, base_unit_id, inventory_account_id, sales_account_id, cogs_account_id)
    VALUES ('SALE-T', 'صنف بيع', ?, ?, ?, ?)`).run(unitId, inventoryAccount, revenueAccount, cogsAccount);
  const itemId = Number((database.prepare('SELECT id FROM inventory_items').get() as Row).id);
  database.prepare(`INSERT INTO inventory_opening_balances (item_id, warehouse_id, quantity, unit_cost)
    VALUES (?, ?, '5', '15')`).run(itemId, warehouseId);
  const customerId = Number((database.prepare('SELECT id FROM customers').get() as Row).id);

  const estimate = invoke<{ id: number; status: string }>('sales:save', {
    type: 'estimate', sourceDocumentId: null, masterClientId: customerId, clientName: 'عميل اختبار',
    date: '2026-04-01', reference: '', notes: '',
    lines: [{
      sourceDocumentLineId: null, sourceWorkOrderLineId: null, masterItemId: itemId,
      description: 'صنف بيع', unit: 'قطعة', quantity: '5', currentQuantity: '0', unitPrice: '20',
    }],
  });
  assert.equal(invoke<{ status: string }>('sales:approve', estimate.id).status, 'approved');
  const workOrder = invoke<{ id: number }>('sales:create-from', { sourceId: estimate.id, type: 'work-order' });
  assert.equal(invoke<{ status: string }>('sales:approve', workOrder.id).status, 'approved');
  const certificate = invoke<{ id: number; lines: Array<{ id: number; sourceDocumentLineId: number; sourceWorkOrderLineId: number }> }>(
    'sales:create-from', { sourceId: workOrder.id, type: 'certificate' },
  );
  const savedCertificate = invoke<{ id: number; lines: Array<{ id: number; sourceDocumentLineId: number; sourceWorkOrderLineId: number }> }>('sales:save', {
    id: certificate.id, type: 'certificate', sourceDocumentId: workOrder.id, masterClientId: customerId,
    clientName: 'عميل اختبار', date: '2026-04-03', reference: '', notes: '',
    lines: [{
      sourceDocumentLineId: certificate.lines[0].sourceDocumentLineId,
      sourceWorkOrderLineId: certificate.lines[0].sourceWorkOrderLineId,
      masterItemId: itemId, description: 'صنف بيع', unit: 'قطعة',
      quantity: '5', currentQuantity: '2', unitPrice: '20',
    }],
  });
  assert.equal(invoke<{ status: string }>('sales:approve', savedCertificate.id).status, 'approved');
  const invoice = invoke<{ id: number; lines: Array<{ id: number }> }>('sales:create-from', { sourceId: savedCertificate.id, type: 'invoice' });
  assert.equal(invoke<{ status: string; journalEntryId: number }>('sales:approve', invoice.id).status, 'approved');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 1);
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM inventory_stock_movements WHERE document_type <> 'opening'"), 0);
  const journal = database.prepare(`
    SELECT lines.account_id, lines.debit, lines.credit FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    WHERE entries.request_key = ?
    ORDER BY lines.line_order
  `).all(`SALES-INV-${invoice.id}`) as Row[];
  assert.deepEqual(journal.map((line) => [Number(line.account_id), String(line.debit), String(line.credit)]), [
    [receivableAccount, '40', '0'], [revenueAccount, '0', '40'],
  ]);
  const salesReturn = invoke<{ id: number; total: string }>('sales:returns:save', {
    invoiceId: invoice.id, date: '2026-04-04', reason: 'مرتجع جزئي', notes: '',
    lines: [{ invoiceLineId: invoice.lines[0].id, quantity: '1' }],
  });
  assert.equal(salesReturn.total, '20');
  assert.equal(invoke<{ status: string }>('sales:returns:approve', salesReturn.id).status, 'approved');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].quantity, '5');
  assert.throws(() => invoke('sales:cancel', invoice.id), /المستندات التابعة/);
  assert.equal(invoke<{ status: string }>('sales:returns:cancel', salesReturn.id).status, 'cancelled');
  const issue = invoke<{ id: number }>('inventory:issues:save', {
    warehouseId, date: '2026-04-04', reason: 'صرف مبيعات', notes: '', projectId: null, salesInvoiceId: invoice.id,
    lines: [{ itemId, unitId, quantity: '2', unitCost: '0', workItemId: null }],
  });
  assert.equal(invoke<{ status: string }>('inventory:issues:approve', issue.id).status, 'approved');
  assert.equal(invoke<Array<{ quantity: string; totalCost: string }>>('inventory:balances:list')[0].quantity, '3');
  const cogsJournal = database.prepare(`
    SELECT lines.account_id, lines.debit, lines.credit FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    WHERE entries.request_key = ? ORDER BY lines.line_order
  `).all(`INVENTORY-ISSUE-${issue.id}`) as Row[];
  assert.deepEqual(cogsJournal.map((line) => [Number(line.account_id), String(line.debit), String(line.credit)]), [
    [cogsAccount, '30', '0'], [inventoryAccount, '0', '30'],
  ]);
  assert.throws(() => invoke('sales:cancel', invoice.id), /أذون الصرف/);
  assert.equal(invoke<{ status: string }>('inventory:issues:cancel', issue.id).status, 'cancelled');
  assert.equal(invoke<{ status: string }>('sales:cancel', invoice.id).status, 'cancelled');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), 6);
  assert.throws(() => invoke('sales:approve', invoice.id), /حالته الحالية/);
  database.close();
});

test('inventory transfers preserve the source moving-average cost in stock balances and reports', () => {
  const database = fixture();
  const inventoryAccount = addAccount(database, 'TRANSFER-STOCK', 'asset');
  database.prepare(`INSERT INTO inventory_units (code, name_ar) VALUES ('TRANSFER-EA', 'قطعة')`).run();
  database.prepare(`INSERT INTO warehouses (code, name) VALUES ('TRANSFER-SOURCE', 'مخزن المصدر')`).run();
  database.prepare(`INSERT INTO warehouses (code, name) VALUES ('TRANSFER-DEST', 'مخزن الوجهة')`).run();
  const unitId = Number((database.prepare("SELECT id FROM inventory_units WHERE code = 'TRANSFER-EA'").get() as Row).id);
  const sourceWarehouseId = Number((database.prepare("SELECT id FROM warehouses WHERE code = 'TRANSFER-SOURCE'").get() as Row).id);
  const destinationWarehouseId = Number((database.prepare("SELECT id FROM warehouses WHERE code = 'TRANSFER-DEST'").get() as Row).id);
  database.prepare(`INSERT INTO inventory_items (code, name_ar, base_unit_id, inventory_account_id)
    VALUES ('TRANSFER-ITEM', 'صنف التحويل', ?, ?)`).run(unitId, inventoryAccount);
  const itemId = Number((database.prepare("SELECT id FROM inventory_items WHERE code = 'TRANSFER-ITEM'").get() as Row).id);
  database.prepare(`INSERT INTO inventory_opening_balances (item_id, warehouse_id, quantity, unit_cost)
    VALUES (?, ?, '10', '10')`).run(itemId, sourceWarehouseId);

  const transfer = invoke<{ id: number }>('inventory:transfers:save', {
    sourceWarehouseId, destinationWarehouseId, date: '2026-04-05', notes: '',
    lines: [{ itemId, unitId, quantity: '2', unitCost: '15', workItemId: null }],
  });
  const approved = invoke<{ status: string; lines: Array<{ unitCost: string }> }>('inventory:transfers:approve', transfer.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.lines[0].unitCost, '10');

  const balances = invoke<Array<{ warehouseId: number; quantity: string; totalCost: string }>>('inventory:balances:list');
  assert.deepEqual(
    balances.map(({ warehouseId, quantity, totalCost }) => [warehouseId, quantity, totalCost]),
    [[sourceWarehouseId, '8', '80'], [destinationWarehouseId, '2', '20']],
  );
  const report = runReport(database, { key: 'inventory-balances', filters: {} });
  assert.equal(report.totals.find(({ label }) => label === 'قيمة المخزون')?.value, '100');
  assert.equal(report.rows.find(({ warehouse }) => warehouse === 'مخزن المصدر')?.value, '80');
  assert.equal(report.rows.find(({ warehouse }) => warehouse === 'مخزن الوجهة')?.value, '20');

  assert.equal(invoke<{ status: string }>('inventory:transfers:cancel', transfer.id).status, 'cancelled');
  const reversed = invoke<Array<{ warehouseId: number; quantity: string; totalCost: string }>>('inventory:balances:list');
  assert.deepEqual(
    reversed.map(({ warehouseId, quantity, totalCost }) => [warehouseId, quantity, totalCost]),
    [[sourceWarehouseId, '10', '100'], [destinationWarehouseId, '0', '0']],
  );
  assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get() as Row).count), 0);
  database.close();
});

test('unsupported purchase return approval is rejected without financial or stock side effects', () => {
  const database = fixture();
  const inventoryAccount = addAccount(database, 'RETURN-STOCK', 'asset');
  const supplierAccount = addAccount(database, 'RETURN-SUPPLIER', 'liability');
  const expenseAccount = addAccount(database, 'RETURN-EXPENSE', 'expense');
  database.prepare(`INSERT INTO suppliers (code, name, account_id, status)
    VALUES ('RETURN-SUP', 'مورد المرتجع', ?, 'active')`).run(supplierAccount);
  database.prepare(`INSERT INTO inventory_units (code, name_ar) VALUES ('RETURN-EA', 'قطعة')`).run();
  const unitId = Number((database.prepare("SELECT id FROM inventory_units WHERE code = 'RETURN-EA'").get() as Row).id);
  database.prepare(`INSERT INTO inventory_items (
    code, name_ar, base_unit_id, inventory_account_id, purchase_account_id, expense_account_id
  ) VALUES ('RETURN-ITEM', 'صنف المرتجع', ?, ?, ?, ?)`)
    .run(unitId, inventoryAccount, inventoryAccount, expenseAccount);
  const itemId = Number((database.prepare("SELECT id FROM inventory_items WHERE code = 'RETURN-ITEM'").get() as Row).id);
  const supplierId = Number((database.prepare("SELECT id FROM suppliers WHERE code = 'RETURN-SUP'").get() as Row).id);
  const invoice = invoke<{ id: number; lines: Array<{ id: number }> }>('purchases:invoices:save', {
    supplierId, invoiceDate: '2026-04-06', dueDate: '', supplierInvoiceNumber: 'RETURN-INV-1',
    paymentLink: 'unlinked', category: 'مخزون', project: '', costCenter: '', notes: '',
    lines: [{ itemId, unitId, itemCode: 'RETURN-ITEM', description: 'صنف المرتجع', unit: 'قطعة', quantity: '2', unitPrice: '10' }],
  });
  invoke('purchases:invoices:approve', invoice.id);
  const purchaseReturn = invoke<{ id: number; status: string }>('purchases:returns:save', {
    invoiceId: invoice.id, date: '2026-04-07', reason: 'اختبار رفض اعتماد المرتجع', notes: '',
    lines: [{ invoiceLineId: invoice.lines[0].id, quantity: '1' }],
  });
  const journalCount = scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries');
  const movementCount = scalar(database, 'SELECT COUNT(*) AS value FROM inventory_stock_movements');

  assert.throws(() => invoke('purchases:returns:approve', purchaseReturn.id), /لا توجد خدمة مخزون أو ترحيل محاسبي موثق/);
  assert.equal(invoke<Array<{ id: number; status: string }>>('purchases:returns:list')
    .find(({ id }) => id === purchaseReturn.id)?.status, 'draft');
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM journal_entries'), journalCount);
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM inventory_stock_movements'), movementCount);
  database.close();
});
