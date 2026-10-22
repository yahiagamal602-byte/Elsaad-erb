import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal } from './posting.js';
import type {
  Expense,
  ExpenseAllocationInput,
  ExpenseInput,
  FinancialVoucher,
  FinancialVoucherInput,
  FinancialVoucherParty,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch (rollbackError) {
      throw new Error('تعذر إكمال الحركة المالية أو التراجع عنها؛ تحقّق من قاعدة البيانات.', { cause: rollbackError });
    }
    throw error;
  }
}

function validId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} غير صالح.`);
  return Number(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function postableAccount(database: DatabaseSync, id: number, type: 'asset' | 'liability' | 'expense', label: string): Row {
  const row = database.prepare(`SELECT account_type, postable,
    EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children FROM accounts WHERE id = ?`).get(id) as Row | undefined;
  if (!row || row.account_type !== type || Number(row.postable) !== 1 || Number(row.has_children) === 1) {
    throw new Error(`${label} يجب أن يكون حسابًا تفصيليًا من نوع ${type === 'asset' ? 'أصول' : type === 'liability' ? 'التزامات' : 'مصروفات'} وقابلًا للترحيل.`);
  }
  return row;
}

function validateCenter(database: DatabaseSync, id: number | null): void {
  if (id === null) return;
  const row = database.prepare(`SELECT postable, EXISTS(SELECT 1 FROM cost_centers child WHERE child.parent_id = cost_centers.id) AS has_children
    FROM cost_centers WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('مركز التكلفة المحدد غير موجود.');
  if (Number(row.postable) !== 1 || Number(row.has_children) === 1) throw new Error('اختر مركز تكلفة تفصيليًا قابلًا للترحيل.');
}

function validateProject(database: DatabaseSync, id: number | null): void {
  if (id === null) return;
  const row = database.prepare('SELECT status FROM projects WHERE id = ?').get(id) as Row | undefined;
  if (!row || row.status === 'cancelled') throw new Error('المشروع المحدد غير موجود أو ملغي.');
}

function validatePayout(database: DatabaseSync, method: 'cash' | 'bank', cashBoxId: number | null, bankAccountId: number | null): number {
  if (method === 'cash') {
    if (cashBoxId === null || bankAccountId !== null) throw new Error('اختر خزينة نشطة فقط لطريقة الدفع النقدية.');
    const box = database.prepare('SELECT account_id, status, currency FROM treasury_cash_boxes WHERE id = ?').get(cashBoxId) as Row | undefined;
    if (!box || box.status !== 'active') throw new Error('الخزينة المحددة غير موجودة أو غير نشطة.');
    if (String(box.currency).toUpperCase() !== 'EGP') throw new Error('لا يمكن ترحيل عملة مختلفة لعدم توفر آلية سعر صرف معتمدة.');
    return Number(box.account_id);
  }
  if (bankAccountId === null || cashBoxId !== null) throw new Error('اختر بنكًا نشطًا فقط لطريقة الدفع البنكية.');
  const bank = database.prepare('SELECT account_id, status, currency FROM treasury_bank_accounts WHERE id = ?').get(bankAccountId) as Row | undefined;
  if (!bank || bank.status !== 'active') throw new Error('البنك المحدد غير موجود أو غير نشط.');
  if (String(bank.currency).toUpperCase() !== 'EGP') throw new Error('لا يمكن ترحيل عملة مختلفة لعدم توفر آلية سعر صرف معتمدة.');
  return Number(bank.account_id);
}

export function installFinancialDocumentSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS financial_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      party_kind TEXT NOT NULL CHECK (party_kind IN ('customer', 'supplier')),
      voucher_type TEXT NOT NULL CHECK (voucher_type IN ('receipt', 'payment')),
      voucher_date TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank')),
      cash_box_id INTEGER REFERENCES treasury_cash_boxes(id) ON DELETE RESTRICT,
      bank_account_id INTEGER REFERENCES treasury_bank_accounts(id) ON DELETE RESTRICT,
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
      journal_entry_id INTEGER UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((party_kind = 'customer' AND voucher_type = 'receipt' AND customer_id IS NOT NULL AND supplier_id IS NULL)
          OR (party_kind = 'supplier' AND voucher_type = 'payment' AND supplier_id IS NOT NULL AND customer_id IS NULL)),
      CHECK ((payment_method = 'cash' AND cash_box_id IS NOT NULL AND bank_account_id IS NULL)
          OR (payment_method = 'bank' AND bank_account_id IS NOT NULL AND cash_box_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS financial_vouchers_party_date ON financial_vouchers(party_kind, voucher_date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      expense_date TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      description TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank')),
      cash_box_id INTEGER REFERENCES treasury_cash_boxes(id) ON DELETE RESTRICT,
      bank_account_id INTEGER REFERENCES treasury_bank_accounts(id) ON DELETE RESTRICT,
      payable_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      paid_amount TEXT NOT NULL,
      total_amount TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
      journal_entry_id INTEGER UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((payment_method = 'cash' AND (bank_account_id IS NULL)) OR (payment_method = 'bank' AND (cash_box_id IS NULL)))
    );
    CREATE INDEX IF NOT EXISTS expenses_date_status ON expenses(expense_date DESC, status, id DESC);
    CREATE TABLE IF NOT EXISTS expense_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      expense_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS expense_allocations_expense ON expense_allocations(expense_id, id);
  `);
}

function validateVoucher(database: DatabaseSync, partyKind: FinancialVoucherParty, value: unknown): FinancialVoucherInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات السند غير صالحة.');
  const input = value as Partial<FinancialVoucherInput>;
  if (input.id !== undefined) validId(input.id, 'رقم السند');
  if (input.partyKind !== partyKind) throw new Error('نوع الطرف في السند غير صالح.');
  if (!validDate(input.date)) throw new Error('تاريخ السند غير صالح.');
  const partyId = validId(input.partyId, partyKind === 'customer' ? 'العميل' : 'المورد');
  if (typeof input.amount !== 'string' || parseAmount(input.amount) <= 0n) throw new Error('مبلغ السند يجب أن يكون أكبر من صفر.');
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'bank') throw new Error('طريقة الدفع غير صالحة.');
  const cashBoxId = input.cashBoxId === null ? null : validId(input.cashBoxId, 'الخزينة');
  const bankAccountId = input.bankAccountId === null ? null : validId(input.bankAccountId, 'البنك');
  const costCenterId = input.costCenterId === null ? null : validId(input.costCenterId, 'مركز التكلفة');
  const projectId = input.projectId === null ? null : validId(input.projectId, 'المشروع');
  if (typeof input.reference !== 'string' || input.reference.length > 100) throw new Error('المرجع غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات السند غير صالحة.');
  const party = partyKind === 'customer'
    ? database.prepare('SELECT status, account_id FROM customers WHERE id = ?').get(partyId) as Row | undefined
    : database.prepare('SELECT status, account_id FROM suppliers WHERE id = ?').get(partyId) as Row | undefined;
  if (!party || party.status !== 'active') throw new Error('العميل أو المورد المحدد غير موجود أو غير نشط.');
  if (party.account_id === null) throw new Error('اربط الطرف بحسابه المحاسبي أولًا.');
  postableAccount(database, Number(party.account_id), partyKind === 'customer' ? 'asset' : 'liability', 'حساب الطرف');
  const payoutAccountId = validatePayout(database, input.paymentMethod, cashBoxId, bankAccountId);
  postableAccount(database, payoutAccountId, 'asset', 'حساب الخزينة أو البنك');
  validateCenter(database, costCenterId);
  validateProject(database, projectId);
  return {
    ...(input.id === undefined ? {} : { id: Number(input.id) }), partyKind, date: input.date,
    partyId, amount: normalizeAmount(input.amount), paymentMethod: input.paymentMethod,
    cashBoxId, bankAccountId, costCenterId, projectId, reference: input.reference.trim(), notes: input.notes.trim(),
  };
}

function voucherQuery(partyKind: FinancialVoucherParty): string {
  return `SELECT vouchers.*, COALESCE(customers.code, suppliers.code, '') AS party_code,
      COALESCE(customers.name, suppliers.name, '') AS party_name,
      COALESCE(customers.account_id, suppliers.account_id) AS party_account_id,
      COALESCE(boxes.name, banks.name, '') AS payout_name,
      COALESCE(boxes.currency, banks.currency, 'EGP') AS payout_currency
    FROM financial_vouchers vouchers
    LEFT JOIN customers ON customers.id = vouchers.customer_id
    LEFT JOIN suppliers ON suppliers.id = vouchers.supplier_id
    LEFT JOIN treasury_cash_boxes boxes ON boxes.id = vouchers.cash_box_id
    LEFT JOIN treasury_bank_accounts banks ON banks.id = vouchers.bank_account_id
    WHERE vouchers.party_kind = '${partyKind}'`;
}

function readVoucher(database: DatabaseSync, id: number, partyKind: FinancialVoucherParty): FinancialVoucher {
  const row = database.prepare(`${voucherQuery(partyKind)} AND vouchers.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('السند المطلوب غير موجود.');
  return {
    id: Number(row.id), number: String(row.number), partyKind,
    date: String(row.voucher_date), partyId: Number(partyKind === 'customer' ? row.customer_id : row.supplier_id),
    amount: String(row.amount), paymentMethod: String(row.payment_method) as FinancialVoucher['paymentMethod'],
    cashBoxId: row.cash_box_id === null ? null : Number(row.cash_box_id), bankAccountId: row.bank_account_id === null ? null : Number(row.bank_account_id),
    costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id), projectId: row.project_id === null ? null : Number(row.project_id),
    reference: String(row.reference), notes: String(row.notes), partyCode: String(row.party_code), partyName: String(row.party_name),
    partyAccountId: Number(row.party_account_id), payoutAccountName: String(row.payout_name), payoutCurrency: String(row.payout_currency),
    status: String(row.status) as FinancialVoucher['status'], journalEntryId: row.journal_entry_id === null ? null : Number(row.journal_entry_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validateExpense(database: DatabaseSync, value: unknown): ExpenseInput & { totalAmount: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات المصروف غير صالحة.');
  const input = value as Partial<ExpenseInput> & { totalAmount?: unknown };
  if (input.id !== undefined) validId(input.id, 'رقم المصروف');
  if (!validDate(input.date)) throw new Error('تاريخ المصروف غير صالح.');
  if (typeof input.operationType !== 'string' || !input.operationType.trim() || input.operationType.length > 100) throw new Error('أدخل نوع العملية.');
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 300) throw new Error('أدخل اسم بند المصروف.');
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'bank') throw new Error('طريقة الدفع غير صالحة.');
  const cashBoxId = input.cashBoxId === null ? null : validId(input.cashBoxId, 'الخزينة');
  const bankAccountId = input.bankAccountId === null ? null : validId(input.bankAccountId, 'البنك');
  const payableAccountId = input.payableAccountId === null ? null : validId(input.payableAccountId, 'حساب الالتزام');
  const costCenterId = input.costCenterId === null ? null : validId(input.costCenterId, 'مركز التكلفة');
  const projectId = input.projectId === null ? null : validId(input.projectId, 'المشروع');
  if (typeof input.paidAmount !== 'string' || typeof input.totalAmount !== 'string') throw new Error('مبالغ المصروف غير صالحة.');
  const paid = parseAmount(input.paidAmount);
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 200) throw new Error('أضف توزيعًا واحدًا على الأقل للمصروف.');
  const allocations: ExpenseAllocationInput[] = [];
  let total = 0n;
  for (const valueLine of input.allocations) {
    if (!valueLine || typeof valueLine !== 'object') throw new Error('أحد توزيعات المصروف غير صالح.');
    const line = valueLine as Partial<ExpenseAllocationInput>;
    const expenseAccountId = validId(line.expenseAccountId, 'حساب المصروف');
    const account = postableAccount(database, expenseAccountId, 'expense', 'حساب المصروف');
    void account;
    const lineProject = line.projectId === null ? projectId : validId(line.projectId, 'مشروع التوزيع');
    const lineCenter = line.costCenterId === null ? costCenterId : validId(line.costCenterId, 'مركز توزيع');
    validateProject(database, lineProject);
    validateCenter(database, lineCenter);
    if (typeof line.amount !== 'string' || parseAmount(line.amount) <= 0n) throw new Error('مبلغ التوزيع يجب أن يكون أكبر من صفر.');
    if (typeof line.notes !== 'string' || line.notes.length > 500) throw new Error('ملاحظات التوزيع غير صالحة.');
    const amount = normalizeAmount(line.amount);
    total += parseAmount(amount);
    allocations.push({ expenseAccountId, projectId: lineProject, costCenterId: lineCenter, amount, notes: line.notes.trim() });
  }
  if (typeof input.totalAmount !== 'string' || parseAmount(input.totalAmount) <= 0n) throw new Error('إجمالي المصروف يجب أن يكون أكبر من صفر.');
  const requestedTotal = parseAmount(input.totalAmount);
  if (total !== requestedTotal) throw new Error('مجموع توزيعات الأوامر يجب أن يساوي إجمالي المصروف بالضبط.');
  if (paid > total) throw new Error('المبلغ المدفوع لا يمكن أن يتجاوز إجمالي المصروف.');
  if (paid < total) {
    if (payableAccountId === null) throw new Error('اختر حساب الالتزام للمبلغ المتبقي غير المدفوع.');
    postableAccount(database, payableAccountId, 'liability', 'حساب الالتزام');
  }
  if (paid > 0n) {
    const payout = validatePayout(database, input.paymentMethod, cashBoxId, bankAccountId);
    postableAccount(database, payout, 'asset', 'حساب الخزينة أو البنك');
  }
  validateCenter(database, costCenterId);
  validateProject(database, projectId);
  return {
    ...(input.id === undefined ? {} : { id: Number(input.id) }), date: input.date,
    operationType: input.operationType.trim(), description: input.description.trim(), paymentMethod: input.paymentMethod,
    cashBoxId, bankAccountId, payableAccountId, costCenterId, projectId,
    paidAmount: normalizeAmount(input.paidAmount), allocations, notes: typeof input.notes === 'string' ? input.notes.trim() : '',
    totalAmount: normalizeAmount(input.totalAmount),
  };
}

function readExpense(database: DatabaseSync, id: number): Expense {
  const row = database.prepare(`SELECT expenses.*, COALESCE(boxes.name, banks.name, '') AS payout_name
    FROM expenses LEFT JOIN treasury_cash_boxes boxes ON boxes.id = expenses.cash_box_id
    LEFT JOIN treasury_bank_accounts banks ON banks.id = expenses.bank_account_id WHERE expenses.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('المصروف المطلوب غير موجود.');
  const allocations = (database.prepare(`SELECT allocations.*, accounts.name AS account_name,
      centers.name AS center_name, projects.name AS project_name
    FROM expense_allocations allocations INNER JOIN accounts ON accounts.id = allocations.expense_account_id
    LEFT JOIN cost_centers centers ON centers.id = allocations.cost_center_id
    LEFT JOIN projects ON projects.id = allocations.project_id WHERE allocations.expense_id = ? ORDER BY allocations.id`).all(id) as Row[])
    .map((line) => ({
      id: Number(line.id), expenseAccountId: Number(line.expense_account_id), expenseAccountName: String(line.account_name),
      projectId: line.project_id === null ? null : Number(line.project_id), projectName: String(line.project_name ?? ''),
      costCenterId: line.cost_center_id === null ? null : Number(line.cost_center_id), costCenterName: String(line.center_name ?? ''),
      amount: String(line.amount), notes: String(line.notes),
    }));
  const total = parseAmount(String(row.total_amount));
  const paid = parseAmount(String(row.paid_amount));
  const remaining = total - paid;
  return {
    id, number: String(row.number), date: String(row.expense_date), operationType: String(row.operation_type), description: String(row.description),
    paymentMethod: String(row.payment_method) as Expense['paymentMethod'],
    cashBoxId: row.cash_box_id === null ? null : Number(row.cash_box_id), bankAccountId: row.bank_account_id === null ? null : Number(row.bank_account_id),
    payableAccountId: row.payable_account_id === null ? null : Number(row.payable_account_id),
    costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id), projectId: row.project_id === null ? null : Number(row.project_id),
    paidAmount: String(row.paid_amount), totalAmount: String(row.total_amount), allocations, notes: String(row.notes), currency: String(row.currency), total: formatAmount(total),
    remaining: formatAmount(remaining), settlementStatus: paid === 0n ? 'unpaid' : remaining === 0n ? 'paid' : 'partial',
    status: String(row.status) as Expense['status'], journalEntryId: row.journal_entry_id === null ? null : Number(row.journal_entry_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function createJournal(database: DatabaseSync, requestKey: string, date: string, description: string, lines: Array<{ accountId: number; debit: string; credit: string; description: string; costCenterId: number | null }>): number {
  return createAccountingJournal(database, requestKey, date, description, lines);
}

function mapVoucherRow(row: Row, partyKind: FinancialVoucherParty): FinancialVoucher {
  return {
    id: Number(row.id), number: String(row.number), partyKind, date: String(row.voucher_date),
    partyId: Number(partyKind === 'customer' ? row.customer_id : row.supplier_id), amount: String(row.amount),
    paymentMethod: String(row.payment_method) as FinancialVoucher['paymentMethod'],
    cashBoxId: row.cash_box_id === null ? null : Number(row.cash_box_id), bankAccountId: row.bank_account_id === null ? null : Number(row.bank_account_id),
    costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id), projectId: row.project_id === null ? null : Number(row.project_id),
    reference: String(row.reference), notes: String(row.notes), partyCode: String(row.party_code), partyName: String(row.party_name),
    partyAccountId: Number(row.party_account_id), payoutAccountName: String(row.payout_name),
    payoutCurrency: String(row.payout_currency),
    status: String(row.status) as FinancialVoucher['status'], journalEntryId: row.journal_entry_id === null ? null : Number(row.journal_entry_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function voucherList(database: DatabaseSync, partyKind: FinancialVoucherParty): string {
  const partyTable = partyKind === 'customer' ? 'customers' : 'suppliers';
  const partyForeignKey = partyKind === 'customer' ? 'customer_id' : 'supplier_id';
  return `SELECT vouchers.*, parties.code AS party_code, parties.name AS party_name,
      parties.account_id AS party_account_id, COALESCE(boxes.name, banks.name, '') AS payout_name,
      COALESCE(boxes.currency, banks.currency, 'EGP') AS payout_currency
    FROM financial_vouchers vouchers INNER JOIN ${partyTable} parties ON parties.id = vouchers.${partyForeignKey}
    LEFT JOIN treasury_cash_boxes boxes ON boxes.id = vouchers.cash_box_id
    LEFT JOIN treasury_bank_accounts banks ON banks.id = vouchers.bank_account_id WHERE vouchers.party_kind = '${partyKind}'`;
}

function updateVoucher(database: DatabaseSync, partyKind: FinancialVoucherParty, value: unknown): FinancialVoucher {
  const input = validateVoucher(database, partyKind, value);
  const voucherType = partyKind === 'customer' ? 'receipt' : 'payment';
  return transaction(database, () => {
    let id = input.id;
    if (id !== undefined) {
      const current = database.prepare('SELECT status, party_kind FROM financial_vouchers WHERE id = ?').get(id) as Row | undefined;
      if (!current || current.party_kind !== partyKind) throw new Error('السند المطلوب غير موجود في هذه الصفحة.');
      if (current.status !== 'draft') throw new Error('لا يمكن تعديل سند مرحّل.');
      const result = database.prepare(`UPDATE financial_vouchers SET ${partyKind === 'customer' ? 'customer_id' : 'supplier_id'} = ?,
        voucher_date = ?, amount = ?, payment_method = ?, cash_box_id = ?, bank_account_id = ?, cost_center_id = ?, project_id = ?, reference = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.partyId, input.date, input.amount, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.costCenterId, input.projectId, input.reference, input.notes, id);
      if (!result.changes) throw new Error('لم يُعثر على السند.');
    } else {
      const result = database.prepare(`INSERT INTO financial_vouchers (number, party_kind, voucher_type, voucher_date,
        customer_id, supplier_id, amount, payment_method, cash_box_id, bank_account_id, cost_center_id, project_id, reference, notes)
        VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(partyKind, voucherType, input.date, partyKind === 'customer' ? input.partyId : null, partyKind === 'supplier' ? input.partyId : null,
          input.amount, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.costCenterId, input.projectId, input.reference, input.notes);
      id = Number(result.lastInsertRowid);
      database.prepare('UPDATE financial_vouchers SET number = ? WHERE id = ?').run(`${partyKind === 'customer' ? 'CR' : 'SP'}-${String(id).padStart(7, '0')}`, id);
    }
    const row = database.prepare(`${voucherList(database, partyKind)} AND vouchers.id = ?`).get(id) as Row;
    return mapVoucherRow(row, partyKind);
  });
}

function approveVoucher(database: DatabaseSync, idValue: unknown, partyKind: FinancialVoucherParty): FinancialVoucher {
  const id = validId(idValue, 'رقم السند');
  return transaction(database, () => {
    const row = database.prepare('SELECT * FROM financial_vouchers WHERE id = ? AND party_kind = ?').get(id, partyKind) as Row | undefined;
    if (!row) throw new Error('السند المطلوب غير موجود.');
    if (row.status === 'posted') return mapVoucherRow(database.prepare(`${voucherList(database, partyKind)} AND vouchers.id = ?`).get(id) as Row, partyKind);
    const partyId = Number(partyKind === 'customer' ? row.customer_id : row.supplier_id);
    const party = database.prepare(`SELECT account_id FROM ${partyKind === 'customer' ? 'customers' : 'suppliers'} WHERE id = ? AND status = 'active'`).get(partyId) as Row | undefined;
    if (!party || party.account_id === null) throw new Error('الطرف غير نشط أو لا يملك حسابًا محاسبيًا.');
    const payoutAccount = validatePayout(database, String(row.payment_method) as 'cash' | 'bank', row.cash_box_id === null ? null : Number(row.cash_box_id), row.bank_account_id === null ? null : Number(row.bank_account_id));
    const amount = String(row.amount);
    const isCustomer = partyKind === 'customer';
    const journalEntryId = createJournal(database, `FIN-${partyKind === 'customer' ? 'CR' : 'SP'}-${id}`, String(row.voucher_date), `${isCustomer ? 'سند قبض عميل' : 'سند سداد مورد'} ${String(row.number)}`,
      isCustomer
        ? [
          { accountId: payoutAccount, debit: amount, credit: '0', description: 'تحصيل نقدي/بنكي', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) },
          { accountId: Number(party.account_id), debit: '0', credit: amount, description: 'حساب العميل', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) },
        ]
        : [
          { accountId: Number(party.account_id), debit: amount, credit: '0', description: 'حساب المورد', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) },
          { accountId: payoutAccount, debit: '0', credit: amount, description: 'سداد نقدي/بنكي', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) },
        ]);
    database.prepare(`UPDATE financial_vouchers SET status = 'posted', journal_entry_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'`)
      .run(journalEntryId, id);
    return mapVoucherRow(database.prepare(`${voucherList(database, partyKind)} AND vouchers.id = ?`).get(id) as Row, partyKind);
  });
}

function writeExpense(database: DatabaseSync, value: unknown): Expense {
  const input = validateExpense(database, value);
  return transaction(database, () => {
    let id = input.id;
    if (id !== undefined) {
      const current = database.prepare('SELECT status FROM expenses WHERE id = ?').get(id) as Row | undefined;
      if (!current) throw new Error('المصروف المطلوب غير موجود.');
      if (current.status !== 'draft') throw new Error('لا يمكن تعديل مصروف مرحّل. أنشئ مصروفًا جديدًا لتسجيل التصحيح.');
      database.prepare(`UPDATE expenses SET expense_date = ?, operation_type = ?, description = ?, payment_method = ?,
        cash_box_id = ?, bank_account_id = ?, payable_account_id = ?, cost_center_id = ?, project_id = ?, paid_amount = ?, total_amount = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.date, input.operationType, input.description, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.payableAccountId,
          input.costCenterId, input.projectId, input.paidAmount, input.totalAmount, input.notes, id);
      database.prepare('DELETE FROM expense_allocations WHERE expense_id = ?').run(id);
    } else {
      const result = database.prepare(`INSERT INTO expenses (number, expense_date, operation_type, description, payment_method, cash_box_id,
        bank_account_id, payable_account_id, cost_center_id, project_id, paid_amount, total_amount, notes)
        VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.date, input.operationType, input.description, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.payableAccountId,
          input.costCenterId, input.projectId, input.paidAmount, input.totalAmount, input.notes);
      id = Number(result.lastInsertRowid);
      database.prepare('UPDATE expenses SET number = ? WHERE id = ?').run(`EXP-${String(id).padStart(7, '0')}`, id);
    }
    const insert = database.prepare(`INSERT INTO expense_allocations (expense_id, expense_account_id, project_id, cost_center_id, amount, notes)
      VALUES (?, ?, ?, ?, ?, ?)`);
    input.allocations.forEach((line) => insert.run(id, line.expenseAccountId, line.projectId, line.costCenterId, line.amount, line.notes));
    return readExpense(database, id);
  });
}

function approveExpense(database: DatabaseSync, idValue: unknown): Expense {
  const id = validId(idValue, 'رقم المصروف');
  return transaction(database, () => {
    const row = database.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('المصروف المطلوب غير موجود.');
    if (row.status === 'posted') return readExpense(database, id);
    const allocations = database.prepare('SELECT * FROM expense_allocations WHERE expense_id = ? ORDER BY id').all(id) as Row[];
    if (allocations.length === 0) throw new Error('لا يمكن ترحيل مصروف بلا توزيعات.');
    const lines: Array<{ accountId: number; debit: string; credit: string; description: string; costCenterId: number | null }> = allocations.map((line) => ({
      accountId: Number(line.expense_account_id), debit: String(line.amount), credit: '0', description: String(row.description),
      costCenterId: line.cost_center_id === null ? null : Number(line.cost_center_id),
    }));
    const paid = parseAmount(String(row.paid_amount));
    if (paid > 0n) {
      const payoutAccount = validatePayout(database, String(row.payment_method) as 'cash' | 'bank', row.cash_box_id === null ? null : Number(row.cash_box_id), row.bank_account_id === null ? null : Number(row.bank_account_id));
      lines.push({ accountId: payoutAccount, debit: '0', credit: String(row.paid_amount), description: 'المبلغ المدفوع', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) });
    }
    const remaining = parseAmount(String(row.total_amount)) - paid;
    if (remaining > 0n) {
      const payable = validId(row.payable_account_id, 'حساب الالتزام');
      postableAccount(database, payable, 'liability', 'حساب الالتزام');
      lines.push({ accountId: payable, debit: '0', credit: formatAmount(remaining), description: 'المبلغ غير المدفوع', costCenterId: row.cost_center_id === null ? null : Number(row.cost_center_id) });
    }
    const journalEntryId = createJournal(database, `EXP-${id}`, String(row.expense_date), `${String(row.operation_type)}: ${String(row.description)}`, lines);
    database.prepare(`UPDATE expenses SET status = 'posted', journal_entry_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'`)
      .run(journalEntryId, id);
    return readExpense(database, id);
  });
}

export function registerFinancialDocumentHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('financial-vouchers:list', (_event, kindValue: unknown, searchValue: unknown) => {
    if (kindValue !== 'customer' && kindValue !== 'supplier') throw new Error('نوع سند الطرف غير صالح.');
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const database = requireAuthentication();
    const search = String(searchValue ?? '').trim();
    if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    const rows = database.prepare(`${voucherList(database, kindValue)} AND (? = '' OR number LIKE '%' || ? || '%'
      OR parties.name LIKE '%' || ? || '%' OR reference LIKE '%' || ? || '%' OR voucher_date LIKE '%' || ? || '%') ORDER BY voucher_date DESC, vouchers.id DESC`)
      .all(search, search, search, search, search) as Row[];
    return rows.map((row) => mapVoucherRow(row, kindValue));
  });
  ipcMain.handle('financial-vouchers:save', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('بيانات السند غير صالحة.');
    const partyKind = (value as { partyKind?: unknown }).partyKind;
    if (partyKind !== 'customer' && partyKind !== 'supplier') throw new Error('نوع الطرف في السند غير صالح.');
    return updateVoucher(requireAuthentication(), partyKind, value);
  });
  ipcMain.handle('financial-vouchers:approve', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('طلب اعتماد السند غير صالح.');
    const input = value as { id?: unknown; partyKind?: unknown };
    if (input.partyKind !== 'customer' && input.partyKind !== 'supplier') throw new Error('نوع الطرف في السند غير صالح.');
    return approveVoucher(requireAuthentication(), input.id, input.partyKind);
  });
  ipcMain.handle('financial-vouchers:delete', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('طلب حذف السند غير صالح.');
    const input = value as { id?: unknown; partyKind?: unknown };
    if (input.partyKind !== 'customer' && input.partyKind !== 'supplier') throw new Error('نوع الطرف في السند غير صالح.');
    const database = requireAuthentication();
    const id = validId(input.id, 'رقم السند');
    const result = database.prepare(`DELETE FROM financial_vouchers WHERE id = ? AND party_kind = ? AND status = 'draft'`).run(id, input.partyKind);
    if (!result.changes) throw new Error('يمكن حذف المسودة فقط؛ السند المرحّل لا يُحذف.');
    return true;
  });
  ipcMain.handle('expenses:list', (_event, searchValue: unknown) => {
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const database = requireAuthentication();
    const search = String(searchValue ?? '').trim();
    if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    const rows = database.prepare(`SELECT id FROM expenses WHERE ? = '' OR number LIKE '%' || ? || '%'
      OR operation_type LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' OR notes LIKE '%' || ? || '%'
      ORDER BY expense_date DESC, id DESC`).all(search, search, search, search, search) as Row[];
    return rows.map((row) => readExpense(database, Number(row.id)));
  });
  ipcMain.handle('expenses:save', (_event, value: unknown) => writeExpense(requireAuthentication(), value));
  ipcMain.handle('expenses:approve', (_event, value: unknown) => approveExpense(requireAuthentication(), value));
  ipcMain.handle('expenses:delete', (_event, value: unknown) => {
    const database = requireAuthentication();
    const id = validId(value, 'رقم المصروف');
    const result = database.prepare(`DELETE FROM expenses WHERE id = ? AND status = 'draft'`).run(id);
    if (!result.changes) throw new Error('يمكن حذف المسودة فقط؛ المصروف المرحّل لا يُحذف.');
    return true;
  });
}
