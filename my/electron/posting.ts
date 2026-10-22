import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { formatAmount, parseAmount } from '../src/shared/accounting.js';

type Row = Record<string, SQLOutputValue>;

export interface PostingLine {
  accountId: number;
  debit: string;
  credit: string;
  description: string;
  costCenterId?: number | null;
}

export function installPostingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounting_period_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      closed_by_user_id INTEGER NOT NULL,
      closed_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (period_start <= period_end),
      UNIQUE(period_start, period_end)
    );
    CREATE INDEX IF NOT EXISTS accounting_period_closures_range
      ON accounting_period_closures(period_start, period_end);
    CREATE TRIGGER IF NOT EXISTS accounting_period_no_overlap
    BEFORE INSERT ON accounting_period_closures
    WHEN EXISTS (
      SELECT 1 FROM accounting_period_closures
      WHERE NEW.period_start <= period_end AND NEW.period_end >= period_start
    )
    BEGIN
      SELECT RAISE(ABORT, 'تتداخل الفترة مع فترة مغلقة سابقة.');
    END;
    CREATE TRIGGER IF NOT EXISTS journal_entry_closed_period_insert
    BEFORE INSERT ON journal_entries
    WHEN EXISTS (
      SELECT 1 FROM accounting_period_closures
      WHERE NEW.entry_date BETWEEN period_start AND period_end
    )
    BEGIN
      SELECT RAISE(ABORT, 'الفترة المحاسبية مغلقة.');
    END;
    CREATE TRIGGER IF NOT EXISTS journal_entry_closed_period_update
    BEFORE UPDATE OF entry_date ON journal_entries
    WHEN EXISTS (
      SELECT 1 FROM accounting_period_closures
      WHERE NEW.entry_date BETWEEN period_start AND period_end
    )
    BEGIN
      SELECT RAISE(ABORT, 'الفترة المحاسبية مغلقة.');
    END;
  `);
}

export function assertAccountingDateOpen(database: DatabaseSync, date: string): void {
  const closed = database.prepare(`
    SELECT 1 AS found FROM accounting_period_closures
    WHERE ? BETWEEN period_start AND period_end LIMIT 1
  `).get(date);
  if (closed) throw new Error('الفترة المحاسبية مغلقة؛ اختر تاريخًا في فترة مفتوحة.');
}

export function firstOpenAccountingDate(database: DatabaseSync, startDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) throw new Error('تاريخ القيد العكسي غير صالح.');
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (start.toISOString().slice(0, 10) !== startDate) throw new Error('تاريخ القيد العكسي غير صالح.');

  let date = startDate;
  for (;;) {
    const closed = database.prepare(`
      SELECT period_end FROM accounting_period_closures
      WHERE period_start <= ? AND period_end >= ?
      ORDER BY period_end DESC LIMIT 1
    `).get(date, date) as Row | undefined;
    if (!closed) return date;
    const next = new Date(`${String(closed.period_end)}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.getUTCFullYear() > 9999) throw new Error('لا توجد فترة مفتوحة متاحة لتاريخ العكس.');
    date = next.toISOString().slice(0, 10);
  }
}

export function requirePostingAccount(
  database: DatabaseSync,
  accountId: number | null,
  expectedType: 'asset' | 'liability' | 'revenue' | 'expense',
  label: string,
): number {
  if (accountId === null || !Number.isSafeInteger(accountId) || accountId < 1) {
    throw new Error(`لم يتم ربط ${label} بحساب محاسبي.`);
  }
  const account = database.prepare(`
    SELECT account_type, postable,
      EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children
    FROM accounts WHERE id = ?
  `).get(accountId) as Row | undefined;
  if (!account || account.account_type !== expectedType) {
    throw new Error(`حساب ${label} غير موجود أو نوعه لا يطابق ${expectedType}.`);
  }
  if (Number(account.postable) !== 1 || Number(account.has_children) === 1) {
    throw new Error(`حساب ${label} تجميعي أو غير قابل للترحيل.`);
  }
  return accountId;
}

function assertPostableAccount(database: DatabaseSync, accountId: number): void {
  const account = database.prepare(`
    SELECT account_type, postable,
      EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children
    FROM accounts WHERE id = ?
  `).get(accountId) as Row | undefined;
  if (!account || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(String(account.account_type))) {
    throw new Error('أحد الحسابات المحاسبية في القيد غير موجود أو نوعه غير صالح.');
  }
  if (Number(account.postable) !== 1 || Number(account.has_children) === 1) {
    throw new Error('لا يمكن الترحيل إلى حساب تجميعي أو غير قابل للترحيل.');
  }
}

export function createAccountingJournal(
  database: DatabaseSync,
  requestKey: string,
  date: string,
  description: string,
  lines: PostingLine[],
  reference = requestKey,
): number {
  if (!requestKey.trim()) throw new Error('مفتاح تكرار القيد غير صالح.');
  const existing = database.prepare('SELECT id FROM journal_entries WHERE request_key = ?').get(requestKey) as Row | undefined;
  if (existing) return Number(existing.id);
  assertAccountingDateOpen(database, date);
  if (!lines.length) throw new Error('لا توجد سطور قابلة للترحيل.');

  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    assertPostableAccount(database, line.accountId);
    const debitValue = parseAmount(line.debit);
    const creditValue = parseAmount(line.credit);
    if ((debitValue === 0n) === (creditValue === 0n)) {
      throw new Error('يجب تحديد جانب واحد فقط لكل سطر قيد.');
    }
    debit += debitValue;
    credit += creditValue;
  }
  if (debit <= 0n || debit !== credit) throw new Error('الحركة المالية غير متوازنة ولا يمكن ترحيلها.');

  const result = database.prepare(`
    INSERT INTO journal_entries (reference, entry_date, description, request_key)
    VALUES (?, ?, ?, ?)
  `)  .run(reference, date, description, requestKey);
  const entryId = Number(result.lastInsertRowid);
  const insert = database.prepare(`
    INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit, description, cost_center_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line, index) => insert.run(
    entryId, index + 1, line.accountId, formatAmount(parseAmount(line.debit)),
    formatAmount(parseAmount(line.credit)), line.description, line.costCenterId ?? null,
  ));
  return entryId;
}

export function reverseAccountingJournal(
  database: DatabaseSync,
  originalEntryId: number,
  requestKey: string,
  date: string,
  description: string,
): number {
  const original = database.prepare('SELECT reference, entry_date FROM journal_entries WHERE id = ?')
    .get(originalEntryId) as Row | undefined;
  if (!original) throw new Error('لا يوجد قيد أصلي موثق لعكسه.');
  const lines = database.prepare(`
    SELECT account_id, debit, credit, description, cost_center_id
    FROM journal_lines WHERE entry_id = ? ORDER BY line_order
  `).all(originalEntryId) as Row[];
  if (!lines.length) throw new Error('القيد الأصلي لا يحتوي سطورًا قابلة للعكس.');
  return createAccountingJournal(database, requestKey, date, description, lines.map((line) => ({
    accountId: Number(line.account_id),
    debit: String(line.credit),
    credit: String(line.debit),
    description: String(line.description),
    costCenterId: line.cost_center_id === null ? null : Number(line.cost_center_id),
  })), String(original.reference));
}
