import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import type { BankAccount, BankAccountInput, CashBox, CashBoxInput, TreasuryStatus } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

export function installTreasurySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS treasury_cash_boxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      currency TEXT NOT NULL,
      opening_balance TEXT NOT NULL,
      opening_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS treasury_cash_boxes_name ON treasury_cash_boxes(name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS treasury_bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      bank_account_number TEXT NOT NULL,
      currency TEXT NOT NULL,
      opening_balance TEXT NOT NULL,
      opening_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS treasury_bank_accounts_name ON treasury_bank_accounts(name COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS treasury_bank_accounts_number ON treasury_bank_accounts(bank_account_number COLLATE NOCASE);
  `);
}

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateStatus(value: unknown): TreasuryStatus {
  if (value !== 'active' && value !== 'inactive') throw new Error('حالة السجل غير صالحة.');
  return value;
}

function validateCurrency(value: unknown): string {
  if (typeof value !== 'string') throw new Error('أدخل رمز العملة أو اسمها.');
  const currency = value.trim();
  if (!currency || currency.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(currency)) {
    throw new Error('أدخل رمز عملة مثل EGP أو اسمًا واضحًا للعملة.');
  }
  return /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : currency;
}

function validateCommon(value: unknown): CashBoxInput & { bankAccountNumber?: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات الخزينة أو البنك غير صالحة.');
  const input = value as Partial<CashBoxInput & BankAccountInput>;
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) {
    throw new Error('أدخل رقمًا لا يتجاوز 40 حرفًا.');
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 160) {
    throw new Error('أدخل اسمًا لا يتجاوز 160 حرفًا.');
  }
  if (!Number.isSafeInteger(input.accountId) || Number(input.accountId) < 1) {
    throw new Error('اختر الحساب المحاسبي المرتبط.');
  }
  if (typeof input.openingBalance !== 'string' || !/^\d{1,15}(?:\.\d{1,12})?$/.test(input.openingBalance.trim())) {
    throw new Error('أدخل رصيدًا غير سالب بدقة لا تتجاوز 12 منزلة عشرية.');
  }
  const openingBalance = normalizeAmount(input.openingBalance);
  parseAmount(openingBalance);
  if (typeof input.openingDate !== 'string' || !isDate(input.openingDate)) {
    throw new Error('تاريخ أول المدة غير صالح.');
  }
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) {
    throw new Error('معرّف السجل غير صالح.');
  }
  const bankAccountNumber = input.bankAccountNumber?.trim();
  if (bankAccountNumber !== undefined && (!bankAccountNumber || bankAccountNumber.length > 50
    || !/^[\p{L}\p{N}][\p{L}\p{N} -]*$/u.test(bankAccountNumber))) {
    throw new Error('أدخل رقم حساب بنكي صحيحًا لا يتجاوز 50 حرفًا.');
  }
  return {
    id: input.id,
    code: input.code.trim(),
    name: input.name.trim(),
    accountId: Number(input.accountId),
    currency: validateCurrency(input.currency),
    openingBalance,
    openingDate: input.openingDate,
    status: validateStatus(input.status),
    ...(bankAccountNumber !== undefined ? { bankAccountNumber } : {}),
  };
}

function ensureAssetAccount(database: DatabaseSync, accountId: number): void {
  const account = database.prepare('SELECT account_type FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
  if (!account) throw new Error('الحساب المحاسبي المحدد غير موجود.');
  if (account.account_type !== 'asset') throw new Error('يجب ربط الخزينة أو البنك بحساب من نوع أصول.');
}

function ensureUniqueCode(
  database: DatabaseSync,
  table: 'treasury_cash_boxes' | 'treasury_bank_accounts',
  code: string,
  id?: number,
): void {
  const duplicate = database.prepare(`SELECT 1 FROM ${table} WHERE code = ? COLLATE NOCASE AND id != COALESCE(?, -1) LIMIT 1`)
    .get(code, id ?? null);
  if (duplicate) throw new Error(table === 'treasury_cash_boxes' ? 'رقم الخزنة مسجل مسبقًا.' : 'رقم البنك مسجل مسبقًا.');
}

function ensureUniqueBankNumber(database: DatabaseSync, bankAccountNumber: string, id?: number): void {
  const duplicate = database.prepare(`SELECT 1 FROM treasury_bank_accounts
    WHERE bank_account_number = ? COLLATE NOCASE AND id != COALESCE(?, -1) LIMIT 1`).get(bankAccountNumber, id ?? null);
  if (duplicate) throw new Error('رقم الحساب البنكي مسجل مسبقًا.');
}

function hasPostedEntries(database: DatabaseSync, accountId: number): boolean {
  return Boolean(database.prepare(`
    SELECT 1
    FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    WHERE lines.account_id = ? AND entries.status = 'posted'
    LIMIT 1
  `).get(accountId));
}

// الحماية من تعارض الرصيد الافتتاحي: حساب الخزينة/البنك يجب أن يكون نظيفًا من
// الحركة المرحلة عند تأسيس السجل أو ربطه حسابًا جديدًا، وإلا يتضاعف الافتتاح
// عند عرض تقارير الأرصدة (الافتتاحي المسجل + قيد افتتاحي قد يكون مؤشِرًا يدويًا).
// لا تعدل هذه الدالة أي بيانات تاريخية؛ تمنع الحالة الجديدة فقط.
function assertOpeningAccountClean(database: DatabaseSync, accountId: number, currentAccountId?: number): void {
  if (currentAccountId !== undefined && currentAccountId === accountId) return;
  const blocked = database.prepare(`
    SELECT 1
    FROM journal_lines AS lines
    INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    WHERE lines.account_id = ? AND entries.status = 'posted'
    LIMIT 1
  `).get(accountId);
  if (blocked) {
    throw new Error('هذا الحساب المحاسبي عليه حركة مرحلة بالفعل؛ ربط الخزينة أو البنك به يتضاعف مع أول مدة في تقارير الأرصدة. استخدم حسابًا مخصصًا نظيفًا، أو سجّل افتتاحية الحساب من قيود الموازنة دون إعلان رصيد مستقل.');
  }
}

function assertFinancialIdentityUnchanged(
  database: DatabaseSync,
  kind: 'الخزينة' | 'البنك',
  accountId: number,
  current: Row,
  next: { code: string; accountId: number; currency: string; openingBalance: string; openingDate: string; bankAccountNumber?: string },
): void {
  if (!hasPostedEntries(database, accountId)) return;
  if (String(current.code) !== next.code || Number(current.account_id) !== next.accountId
    || String(current.currency) !== next.currency || String(current.opening_balance) !== next.openingBalance
    || String(current.opening_date) !== next.openingDate
    || (current.bank_account_number === undefined ? undefined : String(current.bank_account_number)) !== next.bankAccountNumber) {
    throw new Error(`لا يمكن تغيير رقم أو حساب أو عملة أو رصيد أول مدة ${kind} بعد تسجيل حركة مالية على حسابها.`);
  }
}

function mapCashBox(row: Row): CashBox {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name),
    accountId: Number(row.account_id), accountCode: String(row.account_code), accountName: String(row.account_name),
    currency: String(row.currency), openingBalance: String(row.opening_balance), openingDate: String(row.opening_date),
    status: String(row.status) as TreasuryStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapBankAccount(row: Row): BankAccount {
  return {
    ...mapCashBox(row),
    bankAccountNumber: String(row.bank_account_number),
  };
}

const CASH_BOX_SELECT = `
  SELECT boxes.*, accounts.code AS account_code, accounts.name AS account_name
  FROM treasury_cash_boxes AS boxes INNER JOIN accounts ON accounts.id = boxes.account_id
`;
const BANK_ACCOUNT_SELECT = `
  SELECT banks.*, accounts.code AS account_code, accounts.name AS account_name
  FROM treasury_bank_accounts AS banks INNER JOIN accounts ON accounts.id = banks.account_id
`;

export function registerTreasuryHandlers(requireDatabase: () => DatabaseSync): void {
  ipcMain.handle('treasury:cash-boxes:list', () => {
    const database = requireDatabase();
    return (database.prepare(`${CASH_BOX_SELECT} ORDER BY boxes.code COLLATE NOCASE, boxes.id`).all() as Row[]).map(mapCashBox);
  });

  ipcMain.handle('treasury:cash-boxes:save', (_event, value: unknown) => {
    const database = requireDatabase();
    const input = validateCommon(value);
    ensureAssetAccount(database, input.accountId);
    ensureUniqueCode(database, 'treasury_cash_boxes', input.code, input.id);
    const existing = input.id === undefined ? undefined
      : database.prepare('SELECT * FROM treasury_cash_boxes WHERE id = ?').get(input.id) as Row | undefined;
    if (input.id !== undefined && !existing) throw new Error('الخزينة المطلوب تعديلها غير موجودة.');
    assertOpeningAccountClean(database, input.accountId, existing === undefined ? undefined : Number(existing.account_id));
    let recordId = input.id;
    if (existing) {
      assertFinancialIdentityUnchanged(database, 'الخزينة', Number(existing.account_id), existing, input);
      database.prepare(`UPDATE treasury_cash_boxes SET code = ?, name = ?, account_id = ?, currency = ?,
        opening_balance = ?, opening_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.code, input.name, input.accountId, input.currency, input.openingBalance, input.openingDate, input.status, Number(input.id));
    } else {
      const result = database.prepare(`INSERT INTO treasury_cash_boxes (code, name, account_id, currency, opening_balance, opening_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.code, input.name, input.accountId, input.currency, input.openingBalance, input.openingDate, input.status);
      recordId = Number(result.lastInsertRowid);
    }
    const row = database.prepare(`${CASH_BOX_SELECT} WHERE boxes.id = ?`).get(Number(recordId)) as Row;
    return mapCashBox(row);
  });

  ipcMain.handle('treasury:cash-boxes:status', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!value || typeof value !== 'object') throw new Error('طلب تحديث حالة الخزينة غير صالح.');
    const { id, status } = value as { id?: unknown; status?: unknown };
    if (!Number.isSafeInteger(id) || Number(id) < 1) throw new Error('رقم الخزينة غير صالح.');
    const nextStatus = validateStatus(status);
    const result = database.prepare("UPDATE treasury_cash_boxes SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, Number(id));
    if (result.changes === 0) throw new Error('الخزينة المطلوبة غير موجودة.');
    return mapCashBox(database.prepare(`${CASH_BOX_SELECT} WHERE boxes.id = ?`).get(Number(id)) as Row);
  });

  ipcMain.handle('treasury:banks:list', () => {
    const database = requireDatabase();
    return (database.prepare(`${BANK_ACCOUNT_SELECT} ORDER BY banks.code COLLATE NOCASE, banks.id`).all() as Row[]).map(mapBankAccount);
  });

  ipcMain.handle('treasury:banks:save', (_event, value: unknown) => {
    const database = requireDatabase();
    const input = validateCommon(value);
    if (!input.bankAccountNumber) throw new Error('أدخل رقم الحساب البنكي.');
    ensureAssetAccount(database, input.accountId);
    ensureUniqueCode(database, 'treasury_bank_accounts', input.code, input.id);
    ensureUniqueBankNumber(database, input.bankAccountNumber, input.id);
    const existing = input.id === undefined ? undefined
      : database.prepare('SELECT * FROM treasury_bank_accounts WHERE id = ?').get(input.id) as Row | undefined;
    if (input.id !== undefined && !existing) throw new Error('البنك المطلوب تعديله غير موجود.');
    assertOpeningAccountClean(database, input.accountId, existing === undefined ? undefined : Number(existing.account_id));
    let recordId = input.id;
    if (existing) {
      assertFinancialIdentityUnchanged(database, 'البنك', Number(existing.account_id), existing, input);
      database.prepare(`UPDATE treasury_bank_accounts SET code = ?, name = ?, account_id = ?, bank_account_number = ?,
        currency = ?, opening_balance = ?, opening_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.code, input.name, input.accountId, input.bankAccountNumber, input.currency,
          input.openingBalance, input.openingDate, input.status, Number(input.id));
    } else {
      const result = database.prepare(`INSERT INTO treasury_bank_accounts
        (code, name, account_id, bank_account_number, currency, opening_balance, opening_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.code, input.name, input.accountId, input.bankAccountNumber, input.currency,
          input.openingBalance, input.openingDate, input.status);
      recordId = Number(result.lastInsertRowid);
    }
    const row = database.prepare(`${BANK_ACCOUNT_SELECT} WHERE banks.id = ?`)
      .get(Number(recordId)) as Row;
    return mapBankAccount(row);
  });

  ipcMain.handle('treasury:banks:status', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!value || typeof value !== 'object') throw new Error('طلب تحديث حالة البنك غير صالح.');
    const { id, status } = value as { id?: unknown; status?: unknown };
    if (!Number.isSafeInteger(id) || Number(id) < 1) throw new Error('رقم البنك غير صالح.');
    const nextStatus = validateStatus(status);
    const result = database.prepare("UPDATE treasury_bank_accounts SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, Number(id));
    if (result.changes === 0) throw new Error('البنك المطلوب غير موجود.');
    return mapBankAccount(database.prepare(`${BANK_ACCOUNT_SELECT} WHERE banks.id = ?`).get(Number(id)) as Row);
  });
}
