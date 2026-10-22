import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import type {
  AccountItem,
  InventoryItem,
  InventoryItemInput,
  InventoryUnit,
  InventoryUnitInput,
  Warehouse,
  WarehouseInput,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

export function installInventorySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS inventory_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name_ar TEXT NOT NULL COLLATE NOCASE UNIQUE,
      abbreviation TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
      base_unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
      purchase_price TEXT NOT NULL DEFAULT '0',
      sales_price TEXT NOT NULL DEFAULT '0',
      tax_rate TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      sellable INTEGER NOT NULL DEFAULT 1 CHECK (sellable IN (0, 1)),
      purchasable INTEGER NOT NULL DEFAULT 1 CHECK (purchasable IN (0, 1)),
      inventory_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      purchase_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      sales_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      cogs_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      expense_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_barcode_unique
      ON inventory_items(barcode COLLATE NOCASE) WHERE barcode <> '';
    CREATE INDEX IF NOT EXISTS inventory_items_name ON inventory_items(name_ar, id);
    CREATE TABLE IF NOT EXISTS inventory_opening_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      quantity TEXT NOT NULL,
      unit_cost TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(item_id, warehouse_id)
    );
    CREATE INDEX IF NOT EXISTS inventory_opening_warehouse ON inventory_opening_balances(warehouse_id, item_id);
  `);
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
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

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`أدخل ${label} صالحًا.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} غير صالح.`);
  return value.trim();
}

function validateStatus(value: unknown): 'active' | 'inactive' {
  if (value !== 'active' && value !== 'inactive') throw new Error('حالة السجل غير صالحة.');
  return value;
}

function validateOptionalAccount(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isId(value)) throw new Error(`الحساب المرتبط بـ${label} غير صالح.`);
  return value;
}

function validateUnit(value: unknown): InventoryUnitInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات وحدة القياس غير صالحة.');
  const input = value as Partial<InventoryUnitInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم الوحدة غير صالح.');
  return {
    id: input.id,
    code: requiredText(input.code, 'كود الوحدة', 40),
    nameAr: requiredText(input.nameAr, 'اسم الوحدة بالعربية', 100),
    abbreviation: optionalText(input.abbreviation, 'الاسم المختصر', 30),
    status: validateStatus(input.status),
  };
}

function validateWarehouse(value: unknown): WarehouseInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات المخزن غير صالحة.');
  const input = value as Partial<WarehouseInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم المخزن غير صالح.');
  return {
    id: input.id,
    code: requiredText(input.code, 'كود المخزن', 40),
    name: requiredText(input.name, 'اسم المخزن', 160),
    accountId: validateOptionalAccount(input.accountId, 'المخزن'),
    status: validateStatus(input.status),
  };
}

function validateItem(value: unknown): InventoryItemInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات الصنف غير صالحة.');
  const input = value as Partial<InventoryItemInput>;
  if (input.id !== undefined && !isId(input.id)) throw new Error('رقم الصنف غير صالح.');
  if (!isId(input.baseUnitId)) throw new Error('اختر وحدة قياس أساسية صالحة.');
  if (typeof input.sellable !== 'boolean' || typeof input.purchasable !== 'boolean') throw new Error('خيارات البيع والشراء غير صالحة.');

  const purchasePrice = requiredText(input.purchasePrice, 'سعر شراء', 40);
  const salesPrice = requiredText(input.salesPrice, 'سعر بيع', 40);
  if (parseAmount(purchasePrice) < 0n || parseAmount(salesPrice) < 0n) throw new Error('الأسعار لا يمكن أن تكون سالبة.');

  let taxRate = '';
  if (input.taxRate !== '' && input.taxRate !== null && input.taxRate !== undefined) {
    taxRate = requiredText(input.taxRate, 'نسبة الضريبة', 20);
    const rate = Number(taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('أدخل نسبة ضريبة بين 0 و100، أو اتركها فارغة.');
    taxRate = normalizeAmount(taxRate);
  }

  const openingWarehouseId = input.openingWarehouseId ?? null;
  const openingQuantity = input.openingQuantity ?? '';
  const openingUnitCost = input.openingUnitCost ?? '';
  const hasOpeningData = openingWarehouseId !== null || openingQuantity !== '' || openingUnitCost !== '';
  if (hasOpeningData) {
    if (!isId(openingWarehouseId)) throw new Error('اختر مخزنًا للرصيد الافتتاحي.');
    if (typeof openingQuantity !== 'string' || typeof openingUnitCost !== 'string') throw new Error('بيانات الرصيد الافتتاحي غير صالحة.');
    if (parseAmount(openingQuantity) <= 0n || parseAmount(openingUnitCost) < 0n) throw new Error('كمية الرصيد الافتتاحي يجب أن تكون موجبة والتكلفة غير سالبة.');
  }

  return {
    id: input.id,
    code: requiredText(input.code, 'كود الصنف', 80),
    nameAr: requiredText(input.nameAr, 'اسم الصنف بالعربية', 180),
    nameEn: optionalText(input.nameEn, 'الاسم الإنجليزي', 180),
    barcode: optionalText(input.barcode, 'الباركود', 100),
    baseUnitId: input.baseUnitId,
    purchasePrice: normalizeAmount(purchasePrice),
    salesPrice: normalizeAmount(salesPrice),
    taxRate,
    status: validateStatus(input.status),
    sellable: input.sellable,
    purchasable: input.purchasable,
    inventoryAccountId: validateOptionalAccount(input.inventoryAccountId, 'المخزون'),
    purchaseAccountId: validateOptionalAccount(input.purchaseAccountId, 'المشتريات'),
    salesAccountId: validateOptionalAccount(input.salesAccountId, 'المبيعات'),
    cogsAccountId: validateOptionalAccount(input.cogsAccountId, 'تكلفة المبيعات'),
    expenseAccountId: validateOptionalAccount(input.expenseAccountId, 'المصروفات'),
    openingWarehouseId: hasOpeningData ? openingWarehouseId as number : null,
    openingQuantity: hasOpeningData ? normalizeAmount(openingQuantity as string) : '',
    openingUnitCost: hasOpeningData ? normalizeAmount(openingUnitCost as string) : '',
  };
}

function assertUnique(database: DatabaseSync, table: 'inventory_items' | 'inventory_units' | 'warehouses', column: 'code' | 'barcode' | 'name_ar', value: string, id?: number): void {
  if (!value) return;
  const suffix = id === undefined ? '' : ' AND id <> ?';
  const parameters = id === undefined ? [value] : [value, id];
  const row = database.prepare(`SELECT id FROM ${table} WHERE ${column} = ? COLLATE NOCASE${suffix}`).get(...parameters) as Row | undefined;
  if (row) {
    const labels = { code: 'الكود', barcode: 'الباركود', name_ar: 'اسم الوحدة' };
    throw new Error(`${labels[column]} مستخدم بالفعل.`);
  }
}

function assertAccount(database: DatabaseSync, id: number | null, label: string, allowedTypes: readonly string[]): void {
  if (id === null) return;
  const row = database.prepare('SELECT account_type FROM accounts WHERE id = ?').get(id) as Row | undefined;
  if (!row || !allowedTypes.includes(String(row.account_type))) throw new Error(`اختر حسابًا موجودًا مناسبًا لـ${label} أو اتركه دون ربط.`);
}

function mapUnit(row: Row): InventoryUnit {
  return {
    id: Number(row.id), code: String(row.code), nameAr: String(row.name_ar),
    abbreviation: String(row.abbreviation), status: String(row.status) as InventoryUnit['status'],
    itemCount: Number(row.item_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapWarehouse(row: Row): Warehouse {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name),
    accountId: row.account_id === null ? null : Number(row.account_id),
    accountCode: String(row.account_code ?? ''), accountName: String(row.account_name ?? ''),
    status: String(row.status) as Warehouse['status'], openingItemCount: Number(row.opening_item_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapItem(row: Row): InventoryItem {
  return {
    id: Number(row.id), code: String(row.code), nameAr: String(row.name_ar), nameEn: String(row.name_en),
    barcode: String(row.barcode), baseUnitId: Number(row.base_unit_id), baseUnitCode: String(row.unit_code),
    baseUnitName: String(row.unit_name), baseUnitStatus: String(row.unit_status) as InventoryItem['baseUnitStatus'],
    purchasePrice: String(row.purchase_price), salesPrice: String(row.sales_price),
    taxRate: String(row.tax_rate), status: String(row.status) as InventoryItem['status'],
    sellable: Number(row.sellable) === 1, purchasable: Number(row.purchasable) === 1,
    inventoryAccountId: row.inventory_account_id === null ? null : Number(row.inventory_account_id),
    purchaseAccountId: row.purchase_account_id === null ? null : Number(row.purchase_account_id),
    salesAccountId: row.sales_account_id === null ? null : Number(row.sales_account_id),
    cogsAccountId: row.cogs_account_id === null ? null : Number(row.cogs_account_id),
    expenseAccountId: row.expense_account_id === null ? null : Number(row.expense_account_id),
    inventoryAccountCode: String(row.inventory_account_code ?? ''), inventoryAccountName: String(row.inventory_account_name ?? ''),
    purchaseAccountCode: String(row.purchase_account_code ?? ''), purchaseAccountName: String(row.purchase_account_name ?? ''),
    salesAccountCode: String(row.sales_account_code ?? ''), salesAccountName: String(row.sales_account_name ?? ''),
    cogsAccountCode: String(row.cogs_account_code ?? ''), cogsAccountName: String(row.cogs_account_name ?? ''),
    expenseAccountCode: String(row.expense_account_code ?? ''), expenseAccountName: String(row.expense_account_name ?? ''),
    openingBalances: row.opening_warehouse_id === null ? [] : [{
      warehouseId: Number(row.opening_warehouse_id),
      warehouseName: String(row.opening_warehouse_name),
      quantity: String(row.opening_quantity),
      unitCost: String(row.opening_unit_cost),
    }],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function unitRows(database: DatabaseSync): InventoryUnit[] {
  return (database.prepare(`
    SELECT units.*, COUNT(DISTINCT items.id) AS item_count
    FROM inventory_units AS units LEFT JOIN inventory_items AS items ON items.base_unit_id = units.id
    GROUP BY units.id ORDER BY units.name_ar COLLATE NOCASE, units.id
  `).all() as Row[]).map(mapUnit);
}

function warehouseRows(database: DatabaseSync): Warehouse[] {
  return (database.prepare(`
    SELECT warehouses.*, accounts.code AS account_code, accounts.name AS account_name,
      COUNT(DISTINCT balances.item_id) AS opening_item_count
    FROM warehouses LEFT JOIN accounts ON accounts.id = warehouses.account_id
    LEFT JOIN inventory_opening_balances AS balances ON balances.warehouse_id = warehouses.id
    GROUP BY warehouses.id ORDER BY warehouses.name COLLATE NOCASE, warehouses.id
  `).all() as Row[]).map(mapWarehouse);
}

function itemRows(database: DatabaseSync): InventoryItem[] {
  const rows = database.prepare(`
    SELECT items.*, units.code AS unit_code, units.name_ar AS unit_name, units.status AS unit_status,
      inventory_accounts.code AS inventory_account_code, inventory_accounts.name AS inventory_account_name,
      purchase_accounts.code AS purchase_account_code, purchase_accounts.name AS purchase_account_name,
      sales_accounts.code AS sales_account_code, sales_accounts.name AS sales_account_name,
      cogs_accounts.code AS cogs_account_code, cogs_accounts.name AS cogs_account_name,
      expense_accounts.code AS expense_account_code, expense_accounts.name AS expense_account_name,
      balances.warehouse_id AS opening_warehouse_id, warehouses.name AS opening_warehouse_name,
      balances.quantity AS opening_quantity, balances.unit_cost AS opening_unit_cost
    FROM inventory_items AS items
    INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
    LEFT JOIN accounts AS inventory_accounts ON inventory_accounts.id = items.inventory_account_id
    LEFT JOIN accounts AS purchase_accounts ON purchase_accounts.id = items.purchase_account_id
    LEFT JOIN accounts AS sales_accounts ON sales_accounts.id = items.sales_account_id
    LEFT JOIN accounts AS cogs_accounts ON cogs_accounts.id = items.cogs_account_id
    LEFT JOIN accounts AS expense_accounts ON expense_accounts.id = items.expense_account_id
    LEFT JOIN inventory_opening_balances AS balances ON balances.item_id = items.id
    LEFT JOIN warehouses ON warehouses.id = balances.warehouse_id
    ORDER BY items.name_ar COLLATE NOCASE, items.id
  `).all() as Row[];
  const items = new Map<number, InventoryItem>();
  for (const row of rows) {
    const item = mapItem(row);
    const existing = items.get(item.id);
    if (existing) existing.openingBalances.push(...item.openingBalances);
    else items.set(item.id, item);
  }
  return [...items.values()];
}

function saveUnit(database: DatabaseSync, value: unknown): InventoryUnit {
  const unit = validateUnit(value);
  return transaction(database, () => {
    assertUnique(database, 'inventory_units', 'code', unit.code, unit.id);
    assertUnique(database, 'inventory_units', 'name_ar', unit.nameAr, unit.id);
    if (unit.id !== undefined) {
      const result = database.prepare(`UPDATE inventory_units SET code = ?, name_ar = ?, abbreviation = ?, status = ?,
        updated_at = datetime('now') WHERE id = ?`).run(unit.code, unit.nameAr, unit.abbreviation, unit.status, unit.id);
      if (!result.changes) throw new Error('لم يُعثر على وحدة القياس.');
    } else {
      database.prepare('INSERT INTO inventory_units (code, name_ar, abbreviation, status) VALUES (?, ?, ?, ?)')
        .run(unit.code, unit.nameAr, unit.abbreviation, unit.status);
    }
    return unitRows(database).find((entry) => entry.id === (unit.id ?? Number(database.prepare('SELECT last_insert_rowid() AS id').get()!.id)))!;
  });
}

function saveWarehouse(database: DatabaseSync, value: unknown): Warehouse {
  const warehouse = validateWarehouse(value);
  return transaction(database, () => {
    assertUnique(database, 'warehouses', 'code', warehouse.code, warehouse.id);
    assertAccount(database, warehouse.accountId, 'المخزن', ['asset']);
    if (warehouse.id !== undefined) {
      const result = database.prepare(`UPDATE warehouses SET code = ?, name = ?, account_id = ?, status = ?,
        updated_at = datetime('now') WHERE id = ?`).run(warehouse.code, warehouse.name, warehouse.accountId, warehouse.status, warehouse.id);
      if (!result.changes) throw new Error('لم يُعثر على المخزن.');
    } else {
      database.prepare('INSERT INTO warehouses (code, name, account_id, status) VALUES (?, ?, ?, ?)')
        .run(warehouse.code, warehouse.name, warehouse.accountId, warehouse.status);
    }
    const id = warehouse.id ?? Number((database.prepare('SELECT last_insert_rowid() AS id').get() as Row).id);
    return warehouseRows(database).find((entry) => entry.id === id)!;
  });
}

function saveItem(database: DatabaseSync, value: unknown): InventoryItem {
  const item = validateItem(value);
  return transaction(database, () => {
    assertUnique(database, 'inventory_items', 'code', item.code, item.id);
    assertUnique(database, 'inventory_items', 'barcode', item.barcode, item.id);
    const unit = database.prepare('SELECT status FROM inventory_units WHERE id = ?').get(item.baseUnitId) as Row | undefined;
    if (!unit || (unit.status !== 'active' && item.status === 'active')) throw new Error('الصنف النشط يتطلب وحدة قياس نشطة موجودة.');
    assertAccount(database, item.inventoryAccountId, 'حساب المخزون', ['asset']);
    assertAccount(database, item.purchaseAccountId, 'حساب المشتريات', ['asset', 'expense']);
    assertAccount(database, item.salesAccountId, 'حساب المبيعات', ['revenue']);
    assertAccount(database, item.cogsAccountId, 'حساب تكلفة المبيعات', ['expense']);
    assertAccount(database, item.expenseAccountId, 'حساب المصروفات', ['expense']);
    if (item.id !== undefined) {
      const current = database.prepare('SELECT base_unit_id FROM inventory_items WHERE id = ?').get(item.id) as Row | undefined;
      if (!current) throw new Error('لم يُعثر على الصنف.');
      if (Number(current.base_unit_id) !== item.baseUnitId) {
        const used = database.prepare(`
          SELECT 1 FROM inventory_opening_balances WHERE item_id = ?
          UNION ALL SELECT 1 FROM purchase_invoice_lines WHERE item_id = ?
          UNION ALL SELECT 1 FROM sales_document_lines WHERE master_item_id = ? LIMIT 1
        `).get(item.id, item.id, item.id) as Row | undefined;
        if (used) throw new Error('لا يمكن تغيير الوحدة الأساسية لصنف مستخدم في مستند سابق؛ للحفاظ على بياناته التاريخية.');
      }
      database.prepare(`UPDATE inventory_items SET code = ?, name_ar = ?, name_en = ?, barcode = ?, base_unit_id = ?,
        purchase_price = ?, sales_price = ?, tax_rate = ?, status = ?, sellable = ?, purchasable = ?,
        inventory_account_id = ?, purchase_account_id = ?, sales_account_id = ?, cogs_account_id = ?, expense_account_id = ?,
        updated_at = datetime('now') WHERE id = ?`).run(
        item.code, item.nameAr, item.nameEn, item.barcode, item.baseUnitId, item.purchasePrice, item.salesPrice, item.taxRate,
        item.status, item.sellable ? 1 : 0, item.purchasable ? 1 : 0, item.inventoryAccountId, item.purchaseAccountId,
        item.salesAccountId, item.cogsAccountId, item.expenseAccountId, item.id,
      );
    } else {
      database.prepare(`INSERT INTO inventory_items (
        code, name_ar, name_en, barcode, base_unit_id, purchase_price, sales_price, tax_rate, status, sellable, purchasable,
        inventory_account_id, purchase_account_id, sales_account_id, cogs_account_id, expense_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        item.code, item.nameAr, item.nameEn, item.barcode, item.baseUnitId, item.purchasePrice, item.salesPrice, item.taxRate,
        item.status, item.sellable ? 1 : 0, item.purchasable ? 1 : 0, item.inventoryAccountId, item.purchaseAccountId,
        item.salesAccountId, item.cogsAccountId, item.expenseAccountId,
      );
    }
    const id = item.id ?? Number((database.prepare('SELECT last_insert_rowid() AS id').get() as Row).id);
    if (item.openingWarehouseId !== null) {
      const existing = database.prepare('SELECT id FROM inventory_opening_balances WHERE item_id = ? AND warehouse_id = ?')
        .get(id, item.openingWarehouseId) as Row | undefined;
      if (existing) throw new Error('يوجد رصيد افتتاحي محفوظ لهذا الصنف في المخزن المحدد؛ لا يمكن تكراره أو تعديله.');
      const warehouse = database.prepare('SELECT status FROM warehouses WHERE id = ?').get(item.openingWarehouseId) as Row | undefined;
      if (!warehouse || warehouse.status !== 'active') throw new Error('اختر مخزنًا نشطًا موجودًا للرصيد الافتتاحي.');
      database.prepare(`INSERT INTO inventory_opening_balances (item_id, warehouse_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?)`).run(id, item.openingWarehouseId, item.openingQuantity, item.openingUnitCost);
    }
    return itemRows(database).find((entry) => entry.id === id)!;
  });
}

function setStatus(database: DatabaseSync, table: 'inventory_items' | 'inventory_units' | 'warehouses', id: unknown, status: unknown): void {
  if (!isId(id)) throw new Error('رقم السجل غير صالح.');
  const safeStatus = validateStatus(status);
  const result = database.prepare(`UPDATE ${table} SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(safeStatus, id);
  if (!result.changes) throw new Error('لم يُعثر على السجل المطلوب.');
}

function deleteRecord(database: DatabaseSync, kind: 'item' | 'unit' | 'warehouse', id: unknown): boolean {
  if (!isId(id)) throw new Error('رقم السجل غير صالح.');
  return transaction(database, () => {
    let table: string;
    let usage: Row | undefined;
    if (kind === 'item') {
      table = 'inventory_items';
      usage = database.prepare(`
        SELECT 1 FROM inventory_opening_balances WHERE item_id = ?
        UNION ALL SELECT 1 FROM purchase_invoice_lines WHERE item_id = ?
        UNION ALL SELECT 1 FROM sales_document_lines WHERE master_item_id = ? LIMIT 1
      `).get(id, id, id) as Row | undefined;
      if (usage) throw new Error('لا يمكن حذف الصنف لارتباطه برصيد افتتاحي أو مستند سابق؛ عطّله بدلًا من ذلك.');
    } else if (kind === 'unit') {
      table = 'inventory_units';
      usage = database.prepare(`
        SELECT 1 FROM inventory_items WHERE base_unit_id = ?
        UNION ALL SELECT 1 FROM purchase_invoice_lines WHERE unit_id = ? LIMIT 1
      `).get(id, id) as Row | undefined;
      if (usage) throw new Error('لا يمكن حذف وحدة مستخدمة في صنف أو مستند سابق؛ عطّلها بدلًا من ذلك.');
    } else {
      table = 'warehouses';
      usage = database.prepare('SELECT 1 FROM inventory_opening_balances WHERE warehouse_id = ? LIMIT 1').get(id) as Row | undefined;
      if (usage) throw new Error('لا يمكن حذف مخزن مرتبط برصيد أو حركة؛ عطّله بدلًا من ذلك.');
    }
    const result = database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (!result.changes) throw new Error('لم يُعثر على السجل المطلوب.');
    return true;
  });
}

export function registerInventoryHandlers(getDatabase: () => DatabaseSync): void {
  ipcMain.handle('inventory:items:list', () => itemRows(getDatabase()));
  ipcMain.handle('inventory:items:save', (_event, value: unknown) => saveItem(getDatabase(), value));
  ipcMain.handle('inventory:items:status', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('طلب تغيير الحالة غير صالح.');
    const input = value as { id?: unknown; status?: unknown };
    setStatus(getDatabase(), 'inventory_items', input.id, input.status);
    return itemRows(getDatabase()).find((item) => item.id === input.id);
  });
  ipcMain.handle('inventory:items:delete', (_event, id: unknown) => deleteRecord(getDatabase(), 'item', id));
  ipcMain.handle('inventory:units:list', () => unitRows(getDatabase()));
  ipcMain.handle('inventory:units:save', (_event, value: unknown) => saveUnit(getDatabase(), value));
  ipcMain.handle('inventory:units:status', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('طلب تغيير الحالة غير صالح.');
    const input = value as { id?: unknown; status?: unknown };
    setStatus(getDatabase(), 'inventory_units', input.id, input.status);
    return unitRows(getDatabase()).find((unit) => unit.id === input.id);
  });
  ipcMain.handle('inventory:units:delete', (_event, id: unknown) => deleteRecord(getDatabase(), 'unit', id));
  ipcMain.handle('inventory:warehouses:list', () => warehouseRows(getDatabase()));
  ipcMain.handle('inventory:warehouses:save', (_event, value: unknown) => saveWarehouse(getDatabase(), value));
  ipcMain.handle('inventory:warehouses:status', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('طلب تغيير الحالة غير صالح.');
    const input = value as { id?: unknown; status?: unknown };
    setStatus(getDatabase(), 'warehouses', input.id, input.status);
    return warehouseRows(getDatabase()).find((warehouse) => warehouse.id === input.id);
  });
  ipcMain.handle('inventory:warehouses:delete', (_event, id: unknown) => deleteRecord(getDatabase(), 'warehouse', id));
  ipcMain.handle('inventory:accounts:list', () => getDatabase().prepare(`
    SELECT accounts.id, code, name, name_en, account_type, parent_id, postable, notes, created_at,
      EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children FROM accounts ORDER BY code
  `).all().map((row) => {
    const account = row as Row;
    return {
      id: Number(account.id), code: String(account.code), name: String(account.name), nameEn: String(account.name_en ?? ''),
      type: String(account.account_type) as AccountItem['type'],
      parentId: account.parent_id === null ? null : Number(account.parent_id), postable: Number(account.postable ?? 1) === 1 && Number(account.has_children ?? 0) === 0,
      notes: String(account.notes ?? ''), createdAt: String(account.created_at),
    } satisfies AccountItem;
  }));
}
