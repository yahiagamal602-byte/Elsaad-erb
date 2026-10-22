import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import type {
  Contractor,
  ContractorContract,
  ContractorContractInput,
  ContractorContractLine,
  ContractorContractLineInput,
  ContractorInput,
  ContractorOpeningEntry,
  ContractorOpeningEntryInput,
  ContractorStatus,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const SCALE = 10n ** 12n;

export function installContractorSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS contractors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_record_id INTEGER UNIQUE REFERENCES records(id) ON DELETE RESTRICT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      governorate TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contractors_name_status ON contractors(name COLLATE NOCASE, status);
    CREATE TABLE IF NOT EXISTS contractor_opening_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      entry_date TEXT NOT NULL,
      debit TEXT NOT NULL,
      credit TEXT NOT NULL,
      base_equivalent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contractor_opening_entries_date ON contractor_opening_entries(contractor_id, entry_date, id);
    CREATE TABLE IF NOT EXISTS contractor_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      contract_date TEXT NOT NULL,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      notes TEXT NOT NULL DEFAULT '',
      total TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contractor_contracts_contractor_date ON contractor_contracts(contractor_id, contract_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS contractor_contracts_project_date ON contractor_contracts(project_id, contract_date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS contractor_contract_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contractor_contracts(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      item_type TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity TEXT NOT NULL,
      unit_price TEXT NOT NULL,
      line_total TEXT NOT NULL,
      UNIQUE(contract_id, line_order),
      UNIQUE(contract_id, code)
    );
    CREATE INDEX IF NOT EXISTS contractor_contract_lines_contract ON contractor_contract_lines(contract_id, line_order);
    CREATE TABLE IF NOT EXISTS contractor_certificate_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      certificate_date TEXT NOT NULL,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      contract_id INTEGER REFERENCES contractor_contracts(id) ON DELETE RESTRICT,
      cost_center TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      notes TEXT NOT NULL DEFAULT '',
      total TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contractor_certificate_documents_contractor_date ON contractor_certificate_documents(contractor_id, certificate_date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS contractor_certificate_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      certificate_id INTEGER NOT NULL REFERENCES contractor_certificate_documents(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      previous_quantity TEXT NOT NULL,
      current_quantity TEXT NOT NULL,
      contract_quantity TEXT NOT NULL,
      completion_rate TEXT NOT NULL,
      unit_price TEXT NOT NULL,
      discount TEXT NOT NULL DEFAULT '0',
      line_total TEXT NOT NULL,
      UNIQUE(certificate_id, line_order),
      UNIQUE(certificate_id, code)
    );
    CREATE INDEX IF NOT EXISTS contractor_certificate_lines_certificate ON contractor_certificate_lines(certificate_id, line_order);
    CREATE TABLE IF NOT EXISTS contractor_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      voucher_date TEXT NOT NULL,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank')),
      cash_box_id INTEGER REFERENCES treasury_cash_boxes(id) ON DELETE RESTRICT,
      bank_account_id INTEGER REFERENCES treasury_bank_accounts(id) ON DELETE RESTRICT,
      cost_center TEXT NOT NULL DEFAULT '',
      reference_no TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      notes TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contractor_vouchers_contractor_date ON contractor_vouchers(contractor_id, voucher_date DESC, id DESC);
  `);
  const columns = database.prepare('PRAGMA table_info(contractors)').all() as Row[];
  if (!columns.some((row) => row.name === 'legacy_record_id')) {
    database.exec('ALTER TABLE contractors ADD COLUMN legacy_record_id INTEGER REFERENCES records(id) ON DELETE RESTRICT');
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS contractors_legacy_record ON contractors(legacy_record_id) WHERE legacy_record_id IS NOT NULL;
    INSERT OR IGNORE INTO contractors (legacy_record_id, code, name, phone, status, created_at, updated_at)
      SELECT records.id,
        CASE WHEN NULLIF(TRIM(records.reference), '') IS NULL
          OR (SELECT COUNT(*) FROM records AS duplicates WHERE duplicates.module = 'contractors'
              AND lower(TRIM(duplicates.reference)) = lower(TRIM(records.reference))) > 1
          OR EXISTS (SELECT 1 FROM contractors AS existing WHERE existing.code = TRIM(records.reference) COLLATE NOCASE)
          THEN 'LEGACY-' || records.id ELSE TRIM(records.reference) END,
        records.title, '', CASE WHEN records.status = 'inactive' THEN 'inactive' ELSE 'active' END,
        records.created_at, records.updated_at
      FROM records WHERE records.module = 'contractors'
        AND NOT EXISTS (SELECT 1 FROM contractors WHERE contractors.legacy_record_id = records.id)`);
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

function isDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function optionalText(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${label} غير صالح.`);
  return value.trim();
}

function signedAmount(value: bigint): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

function mapOpeningEntry(row: Row): ContractorOpeningEntry {
  return {
    id: Number(row.id), date: String(row.entry_date), debit: String(row.debit), credit: String(row.credit),
    baseEquivalent: String(row.base_equivalent), status: String(row.status) as ContractorOpeningEntry['status'],
  };
}

function validateOpeningEntry(value: unknown): ContractorOpeningEntryInput & { debit: string; credit: string; baseEquivalent: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات حركة الرصيد الافتتاحي غير صالحة.');
  const entry = value as Partial<ContractorOpeningEntryInput>;
  if (!isDate(entry.date)) throw new Error('تاريخ حركة الرصيد الافتتاحي غير صالح.');
  if (entry.status !== 'active' && entry.status !== 'inactive') throw new Error('حالة حركة الرصيد الافتتاحي غير صالحة.');
  if (typeof entry.debit !== 'string' || typeof entry.credit !== 'string') throw new Error('أدخل المدين والدائن كقيم رقمية.');
  const debitUnits = parseAmount(entry.debit);
  const creditUnits = parseAmount(entry.credit);
  if ((debitUnits > 0n) === (creditUnits > 0n)) throw new Error('أدخل مبلغًا موجبًا في المدين أو الدائن فقط لكل حركة.');
  const debit = normalizeAmount(entry.debit);
  const credit = normalizeAmount(entry.credit);
  return {
    date: entry.date,
    debit,
    credit,
    baseEquivalent: formatAmount(debitUnits > 0n ? debitUnits : creditUnits),
    status: entry.status,
  };
}

function validateContractor(value: unknown): ContractorInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات المقاول غير صالحة.');
  const input = value as Partial<ContractorInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم المقاول غير صالح.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('اسم المقاول مطلوب وبحد أقصى 180 حرفًا.');
  const phone = optionalText(input.phone ?? '', 'رقم الهاتف', 40);
  if (phone && !/^[\p{N}+() .-]{5,40}$/u.test(phone)) throw new Error('رقم الهاتف يحتوي على أحرف غير صالحة.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة المقاول غير صالحة.');
  if (!Array.isArray(input.openingEntries) || input.openingEntries.length > 1000) throw new Error('عدد حركات الرصيد الافتتاحي غير صالح.');
  return {
    id: input.id,
    code: optionalText(input.code ?? '', 'كود المقاول', 40),
    name: input.name.trim(),
    phone,
    specialty: optionalText(input.specialty ?? '', 'التخصص', 120),
    country: optionalText(input.country ?? '', 'الدولة', 100),
    governorate: optionalText(input.governorate ?? '', 'المحافظة', 100),
    address: optionalText(input.address ?? '', 'العنوان', 500),
    status: input.status,
    openingEntries: input.openingEntries.map(validateOpeningEntry),
  };
}

function readContractor(database: DatabaseSync, id: number): Contractor {
  const row = database.prepare(`SELECT contractors.*,
    (SELECT COUNT(*) FROM contractor_contracts WHERE contractor_id = contractors.id) AS contract_count
    FROM contractors WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('المقاول المطلوب غير موجود.');
  const entries = database.prepare('SELECT * FROM contractor_opening_entries WHERE contractor_id = ? ORDER BY entry_date, id').all(id) as Row[];
  let debit = 0n;
  let credit = 0n;
  for (const entry of entries) {
    if (entry.status !== 'active') continue;
    debit += parseAmount(String(entry.debit));
    credit += parseAmount(String(entry.credit));
  }
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), phone: String(row.phone),
    specialty: String(row.specialty), country: String(row.country), governorate: String(row.governorate),
    address: String(row.address), status: String(row.status) as ContractorStatus,
    totalDebit: formatAmount(debit), totalCredit: formatAmount(credit),
    netBalance: signedAmount(debit - credit),
    openingEntries: entries.map(mapOpeningEntry), contractCount: Number(row.contract_count),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function saveContractor(database: DatabaseSync, value: unknown): Contractor {
  const input = validateContractor(value);
  return transaction(database, () => {
    let id = input.id;
    let code = input.code;
    if (id !== undefined) {
      const existing = database.prepare('SELECT id, code FROM contractors WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('المقاول المطلوب تعديله غير موجود.');
      code ||= String(existing.code);
    } else if (!code) {
      const next = Number((database.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM contractors").get() as Row).next);
      code = `CON-${String(next).padStart(6, '0')}`;
    }
    const duplicate = database.prepare('SELECT id FROM contractors WHERE code = ? COLLATE NOCASE AND (? IS NULL OR id <> ?) LIMIT 1')
      .get(code, id ?? null, id ?? null);
    if (duplicate) throw new Error('كود المقاول مستخدم بالفعل.');
    if (id !== undefined) {
      database.prepare(`UPDATE contractors SET code = ?, name = ?, phone = ?, specialty = ?, country = ?, governorate = ?, address = ?,
        status = ?, updated_at = datetime('now') WHERE id = ?`).run(
        code, input.name, input.phone, input.specialty, input.country, input.governorate, input.address, input.status, id,
      );
      database.prepare('DELETE FROM contractor_opening_entries WHERE contractor_id = ?').run(id);
    } else {
      const result = database.prepare(`INSERT INTO contractors
        (code, name, phone, specialty, country, governorate, address, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        code, input.name, input.phone, input.specialty, input.country, input.governorate, input.address, input.status,
      );
      id = Number(result.lastInsertRowid);
    }
    const insertEntry = database.prepare(`INSERT INTO contractor_opening_entries
      (contractor_id, entry_date, debit, credit, base_equivalent, status) VALUES (?, ?, ?, ?, ?, ?)`);
    input.openingEntries.forEach((entry) => {
      const debit = parseAmount(entry.debit);
      const credit = parseAmount(entry.credit);
      const baseEquivalent = debit > 0n ? formatAmount(debit) : formatAmount(credit);
      insertEntry.run(id, entry.date, entry.debit, entry.credit, baseEquivalent, entry.status);
    });
    return readContractor(database, id);
  });
}

function validateLine(value: unknown): ContractorContractLineInput & { quantity: string; unitPrice: string; total: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات أحد بنود العقد غير صالحة.');
  const line = value as Partial<ContractorContractLineInput>;
  const code = optionalText(line.code, 'كود البند', 60);
  const name = optionalText(line.name, 'اسم البند', 240);
  const itemType = optionalText(line.itemType, 'نوع البند', 100);
  const unit = optionalText(line.unit, 'وحدة البند', 60);
  if (!code || !name || !itemType || !unit) throw new Error('أكمل كود البند واسمه ونوعه ووحدته.');
  if (typeof line.quantity !== 'string' || typeof line.unitPrice !== 'string') throw new Error('الكمية أو سعر الوحدة غير صالح.');
  const quantityUnits = parseAmount(line.quantity);
  const priceUnits = parseAmount(line.unitPrice);
  if (quantityUnits <= 0n) throw new Error(`كمية البند ${code} يجب أن تكون أكبر من صفر.`);
  if (priceUnits < 0n) throw new Error(`سعر البند ${code} لا يمكن أن يكون سالبًا.`);
  const totalUnits = (quantityUnits * priceUnits + SCALE / 2n) / SCALE;
  return { code, name, itemType, unit, quantity: normalizeAmount(line.quantity), unitPrice: normalizeAmount(line.unitPrice), total: formatAmount(totalUnits) };
}

function validateContract(database: DatabaseSync, value: unknown): ContractorContractInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات عقد المقاول غير صالحة.');
  const input = value as Partial<ContractorContractInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم العقد غير صالح.');
  if (!isDate(input.date)) throw new Error('تاريخ العقد غير صالح.');
  if (!Number.isSafeInteger(input.contractorId) || Number(input.contractorId) < 1) throw new Error('اختر المقاول.');
  if (input.projectId !== null && input.projectId !== undefined && (!Number.isSafeInteger(input.projectId) || input.projectId < 1)) throw new Error('المشروع المرتبط غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 4000) throw new Error('ملاحظات العقد غير صالحة.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500) throw new Error('أضف بندًا واحدًا على الأقل، وبحد أقصى 500 بند.');
  const lines = input.lines.map(validateLine);
  const codes = lines.map((line) => line.code.toLocaleLowerCase('ar'));
  if (new Set(codes).size !== codes.length) throw new Error('لا يمكن تكرار كود البند في العقد نفسه.');
  const contractorId = Number(input.contractorId);
  if (!Number.isSafeInteger(contractorId) || contractorId < 1) throw new Error('المقاول المحدد غير صالح.');
  const contractor = database.prepare('SELECT status FROM contractors WHERE id = ?').get(contractorId) as Row | undefined;
  if (!contractor) throw new Error('المقاول المحدد غير موجود.');
  if (contractor.status !== 'active') {
    const existing = input.id === undefined ? undefined
      : database.prepare('SELECT contractor_id FROM contractor_contracts WHERE id = ?').get(input.id) as Row | undefined;
    if (!existing || Number(existing.contractor_id) !== input.contractorId) throw new Error('لا يمكن إنشاء عقد جديد لمقاول غير نشط.');
  }
  if (input.projectId !== null && input.projectId !== undefined && !database.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) {
    throw new Error('المشروع المحدد غير موجود.');
  }
  return { id: input.id, date: input.date, contractorId: Number(input.contractorId), projectId: input.projectId ?? null, notes: input.notes.trim(), lines };
}

function mapLine(row: Row): ContractorContractLine {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), itemType: String(row.item_type), unit: String(row.unit),
    quantity: String(row.quantity), unitPrice: String(row.unit_price), total: String(row.line_total),
  };
}

function readContract(database: DatabaseSync, id: number): ContractorContract {
  const row = database.prepare(`SELECT contracts.*, contractors.name AS contractor_name, contractors.code AS contractor_code,
      COALESCE(projects.name, '') AS project_name
    FROM contractor_contracts AS contracts
    INNER JOIN contractors ON contractors.id = contracts.contractor_id
    LEFT JOIN projects ON projects.id = contracts.project_id
    WHERE contracts.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('العقد المطلوب غير موجود.');
  const lines = (database.prepare('SELECT * FROM contractor_contract_lines WHERE contract_id = ? ORDER BY line_order, id').all(id) as Row[]).map(mapLine);
  const total = lines.reduce((sum, line) => sum + parseAmount(line.total), 0n);
  return {
    id: Number(row.id), number: String(row.number), date: String(row.contract_date), contractorId: Number(row.contractor_id),
    contractorName: String(row.contractor_name), contractorCode: String(row.contractor_code), projectId: row.project_id === null ? null : Number(row.project_id),
    projectName: String(row.project_name), status: String(row.status) as ContractorContract['status'], notes: String(row.notes),
    total: formatAmount(total), lines, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function persistContract(database: DatabaseSync, value: unknown, approve: boolean, withinTransaction = false): ContractorContract {
  const input = validateContract(database, value);
  const persist = () => {
    let id = input.id;
    if (id !== undefined) {
      const existing = database.prepare('SELECT status FROM contractor_contracts WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('العقد المطلوب تعديله غير موجود.');
      if (existing.status !== 'draft') throw new Error('العقد المعتمد غير قابل للتعديل؛ أنشئ عقدًا تعديليًا منفصلًا.');
      database.prepare(`UPDATE contractor_contracts SET contract_date = ?, contractor_id = ?, project_id = ?, notes = ?,
        updated_at = datetime('now') WHERE id = ?`).run(input.date, input.contractorId, input.projectId, input.notes, id);
      database.prepare('DELETE FROM contractor_contract_lines WHERE contract_id = ?').run(id);
    } else {
      const result = database.prepare(`INSERT INTO contractor_contracts
        (number, contract_date, contractor_id, project_id, status, notes, total)
        VALUES ('PENDING', ?, ?, ?, 'draft', ?, '0')`).run(input.date, input.contractorId, input.projectId, input.notes);
      id = Number(result.lastInsertRowid);
      const number = `CC-${input.date.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      database.prepare('UPDATE contractor_contracts SET number = ? WHERE id = ?').run(number, id);
    }
    const insertLine = database.prepare(`INSERT INTO contractor_contract_lines
      (contract_id, line_order, code, name, item_type, unit, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let total = 0n;
    input.lines.forEach((line, index) => {
      const checked = validateLine(line);
      total += parseAmount(checked.total);
      insertLine.run(id, index + 1, checked.code, checked.name, checked.itemType, checked.unit, checked.quantity, checked.unitPrice, checked.total);
    });
    if (approve) {
      if (input.lines.length === 0 || total <= 0n) throw new Error('لا يمكن اعتماد عقد بلا بنود أو بإجمالي صفر.');
      database.prepare("UPDATE contractor_contracts SET status = 'approved', total = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'")
        .run(formatAmount(total), id);
    } else {
      database.prepare('UPDATE contractor_contracts SET total = ?, updated_at = datetime(\'now\') WHERE id = ?').run(formatAmount(total), id);
    }
    return readContract(database, id);
  };
  return withinTransaction ? persist() : transaction(database, persist);
}

function validateCertificateLine(value: unknown): ContractorContractLineInput & { previousQuantity: string; currentQuantity: string; contractQuantity: string; completionRate: string; discount: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات بند المستخلص غير صالحة.');
  const line = value as Partial<ContractorContractLineInput & { previousQuantity?: string; currentQuantity?: string; contractQuantity?: string; completionRate?: string; discount?: string }>;
  const code = optionalText(line.code, 'كود البند', 60);
  const name = optionalText(line.name, 'اسم البند', 240);
  const unit = optionalText(line.unit, 'وحدة البند', 60);
  const previousQuantity = normalizeAmount(String(line.previousQuantity ?? '0'));
  const currentQuantity = normalizeAmount(String(line.currentQuantity ?? '0'));
  const contractQuantity = normalizeAmount(String(line.contractQuantity ?? '0'));
  const completionRate = typeof line.completionRate === 'string' ? line.completionRate : '0';
  const price = normalizeAmount(String(line.unitPrice ?? '0'));
  const discount = normalizeAmount(String(line.discount ?? '0'));
  const quantityValue = parseAmount(currentQuantity);
  if (quantityValue <= 0n) throw new Error(`كمية بند المستخلص ${code} يجب أن تكون موجبة.`);
  const rate = Number(completionRate || '0');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`نسبة الإنجاز الخاصة بالبند ${code} غير صالحة.`);
  const quantityTotal = (quantityValue * parseAmount(price) + 10n ** 12n / 2n) / (10n ** 12n);
  const discountAmount = parseAmount(discount);
  const total = quantityTotal > discountAmount ? quantityTotal - discountAmount : 0n;
  return { code, name, itemType: 'work', unit, quantity: currentQuantity, previousQuantity, currentQuantity, contractQuantity, completionRate, unitPrice: price, discount, total: formatAmount(total) } as ContractorContractLineInput & { previousQuantity: string; currentQuantity: string; contractQuantity: string; completionRate: string; discount: string };
}

function mapCertificateLine(row: Row): ContractorContractLine {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), itemType: 'work', unit: String(row.unit),
    quantity: String(row.current_quantity), unitPrice: String(row.unit_price), total: String(row.line_total),
  };
}

function validateCertificate(database: DatabaseSync, value: unknown): { id?: number; date: string; contractorId: number; projectId: number | null; contractId: number | null; costCenter: string; notes: string; lines: Array<ContractorContractLineInput & { previousQuantity: string; currentQuantity: string; contractQuantity: string; completionRate: string; discount: string }> } {
  if (!value || typeof value !== 'object') throw new Error('بيانات مستخلص المقاول غير صالحة.');
  const input = value as Partial<{ id?: unknown; date?: unknown; contractorId?: unknown; projectId?: unknown; contractId?: unknown; costCenter?: unknown; notes?: unknown; lines?: unknown[] }>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) throw new Error('رقم المستخلص غير صالح.');
  if (!isDate(String(input.date ?? ''))) throw new Error('تاريخ المستخلص غير صالح.');
  const contractorId = Number(input.contractorId ?? 0);
  const contractor = database.prepare('SELECT status FROM contractors WHERE id = ?').get(contractorId) as Row | undefined;
  if (!Number.isSafeInteger(contractorId) || contractorId < 1 || !contractor) throw new Error('المقاول المحدد غير موجود.');
  const projectId = input.projectId === null || input.projectId === undefined || String(input.projectId) === '' ? null : Number(input.projectId);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1 || !database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId))) throw new Error('المشروع المحدد غير موجود.');
  const contractId = input.contractId === null || input.contractId === undefined || String(input.contractId) === '' ? null : Number(input.contractId);
  if (contractId !== null && (!Number.isSafeInteger(contractId) || contractId < 1 || !database.prepare('SELECT 1 FROM contractor_contracts WHERE id = ? AND contractor_id = ?').get(contractId, contractorId))) {
    throw new Error('العقد المحدد غير موجود أو لا ينتمي إلى المقاول المختار.');
  }
  if (typeof input.costCenter !== 'string' || input.costCenter.length > 200) throw new Error('مركز التكلفة غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 4000) throw new Error('ملاحظات المستخلص غير صالحة.');
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 300) throw new Error('أضف بندًا واحدًا على الأقل إلى المستخلص.');
  const lines = input.lines.map(validateCertificateLine);
  return { id: input.id !== undefined ? Number(input.id) : undefined, date: String(input.date), contractorId, projectId, contractId, costCenter: input.costCenter.trim(), notes: input.notes.trim(), lines };
}

function readCertificate(database: DatabaseSync, id: number): any {
  const row = database.prepare(`SELECT certificates.*, contractors.name AS contractor_name, contractors.code AS contractor_code,
      COALESCE(projects.name, '') AS project_name, COALESCE(contracts.number, '') AS contract_number
    FROM contractor_certificate_documents AS certificates
    INNER JOIN contractors ON contractors.id = certificates.contractor_id
    LEFT JOIN projects ON projects.id = certificates.project_id
    LEFT JOIN contractor_contracts AS contracts ON contracts.id = certificates.contract_id
    WHERE certificates.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('المستخلص المطلوب غير موجود.');
  const lines = database.prepare('SELECT * FROM contractor_certificate_lines WHERE certificate_id = ? ORDER BY line_order, id').all(id) as Row[];
  const total = lines.reduce((sum, line) => sum + parseAmount(String(line.line_total)), 0n);
  return {
    id: Number(row.id), number: String(row.number), date: String(row.certificate_date), contractorId: Number(row.contractor_id),
    contractorName: String(row.contractor_name), contractorCode: String(row.contractor_code), projectId: row.project_id === null ? null : Number(row.project_id),
    projectName: String(row.project_name), contractId: row.contract_id === null ? null : Number(row.contract_id), contractNumber: String(row.contract_number),
    costCenter: String(row.cost_center), notes: String(row.notes), status: String(row.status), total: formatAmount(total),
    lines: lines.map((line) => ({ id: Number(line.id), code: String(line.code), name: String(line.name), unit: String(line.unit),
      previousQuantity: String(line.previous_quantity), currentQuantity: String(line.current_quantity), contractQuantity: String(line.contract_quantity),
      completionRate: String(line.completion_rate), unitPrice: String(line.unit_price), discount: String(line.discount), total: String(line.line_total) })),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function persistCertificate(database: DatabaseSync, value: unknown, approve: boolean, withinTransaction = false): any {
  const input = validateCertificate(database, value);
  const persist = () => {
    let id = input.id;
    if (id !== undefined) {
      const existing = database.prepare('SELECT status FROM contractor_certificate_documents WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('المستخلص المطلوب غير موجود.');
      if (existing.status !== 'draft') throw new Error('المستخلص المعتمد لا يمكن تعديله.');
      database.prepare(`UPDATE contractor_certificate_documents SET certificate_date = ?, contractor_id = ?, project_id = ?, contract_id = ?, cost_center = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.date, input.contractorId, input.projectId, input.contractId, input.costCenter, input.notes, id);
      database.prepare('DELETE FROM contractor_certificate_lines WHERE certificate_id = ?').run(id);
    } else {
      const result = database.prepare(`INSERT INTO contractor_certificate_documents (number, certificate_date, contractor_id, project_id, contract_id, cost_center, status, notes, total)
        VALUES ('PENDING', ?, ?, ?, ?, ?, 'draft', ?, '0')`).run(input.date, input.contractorId, input.projectId, input.contractId, input.costCenter, input.notes);
      id = Number(result.lastInsertRowid);
      const number = `CTR-${input.date.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      database.prepare('UPDATE contractor_certificate_documents SET number = ? WHERE id = ?').run(number, id);
    }
    const insertLine = database.prepare(`INSERT INTO contractor_certificate_lines
      (certificate_id, line_order, code, name, unit, previous_quantity, current_quantity, contract_quantity, completion_rate, unit_price, discount, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let total = 0n;
    input.lines.forEach((line, index) => {
      const safeLine = validateCertificateLine(line);
      const amount = parseAmount(safeLine.currentQuantity) * parseAmount(safeLine.unitPrice);
      const discount = parseAmount(safeLine.discount);
      const lineTotal = amount > discount ? amount - discount : 0n;
      total += lineTotal;
      insertLine.run(id, index + 1, safeLine.code, safeLine.name, safeLine.unit, safeLine.previousQuantity, safeLine.currentQuantity, safeLine.contractQuantity, safeLine.completionRate, safeLine.unitPrice, safeLine.discount, formatAmount(lineTotal));
    });
    if (approve) {
      if (total <= 0n) throw new Error('لا يمكن اعتماد مستخلص بدون قيمة.');
      database.prepare("UPDATE contractor_certificate_documents SET status = 'approved', total = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'")
        .run(formatAmount(total), id);
    } else {
      database.prepare('UPDATE contractor_certificate_documents SET total = ?, updated_at = datetime(\'now\') WHERE id = ?').run(formatAmount(total), id);
    }
    return readCertificate(database, id);
  };
  return withinTransaction ? persist() : transaction(database, persist);
}

function validateVoucher(database: DatabaseSync, value: unknown): { id?: number; date: string; contractorId: number; projectId: number | null; paymentMethod: 'cash' | 'bank'; cashBoxId: number | null; bankAccountId: number | null; costCenter: string; referenceNo: string; amount: string; notes: string } {
  if (!value || typeof value !== 'object') throw new Error('بيانات سند المقاول غير صالحة.');
  const input = value as Partial<{ id?: unknown; date?: unknown; contractorId?: unknown; projectId?: unknown; paymentMethod?: unknown; cashBoxId?: unknown; bankAccountId?: unknown; costCenter?: unknown; referenceNo?: unknown; amount?: unknown; notes?: unknown }>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) throw new Error('رقم السند غير صالح.');
  if (!isDate(String(input.date ?? ''))) throw new Error('تاريخ السند غير صالح.');
  const contractorId = Number(input.contractorId ?? 0);
  if (!Number.isSafeInteger(contractorId) || contractorId < 1 || !database.prepare('SELECT 1 FROM contractors WHERE id = ?').get(contractorId)) throw new Error('المقاول المحدد غير موجود.');
  const projectId = input.projectId === null || input.projectId === undefined || String(input.projectId) === '' ? null : Number(input.projectId);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1 || !database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId))) throw new Error('المشروع المختار غير موجود.');
  const paymentMethod = String(input.paymentMethod ?? 'cash');
  if (paymentMethod !== 'cash' && paymentMethod !== 'bank') throw new Error('طريقة الدفع غير صالحة.');
  const cashBoxId = input.cashBoxId === null || input.cashBoxId === undefined || String(input.cashBoxId) === '' ? null : Number(input.cashBoxId);
  if (cashBoxId !== null && (!Number.isSafeInteger(cashBoxId) || cashBoxId < 1 || !database.prepare('SELECT 1 FROM treasury_cash_boxes WHERE id = ? AND status = ?').get(cashBoxId, 'active'))) throw new Error('الخزينة المحددة غير موجودة أو غير نشطة.');
  const bankAccountId = input.bankAccountId === null || input.bankAccountId === undefined || String(input.bankAccountId) === '' ? null : Number(input.bankAccountId);
  if (bankAccountId !== null && (!Number.isSafeInteger(bankAccountId) || bankAccountId < 1 || !database.prepare('SELECT 1 FROM treasury_bank_accounts WHERE id = ? AND status = ?').get(bankAccountId, 'active'))) throw new Error('الحساب البنكي المحدد غير موجود أو غير نشط.');
  if (paymentMethod === 'cash' && cashBoxId === null) throw new Error('اختر خزينة صالحة عند الدفع نقدًا.');
  if (paymentMethod === 'bank' && bankAccountId === null) throw new Error('اختر حسابًا بنكيًا صالحًا عند الدفع بنكيًا.');
  if (typeof input.costCenter !== 'string' || input.costCenter.length > 200) throw new Error('مركز التكلفة غير صالح.');
  if (typeof input.referenceNo !== 'string' || input.referenceNo.length > 120) throw new Error('رقم المرجع غير صالح.');
  const amount = normalizeAmount(String(input.amount ?? '0'));
  if (parseAmount(amount) <= 0n) throw new Error('المبلغ يجب أن يكون أكبر من صفر.');
  if (typeof input.notes !== 'string' || input.notes.length > 4000) throw new Error('ملاحظات السند غير صالحة.');
  return { id: input.id !== undefined ? Number(input.id) : undefined, date: String(input.date), contractorId, projectId, paymentMethod: paymentMethod as 'cash' | 'bank', cashBoxId, bankAccountId, costCenter: input.costCenter.trim(), referenceNo: input.referenceNo.trim(), amount, notes: input.notes.trim() };
}

function readVoucher(database: DatabaseSync, id: number): any {
  const row = database.prepare(`SELECT vouchers.*, contractors.name AS contractor_name, contractors.code AS contractor_code,
      COALESCE(projects.name, '') AS project_name
    FROM contractor_vouchers AS vouchers
    INNER JOIN contractors ON contractors.id = vouchers.contractor_id
    LEFT JOIN projects ON projects.id = vouchers.project_id
    WHERE vouchers.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('السند المطلوب غير موجود.');
  return {
    id: Number(row.id), number: String(row.number), date: String(row.voucher_date), contractorId: Number(row.contractor_id),
    contractorName: String(row.contractor_name), contractorCode: String(row.contractor_code), projectId: row.project_id === null ? null : Number(row.project_id),
    projectName: String(row.project_name), paymentMethod: String(row.payment_method), cashBoxId: row.cash_box_id === null ? null : Number(row.cash_box_id),
    bankAccountId: row.bank_account_id === null ? null : Number(row.bank_account_id), costCenter: String(row.cost_center), referenceNo: String(row.reference_no),
    amount: String(row.amount), notes: String(row.notes), status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function persistVoucher(database: DatabaseSync, value: unknown, approve: boolean, withinTransaction = false): any {
  const input = validateVoucher(database, value);
  const persist = () => {
    let id = input.id;
    if (id !== undefined) {
      const existing = database.prepare('SELECT status FROM contractor_vouchers WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('السند المطلوب غير موجود.');
      if (existing.status !== 'draft') throw new Error('السند المعتمد لا يمكن تعديله.');
      database.prepare(`UPDATE contractor_vouchers SET voucher_date = ?, contractor_id = ?, project_id = ?, payment_method = ?, cash_box_id = ?, bank_account_id = ?, cost_center = ?, reference_no = ?, notes = ?, amount = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.date, input.contractorId, input.projectId, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.costCenter, input.referenceNo, input.notes, input.amount, id);
    } else {
      const result = database.prepare(`INSERT INTO contractor_vouchers (number, voucher_date, contractor_id, project_id, payment_method, cash_box_id, bank_account_id, cost_center, reference_no, status, notes, amount)
        VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(input.date, input.contractorId, input.projectId, input.paymentMethod, input.cashBoxId, input.bankAccountId, input.costCenter, input.referenceNo, input.notes, input.amount);
      id = Number(result.lastInsertRowid);
      const number = `CV-${input.date.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      database.prepare('UPDATE contractor_vouchers SET number = ? WHERE id = ?').run(number, id);
    }
    if (approve) {
      database.prepare("UPDATE contractor_vouchers SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'draft'").run(id);
    }
    return readVoucher(database, id);
  };
  return withinTransaction ? persist() : transaction(database, persist);
}

export function registerContractorHandlers(requireDatabase: () => DatabaseSync): void {
  ipcMain.handle('contractors:list', (_event, searchValue: unknown) => {
    const database = requireDatabase();
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const rows = database.prepare(`SELECT id FROM contractors
      WHERE (? = '' OR code LIKE '%' || ? || '%' OR name LIKE '%' || ? || '%' OR phone LIKE '%' || ? || '%' OR specialty LIKE '%' || ? || '%')
      ORDER BY name COLLATE NOCASE, code`).all(search, search, search, search, search) as Row[];
    return rows.map((row) => readContractor(database, Number(row.id)));
  });
  ipcMain.handle('contractors:save', (_event, value: unknown) => saveContractor(requireDatabase(), value));
  ipcMain.handle('contractors:status', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!value || typeof value !== 'object') throw new Error('طلب حالة المقاول غير صالح.');
    const { id, status } = value as { id?: unknown; status?: unknown };
    if (!Number.isSafeInteger(id) || Number(id) < 1 || (status !== 'active' && status !== 'inactive')) throw new Error('بيانات حالة المقاول غير صالحة.');
    const result = database.prepare("UPDATE contractors SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, Number(id));
    if (!result.changes) throw new Error('المقاول المطلوب غير موجود.');
    return readContractor(database, Number(id));
  });
  ipcMain.handle('contractor-contracts:list', (_event, searchValue: unknown) => {
    const database = requireDatabase();
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const rows = database.prepare(`SELECT contracts.id FROM contractor_contracts AS contracts
      INNER JOIN contractors ON contractors.id = contracts.contractor_id
      LEFT JOIN projects ON projects.id = contracts.project_id
      WHERE (? = '' OR contracts.number LIKE '%' || ? || '%' OR contractors.name LIKE '%' || ? || '%' OR projects.name LIKE '%' || ? || '%')
      ORDER BY contracts.contract_date DESC, contracts.id DESC`).all(search, search, search, search) as Row[];
    return rows.map((row) => readContract(database, Number(row.id)));
  });
  ipcMain.handle('contractor-contracts:save', (_event, value: unknown) => persistContract(requireDatabase(), value, false));
  ipcMain.handle('contractor-contracts:approve', (_event, value: unknown) => persistContract(requireDatabase(), value, true));
  ipcMain.handle('contractor-contracts:delete', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم العقد غير صالح.');
    const result = database.prepare("DELETE FROM contractor_contracts WHERE id = ? AND status = 'draft'").run(Number(value));
    if (!result.changes) throw new Error('يمكن حذف مسودة العقد فقط.');
    return true;
  });
  ipcMain.handle('contractor-certificates:list', (_event, searchValue: unknown) => {
    const database = requireDatabase();
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const rows = database.prepare(`SELECT certificates.id FROM contractor_certificate_documents AS certificates
      INNER JOIN contractors ON contractors.id = certificates.contractor_id
      LEFT JOIN projects ON projects.id = certificates.project_id
      LEFT JOIN contractor_contracts ON contractor_contracts.id = certificates.contract_id
      WHERE (? = '' OR certificates.number LIKE '%' || ? || '%' OR contractors.name LIKE '%' || ? || '%' OR projects.name LIKE '%' || ? || '%' OR contractor_contracts.number LIKE '%' || ? || '%')
      ORDER BY certificates.certificate_date DESC, certificates.id DESC`).all(search, search, search, search, search, search) as Row[];
    return rows.map((row) => readCertificate(database, Number(row.id)));
  });
  ipcMain.handle('contractor-certificates:save', (_event, value: unknown) => persistCertificate(requireDatabase(), value, false));
  ipcMain.handle('contractor-certificates:approve', (_event, value: unknown) => persistCertificate(requireDatabase(), value, true));
  ipcMain.handle('contractor-certificates:delete', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم المستخلص غير صالح.');
    const result = database.prepare("DELETE FROM contractor_certificate_documents WHERE id = ? AND status = 'draft'").run(Number(value));
    if (!result.changes) throw new Error('يمكن حذف مسودة المستخلص فقط.');
    return true;
  });
  ipcMain.handle('contractor-vouchers:list', (_event, searchValue: unknown) => {
    const database = requireDatabase();
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const rows = database.prepare(`SELECT vouchers.id FROM contractor_vouchers AS vouchers
      INNER JOIN contractors ON contractors.id = vouchers.contractor_id
      LEFT JOIN projects ON projects.id = vouchers.project_id
      WHERE (? = '' OR vouchers.number LIKE '%' || ? || '%' OR contractors.name LIKE '%' || ? || '%' OR projects.name LIKE '%' || ? || '%' OR vouchers.reference_no LIKE '%' || ? || '%')
      ORDER BY vouchers.voucher_date DESC, vouchers.id DESC`).all(search, search, search, search, search) as Row[];
    return rows.map((row) => readVoucher(database, Number(row.id)));
  });
  ipcMain.handle('contractor-vouchers:save', (_event, value: unknown) => persistVoucher(requireDatabase(), value, false));
  ipcMain.handle('contractor-vouchers:approve', (_event, value: unknown) => persistVoucher(requireDatabase(), value, true));
  ipcMain.handle('contractor-vouchers:delete', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم السند غير صالح.');
    const result = database.prepare("DELETE FROM contractor_vouchers WHERE id = ? AND status = 'draft'").run(Number(value));
    if (!result.changes) throw new Error('يمكن حذف مسودة السند فقط.');
    return true;
  });
}