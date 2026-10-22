import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, isAccountType, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal, installPostingSchema } from './posting.js';
import type {
  AccountingPeriodClosure,
  AccountType,
  AccountInput,
  AccountItem,
  Budget,
  BudgetCategory,
  BudgetInput,
  CostCenter,
  CostCenterInput,
  JournalEntryDetail,
  JournalEntryInput,
  JournalEntryItem,
  JournalLineInput,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

export function installAccountingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      parent_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      name_en TEXT NOT NULL DEFAULT '',
      postable INTEGER NOT NULL DEFAULT 1 CHECK (postable IN (0, 1)),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS accounts_parent ON accounts(parent_id);
    CREATE TABLE IF NOT EXISTS cost_centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      center_type TEXT NOT NULL DEFAULT '',
      postable INTEGER NOT NULL DEFAULT 1 CHECK (postable IN (0, 1)),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS cost_centers_parent ON cost_centers(parent_id);
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL DEFAULT '',
      entry_date TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
      request_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS journal_entries_date ON journal_entries(entry_date, id);
    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      debit TEXT NOT NULL,
      credit TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      UNIQUE(entry_id, line_order)
    );
    CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account_id, entry_id);
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS budgets_period ON budgets(starts_on, ends_on);
    CREATE TABLE IF NOT EXISTS budget_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      category TEXT NOT NULL CHECK (category IN ('sales', 'cash-purchases', 'cash-expenses')),
      amount TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS budget_lines_budget ON budget_lines(budget_id, id);
  `);
  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((row) => row.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('accounts', 'name_en', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('accounts', 'postable', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('accounts', 'notes', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('journal_entries', 'request_key', 'TEXT');
  ensureColumn('journal_lines', 'description', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('journal_lines', 'cost_center_id', 'INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_request_key ON journal_entries(request_key) WHERE request_key IS NOT NULL');
  installPostingSchema(database);
}

function readPeriodClosure(row: Row): AccountingPeriodClosure {
  return {
    id: Number(row.id), from: String(row.period_start), to: String(row.period_end),
    closedByUserId: Number(row.closed_by_user_id), closedAt: String(row.closed_at),
  };
}

function asAccount(row: Row): AccountItem {
  if (!isAccountType(row.account_type)) throw new Error('يوجد نوع حساب غير صالح في قاعدة البيانات.');
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    nameEn: String(row.name_en ?? ''),
    type: row.account_type,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    postable: Number(row.postable ?? 1) === 1 && Number(row.has_children ?? 0) === 0,
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at),
  };
}

function asJournalEntry(row: Row): JournalEntryItem {
  return {
    id: Number(row.id),
    reference: String(row.reference),
    date: String(row.entry_date),
    description: String(row.description),
    lineCount: Number(row.line_count),
    postedAt: String(row.created_at),
  };
}

function asCostCenter(row: Row): CostCenter {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), nameEn: String(row.name_en),
    parentId: row.parent_id === null ? null : Number(row.parent_id), type: String(row.center_type),
    postable: Number(row.postable) === 1 && Number(row.has_children ?? 0) === 0, notes: String(row.notes),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new Error('تعذر إكمال العملية أو التراجع عنها؛ تحقّق من قاعدة البيانات.', { cause: rollbackError });
    }
    throw error;
  }
}

function validateCostCenter(value: unknown): CostCenterInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات مركز التكلفة غير صالحة.');
  const input = value as Partial<CostCenterInput> & { id?: unknown };
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) throw new Error('رقم مركز التكلفة غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود مركز تكلفة لا يتجاوز 40 حرفًا.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم مركز التكلفة.');
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 180) throw new Error('الاسم الإنجليزي لمركز التكلفة غير صالح.');
  if (typeof input.type !== 'string' || input.type.length > 80) throw new Error('نوع مركز التكلفة غير صالح.');
  if (typeof input.postable !== 'boolean') throw new Error('خيار السماح بالترحيل غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات مركز التكلفة غير صالحة.');
  if (input.parentId !== null && (!Number.isSafeInteger(input.parentId) || Number(input.parentId) < 1)) throw new Error('المركز الأب غير صالح.');
  return {
    ...(input.id === undefined ? {} : { id: Number(input.id) }), code: input.code.trim(), name: input.name.trim(),
    nameEn: input.nameEn.trim(), parentId: input.parentId as number | null, type: input.type.trim(),
    postable: input.postable, notes: input.notes.trim(),
  };
}

function validateBudget(database: DatabaseSync, value: unknown): BudgetInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات الموازنة غير صالحة.');
  const input = value as Partial<BudgetInput> & { id?: unknown };
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) throw new Error('رقم سجل الموازنة غير صالح.');
  if (typeof input.from !== 'string' || !isValidDate(input.from)) throw new Error('تاريخ بداية الموازنة غير صالح.');
  if (typeof input.to !== 'string' || !isValidDate(input.to) || input.from > input.to) throw new Error('تاريخ نهاية الموازنة غير صالح أو يسبق بدايتها.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات الموازنة غير صالحة.');
  const costCenterId = input.costCenterId ?? null;
  if (costCenterId !== null && (!Number.isSafeInteger(costCenterId) || costCenterId < 1)) throw new Error('مركز التكلفة المحدد غير صالح.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) throw new Error('أضف بندًا واحدًا على الأقل، وبحد أقصى 500 بند.');
  const lines = input.lines.map((valueLine) => {
    if (!valueLine || typeof valueLine !== 'object') throw new Error('أحد بنود الموازنة غير صالح.');
    const line = valueLine as Partial<BudgetInput['lines'][number]>;
    if (!Number.isSafeInteger(line.accountId) || Number(line.accountId) < 1) throw new Error('اختر حسابًا لكل بند موازنة.');
    if (!['sales', 'cash-purchases', 'cash-expenses'].includes(line.category as string)) throw new Error('تصنيف بند الموازنة غير صالح.');
    if (typeof line.amount !== 'string' || parseAmount(line.amount) < 1n) throw new Error('قيمة بند الموازنة يجب أن تكون أكبر من صفر.');
    if (typeof line.notes !== 'string' || line.notes.length > 500) throw new Error('ملاحظات بند الموازنة غير صالحة.');
    const lineCenterId = line.costCenterId ?? null;
    if (lineCenterId !== null && (!Number.isSafeInteger(lineCenterId) || Number(lineCenterId) < 1)) throw new Error('مركز تكلفة أحد البنود غير صالح.');
    const account = database.prepare('SELECT postable, EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children FROM accounts WHERE id = ?')
      .get(Number(line.accountId)) as Row | undefined;
    if (!account) throw new Error('حساب أحد بنود الموازنة غير موجود.');
    if (Number(account.postable) !== 1 || Number(account.has_children) === 1) throw new Error('اختر حسابًا تفصيليًا قابلًا للترحيل لبند الموازنة.');
    if (lineCenterId !== null) {
      const center = database.prepare('SELECT id, postable, EXISTS(SELECT 1 FROM cost_centers child WHERE child.parent_id = cost_centers.id) AS has_children FROM cost_centers WHERE id = ?')
        .get(Number(lineCenterId)) as Row | undefined;
      if (!center) throw new Error('مركز تكلفة أحد البنود غير موجود.');
      if (Number(center.postable) !== 1 || Number(center.has_children) === 1) throw new Error('اختر مركز تكلفة تفصيليًا قابلًا للترحيل.');
    }
    return {
      accountId: Number(line.accountId), costCenterId: lineCenterId === null ? null : Number(lineCenterId),
      category: line.category as BudgetCategory, amount: normalizeAmount(line.amount), notes: line.notes.trim(),
    };
  });
  if (costCenterId !== null && !database.prepare('SELECT 1 FROM cost_centers WHERE id = ?').get(costCenterId)) throw new Error('مركز التكلفة المحدد غير موجود.');
  return {
    ...(input.id === undefined ? {} : { id: Number(input.id) }), from: input.from, to: input.to,
    costCenterId, notes: input.notes.trim(), lines,
  };
}

function readBudget(database: DatabaseSync, id: number): Budget {
  const row = database.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('الموازنة المطلوبة غير موجودة.');
  const lines = (database.prepare('SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY id').all(id) as Row[]).map((line) => ({
    id: Number(line.id), accountId: Number(line.account_id), costCenterId: line.cost_center_id === null ? null : Number(line.cost_center_id),
    category: String(line.category) as BudgetCategory, amount: String(line.amount), notes: String(line.notes),
  }));
  const totals = { sales: 0n, 'cash-purchases': 0n, 'cash-expenses': 0n };
  for (const line of lines) totals[line.category] += parseAmount(line.amount);
  const net = totals.sales - totals['cash-purchases'] - totals['cash-expenses'];
  return {
    id, number: String(row.number), from: String(row.starts_on), to: String(row.ends_on),
    costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id), notes: String(row.notes), lines,
    sales: formatAmount(totals.sales), cashPurchases: formatAmount(totals['cash-purchases']),
    cashExpenses: formatAmount(totals['cash-expenses']),
    net: net < 0n ? `-${formatAmount(-net)}` : formatAmount(net),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function readJournalEntry(database: DatabaseSync, idValue: unknown): JournalEntryDetail {
  if (!Number.isSafeInteger(idValue) || Number(idValue) < 1) throw new Error('رقم القيد غير صالح.');
  const id = Number(idValue);
  const entry = database.prepare(`SELECT entries.*, COUNT(lines.id) AS line_count
    FROM journal_entries entries LEFT JOIN journal_lines lines ON lines.entry_id = entries.id
    WHERE entries.id = ? GROUP BY entries.id`).get(id) as Row | undefined;
  if (!entry) throw new Error('القيد المطلوب غير موجود.');
  const lines = database.prepare(`SELECT lines.*, accounts.code AS account_code, accounts.name AS account_name,
      centers.code AS center_code, centers.name AS center_name
    FROM journal_lines lines INNER JOIN accounts ON accounts.id = lines.account_id
    LEFT JOIN cost_centers centers ON centers.id = lines.cost_center_id
    WHERE lines.entry_id = ? ORDER BY lines.line_order`).all(id) as Row[];
  let debit = 0n;
  let credit = 0n;
  const mappedLines = lines.map((line) => {
    debit += parseAmount(String(line.debit));
    credit += parseAmount(String(line.credit));
    return {
      id: Number(line.id), accountId: Number(line.account_id), accountCode: String(line.account_code), accountName: String(line.account_name),
      description: String(line.description ?? ''), debit: String(line.debit), credit: String(line.credit),
      costCenterId: line.cost_center_id === null ? null : Number(line.cost_center_id),
      costCenterCode: String(line.center_code ?? ''), costCenterName: String(line.center_name ?? ''),
    };
  });
  return {
    ...asJournalEntry(entry), lines: mappedLines, totalDebit: formatAmount(debit), totalCredit: formatAmount(credit), status: 'posted',
  };
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateAccount(value: unknown): AccountInput & { id?: number } {
  if (!value || typeof value !== 'object') throw new Error('بيانات الحساب غير صالحة.');
  const input = value as Partial<AccountInput> & { id?: unknown };
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) {
    throw new Error('أدخل رمز حساب لا يتجاوز 40 حرفًا.');
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) {
    throw new Error('أدخل اسم حساب لا يتجاوز 180 حرفًا.');
  }
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 180) throw new Error('الاسم الإنجليزي للحساب غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات الحساب غير صالحة.');
  if (typeof input.postable !== 'boolean') throw new Error('خيار السماح بالترحيل غير صالح.');
  if (!isAccountType(input.type)) throw new Error('نوع الحساب غير صالح.');
  if (input.parentId !== null && (!Number.isSafeInteger(input.parentId) || Number(input.parentId) < 1)) {
    throw new Error('الحساب الأب غير صالح.');
  }
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) {
    throw new Error('رقم الحساب غير صالح.');
  }
  return {
    id: input.id as number | undefined,
    code: input.code.trim(),
    name: input.name.trim(),
    nameEn: input.nameEn.trim(),
    type: input.type,
    parentId: input.parentId as number | null,
    postable: input.postable,
    notes: input.notes.trim(),
  };
}

function validateJournalEntry(database: DatabaseSync, value: unknown): JournalEntryInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات القيد غير صالحة.');
  const input = value as Partial<JournalEntryInput>;
  if (input.requestKey !== undefined && (typeof input.requestKey !== 'string' || input.requestKey.length < 8 || input.requestKey.length > 100)) {
    throw new Error('مفتاح طلب القيد غير صالح.');
  }
  if (typeof input.date !== 'string' || !isValidDate(input.date)) throw new Error('تاريخ القيد غير صالح.');
  if (typeof input.reference !== 'string' || input.reference.length > 100) throw new Error('المرجع غير صالح.');
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 500) {
    throw new Error('أدخل وصفًا لا يتجاوز 500 حرفًا.');
  }
  if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 100) {
    throw new Error('يجب أن يحتوي القيد على سطرين على الأقل، وبحد أقصى 100 سطر.');
  }

  const lines: JournalLineInput[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const valueLine of input.lines) {
    if (!valueLine || typeof valueLine !== 'object') throw new Error('أحد أسطر القيد غير صالح.');
    const line = valueLine as Partial<JournalLineInput>;
    if (!Number.isSafeInteger(line.accountId) || Number(line.accountId) < 1) throw new Error('اختر حسابًا لكل سطر.');
    if (typeof line.description !== 'string' || line.description.length > 240) throw new Error('بيان أحد أسطر القيد غير صالح.');
    if (line.costCenterId !== null && (!Number.isSafeInteger(line.costCenterId) || Number(line.costCenterId) < 1)) throw new Error('مركز التكلفة في أحد الأسطر غير صالح.');
    if (typeof line.debit !== 'string' || typeof line.credit !== 'string') throw new Error('مبلغ أحد الأسطر غير صالح.');
    const debitUnits = parseAmount(line.debit);
    const creditUnits = parseAmount(line.credit);
    if ((debitUnits === 0n) === (creditUnits === 0n)) {
      throw new Error('يجب إدخال مبلغ في جانب واحد فقط لكل سطر.');
    }
    totalDebit += debitUnits;
    totalCredit += creditUnits;
    lines.push({
      accountId: Number(line.accountId),
      description: line.description.trim(),
      debit: normalizeAmount(line.debit),
      credit: normalizeAmount(line.credit),
      costCenterId: line.costCenterId === null ? null : Number(line.costCenterId),
    });
  }
  if (totalDebit === 0n || totalDebit !== totalCredit) throw new Error('القيد غير متوازن؛ يجب أن يتساوى إجمالي المدين والدائن.');

  for (const line of lines) {
    const account = database.prepare('SELECT postable, EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children FROM accounts WHERE id = ?')
      .get(line.accountId) as Row | undefined;
    if (!account) throw new Error('أحد الحسابات المختارة غير موجود.');
    if (Number(account.postable) !== 1 || Number(account.has_children) === 1) throw new Error('لا يمكن الترحيل إلى حساب تجميعي أو غير قابل للترحيل.');
    if (line.costCenterId !== null) {
      const center = database.prepare('SELECT postable, EXISTS(SELECT 1 FROM cost_centers child WHERE child.parent_id = cost_centers.id) AS has_children FROM cost_centers WHERE id = ?')
        .get(line.costCenterId) as Row | undefined;
      if (!center) throw new Error('مركز التكلفة المحدد غير موجود.');
      if (Number(center.postable) !== 1 || Number(center.has_children) === 1) throw new Error('لا يمكن استخدام مركز تكلفة تجميعي أو غير قابل للترحيل.');
    }
  }

  return {
    ...(input.requestKey ? { requestKey: input.requestKey } : {}),
    reference: input.reference.trim(),
    date: input.date,
    description: input.description.trim(),
    lines,
  };
}

export function registerAccountingHandlers(getDatabase: () => DatabaseSync, getAuthenticatedUserId: () => number = () => 1): void {
  ipcMain.handle('accounting-periods:list', () => {
    const database = getDatabase();
    return (database.prepare('SELECT * FROM accounting_period_closures ORDER BY period_start DESC, id DESC').all() as Row[])
      .map(readPeriodClosure);
  });

  ipcMain.handle('accounting-periods:close', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('بيانات الفترة المحاسبية غير صالحة.');
    const input = value as { from?: unknown; to?: unknown };
    if (typeof input.from !== 'string' || !isValidDate(input.from)
      || typeof input.to !== 'string' || !isValidDate(input.to) || input.from > input.to) {
      throw new Error('يجب إدخال فترة صحيحة يبدأ تاريخها قبل تاريخ النهاية أو يساويه.');
    }
    const from = input.from;
    const to = input.to;
    const userId = getAuthenticatedUserId();
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('تعذر تحديد مدير النظام الذي أغلق الفترة.');
    const database = getDatabase();
    return withTransaction(database, () => {
      const overlap = database.prepare(`
        SELECT 1 FROM accounting_period_closures
        WHERE ? <= period_end AND ? >= period_start LIMIT 1
      `).get(from, to);
      if (overlap) throw new Error('تتداخل الفترة مع فترة مغلقة سابقة.');
      const result = database.prepare(`
        INSERT INTO accounting_period_closures (period_start, period_end, closed_by_user_id)
        VALUES (?, ?, ?)
      `).run(from, to, userId);
      return readPeriodClosure(database.prepare('SELECT * FROM accounting_period_closures WHERE id = ?')
        .get(Number(result.lastInsertRowid)) as Row);
    });
  });

  ipcMain.handle('accounts:list', () => {
    const database = getDatabase();
    const rows = database.prepare(`SELECT accounts.*,
      EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children
      FROM accounts ORDER BY code, id`).all() as Row[];
    return rows.map(asAccount);
  });

  ipcMain.handle('accounts:save', (_event, value: unknown) => {
    const database = getDatabase();
    const input = validateAccount(value);
    return withTransaction(database, () => {
      const duplicate = database.prepare('SELECT id FROM accounts WHERE code = ? COLLATE NOCASE AND id <> ?').get(input.code, input.id ?? 0);
      if (duplicate) throw new Error('رمز الحساب مستخدم بالفعل.');
      let ancestor = input.parentId;
      const visited = new Set<number>();
      while (ancestor !== null) {
        if (ancestor === input.id || visited.has(ancestor)) throw new Error('يؤدي اختيار الحساب الأب إلى علاقة دائرية.');
        visited.add(ancestor);
        const row = database.prepare('SELECT parent_id FROM accounts WHERE id = ?').get(ancestor) as Row | undefined;
        if (!row) throw new Error('الحساب الأب المحدد غير موجود.');
        ancestor = row.parent_id === null ? null : Number(row.parent_id);
      }

      const existing = input.id
        ? database.prepare('SELECT account_type, postable, parent_id FROM accounts WHERE id = ?').get(input.id) as Row | undefined : undefined;
      if (input.id && !existing) throw new Error('لم يُعثر على الحساب المطلوب.');
      const hasHistory = input.id ? Boolean(database.prepare('SELECT 1 FROM journal_lines WHERE account_id = ? LIMIT 1').get(input.id)) : false;
      const usedInBudget = input.id ? Boolean(database.prepare('SELECT 1 FROM budget_lines WHERE account_id = ? LIMIT 1').get(input.id)) : false;
      if (existing && (hasHistory || usedInBudget) && (existing.account_type !== input.type || existing.parent_id !== input.parentId)) {
        throw new Error('لا يمكن تغيير نوع أو أب حساب مستخدم في قيود أو موازنات محفوظة.');
      }
      const children = input.id && database.prepare('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1').get(input.id);
      if (input.postable && children) throw new Error('الحساب الذي له حسابات فرعية لا يمكن السماح بالترحيل إليه.');

      if (input.parentId !== null) {
        const parent = database.prepare('SELECT postable FROM accounts WHERE id = ?').get(input.parentId) as Row;
        if (Number(parent.postable) === 1) {
          database.prepare('UPDATE accounts SET postable = 0 WHERE id = ?').run(input.parentId);
        }
      }

      let accountId = input.id;
      if (accountId) {
        database.prepare(`UPDATE accounts SET code = ?, name = ?, name_en = ?, account_type = ?, parent_id = ?, postable = ?, notes = ? WHERE id = ?`)
          .run(input.code, input.name, input.nameEn, input.type, input.parentId, input.postable ? 1 : 0, input.notes, accountId);
      } else {
        const result = database.prepare(`INSERT INTO accounts (code, name, name_en, account_type, parent_id, postable, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.code, input.name, input.nameEn, input.type, input.parentId, input.postable ? 1 : 0, input.notes);
        accountId = Number(result.lastInsertRowid);
      }
      return asAccount(database.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row);
    });
  });

  ipcMain.handle('accounts:delete', (_event, value: unknown) => {
    const database = getDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم الحساب غير صالح.');
    const accountId = Number(value);
    const child = database.prepare('SELECT 1 AS found FROM accounts WHERE parent_id = ? LIMIT 1').get(accountId);
    const used = database.prepare('SELECT 1 AS found FROM journal_lines WHERE account_id = ? LIMIT 1').get(accountId);
    const budgetUse = database.prepare('SELECT 1 AS found FROM budget_lines WHERE account_id = ? LIMIT 1').get(accountId);
    if (child || used || budgetUse) throw new Error('لا يمكن حذف حساب له حسابات فرعية أو قيود أو موازنات مرتبطة.');
    const result = database.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    if (result.changes === 0) throw new Error('لم يُعثر على الحساب المطلوب.');
    return true;
  });

  ipcMain.handle('cost-centers:list', (_event, searchValue: unknown) => {
    const database = getDatabase();
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const search = String(searchValue ?? '').trim();
    if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    return (database.prepare(`SELECT centers.*,
      EXISTS(SELECT 1 FROM cost_centers child WHERE child.parent_id = centers.id) AS has_children
      FROM cost_centers centers WHERE ? = '' OR code LIKE '%' || ? || '%'
      OR name LIKE '%' || ? || '%' OR name_en LIKE '%' || ? || '%' ORDER BY code COLLATE NOCASE, id`)
      .all(search, search, search, search) as Row[]).map(asCostCenter);
  });

  ipcMain.handle('cost-centers:save', (_event, value: unknown) => {
    const database = getDatabase();
    const input = validateCostCenter(value);
    return withTransaction(database, () => {
      if (database.prepare('SELECT 1 FROM cost_centers WHERE code = ? COLLATE NOCASE AND id <> ?').get(input.code, input.id ?? 0)) {
        throw new Error('كود مركز التكلفة مستخدم بالفعل.');
      }
      let ancestor = input.parentId;
      const visited = new Set<number>();
      while (ancestor !== null) {
        if (ancestor === input.id || visited.has(ancestor)) throw new Error('يؤدي اختيار المركز الأب إلى علاقة دائرية.');
        visited.add(ancestor);
        const row = database.prepare('SELECT parent_id FROM cost_centers WHERE id = ?').get(ancestor) as Row | undefined;
        if (!row) throw new Error('المركز الأب المحدد غير موجود.');
        ancestor = row.parent_id === null ? null : Number(row.parent_id);
      }
      const existing = input.id ? database.prepare('SELECT postable, parent_id FROM cost_centers WHERE id = ?').get(input.id) as Row | undefined : undefined;
      if (input.id && !existing) throw new Error('مركز التكلفة المطلوب غير موجود.');
      const used = input.id ? Boolean(database.prepare('SELECT 1 FROM journal_lines WHERE cost_center_id = ? LIMIT 1').get(input.id)) : false;
      const budgetUse = input.id ? Boolean(database.prepare('SELECT 1 FROM budget_lines WHERE cost_center_id = ? UNION SELECT 1 FROM budgets WHERE cost_center_id = ? LIMIT 1').get(input.id, input.id)) : false;
      if (existing && (used || budgetUse) && existing.parent_id !== input.parentId) {
        throw new Error('لا يمكن تغيير أب مركز مستخدم في قيود أو موازنات محفوظة.');
      }
      if (input.id && input.postable && database.prepare('SELECT 1 FROM cost_centers WHERE parent_id = ? LIMIT 1').get(input.id)) {
        throw new Error('مركز التكلفة الذي له مراكز فرعية لا يمكن السماح بالترحيل إليه.');
      }
      if (input.parentId !== null) {
        const parent = database.prepare('SELECT postable FROM cost_centers WHERE id = ?').get(input.parentId) as Row;
        if (Number(parent.postable) === 1) {
          database.prepare('UPDATE cost_centers SET postable = 0 WHERE id = ?').run(input.parentId);
        }
      }
      let id = input.id;
      if (id) {
        database.prepare(`UPDATE cost_centers SET code = ?, name = ?, name_en = ?, parent_id = ?, center_type = ?, postable = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(input.code, input.name, input.nameEn, input.parentId, input.type, input.postable ? 1 : 0, input.notes, id);
      } else {
        const result = database.prepare(`INSERT INTO cost_centers (code, name, name_en, parent_id, center_type, postable, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.code, input.name, input.nameEn, input.parentId, input.type, input.postable ? 1 : 0, input.notes);
        id = Number(result.lastInsertRowid);
      }
      return asCostCenter(database.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id) as Row);
    });
  });

  ipcMain.handle('cost-centers:delete', (_event, value: unknown) => {
    const database = getDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم مركز التكلفة غير صالح.');
    const id = Number(value);
    if (!database.prepare('SELECT 1 FROM cost_centers WHERE id = ?').get(id)) throw new Error('مركز التكلفة المطلوب غير موجود.');
    if (database.prepare('SELECT 1 FROM cost_centers WHERE parent_id = ? LIMIT 1').get(id)
      || database.prepare('SELECT 1 FROM journal_lines WHERE cost_center_id = ? LIMIT 1').get(id)
      || database.prepare('SELECT 1 FROM budget_lines WHERE cost_center_id = ? LIMIT 1').get(id)
      || database.prepare('SELECT 1 FROM budgets WHERE cost_center_id = ? LIMIT 1').get(id)) {
      throw new Error('لا يمكن حذف مركز تكلفة له مراكز فرعية أو قيود أو موازنات مرتبطة.');
    }
    database.prepare('DELETE FROM cost_centers WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('budgets:list', (_event, searchValue: unknown) => {
    const database = getDatabase();
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const search = String(searchValue ?? '').trim();
    if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    const rows = database.prepare(`SELECT id FROM budgets WHERE ? = '' OR number LIKE '%' || ? || '%' OR notes LIKE '%' || ? || '%'
      ORDER BY starts_on DESC, id DESC`).all(search, search, search) as Row[];
    return rows.map((row) => readBudget(database, Number(row.id)));
  });

  ipcMain.handle('budgets:get', (_event, id: unknown) => readBudget(getDatabase(), Number(id)));

  ipcMain.handle('budgets:save', (_event, value: unknown) => {
    const database = getDatabase();
    return withTransaction(database, () => {
      const input = validateBudget(database, value);
      let id = input.id;
      if (id) {
        if (!database.prepare('SELECT 1 FROM budgets WHERE id = ?').get(id)) throw new Error('الموازنة المطلوب تعديلها غير موجودة.');
        database.prepare(`UPDATE budgets SET starts_on = ?, ends_on = ?, cost_center_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(input.from, input.to, input.costCenterId, input.notes, id);
        database.prepare('DELETE FROM budget_lines WHERE budget_id = ?').run(id);
      } else {
        const result = database.prepare(`INSERT INTO budgets (number, starts_on, ends_on, cost_center_id, notes) VALUES ('PENDING', ?, ?, ?, ?)`)
          .run(input.from, input.to, input.costCenterId, input.notes);
        id = Number(result.lastInsertRowid);
        const number = `BUD-${input.from.slice(0, 4)}-${String(id).padStart(6, '0')}`;
        database.prepare('UPDATE budgets SET number = ? WHERE id = ?').run(number, id);
      }
      const insertLine = database.prepare(`INSERT INTO budget_lines (budget_id, account_id, cost_center_id, category, amount, notes)
        VALUES (?, ?, ?, ?, ?, ?)`);
      input.lines.forEach((line) => insertLine.run(id, line.accountId, line.costCenterId, line.category, line.amount, line.notes));
      return readBudget(database, id);
    });
  });

  ipcMain.handle('budgets:delete', (_event, value: unknown) => {
    const database = getDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم الموازنة غير صالح.');
    const result = database.prepare('DELETE FROM budgets WHERE id = ?').run(Number(value));
    if (!result.changes) throw new Error('الموازنة المطلوبة غير موجودة.');
    return true;
  });

  ipcMain.handle('journals:list', (_event, searchValue: unknown) => {
    const database = getDatabase();
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const search = String(searchValue ?? '').trim();
    if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    const rows = database.prepare(`
      SELECT entries.*, COUNT(lines.id) AS line_count
      FROM journal_entries AS entries
      LEFT JOIN journal_lines AS lines ON lines.entry_id = entries.id
      WHERE ? = '' OR CAST(entries.id AS TEXT) LIKE '%' || ? || '%' OR entries.reference LIKE '%' || ? || '%'
        OR entries.entry_date LIKE '%' || ? || '%' OR entries.description LIKE '%' || ? || '%'
      GROUP BY entries.id
      ORDER BY entries.entry_date DESC, entries.id DESC
    `).all(search, search, search, search, search) as Row[];
    return rows.map(asJournalEntry);
  });

  ipcMain.handle('journals:get', (_event, value: unknown) => readJournalEntry(getDatabase(), value));

  ipcMain.handle('journals:post', (_event, value: unknown) => {
    const database = getDatabase();
    const requestKey = value && typeof value === 'object' && typeof (value as { requestKey?: unknown }).requestKey === 'string'
      ? (value as { requestKey: string }).requestKey : randomUUID();
    return withTransaction(database, () => {
      const previous = database.prepare('SELECT id FROM journal_entries WHERE request_key = ?').get(requestKey) as Row | undefined;
      if (previous) return readJournalEntry(database, Number(previous.id));
      const entry = validateJournalEntry(database, { ...(value as object), requestKey });
      const entryId = createAccountingJournal(database, requestKey, entry.date, entry.description,
        entry.lines.map((line) => ({
          accountId: line.accountId, debit: line.debit, credit: line.credit,
          description: line.description, costCenterId: line.costCenterId,
        })), entry.reference);
      return readJournalEntry(database, entryId);
    });
  });

  ipcMain.handle('reports:trial-balance', (_event, value: unknown) => {
    // انتهت قناة الميزان القديمة بعد إنشاء مركز التقارير؛ لم تعد مستخدمة.
    throw new Error('نُقل تقرير ميزان المراجعة إلى مركز التقارير. افتح الصفحة «التقارير والطباعة».');
  });
}
