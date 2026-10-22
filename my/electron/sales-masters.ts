import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { Customer, CustomerGroup, CustomerGroupInput, CustomerInput } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

export function installSalesMasterSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS customer_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      trade_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      group_id INTEGER REFERENCES customer_groups(id) ON DELETE RESTRICT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      tax_number TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS customers_group_status ON customers(group_id, status, name);
  `);
  const columns = new Set((database.prepare('PRAGMA table_info(customers)').all() as Row[]).map((row) => String(row.name)));
  if (!columns.has('account_id')) database.exec('ALTER TABLE customers ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT');
}

function isPositiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function asGroup(row: Row): CustomerGroup {
  return {
    id: Number(row.id),
    code: String(row.code),
    nameAr: String(row.name_ar),
    nameEn: String(row.name_en),
    status: String(row.status) as CustomerGroup['status'],
    notes: String(row.notes),
    customerCount: Number(row.customer_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function asCustomer(row: Row): Customer {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    tradeName: String(row.trade_name),
    phone: String(row.phone),
    email: String(row.email),
    groupId: row.group_id === null ? null : Number(row.group_id),
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    accountCode: String(row.account_code ?? ''), accountName: String(row.account_name ?? ''),
    city: String(row.city),
    country: String(row.country),
    address: String(row.address),
    taxNumber: String(row.tax_number),
    notes: String(row.notes),
    status: String(row.status) as Customer['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function validateGroup(value: unknown): CustomerGroupInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات مجموعة العملاء غير صالحة.');
  const input = value as Partial<CustomerGroupInput>;
  if (input.id !== undefined && !isPositiveId(input.id)) throw new Error('رقم المجموعة غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 40) throw new Error('أدخل كودًا صالحًا للمجموعة.');
  if (typeof input.nameAr !== 'string' || !input.nameAr.trim() || input.nameAr.length > 160) throw new Error('أدخل الاسم العربي للمجموعة.');
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 160) throw new Error('الاسم الإنجليزي للمجموعة غير صالح.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة المجموعة غير صالحة.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات المجموعة تجاوزت الحد المسموح.');
  return { id: input.id, code: input.code.trim(), nameAr: input.nameAr.trim(), nameEn: input.nameEn.trim(), status: input.status, notes: input.notes.trim() };
}

function validateCustomer(value: unknown): CustomerInput & { accountId: number | null } {
  if (!value || typeof value !== 'object') throw new Error('بيانات العميل غير صالحة.');
  const input = value as Partial<CustomerInput>;
  if (input.id !== undefined && !isPositiveId(input.id)) throw new Error('رقم العميل غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 40) throw new Error('أدخل كودًا صالحًا للعميل.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180) throw new Error('أدخل اسم العميل.');
  const fields = ['tradeName', 'phone', 'email', 'city', 'country', 'address', 'taxNumber', 'notes'] as const;
  const limits = { tradeName: 180, phone: 60, email: 180, city: 100, country: 100, address: 500, taxNumber: 100, notes: 2000 };
  const text = (field: (typeof fields)[number]): string => {
    const fieldValue = input[field];
    if (typeof fieldValue !== 'string' || fieldValue.length > limits[field]) {
      throw new Error('أحد حقول العميل غير صالح أو تجاوز الحد المسموح.');
    }
    return fieldValue;
  };
  const tradeName = text('tradeName');
  const phone = text('phone');
  const email = text('email');
  const city = text('city');
  const country = text('country');
  const address = text('address');
  const taxNumber = text('taxNumber');
  const notes = text('notes');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('صيغة البريد الإلكتروني غير صالحة.');
  if (input.groupId !== null && !isPositiveId(input.groupId)) throw new Error('مجموعة العميل غير صالحة.');
  const accountId = input.accountId ?? null;
  if (accountId !== null && !isPositiveId(accountId)) throw new Error('الحساب المحاسبي للعميل غير صالح.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة العميل غير صالحة.');
  return {
    id: input.id, code: input.code.trim(), name: input.name.trim(), tradeName: tradeName.trim(),
    phone: phone.trim(), email: email.trim(), groupId: input.groupId, accountId,
    city: city.trim(), country: country.trim(), address: address.trim(),
    taxNumber: taxNumber.trim(), notes: notes.trim(), status: input.status,
  };
}

export function registerSalesMasterHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('sales:customer-groups:list', () => {
    const database = requireAuthentication();
    const rows = database.prepare(`
      SELECT groups.*, COUNT(customers.id) AS customer_count
      FROM customer_groups AS groups
      LEFT JOIN customers ON customers.group_id = groups.id
      GROUP BY groups.id ORDER BY groups.name_ar COLLATE NOCASE
    `).all() as Row[];
    return rows.map(asGroup);
  });
  ipcMain.handle('sales:customer-groups:save', (_event, value: unknown) => {
    const database = requireAuthentication();
    const group = validateGroup(value);
    if (group.id !== undefined) {
      const result = database.prepare(`
        UPDATE customer_groups SET code = ?, name_ar = ?, name_en = ?, status = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(group.code, group.nameAr, group.nameEn, group.status, group.notes, group.id);
      if (!result.changes) throw new Error('لم يُعثر على مجموعة العملاء.');
      return asGroup(database.prepare(`
        SELECT groups.*, COUNT(customers.id) AS customer_count
        FROM customer_groups AS groups LEFT JOIN customers ON customers.group_id = groups.id
        WHERE groups.id = ? GROUP BY groups.id
      `).get(group.id) as Row);
    }
    const result = database.prepare(`
      INSERT INTO customer_groups (code, name_ar, name_en, status, notes) VALUES (?, ?, ?, ?, ?)
    `).run(group.code, group.nameAr, group.nameEn, group.status, group.notes);
    return asGroup(database.prepare(`
      SELECT groups.*, 0 AS customer_count FROM customer_groups AS groups WHERE groups.id = ?
    `).get(Number(result.lastInsertRowid)) as Row);
  });
  ipcMain.handle('sales:customer-groups:delete', (_event, value: unknown) => {
    const database = requireAuthentication();
    if (!isPositiveId(value)) throw new Error('رقم المجموعة غير صالح.');
    const inUse = database.prepare('SELECT 1 AS found FROM customers WHERE group_id = ? LIMIT 1').get(value);
    if (inUse) throw new Error('لا يمكن حذف مجموعة مرتبطة بعملاء. انقل العملاء إلى مجموعة أخرى أولًا.');
    const result = database.prepare('DELETE FROM customer_groups WHERE id = ?').run(value);
    if (!result.changes) throw new Error('لم يُعثر على المجموعة.');
    return true;
  });
  ipcMain.handle('sales:customers:list', () => {
    const database = requireAuthentication();
    return (database.prepare(`SELECT customers.*, accounts.code AS account_code, accounts.name AS account_name
      FROM customers LEFT JOIN accounts ON accounts.id = customers.account_id ORDER BY customers.name COLLATE NOCASE, customers.id`).all() as Row[]).map(asCustomer);
  });
  ipcMain.handle('sales:customers:save', (_event, value: unknown) => {
    const database = requireAuthentication();
    const customer = validateCustomer(value);
    if (customer.groupId !== null) {
      const group = database.prepare('SELECT status FROM customer_groups WHERE id = ?').get(customer.groupId) as Row | undefined;
      const existing = customer.id === undefined ? undefined
        : database.prepare('SELECT group_id FROM customers WHERE id = ?').get(customer.id) as Row | undefined;
      const retainingInactiveGroup = group?.status === 'inactive'
        && existing?.group_id !== null
        && existing?.group_id !== undefined
        && Number(existing.group_id) === customer.groupId;
      if (!group || (group.status !== 'active' && !retainingInactiveGroup)) throw new Error('اختر مجموعة عملاء موجودة ونشطة.');
    }
    if (customer.accountId !== null) {
      const account = database.prepare(`SELECT account_type, postable, EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children
        FROM accounts WHERE id = ?`).get(customer.accountId) as Row | undefined;
      if (!account || account.account_type !== 'asset' || Number(account.postable) !== 1 || Number(account.has_children) === 1) {
        throw new Error('اختر حساب عميل تفصيليًا من نوع أصول وقابلًا للترحيل.');
      }
    }
    if (customer.id !== undefined) {
      const result = database.prepare(`
        UPDATE customers SET code = ?, name = ?, trade_name = ?, phone = ?, email = ?, group_id = ?, account_id = ?,
          city = ?, country = ?, address = ?, tax_number = ?, notes = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(customer.code, customer.name, customer.tradeName, customer.phone, customer.email, customer.groupId,
        customer.accountId, customer.city, customer.country, customer.address, customer.taxNumber, customer.notes, customer.status, customer.id);
      if (!result.changes) throw new Error('لم يُعثر على العميل.');
      return asCustomer(database.prepare(`SELECT customers.*, accounts.code AS account_code, accounts.name AS account_name FROM customers
        LEFT JOIN accounts ON accounts.id = customers.account_id WHERE customers.id = ?`).get(customer.id) as Row);
    }
    const result = database.prepare(`
      INSERT INTO customers (
        code, name, trade_name, phone, email, group_id, account_id, city, country, address, tax_number, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customer.code, customer.name, customer.tradeName, customer.phone, customer.email, customer.groupId,
      customer.accountId, customer.city, customer.country, customer.address, customer.taxNumber, customer.notes, customer.status);
    return asCustomer(database.prepare(`SELECT customers.*, accounts.code AS account_code, accounts.name AS account_name FROM customers
      LEFT JOIN accounts ON accounts.id = customers.account_id WHERE customers.id = ?`).get(Number(result.lastInsertRowid)) as Row);
  });
  ipcMain.handle('sales:customers:status', (_event, value: unknown) => {
    const database = requireAuthentication();
    if (!value || typeof value !== 'object') throw new Error('بيانات حالة العميل غير صالحة.');
    const input = value as { id?: unknown; status?: unknown };
    if (!isPositiveId(input.id) || (input.status !== 'active' && input.status !== 'inactive')) throw new Error('بيانات حالة العميل غير صالحة.');
    const result = database.prepare("UPDATE customers SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.status, input.id);
    if (!result.changes) throw new Error('لم يُعثر على العميل.');
    return asCustomer(database.prepare('SELECT * FROM customers WHERE id = ?').get(input.id) as Row);
  });
  ipcMain.handle('sales:customers:delete', (_event, value: unknown) => {
    const database = requireAuthentication();
    if (!isPositiveId(value)) throw new Error('رقم العميل غير صالح.');
    const referenced = database.prepare(`
      SELECT 1 AS found FROM sales_documents WHERE master_client_id = ?
      UNION ALL
      SELECT 1 AS found FROM sales_returns WHERE customer_id = ?
      LIMIT 1
    `).get(value, value);
    if (referenced) throw new Error('العميل مرتبط بمستندات؛ عطّله بدلًا من حذفه.');
    const result = database.prepare('DELETE FROM customers WHERE id = ?').run(value);
    if (!result.changes) throw new Error('لم يُعثر على العميل.');
    return true;
  });
}
