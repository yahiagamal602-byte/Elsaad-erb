import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import { createAccountingJournal, firstOpenAccountingDate, requirePostingAccount, reverseAccountingJournal } from './posting.js';
import type {
  SalesDocument,
  SalesDocumentInput,
  SalesDocumentLine,
  SalesDocumentLineInput,
  SalesDocumentStatus,
  SalesDocumentType,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const DOCUMENT_TYPES: readonly SalesDocumentType[] = ['estimate', 'work-order', 'certificate', 'invoice'];
const SCALE = 10n ** 12n;

export function installSalesSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sales_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_type TEXT NOT NULL CHECK (document_type IN ('estimate', 'work-order', 'certificate', 'invoice')),
      document_number TEXT NOT NULL UNIQUE,
      source_document_id INTEGER REFERENCES sales_documents(id) ON DELETE RESTRICT,
      master_client_id INTEGER,
      client_name TEXT NOT NULL,
      document_date TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
      inventory_sync_status TEXT NOT NULL DEFAULT 'not-applicable'
        CHECK (inventory_sync_status IN ('not-applicable', 'pending-integration', 'reversal-pending-integration')),
      accounting_sync_status TEXT NOT NULL DEFAULT 'not-applicable'
        CHECK (accounting_sync_status IN ('not-applicable', 'pending-rules')),
      journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
      posted_customer_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      approved_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sales_documents_type_date ON sales_documents(document_type, document_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS sales_documents_source ON sales_documents(source_document_id);
    CREATE TABLE IF NOT EXISTS sales_document_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
      line_order INTEGER NOT NULL,
      source_document_line_id INTEGER REFERENCES sales_document_lines(id) ON DELETE RESTRICT,
      source_work_order_line_id INTEGER REFERENCES sales_document_lines(id) ON DELETE RESTRICT,
      master_item_id INTEGER,
      posted_sales_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      description TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL,
      current_quantity TEXT NOT NULL DEFAULT '0',
      unit_price TEXT NOT NULL,
      UNIQUE(document_id, line_order)
    );
    CREATE INDEX IF NOT EXISTS sales_document_lines_document ON sales_document_lines(document_id, line_order);
    CREATE INDEX IF NOT EXISTS sales_document_lines_work_order_source ON sales_document_lines(source_work_order_line_id);
    CREATE TABLE IF NOT EXISTS sales_inventory_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE RESTRICT,
      effect TEXT NOT NULL CHECK (effect IN ('issue', 'reverse')),
      status TEXT NOT NULL DEFAULT 'pending-integration' CHECK (status = 'pending-integration'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(document_id, effect)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_per_certificate
      ON sales_documents(source_document_id)
      WHERE document_type = 'invoice' AND status <> 'cancelled';
  `);
  const documentColumns = new Set((database.prepare('PRAGMA table_info(sales_documents)').all() as Row[]).map((row) => String(row.name)));
  if (!documentColumns.has('journal_entry_id')) database.exec('ALTER TABLE sales_documents ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!documentColumns.has('reversal_journal_entry_id')) database.exec('ALTER TABLE sales_documents ADD COLUMN reversal_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT');
  if (!documentColumns.has('posted_customer_account_id')) database.exec('ALTER TABLE sales_documents ADD COLUMN posted_customer_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT');
  const lineColumns = new Set((database.prepare('PRAGMA table_info(sales_document_lines)').all() as Row[]).map((row) => String(row.name)));
  if (!lineColumns.has('posted_sales_account_id')) database.exec('ALTER TABLE sales_document_lines ADD COLUMN posted_sales_account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT');
}

function isDocumentType(value: unknown): value is SalesDocumentType {
  return typeof value === 'string' && DOCUMENT_TYPES.includes(value as SalesDocumentType);
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} غير صالح.`);
  return Number(value);
}

function optionalId(value: unknown, label: string): number | null {
  if (value === null) return null;
  return positiveId(value, label);
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

function validateLines(type: SalesDocumentType, value: unknown): SalesDocumentLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new Error('أضف بندًا واحدًا على الأقل، وبحد أقصى 500 بند.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('بيانات أحد البنود غير صالحة.');
    const line = entry as Partial<SalesDocumentLineInput>;
    if (typeof line.description !== 'string' || !line.description.trim() || line.description.trim().length > 240) {
      throw new Error('أدخل وصفًا فعليًا لكل بند، بحد أقصى 240 حرفًا.');
    }
    if (typeof line.unit !== 'string' || line.unit.length > 40) throw new Error('وحدة البند غير صالحة.');
    if (typeof line.quantity !== 'string' || typeof line.currentQuantity !== 'string' || typeof line.unitPrice !== 'string') {
      throw new Error('كمية أو سعر أحد البنود غير صالح.');
    }
    const quantity = parseAmount(line.quantity);
    const currentQuantity = parseAmount(line.currentQuantity);
    const unitPrice = parseAmount(line.unitPrice);
    if (type !== 'certificate' && quantity <= 0n) throw new Error('يجب أن تكون كمية البند أكبر من صفر.');
    if (type === 'certificate' && quantity <= 0n) throw new Error('الكمية المتعاقد عليها في البند غير صالحة.');
    if (type === 'certificate' && line.sourceWorkOrderLineId === null) {
      throw new Error('يجب ربط كل بند مستخلص ببند أمر تشغيل.');
    }
    if (type !== 'certificate' && type !== 'invoice' && line.sourceWorkOrderLineId !== null) {
      throw new Error('ارتباط بند أمر التشغيل غير صالح لهذا المستند.');
    }
    if (line.id !== undefined && (!Number.isSafeInteger(line.id) || Number(line.id) < 1)) {
      throw new Error('رقم البند غير صالح.');
    }
    if (unitPrice < 0n || currentQuantity < 0n) throw new Error('لا تقبل الكميات أو الأسعار السالبة.');
    return {
      id: line.id as number | undefined,
      sourceDocumentLineId: optionalId(line.sourceDocumentLineId, 'مرجع بند المستند السابق'),
      sourceWorkOrderLineId: optionalId(line.sourceWorkOrderLineId, 'مرجع بند أمر التشغيل'),
      masterItemId: optionalId(line.masterItemId, 'مرجع الصنف'),
      description: line.description.trim(),
      unit: line.unit.trim(),
      quantity: normalizeAmount(line.quantity),
      currentQuantity: normalizeAmount(line.currentQuantity),
      unitPrice: normalizeAmount(line.unitPrice),
    };
  });
}

function validateDocument(value: unknown): SalesDocumentInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات مستند المبيعات غير صالحة.');
  const input = value as Partial<SalesDocumentInput> & { id?: unknown };
  if (!isDocumentType(input.type)) throw new Error('نوع مستند المبيعات غير صالح.');
  if (typeof input.clientName !== 'string' || !input.clientName.trim() || input.clientName.trim().length > 180) {
    throw new Error('أدخل اسم العميل الفعلي بحد أقصى 180 حرفًا.');
  }
  if (typeof input.date !== 'string' || !isValidDate(input.date)) throw new Error('أدخل تاريخًا صالحًا للمستند.');
  if (typeof input.reference !== 'string' || input.reference.length > 100) throw new Error('مرجع المستند غير صالح.');
  if (typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('الملاحظات تجاوزت الحد المسموح.');
  if (input.id !== undefined) positiveId(input.id, 'رقم المستند');
  const sourceDocumentId = optionalId(input.sourceDocumentId, 'المستند المصدر');
  if (input.id === undefined && sourceDocumentId !== null) {
    throw new Error('يُنشأ المستند المرتبط عبر إجراء التحويل من المصدر المعتمد.');
  }
  return {
    id: input.id as number | undefined,
    type: input.type,
    sourceDocumentId,
    masterClientId: optionalId(input.masterClientId, 'مرجع العميل'),
    clientName: input.clientName.trim(),
    date: input.date,
    reference: input.reference.trim(),
    notes: input.notes.trim(),
    lines: validateLines(input.type, input.lines),
  };
}

function amountFor(quantity: string, unitPrice: string): bigint {
  const product = parseAmount(quantity) * parseAmount(unitPrice);
  return (product + SCALE / 2n) / SCALE;
}

function percentFor(cumulative: string, contracted: string): string {
  const denominator = parseAmount(contracted);
  if (denominator === 0n) return '0';
  const hundredths = (parseAmount(cumulative) * 10000n + denominator / 2n) / denominator;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function readDocument(database: DatabaseSync, id: number): SalesDocument {
  const row = database.prepare(`
    SELECT document.*, source.document_number AS source_number
    FROM sales_documents AS document
    LEFT JOIN sales_documents AS source ON source.id = document.source_document_id
    WHERE document.id = ?
  `).get(id) as Row | undefined;
  if (!row) throw new Error('لم يُعثر على مستند المبيعات.');

  const lineRows = database.prepare(`
    SELECT * FROM sales_document_lines WHERE document_id = ? ORDER BY line_order
  `).all(id) as Row[];
  const lines: SalesDocumentLine[] = lineRows.map((line) => {
    const currentQuantity = String(line.current_quantity);
    let previousQuantity = '0';
    let cumulativeQuantity = row.document_type === 'certificate' ? currentQuantity : String(line.quantity);
    if (row.document_type === 'certificate') {
      const certificates = database.prepare(`
        SELECT certificate_line.document_id, certificate_line.current_quantity
        FROM sales_document_lines AS certificate_line
        INNER JOIN sales_documents AS certificate ON certificate.id = certificate_line.document_id
        WHERE certificate.document_type = 'certificate'
          AND certificate.status = 'approved'
          AND certificate_line.source_work_order_line_id = ?
      `).all(Number(line.source_work_order_line_id)) as Row[];
      let approvedTotal = 0n;
      let ownApprovedQuantity = 0n;
      for (const certificate of certificates) {
        const quantity = parseAmount(String(certificate.current_quantity));
        approvedTotal += quantity;
        if (Number(certificate.document_id) === Number(row.id)) ownApprovedQuantity += quantity;
      }
      previousQuantity = formatAmount(approvedTotal - ownApprovedQuantity);
      cumulativeQuantity = formatAmount(approvedTotal + (row.status === 'draft' ? parseAmount(currentQuantity) : 0n));
    }
    return {
      id: Number(line.id),
      sourceWorkOrderLineId: line.source_work_order_line_id === null ? null : Number(line.source_work_order_line_id),
      sourceDocumentLineId: line.source_document_line_id === null ? null : Number(line.source_document_line_id),
      masterItemId: line.master_item_id === null ? null : Number(line.master_item_id),
      description: String(line.description),
      unit: String(line.unit),
      quantity: String(line.quantity),
      currentQuantity,
      unitPrice: String(line.unit_price),
      amount: formatAmount(amountFor(row.document_type === 'certificate' ? currentQuantity : String(line.quantity), String(line.unit_price))),
      previousQuantity,
      cumulativeQuantity,
      completionPercent: percentFor(cumulativeQuantity, String(line.quantity)),
    };
  });
  const total = lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  const type = String(row.document_type) as SalesDocumentType;
  const status = String(row.status) as SalesDocumentStatus;
  return {
    id: Number(row.id),
    type,
    number: String(row.document_number),
    sourceDocumentId: row.source_document_id === null ? null : Number(row.source_document_id),
    sourceNumber: String(row.source_number ?? ''),
    masterClientId: row.master_client_id === null ? null : Number(row.master_client_id),
    clientName: String(row.client_name),
    date: String(row.document_date),
    reference: String(row.reference),
    notes: String(row.notes),
    status,
    inventorySyncStatus: String(row.inventory_sync_status) as SalesDocument['inventorySyncStatus'],
    accountingSyncStatus: row.reversal_journal_entry_id !== null
      ? 'reversed'
      : row.journal_entry_id !== null
        ? 'posted'
        : String(row.accounting_sync_status) as SalesDocument['accountingSyncStatus'],
    journalEntryId: row.journal_entry_id === null ? null : Number(row.journal_entry_id),
    reversalJournalEntryId: row.reversal_journal_entry_id === null ? null : Number(row.reversal_journal_entry_id),
    total: formatAmount(total),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    approvedAt: String(row.approved_at),
    cancelledAt: String(row.cancelled_at),
    lines,
  };
}

function createNumber(database: DatabaseSync, type: SalesDocumentType, id: number): string {
  let prefix: string = { estimate: 'EST', 'work-order': 'WO', certificate: 'CERT', invoice: 'INV' }[type];
  if (type === 'invoice') {
    const setting = database.prepare("SELECT value FROM app_settings WHERE key = 'invoice_prefix'").get() as Row | undefined;
    if (setting) {
      const configuredPrefix = String(setting.value);
      if (!/^[A-Z0-9][A-Z0-9_-]{0,11}$/.test(configuredPrefix)) {
        throw new Error('بادئة رقم الفاتورة المحفوظة غير صالحة.');
      }
      prefix = configuredPrefix;
    }
  }
  return `${prefix}-${String(id).padStart(6, '0')}`;
}

function saveDocument(database: DatabaseSync, value: unknown): SalesDocument {
  const input = validateDocument(value);
  return transaction(database, () => {
    if (input.masterClientId !== null) {
      const customer = database.prepare('SELECT name, status FROM customers WHERE id = ?').get(input.masterClientId) as Row | undefined;
      if (!customer || customer.name !== input.clientName) throw new Error('العميل المحدد غير موجود أو لا يطابق اسم المستند.');
      if (input.id === undefined && input.type === 'estimate' && customer.status !== 'active') {
        throw new Error('لا يمكن إنشاء مقايسة لعميل معطّل.');
      }
    } else if (input.id === undefined && input.type === 'estimate') {
      throw new Error('اختر عميلًا مسجلًا قبل إنشاء المقايسة.');
    }
    if (input.id !== undefined) {
      const existing = database.prepare('SELECT document_type, status, source_document_id FROM sales_documents WHERE id = ?')
        .get(input.id) as Row | undefined;
      if (!existing) throw new Error('لم يُعثر على المستند المطلوب.');
      if (existing.document_type !== input.type) throw new Error('لا يمكن تغيير نوع المستند بعد إنشائه.');
      if (existing.status !== 'draft') throw new Error('المستند المعتمد أو الملغي غير قابل للتعديل.');
      const existingSourceId = existing.source_document_id === null ? null : Number(existing.source_document_id);
      if (input.sourceDocumentId !== existingSourceId) throw new Error('لا يمكن تغيير ارتباط المستند المصدر.');
      validateSourceLines(database, input.type, existingSourceId, input.clientName, input.masterClientId, input.lines);
      database.prepare(`
        UPDATE sales_documents
        SET master_client_id = ?, client_name = ?, document_date = ?, reference = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(input.masterClientId, input.clientName, input.date, input.reference, input.notes, input.id);
      database.prepare('DELETE FROM sales_document_lines WHERE document_id = ?').run(input.id);
      insertLines(database, input.id, input.lines);
      return readDocument(database, input.id);
    }

    if (input.type !== 'estimate') throw new Error('أنشئ هذا المستند من المستند المصدر المعتمد لنقل بياناته وبنوده.');
    validateSourceLines(database, input.type, null, input.clientName, input.masterClientId, input.lines);
    const inserted = database.prepare(`
      INSERT INTO sales_documents (
        document_type, document_number, master_client_id, client_name, document_date,
        reference, notes, accounting_sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.type, '', input.masterClientId, input.clientName, input.date, input.reference, input.notes, 'not-applicable');
    const id = Number(inserted.lastInsertRowid);
    database.prepare('UPDATE sales_documents SET document_number = ? WHERE id = ?')
      .run(createNumber(database, input.type, id), id);
    insertLines(database, id, input.lines);
    return readDocument(database, id);
  });
}

function insertLines(database: DatabaseSync, documentId: number, lines: SalesDocumentLineInput[]): void {
  const insert = database.prepare(`
    INSERT INTO sales_document_lines (
      document_id, line_order, source_document_line_id, source_work_order_line_id,
      master_item_id, description, unit, quantity, current_quantity, unit_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line, index) => insert.run(
    documentId,
    index + 1,
    line.sourceDocumentLineId,
    line.sourceWorkOrderLineId,
    line.masterItemId,
    line.description,
    line.unit,
    line.quantity,
    line.currentQuantity,
    line.unitPrice,
  ));
}

function validateSourceLines(
  database: DatabaseSync,
  type: SalesDocumentType,
  sourceDocumentId: number | null,
  clientName: string,
  masterClientId: number | null,
  lines: SalesDocumentLineInput[],
): void {
  if (type === 'estimate') {
    if (sourceDocumentId !== null || lines.some((line) => line.sourceDocumentLineId !== null || line.sourceWorkOrderLineId !== null)) {
      throw new Error('لا يرتبط أصل المقايسة بمستند سابق.');
    }
    return;
  }
  if (sourceDocumentId === null) throw new Error('يجب إنشاء المستند من المستند السابق المعتمد في التسلسل.');
  const source = database.prepare(`
    SELECT id, document_type, status, client_name, master_client_id FROM sales_documents WHERE id = ?
  `).get(sourceDocumentId) as Row | undefined;
  if (!source || source.status !== 'approved') throw new Error('المستند المصدر غير موجود أو غير معتمد.');
  const requiredSourceType: Record<Exclude<SalesDocumentType, 'estimate'>, SalesDocumentType> = {
    'work-order': 'estimate',
    certificate: 'work-order',
    invoice: 'certificate',
  };
  if (source.document_type !== requiredSourceType[type]) throw new Error('ارتباط المستند لا يطابق تسلسل المبيعات.');
  if (source.client_name !== clientName || (source.master_client_id ?? null) !== masterClientId) {
    throw new Error('يجب أن يبقى العميل مطابقًا للمستند المصدر.');
  }

  const sourceLines = database.prepare(`
    SELECT * FROM sales_document_lines WHERE document_id = ? ORDER BY line_order
  `).all(sourceDocumentId) as Row[];
  const sourceById = new Map(sourceLines.map((line) => [Number(line.id), line]));
  const linkedIds = new Set<number>();
  for (const line of lines) {
    const sourceLineId = line.sourceDocumentLineId;
    if (sourceLineId === null || linkedIds.has(sourceLineId)) {
      throw new Error('يجب ربط كل بند ببند واحد فريد من المستند المصدر.');
    }
    const sourceLine = sourceById.get(sourceLineId);
    if (!sourceLine) throw new Error('أحد بنود المستند المصدر غير موجود.');
    linkedIds.add(sourceLineId);
    const sameDescription = sourceLine.description === line.description;
    const sameUnit = sourceLine.unit === line.unit;
    const samePrice = sourceLine.unit_price === line.unitPrice;
    const sameItem = (sourceLine.master_item_id ?? null) === line.masterItemId;
    if (!sameDescription || !sameUnit || !samePrice || !sameItem) {
      throw new Error('لا يمكن تغيير الصنف أو الوحدة أو السعر المنقول من المستند المصدر.');
    }
    if (type === 'work-order') {
      if (line.sourceWorkOrderLineId !== null || sourceLine.quantity !== line.quantity) {
        throw new Error('يجب الحفاظ على الكمية المتعاقد عليها المنقولة من المقايسة.');
      }
    } else if (type === 'certificate') {
      if (line.sourceWorkOrderLineId !== sourceLineId || sourceLine.quantity !== line.quantity) {
        throw new Error('بند المستخلص يجب أن يرتبط ببند أمر التشغيل وبكميته المتعاقد عليها.');
      }
    } else {
      if (line.sourceWorkOrderLineId !== sourceLine.source_work_order_line_id
        || sourceLine.current_quantity !== line.quantity) {
        throw new Error('كمية الفاتورة يجب أن تطابق الكمية الحالية في المستخلص المصدر.');
      }
    }
  }
  if (linkedIds.size !== sourceLines.length) throw new Error('يجب نقل جميع بنود المستند المصدر دون إسقاط أو تكرار.');
}

function createFrom(database: DatabaseSync, sourceIdValue: unknown, targetValue: unknown): SalesDocument {
  const sourceId = positiveId(sourceIdValue, 'رقم المستند المصدر');
  if (!isDocumentType(targetValue)) throw new Error('نوع المستند الناتج غير صالح.');
  const targetType = targetValue;
  return transaction(database, () => {
    const source = readDocument(database, sourceId);
    if (source.status !== 'approved') throw new Error('يجب اعتماد المستند المصدر قبل إنشاء المستند التالي.');
    const expectedTarget: Partial<Record<SalesDocumentType, SalesDocumentType>> = {
      estimate: 'work-order',
      'work-order': 'certificate',
      certificate: 'invoice',
    };
    if (expectedTarget[source.type] !== targetType) throw new Error('تسلسل مستندات المبيعات غير صالح.');
    if (targetType === 'invoice' && database.prepare(`
      SELECT 1 AS found FROM sales_documents
      WHERE source_document_id = ? AND document_type = 'invoice' AND status <> 'cancelled'
    `).get(source.id)) {
      throw new Error('يوجد بالفعل مستند فاتورة نشط لهذا المستخلص.');
    }
    const lines: SalesDocumentLineInput[] = source.lines.map((line) => ({
      sourceDocumentLineId: line.id,
      sourceWorkOrderLineId: targetType === 'certificate'
        ? line.id
        : targetType === 'invoice'
          ? line.sourceWorkOrderLineId
          : null,
      masterItemId: line.masterItemId,
      description: line.description,
      unit: line.unit,
      quantity: targetType === 'invoice' ? line.currentQuantity : line.quantity,
      currentQuantity: '0',
      unitPrice: line.unitPrice,
    }));
    if (targetType === 'invoice' && lines.some((line) => parseAmount(line.quantity) <= 0n)) {
      throw new Error('لا يمكن إنشاء فاتورة من مستخلص لا يحتوي كميات حالية موجبة.');
    }
    const accountingStatus = targetType === 'invoice' ? 'pending-rules' : 'not-applicable';
    const inserted = database.prepare(`
      INSERT INTO sales_documents (
        document_type, document_number, source_document_id, master_client_id,
        client_name, document_date, reference, notes, accounting_sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetType,
      '',
      source.id,
      source.masterClientId,
      source.clientName,
      localDateString(),
      '',
      '',
      accountingStatus,
    );
    const id = Number(inserted.lastInsertRowid);
    database.prepare('UPDATE sales_documents SET document_number = ? WHERE id = ?')
      .run(createNumber(database, targetType, id), id);
    insertLines(database, id, lines);
    return readDocument(database, id);
  });
}

function approveDocument(database: DatabaseSync, idValue: unknown): SalesDocument {
  const id = positiveId(idValue, 'رقم المستند');
  return transaction(database, () => {
    const document = readDocument(database, id);
    if (document.status !== 'draft') throw new Error('لا يمكن اعتماد هذا المستند في حالته الحالية.');
    if (document.type !== 'estimate' && !document.sourceDocumentId) {
      throw new Error('يجب إنشاء المستند من المستند السابق المعتمد في التسلسل.');
    }
    if (document.type === 'certificate' && document.lines.some((line) => parseAmount(line.currentQuantity) <= 0n)) {
      throw new Error('أدخل كمية حالية موجبة لكل بند في المستخلص قبل اعتماده.');
    }
    let journalEntryId: number | null = null;
    let customerAccountId: number | null = null;
    if (document.type === 'invoice') {
      if (document.masterClientId === null) throw new Error('لا يمكن اعتماد فاتورة دون عميل مرتبط بحساب ذمم.');
      const customer = database.prepare("SELECT status, account_id FROM customers WHERE id = ?")
        .get(document.masterClientId) as Row | undefined;
      if (!customer || customer.status !== 'active') throw new Error('العميل غير موجود أو غير نشط.');
      customerAccountId = requirePostingAccount(database,
        customer.account_id === null ? null : Number(customer.account_id), 'asset', 'ذمم العميل');
      const seenItems = new Set<number>();
      const revenueByAccount = new Map<number, bigint>();
      const lineAccount = new Map<number, number>();
      let total = 0n;
      for (const line of document.lines) {
        if (line.masterItemId === null) {
          throw new Error('اربط كل بند فاتورة بصنف له حساب مبيعات قبل الاعتماد؛ لا يوجد حساب افتراضي للبنود النصية.');
        }
        if (seenItems.has(line.masterItemId)) throw new Error('لا تكرر الصنف في فاتورة البيع؛ اجمع كميته في بند واحد.');
        seenItems.add(line.masterItemId);
        const item = database.prepare(`
          SELECT items.status, items.sellable, items.base_unit_id, units.name_ar AS unit_name, items.sales_account_id
          FROM inventory_items AS items INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
          WHERE items.id = ?
        `).get(line.masterItemId) as Row | undefined;
        if (!item || item.status !== 'active' || Number(item.sellable) !== 1) {
          throw new Error(`الصنف المرتبط ببند «${line.description}» غير نشط أو غير قابل للبيع.`);
        }
        if (String(item.unit_name) !== line.unit) throw new Error(`وحدة بند «${line.description}» لا تطابق الوحدة الأساسية للصنف.`);
        const revenueAccountId = requirePostingAccount(database,
          item.sales_account_id === null ? null : Number(item.sales_account_id), 'revenue', 'إيراد الصنف');
        const amount = parseAmount(line.amount);
        if (amount <= 0n) throw new Error(`قيمة بند «${line.description}» يجب أن تكون أكبر من صفر.`);
        total += amount;
        revenueByAccount.set(revenueAccountId, (revenueByAccount.get(revenueAccountId) ?? 0n) + amount);
        const row = database.prepare('SELECT id FROM sales_document_lines WHERE document_id = ? AND line_order = ?')
          .get(id, document.lines.indexOf(line) + 1) as Row | undefined;
        if (!row) throw new Error('تعذر تحديد بند الفاتورة لحفظ حساب المبيعات المرتبط.');
        lineAccount.set(Number(row.id), revenueAccountId);
      }
      if (total <= 0n) throw new Error('لا يمكن اعتماد فاتورة بإجمالي صفري.');
      const journalLines = [
        { accountId: customerAccountId, debit: formatAmount(total), credit: '0', description: 'ذمم العميل', costCenterId: null },
        ...[...revenueByAccount].map(([accountId, amount]) => ({
          accountId, debit: '0', credit: formatAmount(amount), description: 'إيراد المبيعات', costCenterId: null,
        })),
      ];
      journalEntryId = createAccountingJournal(database, `SALES-INV-${id}`, document.date,
        `فاتورة مبيعات ${document.number}`, journalLines);
      const updateLineAccount = database.prepare('UPDATE sales_document_lines SET posted_sales_account_id = ? WHERE id = ?');
      for (const [lineId, accountId] of lineAccount) updateLineAccount.run(accountId, lineId);
    }
    const inventoryStatus = document.type === 'work-order' ? 'pending-integration' : 'not-applicable';
    database.prepare(`
      UPDATE sales_documents
      SET status = 'approved', inventory_sync_status = ?, journal_entry_id = ?, posted_customer_account_id = ?,
        approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'draft'
    `).run(inventoryStatus, journalEntryId, customerAccountId, id);
    if (document.type === 'work-order') {
      database.prepare(`
        INSERT INTO sales_inventory_outbox (document_id, effect) VALUES (?, 'issue')
        ON CONFLICT(document_id, effect) DO NOTHING
      `).run(id);
    }
    return readDocument(database, id);
  });
}

function cancelDocument(database: DatabaseSync, idValue: unknown): SalesDocument {
  const id = positiveId(idValue, 'رقم المستند');
  return transaction(database, () => {
    const document = readDocument(database, id);
    if (document.status !== 'approved') throw new Error('يمكن إلغاء المستند المعتمد فقط.');
    const activeChild = database.prepare(`
      SELECT 1 AS found FROM sales_documents
      WHERE source_document_id = ? AND status <> 'cancelled' LIMIT 1
    `).get(id);
    const activeReturn = document.type === 'invoice'
      ? database.prepare("SELECT 1 AS found FROM sales_returns WHERE invoice_id = ? AND status <> 'cancelled' LIMIT 1").get(id)
      : undefined;
    if (activeChild || activeReturn) throw new Error('احذف المسودات التابعة أو ألغِ المستندات التابعة المعتمدة أولًا.');
    if (document.type === 'invoice') {
      const activeIssue = database.prepare("SELECT 1 AS found FROM inventory_issues WHERE sales_invoice_id = ? AND status <> 'cancelled' LIMIT 1")
        .get(id);
      if (activeIssue) throw new Error('ألغِ أذون الصرف المرتبطة بالفاتورة أولًا.');
    }
    const posting = database.prepare('SELECT journal_entry_id, reversal_journal_entry_id FROM sales_documents WHERE id = ?')
      .get(id) as Row | undefined;
    let reversalJournalEntryId: number | null = null;
    if (posting?.journal_entry_id !== null && posting?.journal_entry_id !== undefined
      && posting.reversal_journal_entry_id === null) {
      const reversalDate = firstOpenAccountingDate(database, new Date().toISOString().slice(0, 10));
      reversalJournalEntryId = reverseAccountingJournal(
        database, Number(posting.journal_entry_id), `SALES-INV-REV-${id}`, reversalDate, `عكس فاتورة مبيعات ${document.number}`,
      );
    }
    const inventoryStatus = document.type === 'work-order' ? 'reversal-pending-integration' : 'not-applicable';
    database.prepare(`
      UPDATE sales_documents
      SET status = 'cancelled', inventory_sync_status = ?, reversal_journal_entry_id = COALESCE(?, reversal_journal_entry_id),
        cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'approved'
    `).run(inventoryStatus, reversalJournalEntryId, id);
    if (document.type === 'work-order') {
      database.prepare(`
        INSERT INTO sales_inventory_outbox (document_id, effect) VALUES (?, 'reverse')
        ON CONFLICT(document_id, effect) DO NOTHING
      `).run(id);
    }
    return readDocument(database, id);
  });
}

function deleteDocument(database: DatabaseSync, idValue: unknown): boolean {
  const id = positiveId(idValue, 'رقم المستند');
  const result = database.prepare("DELETE FROM sales_documents WHERE id = ? AND status = 'draft'").run(id);
  if (result.changes === 0) throw new Error('يمكن حذف المسودة فقط؛ ألغِ المستند المعتمد بدل حذفه.');
  return true;
}

export function registerSalesHandlers(requireAuthentication: () => DatabaseSync): void {
  ipcMain.handle('sales:list', (_event, type: unknown) => {
    const database = requireAuthentication();
    if (!isDocumentType(type)) throw new Error('نوع مستند المبيعات غير صالح.');
    const rows = database.prepare(`
      SELECT id FROM sales_documents WHERE document_type = ?
      ORDER BY document_date DESC, id DESC
    `).all(type) as Row[];
    return rows.map((row) => readDocument(database, Number(row.id)));
  });
  ipcMain.handle('sales:save', (_event, value: unknown) => saveDocument(requireAuthentication(), value));
  ipcMain.handle('sales:create-from', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('بيانات تحويل المستند غير صالحة.');
    const input = value as { sourceId?: unknown; type?: unknown };
    return createFrom(requireAuthentication(), input.sourceId, input.type);
  });
  ipcMain.handle('sales:approve', (_event, id: unknown) => approveDocument(requireAuthentication(), id));
  ipcMain.handle('sales:cancel', (_event, id: unknown) => cancelDocument(requireAuthentication(), id));
  ipcMain.handle('sales:delete', (_event, id: unknown) => deleteDocument(requireAuthentication(), id));
}
