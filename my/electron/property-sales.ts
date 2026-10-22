import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import {
  calculateContractAmounts,
  fromCents,
  generateInstallments,
  toCents,
  validateScheduleTotal,
  type InstallmentDraft,
} from '../src/shared/property-sales.js';
import type {
  BrokerCommissionTreatment,
  PropertyBroker,
  PropertyBrokerInput,
  PropertyContract,
  PropertyContractInput,
  PropertyFreePaymentInput,
  PropertyInstallment,
  PropertyReceiptInput,
  PropertyReceiptSummary,
  PropertyScheduleInput,
  PropertyUnit,
  PropertyUnitInput,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
const COMMISSION_TREATMENTS: readonly BrokerCommissionTreatment[] = ['deduct', 'cash', 'bank'];

export function installPropertySalesSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS property_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      code TEXT NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      floor TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '0',
      original_price TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, code)
    );
    CREATE INDEX IF NOT EXISTS property_units_project_status ON property_units(project_id, status, code);
    CREATE TABLE IF NOT EXISTS property_brokers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      commission_rate TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS property_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      unit_id INTEGER NOT NULL REFERENCES property_units(id) ON DELETE RESTRICT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      contract_date TEXT NOT NULL,
      down_payment_due_date TEXT NOT NULL DEFAULT '',
      original_price TEXT NOT NULL,
      discount TEXT NOT NULL,
      fees TEXT NOT NULL,
      fees_detail TEXT NOT NULL DEFAULT '[]',
      down_payment TEXT NOT NULL,
      broker_id INTEGER REFERENCES property_brokers(id) ON DELETE RESTRICT,
      broker_commission_mode TEXT NOT NULL DEFAULT 'rate' CHECK (broker_commission_mode IN ('rate', 'fixed')),
      broker_rate TEXT NOT NULL DEFAULT '0',
      broker_on_original_price INTEGER NOT NULL DEFAULT 0 CHECK (broker_on_original_price IN (0, 1)),
      broker_commission TEXT NOT NULL DEFAULT '0',
      commission_treatment TEXT CHECK (commission_treatment IS NULL OR commission_treatment IN ('deduct', 'cash', 'bank')),
      commission_journal_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS property_contracts_unit_status ON property_contracts(unit_id, status);
    CREATE INDEX IF NOT EXISTS property_contracts_customer_date ON property_contracts(customer_id, contract_date DESC);
    CREATE TABLE IF NOT EXISTS property_contract_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES property_contracts(id) ON DELETE CASCADE,
      frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
      amount TEXT NOT NULL,
      installment_count INTEGER NOT NULL,
      first_due_date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(contract_id, frequency)
    );
    CREATE TABLE IF NOT EXISTS property_contract_free_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES property_contracts(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      amount TEXT NOT NULL,
      due_date TEXT NOT NULL,
      description TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(contract_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS property_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES property_contracts(id) ON DELETE RESTRICT,
      frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual', 'free', 'down-payment')),
      sequence INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      description TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL,
      UNIQUE(contract_id, frequency, sequence)
    );
    CREATE INDEX IF NOT EXISTS property_installments_due ON property_installments(contract_id, due_date, id);
    CREATE TABLE IF NOT EXISTS property_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES property_contracts(id) ON DELETE RESTRICT,
      receipt_date TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('cash', 'bank')),
      cash_box_id INTEGER REFERENCES treasury_cash_boxes(id) ON DELETE RESTRICT,
      bank_account_id INTEGER REFERENCES treasury_bank_accounts(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      receivable_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
      request_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS property_receipts_contract ON property_receipts(contract_id, receipt_date, id);
    CREATE TABLE IF NOT EXISTS property_receipt_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES property_receipts(id) ON DELETE RESTRICT,
      installment_id INTEGER NOT NULL REFERENCES property_installments(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      UNIQUE(receipt_id, installment_id)
    );
    CREATE INDEX IF NOT EXISTS property_receipt_allocations_installment ON property_receipt_allocations(installment_id);
    CREATE TABLE IF NOT EXISTS property_installment_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES property_contracts(id) ON DELETE RESTRICT,
      installment_id INTEGER NOT NULL REFERENCES property_installments(id) ON DELETE RESTRICT,
      adjustment_type TEXT NOT NULL CHECK (adjustment_type = 'broker-commission-offset'),
      amount TEXT NOT NULL,
      UNIQUE(contract_id, installment_id, adjustment_type)
    );
  `);
  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((row) => row.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('property_units', 'floor', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('property_brokers', 'commission_rate', "TEXT NOT NULL DEFAULT '0'");
  ensureColumn('property_contracts', 'fees_detail', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('property_contracts', 'broker_commission_mode', "TEXT NOT NULL DEFAULT 'rate'");
  ensureColumn('property_contracts', 'down_payment_due_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('property_receipts', 'reference', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('property_receipts', 'notes', "TEXT NOT NULL DEFAULT ''");
}

function transaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new Error('تعذر إكمال العملية أو التراجع عنها؛ تحقّق من قاعدة البيانات.', { cause: rollbackError });
    }
    throw error;
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function mapBroker(row: Row): PropertyBroker {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), phone: String(row.phone), commissionRate: String(row.commission_rate ?? '0'),
    status: String(row.status) as PropertyBroker['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validateBroker(value: unknown): PropertyBrokerInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات السمسار غير صالحة.');
  const input = value as Partial<PropertyBrokerInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم السمسار غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود السمسار.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم السمسار.');
  if (typeof input.phone !== 'string' || input.phone.length > 40) throw new Error('رقم هاتف السمسار غير صالح.');
  const commissionRate = input.commissionRate ?? '0';
  if (typeof commissionRate !== 'string') throw new Error('نسبة العمولة غير صالحة.');
  const commissionCents = toCents(commissionRate, 'نسبة العمولة');
  if (commissionCents > 10000n) throw new Error('نسبة العمولة يجب أن تكون بين 0 و100.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة السمسار غير صالحة.');
  return { id: input.id, code: input.code.trim(), name: input.name.trim(), phone: input.phone.trim(), commissionRate, status: input.status };
}

export function listPropertyBrokers(database: DatabaseSync, searchValue = ''): PropertyBroker[] {
  const search = searchValue.trim();
  if (search.length > 180) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
  const rows = database.prepare(`SELECT * FROM property_brokers
    WHERE ? = '' OR code LIKE '%' || ? || '%' OR name LIKE '%' || ? || '%' OR phone LIKE '%' || ? || '%'
    ORDER BY name COLLATE NOCASE, id`).all(search, search, search, search) as Row[];
  return rows.map(mapBroker);
}

export function savePropertyBroker(database: DatabaseSync, value: unknown): PropertyBroker {
  const input = validateBroker(value);
  const duplicateCode = database.prepare('SELECT id FROM property_brokers WHERE code = ? COLLATE NOCASE AND id != ?')
    .get(input.code, input.id ?? 0) as Row | undefined;
  if (duplicateCode) throw new Error('كود السمسار مسجل بالفعل.');
  if (input.id !== undefined) {
    const result = database.prepare(`UPDATE property_brokers SET code = ?, name = ?, phone = ?, commission_rate = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(input.code, input.name, input.phone, input.commissionRate, input.status, input.id);
    if (!result.changes) throw new Error('السمسار المطلوب غير موجود.');
    return mapBroker(database.prepare('SELECT * FROM property_brokers WHERE id = ?').get(input.id) as Row);
  }
  const result = database.prepare('INSERT INTO property_brokers (code, name, phone, commission_rate, status) VALUES (?, ?, ?, ?, ?)')
    .run(input.code, input.name, input.phone, input.commissionRate, input.status);
  return mapBroker(database.prepare('SELECT * FROM property_brokers WHERE id = ?').get(Number(result.lastInsertRowid)) as Row);
}

export function deletePropertyBroker(database: DatabaseSync, idValue: unknown): boolean {
  if (!Number.isSafeInteger(idValue) || Number(idValue) < 1) throw new Error('رقم السمسار غير صالح.');
  const id = Number(idValue);
  if (!database.prepare('SELECT 1 FROM property_brokers WHERE id = ?').get(id)) throw new Error('السمسار المطلوب غير موجود.');
  if (database.prepare('SELECT 1 FROM property_contracts WHERE broker_id = ? LIMIT 1').get(id)) {
    throw new Error('لا يمكن حذف سمسار مرتبط بعقد. يمكنك إيقافه بدلًا من حذفه.');
  }
  database.prepare('DELETE FROM property_brokers WHERE id = ?').run(id);
  return true;
}

function mapUnit(row: Row): PropertyUnit {
  const area = toCents(String(row.area), 'المساحة');
  const price = toCents(String(row.original_price), 'سعر الوحدة');
  const pricePerMeter = area > 0n ? fromCents((price * 100n + area / 2n) / area) : '0.00';
  return {
    id: Number(row.id), projectId: Number(row.project_id), projectName: String(row.project_name), code: String(row.code),
    name: String(row.name), floor: String(row.floor ?? ''), area: String(row.area), originalPrice: String(row.original_price),
    pricePerMeter,
    status: String(row.status) as PropertyUnit['status'], contractNumber: String(row.contract_number ?? ''),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

const UNIT_SELECT = `SELECT units.*, projects.name AS project_name,
  (SELECT number FROM property_contracts WHERE unit_id = units.id AND status = 'approved' ORDER BY id DESC LIMIT 1) AS contract_number
  FROM property_units AS units INNER JOIN projects ON projects.id = units.project_id`;

function validateUnit(value: unknown): PropertyUnitInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات الوحدة غير صالحة.');
  const input = value as Partial<PropertyUnitInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم الوحدة غير صالح.');
  if (!Number.isSafeInteger(input.projectId) || Number(input.projectId) < 1) throw new Error('اختر المشروع.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود الوحدة.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم الوحدة.');
  const floor = input.floor ?? '';
  if (typeof floor !== 'string' || floor.length > 60) throw new Error('الدور غير صالح.');
  const area = input.area ?? '0';
  const price = input.originalPrice ?? '';
  toCents(area, 'المساحة');
  toCents(price, 'سعر الوحدة');
  if (toCents(price) < 1n) throw new Error('سعر الوحدة يجب أن يكون أكبر من صفر.');
  if (!['available', 'reserved', 'sold'].includes(input.status as string)) throw new Error('حالة الوحدة غير صالحة.');
  return { id: input.id, projectId: Number(input.projectId), code: input.code.trim(), name: input.name.trim(), floor, area, originalPrice: price, status: input.status as PropertyUnitInput['status'] };
}

function validateFee(value: unknown): { description: string; amount: string } {
  if (!value || typeof value !== 'object') throw new Error('تفاصيل أحد الرسوم غير صالحة.');
  const fee = value as { description?: unknown; amount?: unknown };
  if (typeof fee.description !== 'string' || !fee.description.trim() || fee.description.length > 160) throw new Error('أدخل وصفًا لكل رسم.');
  if (typeof fee.amount !== 'string' || toCents(fee.amount, 'قيمة الرسم') < 1n) throw new Error('قيمة الرسم يجب أن تكون أكبر من صفر.');
  return { description: fee.description.trim(), amount: fee.amount };
}

function validateSchedule(value: unknown): PropertyScheduleInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات نوع السداد غير صالحة.');
  const input = value as Partial<PropertyScheduleInput>;
  if (!FREQUENCIES.includes(input.frequency as typeof FREQUENCIES[number])) throw new Error('نوع تكرار القسط غير صالح.');
  toCents(String(input.amount ?? ''), 'المبلغ المخصص');
  if (!Number.isSafeInteger(input.count) || Number(input.count) < 1 || Number(input.count) > 1200) throw new Error('عدد الأقساط يجب أن يكون بين 1 و1200.');
  if (!validDate(input.firstDueDate)) throw new Error('تاريخ أول استحقاق غير صالح.');
  if (typeof input.description !== 'string' || input.description.length > 240) throw new Error('بيان الأقساط غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات الأقساط غير صالحة.');
  return { frequency: input.frequency as PropertyScheduleInput['frequency'], amount: input.amount!, count: input.count!, firstDueDate: input.firstDueDate, description: input.description, notes: input.notes };
}

function validateFreePayment(value: unknown): PropertyFreePaymentInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات الدفعة الحرة غير صالحة.');
  const input = value as Partial<PropertyFreePaymentInput>;
  toCents(String(input.amount ?? ''), 'مبلغ الدفعة الحرة');
  if (toCents(input.amount!) < 1n) throw new Error('مبلغ الدفعة الحرة يجب أن يكون أكبر من صفر.');
  if (!validDate(input.dueDate)) throw new Error('تاريخ الدفعة الحرة غير صالح.');
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 240) throw new Error('أدخل بيان الدفعة الحرة.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات الدفعة الحرة غير صالحة.');
  return { amount: input.amount!, dueDate: input.dueDate, description: input.description.trim(), notes: input.notes };
}

function validateContract(value: unknown): PropertyContractInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات العقد غير صالحة.');
  const input = value as Partial<PropertyContractInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم العقد غير صالح.');
  for (const [field, label] of [['projectId', 'المشروع'], ['unitId', 'الوحدة'], ['customerId', 'العميل']] as const) {
    if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 1) throw new Error(`اختر ${label}.`);
  }
  if (!validDate(input.contractDate)) throw new Error('تاريخ العقد غير صالح.');
  const downPaymentDueDate = input.downPaymentDueDate ?? input.contractDate;
  if (!validDate(downPaymentDueDate)) throw new Error('تاريخ استحقاق المقدم غير صالح.');
  const brokerId = input.brokerId ?? null;
  if (brokerId !== null && (!Number.isSafeInteger(brokerId) || brokerId < 1)) throw new Error('السمسار المحدد غير صالح.');
  if (input.brokerCommissionMode !== 'rate' && input.brokerCommissionMode !== 'fixed') throw new Error('طريقة إدخال عمولة السمسار غير صالحة.');
  if (typeof input.brokerOnOriginalPrice !== 'boolean') throw new Error('خيار أساس العمولة غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 4000) throw new Error('ملاحظات العقد غير صالحة.');
  const schedules = input.schedules;
  const freePayments = input.freePayments;
  if (!Array.isArray(schedules) || schedules.length > 4) throw new Error('أنواع الأقساط الدورية غير صالحة.');
  if (!Array.isArray(freePayments) || freePayments.length > 2000) throw new Error('عدد الدفعات الحرة غير صالح.');
  const checkedSchedules = schedules.map(validateSchedule);
  if (new Set(checkedSchedules.map((entry) => entry.frequency)).size !== checkedSchedules.length) throw new Error('لا يمكن تكرار نوع السداد الدوري نفسه.');
  const checkedFree = freePayments.map(validateFreePayment);
  if (!Array.isArray(input.feeItems) || input.feeItems.length > 100) throw new Error('تفاصيل الرسوم غير صالحة.');
  const feeItems = input.feeItems.map(validateFee);
  const feeTotal = feeItems.reduce((sum, fee) => sum + toCents(fee.amount), 0n);
  if (feeTotal !== toCents(String(input.fees ?? ''), 'إجمالي الرسوم')) throw new Error('إجمالي الرسوم لا يطابق مجموع تفاصيل الرسوم.');
  const amounts = calculateContractAmounts({
    originalPrice: String(input.originalPrice ?? ''), discount: String(input.discount ?? ''), fees: String(input.fees ?? ''),
    downPayment: String(input.downPayment ?? ''), brokerRate: String(input.brokerRate ?? '0'), brokerCommissionMode: input.brokerCommissionMode, brokerOnOriginalPrice: input.brokerOnOriginalPrice,
  });
  const drafts = [
    ...checkedSchedules.flatMap((schedule) => generateInstallments({
      frequency: schedule.frequency, amount: schedule.amount, count: schedule.count, firstDueDate: schedule.firstDueDate,
    })),
    ...checkedFree.map((entry, index): InstallmentDraft => ({
      amount: entry.amount, dueDate: entry.dueDate, description: entry.description, frequency: 'free', sequence: index + 1,
    })),
  ];
  validateScheduleTotal(amounts.remaining, drafts);
  return {
    id: input.id, projectId: Number(input.projectId), unitId: Number(input.unitId), customerId: Number(input.customerId),
    contractDate: input.contractDate, downPaymentDueDate, originalPrice: amounts.originalPrice, discount: amounts.discount, fees: amounts.fees,
    downPayment: amounts.downPayment, feeItems, brokerId, brokerCommissionMode: input.brokerCommissionMode, brokerRate: String(input.brokerRate ?? '0'),
    brokerOnOriginalPrice: input.brokerOnOriginalPrice, schedules: checkedSchedules, freePayments: checkedFree, notes: input.notes.trim(),
  };
}

function readInstallments(database: DatabaseSync, contractId: number): PropertyInstallment[] {
  const rows = database.prepare(`
    SELECT installments.*,
      COALESCE((SELECT SUM(allocations.amount) FROM property_receipt_allocations AS allocations WHERE allocations.installment_id = installments.id), '0') AS paid,
      COALESCE((SELECT SUM(adjustments.amount) FROM property_installment_adjustments AS adjustments WHERE adjustments.installment_id = installments.id), '0') AS adjusted
    FROM property_installments AS installments WHERE contract_id = ? ORDER BY due_date, id
  `).all(contractId) as Row[];
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((row) => {
    const amount = toCents(String(row.amount));
    const paid = toCents(String(row.paid));
    const adjusted = toCents(String(row.adjusted));
    const remaining = amount > paid + adjusted ? amount - paid - adjusted : 0n;
    const status: PropertyInstallment['status'] = remaining === 0n ? 'paid' : paid > 0n ? 'partial' : 'unpaid';
    return {
      id: Number(row.id), contractId: Number(row.contract_id), frequency: String(row.frequency) as PropertyInstallment['frequency'],
      sequence: Number(row.sequence), dueDate: String(row.due_date), description: String(row.description), notes: String(row.notes),
      amount: fromCents(amount), paid: fromCents(paid), adjusted: fromCents(adjusted), remaining: fromCents(remaining), status,
      timeStatus: remaining === 0n || String(row.due_date) > today ? 'upcoming' : String(row.due_date) < today ? 'overdue' : 'due',
    };
  });
}

function readContract(database: DatabaseSync, contractId: number): PropertyContract {
  const row = database.prepare(`
    SELECT contracts.*, projects.name AS project_name, units.code AS unit_code, units.name AS unit_name,
      customers.name AS customer_name, COALESCE(brokers.name, '') AS broker_name
    FROM property_contracts AS contracts
    INNER JOIN projects ON projects.id = contracts.project_id
    INNER JOIN property_units AS units ON units.id = contracts.unit_id
    INNER JOIN customers ON customers.id = contracts.customer_id
    LEFT JOIN property_brokers AS brokers ON brokers.id = contracts.broker_id
    WHERE contracts.id = ?
  `).get(contractId) as Row | undefined;
  if (!row) throw new Error('العقد المطلوب غير موجود.');
  const amounts = calculateContractAmounts({
    originalPrice: String(row.original_price), discount: String(row.discount), fees: String(row.fees),
    downPayment: String(row.down_payment), brokerRate: String(row.broker_rate), brokerCommissionMode: String(row.broker_commission_mode) as PropertyContractInput['brokerCommissionMode'], brokerOnOriginalPrice: Number(row.broker_on_original_price) === 1,
  });
  const installmentRows = readInstallments(database, contractId);
  const collected = installmentRows.reduce((sum, installment) => sum + toCents(installment.paid), 0n);
  const adjusted = installmentRows.reduce((sum, installment) => sum + toCents(installment.adjusted), 0n);
  const schedules = database.prepare('SELECT * FROM property_contract_schedules WHERE contract_id = ? ORDER BY id').all(contractId) as Row[];
  const freeRows = database.prepare('SELECT * FROM property_contract_free_payments WHERE contract_id = ? ORDER BY sequence').all(contractId) as Row[];
  const receiptRows = database.prepare(`SELECT receipts.*, COALESCE(boxes.name, banks.name, '') AS account_name
    FROM property_receipts AS receipts
    LEFT JOIN treasury_cash_boxes AS boxes ON boxes.id = receipts.cash_box_id
    LEFT JOIN treasury_bank_accounts AS banks ON banks.id = receipts.bank_account_id
    WHERE receipts.contract_id = ? ORDER BY receipts.receipt_date DESC, receipts.id DESC`).all(contractId) as Row[];
  return {
    id: Number(row.id), number: String(row.number), projectId: Number(row.project_id), unitId: Number(row.unit_id), customerId: Number(row.customer_id),
    contractDate: String(row.contract_date), downPaymentDueDate: String(row.down_payment_due_date || row.contract_date), originalPrice: amounts.originalPrice, discount: amounts.discount, fees: amounts.fees,
    feeItems: (() => { try { return JSON.parse(String(row.fees_detail)) as PropertyContractInput['feeItems']; } catch { return []; } })(),
    downPayment: amounts.downPayment, brokerId: row.broker_id === null ? null : Number(row.broker_id), brokerCommissionMode: String(row.broker_commission_mode) as PropertyContractInput['brokerCommissionMode'], brokerRate: String(row.broker_rate),
    brokerOnOriginalPrice: Number(row.broker_on_original_price) === 1,
    schedules: schedules.map((schedule) => ({
      frequency: String(schedule.frequency) as PropertyScheduleInput['frequency'], amount: String(schedule.amount), count: Number(schedule.installment_count),
      firstDueDate: String(schedule.first_due_date), description: String(schedule.description), notes: String(schedule.notes),
    })),
    freePayments: freeRows.map((payment) => ({ amount: String(payment.amount), dueDate: String(payment.due_date), description: String(payment.description), notes: String(payment.notes) })),
    notes: String(row.notes), projectName: String(row.project_name), unitCode: String(row.unit_code), unitName: String(row.unit_name),
    customerName: String(row.customer_name), brokerName: String(row.broker_name), contractValue: amounts.contractValue,
    remainingToSchedule: amounts.remaining, brokerCommission: amounts.brokerCommission,
    commissionTreatment: row.commission_treatment === null ? null : String(row.commission_treatment) as BrokerCommissionTreatment,
    commissionJournalId: row.commission_journal_id === null ? null : Number(row.commission_journal_id),
    status: String(row.status) as PropertyContract['status'], collected: fromCents(collected),
    outstanding: fromCents(toCents(amounts.contractValue) - collected - adjusted), installments: installmentRows,
    receipts: receiptRows.map((receipt): PropertyReceiptSummary => ({
      id: Number(receipt.id), date: String(receipt.receipt_date), channel: String(receipt.channel) as PropertyReceiptSummary['channel'],
      accountName: String(receipt.account_name), reference: String(receipt.reference), notes: String(receipt.notes),
      amount: String(receipt.amount), journalEntryId: Number(receipt.journal_entry_id),
    })),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function ensureAccount(database: DatabaseSync, accountId: number, type: string): Row {
  const row = database.prepare('SELECT * FROM accounts WHERE id = ? AND account_type = ?').get(accountId, type) as Row | undefined;
  if (!row) throw new Error(`الحساب المحاسبي المحدد غير موجود أو ليس من نوع ${type === 'asset' ? 'الأصول' : type === 'expense' ? 'المصروفات' : type}.`);
  return row;
}

function cashAccount(database: DatabaseSync, treatment: 'cash' | 'bank', accountId: number): { accountId: number; openingBalance: string; openingDate: string } {
  const row = treatment === 'cash'
    ? database.prepare(`SELECT boxes.account_id, boxes.opening_balance, boxes.opening_date FROM treasury_cash_boxes AS boxes WHERE boxes.id = ? AND boxes.status = 'active'`).get(accountId) as Row | undefined
    : database.prepare(`SELECT banks.account_id, banks.opening_balance, banks.opening_date FROM treasury_bank_accounts AS banks WHERE banks.id = ? AND banks.status = 'active'`).get(accountId) as Row | undefined;
  if (!row) throw new Error(treatment === 'cash' ? 'اختر خزينة نشطة موجودة.' : 'اختر حسابًا بنكيًا نشطًا موجودًا.');
  return { accountId: Number(row.account_id), openingBalance: String(row.opening_balance), openingDate: String(row.opening_date) };
}

function currentAssetBalance(database: DatabaseSync, account: { accountId: number; openingBalance: string; openingDate: string }): bigint {
  const rows = database.prepare(`SELECT lines.debit, lines.credit
    FROM journal_lines AS lines INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
    WHERE lines.account_id = ? AND entries.status = 'posted' AND entries.entry_date >= ?`).all(account.accountId, account.openingDate) as Row[];
  const movement = rows.reduce((total, row) => total + toCents(String(row.debit)) - toCents(String(row.credit)), 0n);
  return toCents(account.openingBalance) + movement;
}

function insertJournal(database: DatabaseSync, reference: string, date: string, description: string, lines: Array<{ accountId: number; debit: string; credit: string }>): number {
  const result = database.prepare('INSERT INTO journal_entries (reference, entry_date, description) VALUES (?, ?, ?)')
    .run(reference, date, description);
  const id = Number(result.lastInsertRowid);
  const insert = database.prepare('INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)');
  lines.forEach((line, index) => insert.run(id, index + 1, line.accountId, line.debit, line.credit));
  return id;
}

export function saveContract(database: DatabaseSync, value: unknown, withinTransaction = false): PropertyContract {
  const input = validateContract(value);
  const save = () => {
    const unit = database.prepare('SELECT project_id, status FROM property_units WHERE id = ?').get(input.unitId) as Row | undefined;
    if (!unit || Number(unit.project_id) !== input.projectId) throw new Error('الوحدة لا تتبع المشروع المحدد.');
    if (String(unit.status) !== 'available') throw new Error('الوحدة غير متاحة للبيع.');
    const customer = database.prepare("SELECT status FROM customers WHERE id = ?").get(input.customerId) as Row | undefined;
    if (!customer || (customer.status !== 'active' && input.id === undefined)) throw new Error('اختر عميلًا نشطًا مسجلًا.');
    if (input.brokerId !== null && !database.prepare("SELECT 1 FROM property_brokers WHERE id = ? AND status = 'active'").get(input.brokerId)) throw new Error('السمسار المحدد غير نشط أو غير موجود.');
    let id = input.id;
    if (id !== undefined) {
      const existing = database.prepare('SELECT status FROM property_contracts WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('العقد المطلوب تعديله غير موجود.');
      if (existing.status !== 'draft') throw new Error('لا يمكن تعديل عقد معتمد أو ملغى؛ حافظ النظام على الأقساط والتحصيلات المرتبطة.');
      database.prepare(`UPDATE property_contracts SET project_id = ?, unit_id = ?, customer_id = ?, contract_date = ?, down_payment_due_date = ?, original_price = ?,
        discount = ?, fees = ?, fees_detail = ?, down_payment = ?, broker_id = ?, broker_commission_mode = ?, broker_rate = ?, broker_on_original_price = ?, broker_commission = '0',
        notes = ?, updated_at = datetime('now') WHERE id = ?`).run(
        input.projectId, input.unitId, input.customerId, input.contractDate, input.downPaymentDueDate, input.originalPrice, input.discount, input.fees, JSON.stringify(input.feeItems),
        input.downPayment, input.brokerId, input.brokerCommissionMode, input.brokerRate, Number(input.brokerOnOriginalPrice), input.notes, id,
      );
      database.prepare('DELETE FROM property_contract_schedules WHERE contract_id = ?').run(id);
      database.prepare('DELETE FROM property_contract_free_payments WHERE contract_id = ?').run(id);
    } else {
      const amounts = calculateContractAmounts({ originalPrice: input.originalPrice, discount: input.discount, fees: input.fees, downPayment: input.downPayment, brokerRate: input.brokerRate, brokerCommissionMode: input.brokerCommissionMode, brokerOnOriginalPrice: input.brokerOnOriginalPrice });
      const result = database.prepare(`INSERT INTO property_contracts
        (number, project_id, unit_id, customer_id, contract_date, down_payment_due_date, original_price, discount, fees, fees_detail, down_payment, broker_id, broker_commission_mode, broker_rate,
         broker_on_original_price, broker_commission, notes)
        VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.projectId, input.unitId, input.customerId, input.contractDate, input.downPaymentDueDate, input.originalPrice, input.discount, input.fees, JSON.stringify(input.feeItems),
        input.downPayment, input.brokerId, input.brokerCommissionMode, input.brokerRate, Number(input.brokerOnOriginalPrice), amounts.brokerCommission, input.notes,
      );
      id = Number(result.lastInsertRowid);
      const number = `SU-${input.contractDate.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      database.prepare('UPDATE property_contracts SET number = ? WHERE id = ?').run(number, id);
    }
    const insertSchedule = database.prepare(`INSERT INTO property_contract_schedules
      (contract_id, frequency, amount, installment_count, first_due_date, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    input.schedules.forEach((schedule) => insertSchedule.run(id, schedule.frequency, schedule.amount, schedule.count, schedule.firstDueDate, schedule.description, schedule.notes));
    const insertFree = database.prepare(`INSERT INTO property_contract_free_payments
      (contract_id, sequence, amount, due_date, description, notes) VALUES (?, ?, ?, ?, ?, ?)`);
    input.freePayments.forEach((payment, index) => insertFree.run(id, index + 1, payment.amount, payment.dueDate, payment.description, payment.notes));
    return readContract(database, id);
  };
  return withinTransaction ? save() : transaction(database, save);
}

export function approveContract(database: DatabaseSync, value: unknown, withinTransaction = false): PropertyContract {
  if (!value || typeof value !== 'object') throw new Error('بيانات اعتماد العقد غير صالحة.');
  const input = value as { id?: unknown; commissionTreatment?: unknown; payoutAccountId?: unknown; expenseAccountId?: unknown };
  if (!Number.isSafeInteger(input.id) || Number(input.id) < 1) throw new Error('رقم العقد غير صالح.');
  const id = Number(input.id);
  const approve = () => {
    const contract = database.prepare('SELECT * FROM property_contracts WHERE id = ?').get(id) as Row | undefined;
    if (!contract) throw new Error('العقد المطلوب غير موجود.');
    if (contract.status === 'approved') return readContract(database, id);
    if (contract.status !== 'draft') throw new Error('لا يمكن اعتماد عقد ملغى.');
    const amounts = calculateContractAmounts({
      originalPrice: String(contract.original_price), discount: String(contract.discount), fees: String(contract.fees),
      downPayment: String(contract.down_payment), brokerRate: String(contract.broker_rate), brokerCommissionMode: String(contract.broker_commission_mode) as PropertyContractInput['brokerCommissionMode'], brokerOnOriginalPrice: Number(contract.broker_on_original_price) === 1,
    });
    const schedules = (database.prepare('SELECT * FROM property_contract_schedules WHERE contract_id = ? ORDER BY id').all(id) as Row[]).map((row) => ({
      frequency: String(row.frequency) as PropertyScheduleInput['frequency'], amount: String(row.amount), count: Number(row.installment_count),
      firstDueDate: String(row.first_due_date), description: String(row.description), notes: String(row.notes),
    }));
    const freePayments = (database.prepare('SELECT * FROM property_contract_free_payments WHERE contract_id = ? ORDER BY sequence').all(id) as Row[]).map((row) => ({
      amount: String(row.amount), dueDate: String(row.due_date), description: String(row.description), notes: String(row.notes),
    }));
    const drafts: InstallmentDraft[] = [
      ...schedules.flatMap((schedule) => generateInstallments({ frequency: schedule.frequency, amount: schedule.amount, count: schedule.count, firstDueDate: schedule.firstDueDate })
        .map((item) => ({ ...item, description: schedule.description ? `${schedule.description} ${item.sequence}` : item.description, notes: schedule.notes } as InstallmentDraft & { notes: string }))),
      ...freePayments.map((payment, index): InstallmentDraft & { notes: string } => ({
        frequency: 'free', sequence: index + 1, dueDate: payment.dueDate, amount: payment.amount, description: payment.description, notes: payment.notes,
      })),
    ];
    const totals = validateScheduleTotal(amounts.remaining, drafts);
    if (toCents(totals.undistributed) !== 0n) throw new Error(`لا يمكن اعتماد الخطة؛ يوجد مبلغ غير موزع قدره ${totals.undistributed} جنيه.`);
    const commission = toCents(amounts.brokerCommission);
    const treatment = input.commissionTreatment;
    if (commission > 0n && contract.broker_id === null) throw new Error('اختر السمسار المستحق للعمولة قبل اعتماد العقد.');
    if (commission > 0n && !COMMISSION_TREATMENTS.includes(treatment as BrokerCommissionTreatment)) throw new Error('اختر طريقة معالجة عمولة السمسار قبل اعتماد العقد.');
    const unit = database.prepare('SELECT status FROM property_units WHERE id = ?').get(Number(contract.unit_id)) as Row | undefined;
    if (!unit || unit.status !== 'available') throw new Error('الوحدة غير متاحة للبيع.');
    const existingApproved = database.prepare("SELECT 1 FROM property_contracts WHERE unit_id = ? AND status = 'approved' AND id <> ?").get(Number(contract.unit_id), id);
    if (existingApproved) throw new Error('للوحدة عقد معتمد بالفعل.');

    const insertInstallment = database.prepare(`INSERT INTO property_installments
      (contract_id, frequency, sequence, due_date, description, notes, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    if (toCents(amounts.downPayment) > 0n) insertInstallment.run(id, 'down-payment', 1, contract.down_payment_due_date || contract.contract_date, 'مقدم العقد', '', amounts.downPayment);
    drafts.forEach((item) => insertInstallment.run(id, item.frequency, item.sequence, item.dueDate, item.description, (item as InstallmentDraft & { notes?: string }).notes ?? '', item.amount));

    let journalId: number | null = null;
    if (commission > 0n && treatment === 'deduct') {
      let remainingOffset = commission;
      const candidates = database.prepare(`SELECT id, amount FROM property_installments
        WHERE contract_id = ? AND frequency <> 'down-payment' ORDER BY due_date DESC, id DESC`).all(id) as Row[];
      for (const installment of candidates) {
        if (remainingOffset === 0n) break;
        const applied = toCents(String(installment.amount)) < remainingOffset ? toCents(String(installment.amount)) : remainingOffset;
        database.prepare(`INSERT INTO property_installment_adjustments (contract_id, installment_id, adjustment_type, amount)
          VALUES (?, ?, 'broker-commission-offset', ?)`).run(id, Number(installment.id), fromCents(applied));
        remainingOffset -= applied;
      }
      if (remainingOffset > 0n) throw new Error('عمولة السمسار أكبر من مستحقات الأقساط المتاحة للخصم.');
    } else if (commission > 0n && (treatment === 'cash' || treatment === 'bank')) {
      if (!Number.isSafeInteger(input.payoutAccountId) || Number(input.payoutAccountId) < 1) throw new Error(treatment === 'cash' ? 'اختر الخزينة التي ستُصرف منها العمولة.' : 'اختر الحساب البنكي الذي سيُصرف منه المبلغ.');
      if (!Number.isSafeInteger(input.expenseAccountId) || Number(input.expenseAccountId) < 1) throw new Error('اختر حساب مصروف عمولات السمسرة.');
      const payout = cashAccount(database, treatment, Number(input.payoutAccountId));
      if (String(contract.contract_date) < payout.openingDate) throw new Error('تاريخ العقد يسبق تاريخ أول مدة للحساب المالي المختار.');
      const expense = ensureAccount(database, Number(input.expenseAccountId), 'expense');
      if (payout.accountId === Number(expense.id)) throw new Error('حساب الصرف لا يمكن أن يكون حساب المصروف نفسه.');
      if (currentAssetBalance(database, payout) < commission) throw new Error('الرصيد المتاح في الحساب المختار غير كافٍ لصرف العمولة.');
      const number = String(contract.number);
      const broker = contract.broker_id === null ? 'سمسار' : String((database.prepare('SELECT name FROM property_brokers WHERE id = ?').get(Number(contract.broker_id)) as Row | undefined)?.name ?? 'سمسار');
      journalId = insertJournal(database, `BROKER-${number}`, String(contract.contract_date), `عمولة سمسار ${broker} عن عقد الوحدة ${number}`,
        [{ accountId: Number(expense.id), debit: amounts.brokerCommission, credit: '0' }, { accountId: payout.accountId, debit: '0', credit: amounts.brokerCommission }]);
    }
    const savedTreatment: BrokerCommissionTreatment | null = commission > 0n ? treatment as BrokerCommissionTreatment : null;
    database.prepare(`UPDATE property_contracts SET status = 'approved', commission_treatment = ?, commission_journal_id = ?,
      broker_commission = ?, updated_at = datetime('now') WHERE id = ?`).run(savedTreatment, journalId, amounts.brokerCommission, id);
    database.prepare("UPDATE property_units SET status = 'sold', updated_at = datetime('now') WHERE id = ?").run(Number(contract.unit_id));
    return readContract(database, id);
  };
  return withinTransaction ? approve() : transaction(database, approve);
}

export function saveAndApproveContract(database: DatabaseSync, value: unknown): PropertyContract {
  if (!value || typeof value !== 'object') throw new Error('بيانات الاعتماد غير صالحة.');
  const input = value as { contract?: unknown; commissionTreatment?: unknown; payoutAccountId?: unknown; expenseAccountId?: unknown };
  return transaction(database, () => {
    const saved = saveContract(database, input.contract, true);
    return approveContract(database, {
      id: saved.id,
      commissionTreatment: input.commissionTreatment,
      payoutAccountId: input.payoutAccountId,
      expenseAccountId: input.expenseAccountId,
    }, true);
  });
}

export function collectReceipt(database: DatabaseSync, value: unknown): PropertyContract {
  if (!value || typeof value !== 'object') throw new Error('بيانات التحصيل غير صالحة.');
  const input = value as Partial<PropertyReceiptInput>;
  if (!Number.isSafeInteger(input.contractId) || Number(input.contractId) < 1) throw new Error('رقم العقد غير صالح.');
  if (!validDate(input.date)) throw new Error('تاريخ التحصيل غير صالح.');
  if (input.channel !== 'cash' && input.channel !== 'bank') throw new Error('اختر طريقة تحصيل صحيحة.');
  if (typeof input.requestKey !== 'string' || !/^[\w-]{12,100}$/.test(input.requestKey)) throw new Error('مفتاح عملية التحصيل غير صالح.');
  if (typeof input.reference !== 'string' || input.reference.length > 100) throw new Error('المرجع غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('ملاحظات التحصيل غير صالحة.');
  const reference = input.reference.trim();
  const notes = input.notes.trim();
  const requestKey = input.requestKey;
  const contractId = Number(input.contractId);
  const date = input.date;
  const channel = input.channel;
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 1000) throw new Error('حدد استحقاقًا واحدًا على الأقل للتحصيل.');
  if (!Number.isSafeInteger(input.receivableAccountId) || Number(input.receivableAccountId) < 1) throw new Error('اختر حساب الذمم المدينة.');
  const allocations = input.allocations.map((allocation) => {
    if (!Number.isSafeInteger(allocation.installmentId) || allocation.installmentId < 1) throw new Error('أحد الاستحقاقات المحددة غير صالح.');
    const amount = toCents(allocation.amount, 'مبلغ التخصيص');
    if (amount < 1n) throw new Error('مبلغ التخصيص يجب أن يكون أكبر من صفر.');
    return { installmentId: allocation.installmentId, amount };
  });
  if (new Set(allocations.map((item) => item.installmentId)).size !== allocations.length) throw new Error('لا تكرر الاستحقاق نفسه في التخصيص.');
  return transaction(database, () => {
    const duplicate = database.prepare('SELECT contract_id FROM property_receipts WHERE request_key = ?').get(requestKey) as Row | undefined;
    if (duplicate) {
      if (Number(duplicate.contract_id) !== contractId) throw new Error('مفتاح التحصيل مستخدم في عقد آخر.');
      return readContract(database, contractId);
    }
    const contract = database.prepare("SELECT * FROM property_contracts WHERE id = ? AND status = 'approved'").get(contractId) as Row | undefined;
    if (!contract) throw new Error('اختر عقدًا معتمدًا.');
    const cashBoxId = channel === 'cash' ? input.cashBoxId ?? null : null;
    const bankAccountId = channel === 'bank' ? input.bankAccountId ?? null : null;
    const payout = cashAccount(database, channel, Number(channel === 'cash' ? cashBoxId : bankAccountId));
    if (date < payout.openingDate) throw new Error('تاريخ التحصيل يسبق تاريخ أول مدة للحساب المالي المختار.');
    const receivable = ensureAccount(database, Number(input.receivableAccountId), 'asset');
    if (payout.accountId === Number(receivable.id)) throw new Error('اختر حساب ذمم يختلف عن حساب التحصيل.');
    let total = 0n;
    for (const allocation of allocations) {
      const installment = database.prepare('SELECT * FROM property_installments WHERE id = ? AND contract_id = ?').get(allocation.installmentId, contractId) as Row | undefined;
      if (!installment) throw new Error('أحد الاستحقاقات لا يتبع العقد المحدد.');
      const installmentState = readInstallments(database, contractId).find((item) => item.id === allocation.installmentId)!;
      if (allocation.amount > toCents(installmentState.remaining)) throw new Error(`مبلغ التخصيص يتجاوز المتبقي على ${String(installment.description)} (${installmentState.remaining} جنيه).`);
      total += allocation.amount;
    }
    const outstanding = toCents(readContract(database, contractId).outstanding);
    if (total > outstanding) throw new Error(`إجمالي التحصيل يتجاوز متبقي العقد البالغ ${fromCents(outstanding)} جنيه.`);
    const totalText = fromCents(total);
    const journalId = insertJournal(database, `UNIT-RECEIPT-${requestKey.slice(0, 40)}`, date,
      `تحصيل عقد وحدة ${String(contract.number)}`,
      [{ accountId: payout.accountId, debit: totalText, credit: '0' }, { accountId: Number(receivable.id), debit: '0', credit: totalText }]);
    const receipt = database.prepare(`INSERT INTO property_receipts
      (contract_id, receipt_date, channel, cash_box_id, bank_account_id, amount, reference, notes, receivable_account_id, journal_entry_id, request_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contractId, date, channel, cashBoxId, bankAccountId,
      totalText, reference, notes, Number(receivable.id), journalId, requestKey);
    const insertAllocation = database.prepare('INSERT INTO property_receipt_allocations (receipt_id, installment_id, amount) VALUES (?, ?, ?)');
    allocations.forEach((allocation) => insertAllocation.run(Number(receipt.lastInsertRowid), allocation.installmentId, fromCents(allocation.amount)));
    return readContract(database, contractId);
  });
}

export function registerPropertySalesHandlers(requireDatabase: () => DatabaseSync): void {
  ipcMain.handle('property-sales:units:list', (_event, projectValue: unknown) => {
    const database = requireDatabase();
    if (projectValue !== undefined && projectValue !== null && projectValue !== '' && (!Number.isSafeInteger(projectValue) || Number(projectValue) < 1)) throw new Error('رقم المشروع غير صالح.');
    const rows = (projectValue ? database.prepare(`${UNIT_SELECT} WHERE units.project_id = ? ORDER BY units.code COLLATE NOCASE, units.id`).all(Number(projectValue))
      : database.prepare(`${UNIT_SELECT} ORDER BY projects.name COLLATE NOCASE, units.code COLLATE NOCASE, units.id`).all()) as Row[];
    return rows.map(mapUnit);
  });
  ipcMain.handle('property-sales:units:save', (_event, value: unknown) => {
    const database = requireDatabase();
    const input = validateUnit(value);
    if (!database.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) throw new Error('المشروع المحدد غير موجود.');
    if (input.id !== undefined) {
      const existing = database.prepare('SELECT status FROM property_units WHERE id = ?').get(input.id) as Row | undefined;
      if (!existing) throw new Error('الوحدة المطلوب تعديلها غير موجودة.');
      if (existing.status === 'sold') throw new Error('لا يمكن تعديل وحدة مرتبطة بعقد معتمد.');
      database.prepare(`UPDATE property_units SET project_id = ?, code = ?, name = ?, floor = ?, area = ?, original_price = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.projectId, input.code, input.name, input.floor, input.area, input.originalPrice, input.status, input.id);
      return mapUnit(database.prepare(`${UNIT_SELECT} WHERE units.id = ?`).get(input.id) as Row);
    }
    const result = database.prepare(`INSERT INTO property_units (project_id, code, name, floor, area, original_price, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.projectId, input.code, input.name, input.floor, input.area, input.originalPrice, input.status);
    return mapUnit(database.prepare(`${UNIT_SELECT} WHERE units.id = ?`).get(Number(result.lastInsertRowid)) as Row);
  });
  ipcMain.handle('property-sales:brokers:list', (_event, searchValue: unknown) => {
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    return listPropertyBrokers(requireDatabase(), searchValue as string | undefined);
  });
  ipcMain.handle('property-sales:brokers:save', (_event, value: unknown) => savePropertyBroker(requireDatabase(), value));
  ipcMain.handle('property-sales:brokers:delete', (_event, id: unknown) => deletePropertyBroker(requireDatabase(), id));
  ipcMain.handle('property-sales:contracts:list', () => {
    const database = requireDatabase();
    return (database.prepare('SELECT id FROM property_contracts ORDER BY contract_date DESC, id DESC').all() as Row[]).map((row) => readContract(database, Number(row.id)));
  });
  ipcMain.handle('property-sales:contracts:get', (_event, value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم العقد غير صالح.');
    return readContract(requireDatabase(), Number(value));
  });
  ipcMain.handle('property-sales:contracts:save', (_event, value: unknown) => saveContract(requireDatabase(), value));
  ipcMain.handle('property-sales:contracts:save-approve', (_event, value: unknown) => saveAndApproveContract(requireDatabase(), value));
  ipcMain.handle('property-sales:contracts:approve', (_event, value: unknown) => approveContract(requireDatabase(), value));
  ipcMain.handle('property-sales:contracts:payment-list', (_event, searchValue: unknown) => {
    const database = requireDatabase();
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const rows = (database.prepare(`SELECT contracts.id FROM property_contracts AS contracts
      INNER JOIN customers ON customers.id = contracts.customer_id
      WHERE contracts.status = 'approved' AND (? = '' OR contracts.number LIKE '%' || ? || '%' OR customers.name LIKE '%' || ? || '%')
      ORDER BY contracts.contract_date DESC, contracts.id DESC`).all(search, search, search) as Row[]);
    return rows.map((row) => readContract(database, Number(row.id)));
  });
  ipcMain.handle('property-sales:receipts:collect', (_event, value: unknown) => collectReceipt(requireDatabase(), value));
}