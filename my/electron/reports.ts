import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { ACCOUNT_TYPES, formatAmount, parseAmount } from '../src/shared/accounting.js';
import { MODULES } from '../src/shared/modules.js';
import {
  REPORT_DEFINITIONS,
  REPORT_STATUS_LABELS,
  defaultReportFilters,
  findReportDefinition,
  formatReportRange,
  type ReportDefinition,
  type ReportFilterOptions,
  type ReportLibrary,
  type ReportResult,
  type ReportRunFilters,
  type ReportSummaryCard,
} from '../src/shared/reports.js';

type Row = Record<string, SQLOutputValue>;
type Param = string | number;
type Cell = string | number;
type ReportBuild = { rows: Array<Record<string, string>>; totals: ReportSummaryCard[]; note: string };

const SCALE = 10n ** 12n;
const DOCUMENT_TYPES: Record<string, string> = {
  estimate: 'مقايسة', 'work-order': 'أمر تشغيل', certificate: 'مستخلص', invoice: 'فاتورة',
};
const MOVEMENT_TYPES: Record<string, string> = {
  opening: 'رصيد افتتاحي', receipt: 'استلام', issue: 'صرف', 'transfer-out': 'تحويل صادر',
  'transfer-in': 'تحويل وارد', transfer: 'تحويل', reversal: 'قيد عكسي',
};
const INSTALLMENT_FREQUENCY: Record<string, string> = {
  monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي',
  free: 'دفعة حرة', 'down-payment': 'مقدم',
};

function rows(database: DatabaseSync, sql: string, params: Param[] = []): Row[] {
  return database.prepare(sql).all(...params) as Row[];
}

function scalar(database: DatabaseSync, sql: string, params: Param[] = []): number {
  const row = database.prepare(sql).get(...params) as Row | undefined;
  return Number(Object.values(row ?? { value: 0 })[0] ?? 0);
}

function amount(value: unknown): bigint {
  const text = String(value ?? '').trim();
  if (!text) return 0n;
  try {
    return text.startsWith('-') ? -parseAmount(text.slice(1)) : parseAmount(text);
  } catch {
    return 0n;
  }
}

function money(value: bigint): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

function product(left: bigint, right: bigint): bigint {
  return (left * right) / SCALE;
}

function label(map: Record<string, string>, value: unknown): string {
  const key = String(value ?? '');
  return map[key] ?? (REPORT_STATUS_LABELS[key] ?? key);
}

function accountType(type: string): string {
  return ACCOUNT_TYPES.find(({ value }) => value === type)?.label ?? type;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function emptyPeriod(): ReportRunFilters {
  return { ...defaultReportFilters(), from: '', to: '' };
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function readFilters(value: unknown): ReportRunFilters {
  const defaults = defaultReportFilters();
  if (value === undefined || value === null) return defaults;
  if (typeof value !== 'object') throw new Error('فلاتر التقرير غير صالحة.');
  const input = value as Partial<Record<keyof ReportRunFilters, unknown>>;
  const text = (key: keyof ReportRunFilters): string => {
    const field = input[key];
    if (field === undefined || field === null) return '';
    if (typeof field !== 'string') throw new Error('فلاتر التقرير غير صالحة.');
    return field.trim();
  };
  const id = (key: keyof ReportRunFilters): number | null => {
    const field = input[key];
    if (field === undefined || field === null || field === '') return null;
    if (!Number.isSafeInteger(field) || Number(field) < 1) throw new Error('معرّف الفلتر غير صالح.');
    return Number(field);
  };
  const from = text('from');
  const to = text('to');
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) throw new Error('تاريخ الفلتر غير صالح.');
  if (from && to && from > to) throw new Error('تاريخ البداية لا يمكن أن يتجاوز تاريخ النهاية.');
  const treasury = text('treasury');
  if (treasury && !/^(cash|bank):\d{1,12}$/.test(treasury)) throw new Error('اختيار الخزينة أو البنك غير صالح.');
  const status = text('status');
  const installmentStatus = text('installmentStatus');
  if (status.length > 40 || installmentStatus.length > 40) throw new Error('قيمة فلتر الحالة غير صالحة.');
  return {
    from, to,
    customerId: id('customerId'),
    supplierId: id('supplierId'),
    accountId: id('accountId'),
    projectId: id('projectId'),
    costCenterId: id('costCenterId'),
    treasury,
    status,
    installmentStatus,
    itemId: id('itemId'),
    unitId: id('unitId'),
    assetGroupId: id('assetGroupId'),
  };
}

function treasuryParts(filters: ReportRunFilters): { kind: 'cash' | 'bank' | ''; id: number | null } {
  const match = /^(cash|bank):(\d+)$/.exec(filters.treasury);
  return match ? { kind: match[1] as 'cash' | 'bank', id: Number(match[2]) } : { kind: '', id: null };
}

interface LedgerLine {
  id: number;
  entryId: number;
  date: string;
  reference: string;
  entryDescription: string;
  description: string;
  debit: bigint;
  credit: bigint;
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  costCenterId: number | null;
  costCenterCode: string;
  costCenterName: string;
}

const LEDGER_SELECT = `
  SELECT lines.id, lines.entry_id, entries.entry_date, entries.reference, entries.description AS entry_description,
    lines.description AS line_description, lines.debit, lines.credit, lines.account_id,
    accounts.code AS account_code, accounts.name AS account_name, accounts.account_type,
    lines.cost_center_id, COALESCE(centers.code, '') AS center_code, COALESCE(centers.name, '') AS center_name
  FROM journal_lines AS lines
  INNER JOIN journal_entries AS entries ON entries.id = lines.entry_id
  INNER JOIN accounts ON accounts.id = lines.account_id
  LEFT JOIN cost_centers AS centers ON centers.id = lines.cost_center_id
  WHERE entries.status = 'posted'
`;

function ledgerLines(database: DatabaseSync, filters: ReportRunFilters, options: {
  accountId?: number | null;
  costCenterId?: number | null;
  ignoreFrom?: boolean;
  ignoreTo?: boolean;
} = {}): LedgerLine[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (!options.ignoreFrom && filters.from) { where.push('entries.entry_date >= ?'); params.push(filters.from); }
  if (!options.ignoreTo && filters.to) { where.push('entries.entry_date <= ?'); params.push(filters.to); }
  const accountId = options.accountId === undefined ? filters.accountId : options.accountId;
  if (accountId) { where.push('lines.account_id = ?'); params.push(accountId); }
  const costCenterId = options.costCenterId === undefined ? filters.costCenterId : options.costCenterId;
  if (costCenterId) { where.push('lines.cost_center_id = ?'); params.push(costCenterId); }
  const sql = `${LEDGER_SELECT}${where.length ? ` AND ${where.join(' AND ')}` : ''}
    ORDER BY entries.entry_date, entries.id, lines.line_order, lines.id`;
  return rows(database, sql, params).map((row) => ({
    id: Number(row.id),
    entryId: Number(row.entry_id),
    date: String(row.entry_date),
    reference: String(row.reference),
    entryDescription: String(row.entry_description),
    description: String(row.line_description),
    debit: amount(row.debit),
    credit: amount(row.credit),
    accountId: Number(row.account_id),
    accountCode: String(row.account_code),
    accountName: String(row.account_name),
    accountType: String(row.account_type),
    costCenterId: row.cost_center_id === null || row.cost_center_id === undefined ? null : Number(row.center_id ?? row.cost_center_id),
    costCenterCode: String(row.center_code),
    costCenterName: String(row.center_name),
  }));
}

function build(def: ReportDefinition, buildResult: ReportBuild, filters: ReportRunFilters, entityName: string): ReportResult {
  return {
    key: def.key,
    title: def.title,
    description: def.description,
    group: def.group,
    generatedAt: new Date().toISOString(),
    from: filters.from,
    to: filters.to,
    columns: def.columns,
    rows: buildResult.rows,
    totals: buildResult.totals,
    footer: [
      { key: 'الفترة', value: formatReportRange(filters.from, filters.to) },
      { key: 'المنشأة', value: entityName },
      { key: 'عدد السجلات', value: String(buildResult.rows.length) },
    ],
    note: buildResult.note,
  };
}

function card(label: string, value: string, tone?: ReportSummaryCard['tone']): ReportSummaryCard {
  return { label, value, ...(tone ? { tone } : {}) };
}

function entityName(database: DatabaseSync): string {
  try {
    const row = database.prepare(`SELECT value FROM app_settings WHERE key IN ('company_name', 'companyName', 'company')
      ORDER BY CASE key WHEN 'company_name' THEN 0 WHEN 'companyName' THEN 1 ELSE 2 END LIMIT 1`).get() as Row | undefined;
    const value = row?.value === undefined ? '' : String(row.value).trim();
    return value || 'Elsaad ERP';
  } catch {
    return 'Elsaad ERP';
  }
}

function moduleLabel(module: unknown): string {
  return MODULES.find(({ key }) => key === String(module))?.label ?? String(module ?? '');
}

// ── التقارير العامة ──────────────────────────────────────────────────

function systemOverview(database: DatabaseSync): ReportBuild {
  const accountsCount = scalar(database, 'SELECT COUNT(*) AS value FROM accounts');
  const journalCount = scalar(database, "SELECT COUNT(*) AS value FROM journal_entries WHERE status = 'posted'");
  const journalDebit = ledgerLines(database, emptyPeriod(), { ignoreFrom: true, ignoreTo: true }).reduce((total, line) => total + line.debit, 0n);
  const customersCount = scalar(database, 'SELECT COUNT(*) AS value FROM customers');
  const suppliersCount = scalar(database, 'SELECT COUNT(*) AS value FROM suppliers');
  const itemsCount = scalar(database, 'SELECT COUNT(*) AS value FROM inventory_items');
  const warehousesCount = scalar(database, 'SELECT COUNT(*) AS value FROM warehouses');
  const salesCount = scalar(database, 'SELECT COUNT(*) AS value FROM sales_documents');
  const salesTotal = rows(database, `SELECT quantity, unit_price FROM sales_document_lines`).reduce((total, line) => total + product(amount(line.quantity), amount(line.unit_price)), 0n);
  const purchaseCount = scalar(database, 'SELECT COUNT(*) AS value FROM purchase_invoices');
  const purchaseTotal = rows(database, `SELECT quantity, unit_price FROM purchase_invoice_lines`).reduce((total, line) => total + product(amount(line.quantity), amount(line.unit_price)), 0n);
  const expenseCount = scalar(database, 'SELECT COUNT(*) AS value FROM expenses');
  const expenseTotal = rows(database, 'SELECT total_amount FROM expenses').reduce((total, row) => total + amount(row.total_amount), 0n);
  const voucherCount = scalar(database, 'SELECT COUNT(*) AS value FROM financial_vouchers');
  const voucherTotal = rows(database, 'SELECT amount FROM financial_vouchers').reduce((total, row) => total + amount(row.amount), 0n);
  const projectsCount = scalar(database, 'SELECT COUNT(*) AS value FROM projects');
  const contractorContractCount = scalar(database, 'SELECT COUNT(*) AS value FROM contractor_contracts');
  const contractorContractTotal = rows(database, 'SELECT total FROM contractor_contracts').reduce((total, row) => total + amount(row.total), 0n);
  const assetCount = scalar(database, 'SELECT COUNT(*) AS value FROM fixed_assets');
  const assetTotal = rows(database, 'SELECT purchase_value FROM fixed_assets').reduce((total, row) => total + amount(row.purchase_value), 0n);
  const propertyContractCount = scalar(database, 'SELECT COUNT(*) AS value FROM property_contracts');
  const propertyContractTotal = rows(database, 'SELECT original_price, discount, fees FROM property_contracts')
    .reduce((total, row) => total + amount(row.original_price) - amount(row.discount) + amount(row.fees), 0n);
  const installmentCount = scalar(database, 'SELECT COUNT(*) AS value FROM property_installments');
  const installmentTotal = rows(database, 'SELECT amount FROM property_installments').reduce((total, row) => total + amount(row.amount), 0n);
  const receiptCount = scalar(database, 'SELECT COUNT(*) AS value FROM property_receipts');
  const receiptTotal = rows(database, 'SELECT amount FROM property_receipts').reduce((total, row) => total + amount(row.amount), 0n);
  const movementCount = scalar(database, 'SELECT COUNT(*) AS value FROM inventory_stock_movements');

  const sections: Array<[string, number, bigint | null, string]> = [
    ['الدليل المحاسبي', accountsCount, null, 'الحسابات المسجلة'],
    ['القيود اليومية المرحلة', journalCount, journalDebit, 'إجمالي المدين'],
    ['العملاء', customersCount, null, 'البيانات الأساسية'],
    ['الموردون', suppliersCount, null, 'البيانات الأساسية'],
    ['المخازن', warehousesCount, null, 'البيانات الأساسية'],
    ['الأصناف', itemsCount, null, 'البيانات الأساسية'],
    ['مستندات المبيعات', salesCount, salesTotal, 'قيمة البنود'],
    ['فواتير المشتريات', purchaseCount, purchaseTotal, 'قيمة البنود'],
    ['سندات القبض والسداد', voucherCount, voucherTotal, 'إجمالي المبالغ'],
    ['المصروفات', expenseCount, expenseTotal, 'الإجمالي'],
    ['المشروعات', projectsCount, null, 'البيانات التشغيلية'],
    ['عقود المقاولين', contractorContractCount, contractorContractTotal, 'قيمة العقود'],
    ['الأصول الثابتة', assetCount, assetTotal, 'قيمة الشراء'],
    ['عقود بيع الوحدات', propertyContractCount, propertyContractTotal, 'قيمة العقود'],
    ['أقساط العملاء', installmentCount, installmentTotal, 'إجمالي الأقساط'],
    ['تحصيلات العقود', receiptCount, receiptTotal, 'إجمالي التحصيل'],
    ['حركات المخزون', movementCount, null, 'افتتاحي/استلام/صرف/تحويل'],
  ];
  const totalRecords = sections.reduce((total, [, count]) => total + count, 0);
  const activeSections = sections.filter(([, count]) => count > 0).length;
  return {
    rows: sections.map(([section, count, total, extra]) => ({
      section,
      records: String(count),
      amount: total === null ? '—' : money(total),
      extra,
    })),
    totals: [card('الوحدات المشمولة', String(activeSections)), card('إجمالي السجلات', String(totalRecords))],
    note: 'الملخص شامل لكل بيانات النظام بغض النظر عن الفترة، ويُظهر الوحدات التي تحتوي سجلات فقط عند وجود بيانات. مبالغ الفواتير محسوبة من بنودها.',
  };
}

function recordsLog(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('substr(date, 1, 10) >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('substr(date, 1, 10) <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT * FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, id DESC`, params);
  return {
    rows: data.map((row) => ({
      date: String(row.date ?? ''),
      module: moduleLabel(row.module),
      title: String(row.title ?? ''),
      party: String(row.party ?? ''),
      reference: String(row.reference ?? ''),
      amount: String(row.amount ?? ''),
      status: label({}, row.status),
    })),
    totals: [card('عدد السجلات', String(data.length), data.length ? 'neutral' : 'negative')],
    note: 'السجلات تعرض القيمة كما أُدخلت في قسمها، وتشمل كل السجلات بغض النظر عن حالتها وفق الفلتر.',
  };
}

function masterData(database: DatabaseSync): ReportBuild {
  const data: Array<Record<string, string>> = [];
  const push = (type: string, code: unknown, name: unknown, detail: unknown, status: unknown): void => {
    data.push({ type, code: String(code ?? ''), name: String(name ?? ''), detail: String(detail ?? ''), status: label({ active: 'نشط', inactive: 'موقوف' }, status) });
  };
  for (const row of rows(database, 'SELECT accounts.code, accounts.name, accounts.account_type, accounts.postable FROM accounts ORDER BY accounts.code')) {
    push('حساب محاسبي', row.code, row.name, `${accountType(String(row.account_type))} · ${Number(row.postable) === 1 ? 'قابل للترحيل' : 'حساب رئيسي'}`, 'active');
  }
  for (const row of rows(database, 'SELECT customers.*, groups.name_ar AS group_name FROM customers LEFT JOIN customer_groups AS groups ON groups.id = customers.group_id ORDER BY customers.code')) {
    push('عميل', row.code, row.name, `المجموعة: ${String(row.group_name ?? '—')} · ${String(row.phone ?? '')}`, row.status);
  }
  for (const row of rows(database, 'SELECT suppliers.*, groups.name_ar AS group_name FROM suppliers LEFT JOIN supplier_groups AS groups ON groups.id = suppliers.group_id ORDER BY suppliers.code')) {
    push('مورد', row.code, row.name, `المجموعة: ${String(row.group_name ?? '—')} · ${String(row.phone ?? '')}`, row.status);
  }
  for (const row of rows(database, 'SELECT items.code, items.name_ar, items.status, units.name_ar AS unit FROM inventory_items AS items LEFT JOIN inventory_units AS units ON units.id = items.base_unit_id ORDER BY items.code')) {
    push('صنف', row.code, row.name_ar, `الوحدة: ${String(row.unit ?? '—')}`, row.status);
  }
  for (const row of rows(database, 'SELECT code, name, status FROM projects ORDER BY code')) push('مشروع', row.code, row.name, 'وحدة المشروعات', row.status);
  for (const row of rows(database, 'SELECT code, name, postable FROM cost_centers ORDER BY code')) {
    push('مركز تكلفة', row.code, row.name, Number(row.postable) === 1 ? 'قابل للترحيل' : 'مركز رئيسي', 'active');
  }
  for (const row of rows(database, 'SELECT code, name FROM warehouses ORDER BY code')) push('مخزن', row.code, row.name, 'وحدة المخزون', 'active');
  for (const row of rows(database, 'SELECT code, name FROM asset_groups ORDER BY code')) push('مجموعة أصول', row.code, row.name, 'وحدة الأصول', 'active');
  return {
    rows: data,
    totals: [card('إجمالي السجلات', String(data.length)), card('أنواع البيانات', String(new Set(data.map((row) => row.type)).size))],
    note: 'تقرير مرجعي للبيانات الأساسية كما هي مسجلة؛ لا يحتسب أرصدة أو مبالغ.',
  };
}

function activityLog(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('substr(updated_at, 1, 10) >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('substr(updated_at, 1, 10) <= ?'); params.push(filters.to); }
  const data = rows(database, `SELECT * FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`, params);
  return {
    rows: data.map((row) => ({
      updated: String(row.updated_at ?? '').replace(' ', ' '),
      module: moduleLabel(row.module),
      title: String(row.title ?? ''),
      reference: String(row.reference ?? ''),
      status: label({}, row.status),
      created: String(row.created_at ?? ''),
    })),
    totals: [card('تغييرات خلال الفترة', String(data.length))],
    note: 'يعتمد التقرير على تاريخ آخر تحديث للسجل، وقد يظهر السجل أكثر من مرة إذا عُدّل في فترات مختلفة.',
  };
}

// ── التقارير المحاسبية ──────────────────────────────────────────────

function chartOfAccounts(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const params: Param[] = [];
  let where = '';
  if (filters.accountId) { where = 'WHERE accounts.id = ?'; params.push(filters.accountId); }
  const data = rows(database, `SELECT accounts.*, parents.code AS parent_code, parents.name AS parent_name,
    (SELECT COUNT(*) FROM accounts AS children WHERE children.parent_id = accounts.id) AS child_count
    FROM accounts LEFT JOIN accounts AS parents ON parents.id = accounts.parent_id ${where}
    ORDER BY accounts.code`, params);
  return {
    rows: data.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      type: accountType(String(row.account_type)),
      parent: row.parent_code ? `${String(row.parent_code)} — ${String(row.parent_name)}` : '—',
      postable: Number(row.postable) === 1 ? 'نعم' : 'لا (حساب رئيسي)',
      notes: `${String(row.name_en ?? '')}${Number(row.child_count) ? ` · ${String(row.child_count)} حساب فرعي` : ''}`,
    })),
    totals: [card('عدد الحسابات', String(data.length)), card('قابلة للترحيل', String(data.filter((row) => Number(row.postable) === 1).length))],
    note: 'الحسابات الرئيسية غير القابلة للترحيل تُعرض للدليل فقط ولا تُستخدم في القيود.',
  };
}

function accountBalances(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, filters);
  const grouped = new Map<number, { code: string; name: string; type: string; debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = grouped.get(line.accountId) ?? { code: line.accountCode, name: line.accountName, type: line.accountType, debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    grouped.set(line.accountId, entry);
  }
  const data = [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code));
  const totalDebit = data.reduce((total, entry) => total + entry.debit, 0n);
  const totalCredit = data.reduce((total, entry) => total + entry.credit, 0n);
  return {
    rows: data.map((entry) => ({
      code: entry.code,
      name: entry.name,
      type: accountType(entry.type),
      debit: money(entry.debit),
      credit: money(entry.credit),
      balance: money(entry.debit - entry.credit),
    })),
    totals: [card('مدين', money(totalDebit)), card('دائن', money(totalCredit)), card('الفرق', money(totalDebit - totalCredit), totalDebit === totalCredit ? 'positive' : 'negative')],
    note: 'الأرصدة محسوبة من القيود المرحلة فقط. الرصيد الموجب مدين والسالبة دائن.',
  };
}

function generalLedger(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, filters);
  const running = new Map<number, bigint>();
  const data = lines.map((line) => {
    const balance = (running.get(line.accountId) ?? 0n) + line.debit - line.credit;
    running.set(line.accountId, balance);
    return {
      date: line.date,
      reference: line.reference,
      account: `${line.accountCode} — ${line.accountName}`,
      description: [line.entryDescription, line.description].filter(Boolean).join(' · '),
      costCenter: line.costCenterName ? `${line.costCenterCode} — ${line.costCenterName}` : '—',
      debit: money(line.debit),
      credit: money(line.credit),
      balance: money(balance),
    };
  });
  const totalDebit = lines.reduce((total, line) => total + line.debit, 0n);
  const totalCredit = lines.reduce((total, line) => total + line.credit, 0n);
  return {
    rows: data,
    totals: [card('عدد الأسطر', String(data.length)), card('مدين', money(totalDebit)), card('دائن', money(totalCredit))],
    note: 'الرصيد الجاري يُحتسب لكل حساب على حدة حسب تسلسل تاريخ القيد ورقمه.',
  };
}

function trialBalance(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null }, { ignoreFrom: true });
  const grouped = new Map<number, { code: string; name: string; type: string; debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = grouped.get(line.accountId) ?? { code: line.accountCode, name: line.accountName, type: line.accountType, debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    grouped.set(line.accountId, entry);
  }
  const data = [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code));
  const balances = data.map((entry) => ({ ...entry, balance: entry.debit - entry.credit }));
  const totalDebit = balances.reduce((total, entry) => total + (entry.balance > 0n ? entry.balance : 0n), 0n);
  const totalCredit = balances.reduce((total, entry) => total + (entry.balance < 0n ? -entry.balance : 0n), 0n);
  return {
    rows: balances.map((entry) => ({
      code: entry.code, name: entry.name, type: accountType(entry.type),
      debit: money(entry.balance > 0n ? entry.balance : 0n),
      credit: money(entry.balance < 0n ? -entry.balance : 0n),
      balance: money(entry.balance),
    })),
    totals: [
      card('إجمالي المدين', money(totalDebit)), card('إجمالي الدائن', money(totalCredit)),
      card('الفرق', money(totalDebit - totalCredit), totalDebit === totalCredit ? 'positive' : 'negative'),
    ],
    note: totalDebit === totalCredit
      ? 'الأرصدة الختامية محسوبة من جميع القيود المرحلة حتى تاريخ النهاية؛ تاريخ البداية لا يؤثر على ميزان المراجعة. إجمالي المدين يساوي إجمالي الدائن.'
      : 'تنبيه: يوجد فرق بين الأرصدة المدينة والدائنة حتى تاريخ النهاية، راجع القيود المرحلة.',
  };
}

function journalEntriesReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, { ...filters, accountId: null });
  const grouped = new Map<number, { date: string; reference: string; description: string; lines: number; debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = grouped.get(line.entryId) ?? { date: line.date, reference: line.reference, description: line.entryDescription, lines: 0, debit: 0n, credit: 0n };
    entry.lines += 1;
    entry.debit += line.debit;
    entry.credit += line.credit;
    grouped.set(line.entryId, entry);
  }
  const data = [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
  return {
    rows: data.map((entry) => ({
      date: entry.date, reference: entry.reference || '—', description: entry.description,
      lines: String(entry.lines), debit: money(entry.debit), credit: money(entry.credit),
    })),
    totals: [card('عدد القيود', String(data.length)), card('مدين', money(data.reduce((total, entry) => total + entry.debit, 0n))), card('دائن', money(data.reduce((total, entry) => total + entry.credit, 0n)))],
    note: 'تُعرض القيود المرحلة فقط، مجمعة حسب رقم القيد المحاسبي.',
  };
}

function accountMovement(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const data = rows(database, `SELECT accounts.id, accounts.code, accounts.name, accounts.account_type FROM accounts
    WHERE accounts.postable = 1 ${filters.accountId ? 'AND accounts.id = ?' : ''} ORDER BY accounts.code`,
  filters.accountId ? [filters.accountId] : []);
  const all = ledgerLines(database, { ...filters, accountId: null, costCenterId: null }, { ignoreFrom: true });
  const opening = new Map<number, bigint>();
  const period = new Map<number, { debit: bigint; credit: bigint }>();
  for (const line of all) {
    const target = filters.from && line.date < filters.from ? opening : null;
    if (target !== null) {
      opening.set(line.accountId, (opening.get(line.accountId) ?? 0n) + line.debit - line.credit);
    } else {
      const entry = period.get(line.accountId) ?? { debit: 0n, credit: 0n };
      entry.debit += line.debit;
      entry.credit += line.credit;
      period.set(line.accountId, entry);
    }
  }
  const rowsData = data.map((row) => {
    const id = Number(row.id);
    const openingBalance = opening.get(id) ?? 0n;
    const movement = period.get(id) ?? { debit: 0n, credit: 0n };
    return {
      code: String(row.code), name: String(row.name), type: accountType(String(row.account_type)),
      opening: money(openingBalance), debit: money(movement.debit), credit: money(movement.credit),
      closing: money(openingBalance + movement.debit - movement.credit),
      _opening: openingBalance, _debit: movement.debit, _credit: movement.credit,
    };
  });
  const totals = rowsData.reduce((total, row) => ({
    opening: total.opening + row._opening, debit: total.debit + row._debit, credit: total.credit + row._credit,
  }), { opening: 0n, debit: 0n, credit: 0n });
  return {
    rows: rowsData.map(({ _opening, _debit, _credit, ...row }) => row),
    totals: [card('أول المدة', money(totals.opening)), card('مدين', money(totals.debit)), card('دائن', money(totals.credit)), card('آخر المدة', money(totals.opening + totals.debit - totals.credit))],
    note: 'رصيد أول المدة يُحتسب من القيود المرحلة قبل تاريخ البداية، وآخر المدة = أول المدة + المدين − الدائن.',
  };
}

function receivablesPayables(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const parties = rows(database, `SELECT 'customer' AS kind, customers.code, customers.name, customers.account_id FROM customers WHERE customers.account_id IS NOT NULL
    UNION ALL SELECT 'supplier' AS kind, suppliers.code, suppliers.name, suppliers.account_id FROM suppliers WHERE suppliers.account_id IS NOT NULL`);
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null });
  const balances = new Map<number, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = balances.get(line.accountId) ?? { debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    balances.set(line.accountId, entry);
  }
  const data = parties.map((party) => {
    const balance = balances.get(Number(party.account_id)) ?? { debit: 0n, credit: 0n };
    return {
      type: party.kind === 'customer' ? 'عميل' : 'مورد',
      code: String(party.code), name: String(party.name),
      debit: money(balance.debit), credit: money(balance.credit), balance: money(balance.debit - balance.credit),
      _debit: balance.debit, _credit: balance.credit,
    };
  });
  return {
    rows: data.map(({ _debit, _credit, ...row }) => row),
    totals: [
      card('إجمالي المدين', money(data.reduce((total, row) => total + row._debit, 0n))),
      card('إجمالي الدائن', money(data.reduce((total, row) => total + row._credit, 0n))),
      card('صافي الأرصدة', money(data.reduce((total, row) => total + row._debit - row._credit, 0n))),
    ],
    note: 'يشمل العملاء والموردين المرتبطين بحسابات محاسبية فقط. الرصيد الموجب مدين لصالح المنشأة.',
  };
}

function costCentersReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, { ...filters, accountId: null });
  const grouped = new Map<string, { code: string; name: string; debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const key = line.costCenterId === null ? 'none' : String(line.costCenterId);
    const entry = grouped.get(key) ?? { code: line.costCenterCode || '—', name: line.costCenterName || 'بدون مركز تكلفة', debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    grouped.set(key, entry);
  }
  const data = [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code));
  const totalDebit = data.reduce((total, entry) => total + entry.debit, 0n);
  const totalCredit = data.reduce((total, entry) => total + entry.credit, 0n);
  return {
    rows: data.map((entry) => ({ code: entry.code, name: entry.name, debit: money(entry.debit), credit: money(entry.credit), balance: money(entry.debit - entry.credit) })),
    totals: [card('إجمالي المدين', money(totalDebit)), card('إجمالي الدائن', money(totalCredit))],
    note: 'حركات القيود التي لا تحمل مركز تكلفة تُجمع في صف «بدون مركز تكلفة».',
  };
}

function budgetComparison(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const budgets = rows(database, `SELECT * FROM budgets ${filters.from ? 'WHERE ends_on >= ?' : ''} ${filters.from && filters.to ? 'AND' : ''} ${filters.to ? 'starts_on <= ?' : ''} ORDER BY starts_on DESC, id`, [
    ...(filters.from ? [filters.from] : []), ...(filters.to ? [filters.to] : []),
  ]);
  if (!budgets.length) {
    return { rows: [], totals: [card('عدد البنود', '0')], note: 'لا توجد موازنات تقديرية في الفترة المحددة.' };
  }
  const allLines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null }, { ignoreFrom: true, ignoreTo: true });
  const data: Array<Record<string, string>> = [];
  let totalBudget = 0n;
  let totalActual = 0n;
  for (const budget of budgets) {
    const budgetFrom = String(budget.starts_on);
    const budgetTo = String(budget.ends_on);
    const effectiveFrom = filters.from && filters.from > budgetFrom ? filters.from : budgetFrom;
    const effectiveTo = filters.to && filters.to < budgetTo ? filters.to : budgetTo;
    const budgetLines = rows(database, `SELECT lines.*, accounts.code, accounts.name AS account_name FROM budget_lines AS lines
      INNER JOIN accounts ON accounts.id = lines.account_id WHERE lines.budget_id = ? ORDER BY lines.id`, [Number(budget.id)]);
    for (const line of budgetLines) {
      if (filters.accountId && Number(line.account_id) !== filters.accountId) continue;
      const actual = allLines
        .filter((entry) => entry.accountId === Number(line.account_id)
          && entry.date >= effectiveFrom && entry.date <= effectiveTo
          && (!line.cost_center_id || entry.costCenterId === Number(line.cost_center_id)))
        .reduce((total, entry) => total + entry.debit - entry.credit, 0n);
      const budgetAmount = amount(line.amount);
      const variance = budgetAmount - actual;
      totalBudget += budgetAmount;
      totalActual += actual;
      data.push({
        budget: `${String(budget.number)} (${budgetFrom} → ${budgetTo})`,
        account: `${String(line.code)} — ${String(line.account_name)}`,
        category: label({ sales: 'مبيعات', 'cash-purchases': 'مشتريات نقدية', 'cash-expenses': 'مصروفات نقدية' }, line.category),
        budgetAmount: money(budgetAmount),
        actual: money(actual),
        variance: money(variance),
        usage: budgetAmount === 0n ? '—' : `${((Number(actual) / Number(budgetAmount)) * 100).toFixed(1)}%`,
      });
    }
  }
  return {
    rows: data,
    totals: [card('إجمالي المقدّر', money(totalBudget)), card('إجمالي الفعلي', money(totalActual)), card('الفرق', money(totalBudget - totalActual), totalBudget - totalActual >= 0n ? 'positive' : 'negative')],
    note: 'الفعلي يُحتسب من صافي المدين على الحساب داخل فترة الموازنة المتقاطعة مع الفترة المحددة. قد تختلف طبيعة الحسابات بين الإيراد والمصروف.',
  };
}

// ── التقارير المالية ────────────────────────────────────────────────

function treasuryMovements(database: DatabaseSync, filters: ReportRunFilters, kind: 'cash' | 'bank'): ReportBuild {
  const table = kind === 'cash' ? 'treasury_cash_boxes' : 'treasury_bank_accounts';
  const accounts = rows(database, `SELECT boxes.id, boxes.name, boxes.account_id, boxes.opening_balance, boxes.opening_date,
    accounts.code, accounts.name AS account_name FROM ${table} AS boxes INNER JOIN accounts ON accounts.id = boxes.account_id ORDER BY boxes.code`);
  const selected = treasuryParts(filters);
  const chosen = selected.kind && selected.kind !== kind ? [] : accounts.filter((box) => !selected.id || Number(box.id) === selected.id);
  const ids = new Set(chosen.map((box) => Number(box.account_id)));
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null }, { ignoreFrom: true })
    .filter((line) => ids.has(line.accountId));
  const openingByAccount = new Map<number, bigint>();
  const running = new Map<number, bigint>();
  for (const box of chosen) {
    const id = Number(box.account_id);
    const opening = amount(box.opening_balance)
      + lines.filter((line) => line.accountId === id && filters.from && line.date < filters.from).reduce((total, line) => total + line.debit - line.credit, 0n);
    openingByAccount.set(id, opening);
    running.set(id, opening);
  }
  const periodLines = lines.filter((line) => (!filters.from || line.date >= filters.from) && (!filters.to || line.date <= filters.to));
  const accountNames = new Map(chosen.map((box) => [Number(box.account_id), String(box.name)]));
  const data = periodLines.map((line) => {
    const balance = (running.get(line.accountId) ?? 0n) + line.debit - line.credit;
    running.set(line.accountId, balance);
    return {
      date: line.date,
      treasury: accountNames.get(line.accountId) ?? line.accountName,
      reference: line.reference,
      description: [line.entryDescription, line.description].filter(Boolean).join(' · '),
      debit: money(line.debit), credit: money(line.credit), balance: money(balance),
    };
  });
  const totalDebit = periodLines.reduce((total, line) => total + line.debit, 0n);
  const totalCredit = periodLines.reduce((total, line) => total + line.credit, 0n);
  return {
    rows: data,
    totals: [card(kind === 'cash' ? 'إجمالي القبض' : 'إجمالي الإيداع', money(totalDebit)), card(kind === 'cash' ? 'إجمالي الصرف' : 'إجمالي السحب', money(totalCredit)), card('صافي الحركة', money(totalDebit - totalCredit))],
    note: 'الرصيد الجاري يبدأ بالرصيد الافتتاحي المسجل للخزينة مضافًا إليه حركة القيود السابقة للفترة.',
  };
}

function treasuryBalances(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const parts: Array<{ type: string; name: string; code: string; accountName: string; opening: bigint; accountId: number; id: number; kind: 'cash' | 'bank' }> = [];
  for (const row of rows(database, `SELECT boxes.*, accounts.code, accounts.name AS account_name FROM treasury_cash_boxes AS boxes INNER JOIN accounts ON accounts.id = boxes.account_id ORDER BY boxes.code`)) {
    parts.push({ type: 'خزينة', name: String(row.name), code: String(row.code), accountName: `${String(row.code)} — ${String(row.account_name)}`, opening: amount(row.opening_balance), accountId: Number(row.account_id), id: Number(row.id), kind: 'cash' });
  }
  for (const row of rows(database, `SELECT banks.*, accounts.code, accounts.name AS account_name FROM treasury_bank_accounts AS banks INNER JOIN accounts ON accounts.id = banks.account_id ORDER BY banks.code`)) {
    parts.push({ type: 'بنك', name: String(row.name), code: String(row.code), accountName: `${String(row.code)} — ${String(row.account_name)}`, opening: amount(row.opening_balance), accountId: Number(row.account_id), id: Number(row.id), kind: 'bank' });
  }
  const selected = treasuryParts(filters);
  const chosen = parts.filter((part) => (!selected.kind || (selected.kind === part.kind && (!selected.id || selected.id === part.id))));
  const ids = new Set(chosen.map((part) => part.accountId));
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null }, { ignoreFrom: true }).filter((line) => ids.has(line.accountId));
  const data = chosen.map((part) => {
    const accountLines = lines.filter((line) => line.accountId === part.accountId);
    const periodLines = accountLines.filter((line) => (!filters.from || line.date >= filters.from) && (!filters.to || line.date <= filters.to));
    const debit = periodLines.reduce((total, line) => total + line.debit, 0n);
    const credit = periodLines.reduce((total, line) => total + line.credit, 0n);
    const allMovement = accountLines.filter((line) => !filters.to || line.date <= filters.to).reduce((total, line) => total + line.debit - line.credit, 0n);
    return {
      type: part.type, name: part.name, account: part.accountName,
      opening: money(part.opening), debit: money(debit), credit: money(credit),
      closing: money(part.opening + allMovement), _closing: part.opening + allMovement,
    };
  });
  return {
    rows: data.map(({ _closing, ...row }) => row),
    totals: [card('عدد الخزائن والبنوك', String(data.length)), card('إجمالي الأرصدة الحالية', money(data.reduce((total, row) => total + row._closing, 0n)))],
    note: 'الرصيد الحالي = الرصيد الافتتاحي المسجل + صافي حركة القيود المرحلة على حساب الخزينة حتى نهاية الفترة.',
  };
}

function receiptsPayments(database: DatabaseSync, filters: ReportRunFilters, partyKind?: 'customer' | 'supplier'): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('vouchers.voucher_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('vouchers.voucher_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('vouchers.customer_id = ?'); params.push(filters.customerId); }
  if (filters.supplierId) { where.push('vouchers.supplier_id = ?'); params.push(filters.supplierId); }
  if (partyKind === 'customer') where.push("vouchers.party_kind = 'customer'");
  if (partyKind === 'supplier') where.push("vouchers.party_kind = 'supplier'");
  if (filters.status) { where.push('vouchers.status = ?'); params.push(filters.status); }
  const selected = treasuryParts(filters);
  if (selected.kind) {
    where.push('vouchers.payment_method = ?');
    params.push(selected.kind);
    if (selected.id) {
      where.push(selected.kind === 'cash' ? 'vouchers.cash_box_id = ?' : 'vouchers.bank_account_id = ?');
      params.push(selected.id);
    }
  }
  const data = rows(database, `SELECT vouchers.*, COALESCE(customers.name, suppliers.name) AS party_name
    FROM financial_vouchers AS vouchers
    LEFT JOIN customers ON customers.id = vouchers.customer_id
    LEFT JOIN suppliers ON suppliers.id = vouchers.supplier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY vouchers.voucher_date, vouchers.id`, params);
  const receipts = data.filter((row) => row.voucher_type === 'receipt').reduce((total, row) => total + amount(row.amount), 0n);
  const payments = data.filter((row) => row.voucher_type === 'payment').reduce((total, row) => total + amount(row.amount), 0n);
  const totals: ReportSummaryCard[] = [card('عدد السندات', String(data.length)), card('المقبوضات', money(receipts)), card('المدفوعات', money(payments)), card('الصافي', money(receipts - payments), receipts - payments >= 0n ? 'positive' : 'negative')];
  return {
    rows: data.map((row) => ({
      number: String(row.number),
      date: String(row.voucher_date),
      type: row.voucher_type === 'receipt' ? 'قبض' : 'سداد',
      party: String(row.party_name ?? ''),
      method: row.payment_method === 'cash' ? 'نقدي' : 'بنكي',
      reference: String(row.reference ?? ''),
      amount: money(amount(row.amount)),
      status: label({}, row.status),
    })),
    totals,
    note: 'السندات المسودة لا تؤثر على الحسابات حتى تُرحّل. الإجماليات تشمل كل السندات الظاهرة وفق فلتر الحالة.',
  };
}

function revenueExpense(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null })
    .filter((line) => line.accountType === 'revenue' || line.accountType === 'expense');
  const grouped = new Map<number, { code: string; name: string; type: string; debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = grouped.get(line.accountId) ?? { code: line.accountCode, name: line.accountName, type: line.accountType, debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    grouped.set(line.accountId, entry);
  }
  const data = [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code));
  let revenue = 0n;
  let expense = 0n;
  for (const entry of data) {
    if (entry.type === 'revenue') revenue += entry.credit - entry.debit; else expense += entry.debit - entry.credit;
  }
  return {
    rows: data.map((entry) => ({
      type: entry.type === 'revenue' ? 'إيراد' : 'مصروف', code: entry.code, name: entry.name,
      debit: money(entry.debit), credit: money(entry.credit),
      net: money(entry.type === 'revenue' ? entry.credit - entry.debit : entry.debit - entry.credit),
    })),
    totals: [card('الإيرادات', money(revenue), 'positive'), card('المصروفات', money(expense), 'negative'), card('الصافي', money(revenue - expense), revenue - expense >= 0n ? 'positive' : 'negative')],
    note: 'الصافي لكل حساب موجب في طبيعته: الإيراد بدائن والمصروف بمدين. لا تُحتسب ضرائب أو تسويات غير مرحّلة.',
  };
}

function expensesReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('expenses.expense_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('expenses.expense_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('expenses.project_id = ?'); params.push(filters.projectId); }
  if (filters.costCenterId) { where.push('expenses.cost_center_id = ?'); params.push(filters.costCenterId); }
  if (filters.status) { where.push('expenses.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT expenses.*, projects.name AS project_name, centers.name AS center_name
    FROM expenses LEFT JOIN projects ON projects.id = expenses.project_id
    LEFT JOIN cost_centers AS centers ON centers.id = expenses.cost_center_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY expenses.expense_date, expenses.id`, params);
  let total = 0n;
  let paid = 0n;
  const dataRows = data.map((row) => {
    const totalAmount = amount(row.total_amount);
    const paidAmount = amount(row.paid_amount);
    const remaining = totalAmount > paidAmount ? totalAmount - paidAmount : 0n;
    total += totalAmount;
    paid += paidAmount;
    return {
      number: String(row.number), date: String(row.expense_date), description: String(row.description),
      project: String(row.project_name ?? '—'), costCenter: String(row.center_name ?? '—'),
      total: money(totalAmount), paid: money(paidAmount), remaining: money(remaining),
      status: label({}, row.status),
    };
  });
  return {
    rows: dataRows,
    totals: [card('عدد المصروفات', String(dataRows.length)), card('الإجمالي', money(total)), card('المدفوع', money(paid)), card('المتبقي', money(total - paid), total - paid > 0n ? 'negative' : 'positive')],
    note: 'المبالغ من حقول المصروف المسجلة. المصروفات المسودة لا تُرحّل تلقائيًا للحسابات.',
  };
}

// ── العملاء والموردون ───────────────────────────────────────────────

function partyStatement(database: DatabaseSync, filters: ReportRunFilters, kind: 'customer' | 'supplier'): ReportBuild {
  const id = kind === 'customer' ? filters.customerId : filters.supplierId;
  if (!id) throw new Error(kind === 'customer' ? 'اختر العميل أولًا لعرض كشف الحساب.' : 'اختر المورد أولًا لعرض كشف الحساب.');
  const table = kind === 'customer' ? 'customers' : 'suppliers';
  const party = database.prepare(`SELECT code, name, account_id FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  if (!party) throw new Error(kind === 'customer' ? 'العميل المحدد غير موجود.' : 'المورد المحدد غير موجود.');
  if (!party.account_id) {
    throw new Error(kind === 'customer'
      ? 'العميل المحدد غير مربوط بحساب محاسبي. اربطه من صفحة العملاء أولًا.'
      : 'المورد المحدد غير مربوط بحساب محاسبي. اربطه من صفحة الموردين أولًا.');
  }
  const accountId = Number(party.account_id);
  const allLines = ledgerLines(database, { ...filters, accountId, costCenterId: null }, { ignoreFrom: true });
  const opening = allLines.filter((line) => filters.from && line.date < filters.from).reduce((total, line) => total + line.debit - line.credit, 0n);
  const periodLines = allLines.filter((line) => !filters.from || line.date >= filters.from);
  let running = opening;
  const data = periodLines.map((line) => {
    running += line.debit - line.credit;
    return {
      date: line.date, reference: line.reference,
      description: [line.entryDescription, line.description].filter(Boolean).join(' · '),
      debit: money(line.debit), credit: money(line.credit), balance: money(running),
    };
  });
  return {
    rows: data,
    totals: [
      card('رصيد أول المدة', money(opening)),
      card('مدين', money(periodLines.reduce((total, line) => total + line.debit, 0n))),
      card('دائن', money(periodLines.reduce((total, line) => total + line.credit, 0n))),
      card('الرصيد النهائي', money(running)),
    ],
    note: `${kind === 'customer' ? 'العميل' : 'المورد'}: ${String(party.code)} — ${String(party.name)}. الرصيد الموجب مدين والسالبة دائن.`,
  };
}

function partyBalances(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const data = rows(database, `SELECT * FROM (
      SELECT 'customer' AS kind, customers.code, customers.name, customers.account_id,
        accounts.code AS account_code, accounts.name AS account_name FROM customers
        LEFT JOIN accounts ON accounts.id = customers.account_id
      UNION ALL
      SELECT 'supplier' AS kind, suppliers.code, suppliers.name, suppliers.account_id,
        accounts.code AS account_code, accounts.name AS account_name FROM suppliers
        LEFT JOIN accounts ON accounts.id = suppliers.account_id
    ) AS parties
    ORDER BY parties.kind, parties.code`);
  const lines = ledgerLines(database, { ...filters, accountId: null, costCenterId: null });
  const balances = new Map<number, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const entry = balances.get(line.accountId) ?? { debit: 0n, credit: 0n };
    entry.debit += line.debit;
    entry.credit += line.credit;
    balances.set(line.accountId, entry);
  }
  const dataRows = data.map((row) => {
    const balance = row.account_id ? (balances.get(Number(row.account_id)) ?? { debit: 0n, credit: 0n }) : { debit: 0n, credit: 0n };
    return {
      type: row.kind === 'customer' ? 'عميل' : 'مورد', code: String(row.code), name: String(row.name),
      account: row.account_code ? `${String(row.account_code)} — ${String(row.account_name)}` : 'غير مربوط',
      debit: money(balance.debit), credit: money(balance.credit), balance: money(balance.debit - balance.credit),
      _debit: balance.debit, _credit: balance.credit,
    };
  });
  return {
    rows: dataRows.map(({ _debit, _credit, ...row }) => row),
    totals: [card('عدد العملاء والموردين', String(dataRows.length)), card('أرصدة مدينة', money(dataRows.reduce((total, row) => total + row._debit, 0n))), card('أرصدة دائنة', money(dataRows.reduce((total, row) => total + row._credit, 0n)))],
    note: 'يظهر العملاء والموردون غير المرتبطين بحساب برصيد صفر لتوضيح الحاجة للربط المحاسبي.',
  };
}

function propertyContractsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('contracts.contract_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('contracts.contract_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('contracts.customer_id = ?'); params.push(filters.customerId); }
  if (filters.projectId) { where.push('contracts.project_id = ?'); params.push(filters.projectId); }
  const data = rows(database, `SELECT contracts.*, customers.name AS customer_name, projects.name AS project_name,
      COALESCE((SELECT SUM(receipts.amount) FROM property_receipts AS receipts WHERE receipts.contract_id = contracts.id), '0') AS collected
    FROM property_contracts AS contracts
    INNER JOIN customers ON customers.id = contracts.customer_id
    INNER JOIN projects ON projects.id = contracts.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY contracts.contract_date, contracts.id`, params);
  let total = 0n;
  let collected = 0n;
  const dataRows = data.map((row) => {
    const contractValue = amount(row.original_price) - amount(row.discount) + amount(row.fees);
    const paid = amount(row.collected);
    total += contractValue;
    collected += paid;
    return {
      number: String(row.number), date: String(row.contract_date), customer: String(row.customer_name),
      project: String(row.project_name), total: money(contractValue), collected: money(paid),
      remaining: money(contractValue > paid ? contractValue - paid : 0n), status: label({}, row.status),
    };
  });
  return {
    rows: dataRows,
    totals: [card('عدد العقود', String(dataRows.length)), card('قيمة العقود', money(total)), card('المحصّل', money(collected)), card('المتبقي', money(total > collected ? total - collected : 0n))],
    note: 'قيمة العقد = السعر الأصلي − الخصم + الرسوم. التحصيل من سندات تحصيل العقد المسجلة.',
  };
}

function collectionsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('receipts.receipt_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('receipts.receipt_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('contracts.customer_id = ?'); params.push(filters.customerId); }
  const selected = treasuryParts(filters);
  if (selected.kind === 'cash') {
    where.push("receipts.channel = 'cash'");
    if (selected.id) { where.push('receipts.cash_box_id = ?'); params.push(selected.id); }
  }
  if (selected.kind === 'bank') {
    where.push("receipts.channel = 'bank'");
    if (selected.id) { where.push('receipts.bank_account_id = ?'); params.push(selected.id); }
  }
  const data = rows(database, `SELECT receipts.*, contracts.number AS contract_number, customers.name AS customer_name
    FROM property_receipts AS receipts
    INNER JOIN property_contracts AS contracts ON contracts.id = receipts.contract_id
    INNER JOIN customers ON customers.id = contracts.customer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY receipts.receipt_date, receipts.id`, params);
  const total = data.reduce((sum, row) => sum + amount(row.amount), 0n);
  return {
    rows: data.map((row) => ({
      date: String(row.receipt_date), contract: String(row.contract_number), customer: String(row.customer_name),
      channel: row.channel === 'cash' ? 'نقدي' : 'بنكي', reference: String(row.reference ?? ''), amount: money(amount(row.amount)),
    })),
    totals: [card('عدد التحصيلات', String(data.length)), card('إجمالي التحصيل', money(total))],
    note: 'التحصيلات مسجلة بقيود محاسبية عند إنشائها من صفحة سداد مبيعات الوحدات.',
  };
}

// ── الأقساط ─────────────────────────────────────────────────────────

interface InstallmentRow {
  installmentId: number;
  contractId: number;
  sequence: number;
  customerId: number;
  customerCode: string;
  projectId: number;
  projectCode: string;
  unitId: number;
  unitCode: string;
  unitName: string;
  contract: string;
  customer: string;
  project: string;
  description: string;
  frequency: string;
  dueDate: string;
  amount: bigint;
  paid: bigint;
  adjusted: bigint;
  remaining: bigint;
  dueStatus: 'paid' | 'partial' | 'unpaid';
  timeStatus: 'overdue' | 'due' | 'upcoming';
}

function installmentRows(database: DatabaseSync, filters: ReportRunFilters): InstallmentRow[] {
  const where: string[] = ["contracts.status = 'approved'"];
  const params: Param[] = [];
  if (filters.from) { where.push('installments.due_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('installments.due_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('contracts.customer_id = ?'); params.push(filters.customerId); }
  if (filters.projectId) { where.push('contracts.project_id = ?'); params.push(filters.projectId); }
  if (filters.unitId) { where.push('contracts.unit_id = ?'); params.push(filters.unitId); }
  const data = rows(database, `SELECT installments.*, contracts.id AS contract_id, contracts.number AS contract_number,
      customers.id AS customer_id, customers.code AS customer_code, customers.name AS customer_name,
      projects.id AS project_id, projects.code AS project_code, projects.name AS project_name,
      units.id AS unit_id, units.code AS unit_code, units.name AS unit_name,
      COALESCE((SELECT SUM(allocations.amount) FROM property_receipt_allocations AS allocations WHERE allocations.installment_id = installments.id), '0') AS paid_amount,
      COALESCE((SELECT SUM(adjustments.amount) FROM property_installment_adjustments AS adjustments WHERE adjustments.installment_id = installments.id), '0') AS adjusted_amount
    FROM property_installments AS installments
    INNER JOIN property_contracts AS contracts ON contracts.id = installments.contract_id
    INNER JOIN customers ON customers.id = contracts.customer_id
    INNER JOIN projects ON projects.id = contracts.project_id
    INNER JOIN property_units AS units ON units.id = contracts.unit_id
    WHERE ${where.join(' AND ')}
    ORDER BY installments.due_date, installments.id`, params);
  const now = today();
  return data.map((row) => {
    const total = amount(row.amount);
    const paid = amount(row.paid_amount);
    const adjusted = amount(row.adjusted_amount);
    const remaining = total > paid + adjusted ? total - paid - adjusted : 0n;
    const dueStatus = remaining === 0n ? 'paid' : paid > 0n ? 'partial' : 'unpaid';
    const dueDate = String(row.due_date);
    return {
      installmentId: Number(row.id), contractId: Number(row.contract_id), sequence: Number(row.sequence),
      customerId: Number(row.customer_id), customerCode: String(row.customer_code),
      projectId: Number(row.project_id), projectCode: String(row.project_code), unitId: Number(row.unit_id),
      unitCode: String(row.unit_code), unitName: String(row.unit_name),
      contract: String(row.contract_number), customer: String(row.customer_name), project: String(row.project_name),
      description: String(row.description), frequency: String(row.frequency), dueDate, amount: total, paid, adjusted, remaining, dueStatus,
      timeStatus: remaining === 0n || dueDate > now ? 'upcoming' : dueDate < now ? 'overdue' : 'due',
    };
  });
}

function installmentReport(database: DatabaseSync, filters: ReportRunFilters, preset: string): ReportBuild {
  let data = installmentRows(database, filters);
  const status = filters.installmentStatus || preset;
  if (status) {
    data = data.filter((row) => {
      if (status === 'overdue') return row.remaining > 0n && row.timeStatus === 'overdue';
      if (status === 'due-upcoming') return row.remaining > 0n && row.timeStatus !== 'overdue';
      if (status === 'due') return row.remaining > 0n && row.timeStatus !== 'upcoming';
      if (status === 'upcoming') return row.remaining > 0n && row.timeStatus === 'upcoming';
      if (status === 'paid') return row.remaining === 0n;
      if (status === 'remaining') return row.remaining > 0n;
      if (status === 'unpaid') return row.dueStatus === 'unpaid';
      if (status === 'partial') return row.dueStatus === 'partial';
      return true;
    });
  }
  const total = data.reduce((sum, row) => sum + row.amount, 0n);
  const paid = data.reduce((sum, row) => sum + row.paid, 0n);
  const remaining = data.reduce((sum, row) => sum + row.remaining, 0n);
  const overdue = data.filter((row) => row.remaining > 0n && row.timeStatus === 'overdue');
  const statusLabel = (row: InstallmentRow): string =>
    row.remaining === 0n ? (row.adjusted > 0n ? 'مسدد (مع خصم)' : 'مسدد')
      : row.timeStatus === 'overdue' ? (row.dueStatus === 'partial' ? 'متأخر (مسدد جزئيًا)' : 'متأخر')
        : row.dueStatus === 'partial' ? 'مسدد جزئيًا' : 'غير مسدد';
  return {
    rows: data.map((row) => ({
      contract: row.contract, customer: row.customer, description: `${row.description} (${INSTALLMENT_FREQUENCY[row.frequency] ?? row.frequency})`,
      dueDate: row.dueDate, amount: money(row.amount), paid: money(row.paid), adjusted: money(row.adjusted),
      remaining: money(row.remaining), status: statusLabel(row),
      installmentId: String(row.installmentId), contractId: String(row.contractId), sequence: String(row.sequence),
      customerId: String(row.customerId), customerCode: row.customerCode,
      projectId: String(row.projectId), projectCode: row.projectCode, unitId: String(row.unitId),
      unitCode: row.unitCode, unit: row.unitName,
      dueStatus: row.dueStatus, timeStatus: row.timeStatus,
    })),
    totals: [
      card('عدد الأقساط', String(data.length)),
      card('إجمالي الأقساط', money(total)),
      card('المحصّل', money(paid), 'positive'),
      card('المتبقي', money(remaining), remaining > 0n ? 'negative' : 'positive'),
      card('عدد المتأخرات', String(overdue.length), overdue.length ? 'negative' : 'positive'),
    ],
    note: 'المتبقي = قيمة القسط − المخصص من التحصيلات − خصومات عمولة السمسار. حالة التأخر تُقارن بتاريخ اليوم.',
  };
}

function customerInstallmentsStatement(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.customerId) { where.push('contracts.customer_id = ?'); params.push(filters.customerId); }
  if (filters.projectId) { where.push('contracts.project_id = ?'); params.push(filters.projectId); }
  const data = rows(database, `SELECT contracts.*, customers.name AS customer_name, projects.name AS project_name,
      (SELECT COUNT(*) FROM property_installments AS installments WHERE installments.contract_id = contracts.id) AS installment_count,
      COALESCE((SELECT SUM(receipts.amount) FROM property_receipts AS receipts WHERE receipts.contract_id = contracts.id), '0') AS collected
    FROM property_contracts AS contracts
    INNER JOIN customers ON customers.id = contracts.customer_id
    INNER JOIN projects ON projects.id = contracts.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY customers.name, contracts.contract_date`, params);
  const now = today();
  let total = 0n;
  let collected = 0n;
  const dataRows = data.map((row) => {
    const contractValue = amount(row.original_price) - amount(row.discount) + amount(row.fees);
    const paid = amount(row.collected);
    total += contractValue;
    collected += paid;
    const overdue = scalar(database, `SELECT COUNT(*) AS value FROM property_installments AS installments
      WHERE installments.contract_id = ? AND installments.due_date < ?
        AND installments.amount > COALESCE((SELECT SUM(allocations.amount) FROM property_receipt_allocations AS allocations WHERE allocations.installment_id = installments.id), '0')
        + COALESCE((SELECT SUM(adjustments.amount) FROM property_installment_adjustments AS adjustments WHERE adjustments.installment_id = installments.id), '0')`, [Number(row.id), now]);
    return {
      customer: String(row.customer_name), contract: String(row.number), project: String(row.project_name),
      total: money(contractValue), collected: money(paid), remaining: money(contractValue > paid ? contractValue - paid : 0n),
      installments: String(row.installment_count), overdue: String(overdue),
    };
  });
  return {
    rows: dataRows,
    totals: [card('عدد العقود', String(dataRows.length)), card('قيمة العقود', money(total)), card('المحصّل', money(collected)), card('المتبقي', money(total > collected ? total - collected : 0n))],
    note: 'ملخص تعاقدي لكل عميل. لعرض تفاصيل الأقساط استخدم تقرير أقساط العملاء.',
  };
}

// ── المبيعات والمشتريات ─────────────────────────────────────────────

function salesDocumentsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('documents.document_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('documents.document_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('documents.master_client_id = ?'); params.push(filters.customerId); }
  if (filters.status) { where.push('documents.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT documents.*, customers.name AS customer_name
    FROM sales_documents AS documents
    LEFT JOIN customers ON customers.id = documents.master_client_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY documents.document_date, documents.id`, params);
  const lineTotals = new Map<number, bigint>();
  for (const line of rows(database, 'SELECT document_id, quantity, unit_price FROM sales_document_lines')) {
    const id = Number(line.document_id);
    lineTotals.set(id, (lineTotals.get(id) ?? 0n) + product(amount(line.quantity), amount(line.unit_price)));
  }
  let total = 0n;
  const dataRows = data.map((row) => {
    const subtotal = lineTotals.get(Number(row.id)) ?? 0n;
    total += subtotal;
    return {
      number: String(row.document_number), type: label(DOCUMENT_TYPES, row.document_type),
      date: String(row.document_date), customer: String(row.customer_name ?? row.client_name ?? ''),
      reference: String(row.reference ?? ''), total: money(subtotal), status: label({}, row.status),
    };
  });
  return {
    rows: dataRows,
    totals: [card('عدد المستندات', String(dataRows.length)), card('إجمالي القيمة', money(total))],
    note: 'قيمة المستند محسوبة من بنوده (الكمية × سعر الوحدة). المستندات المسودة لا تُرحّل تلقائيًا للحسابات.',
  };
}

function salesReturnsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('returns.return_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('returns.return_date <= ?'); params.push(filters.to); }
  if (filters.customerId) { where.push('returns.customer_id = ?'); params.push(filters.customerId); }
  if (filters.status) { where.push('returns.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT returns.*, documents.document_number AS invoice_number, customers.name AS customer_name,
      COALESCE((SELECT SUM(return_lines.quantity * invoice_lines.unit_price)
        FROM sales_return_lines AS return_lines
        INNER JOIN sales_document_lines AS invoice_lines ON invoice_lines.id = return_lines.invoice_line_id
        WHERE return_lines.return_id = returns.id), 0) AS total
    FROM sales_returns AS returns
    INNER JOIN sales_documents AS documents ON documents.id = returns.invoice_id
    LEFT JOIN customers ON customers.id = returns.customer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY returns.return_date, returns.id`, params);
  const total = data.reduce((sum, row) => sum + amount(row.total), 0n);
  return {
    rows: data.map((row) => ({
      number: String(row.return_number), date: String(row.return_date), invoice: String(row.invoice_number),
      customer: String(row.customer_name ?? '—'), reason: String(row.reason), total: money(amount(row.total)), status: label({}, row.status),
    })),
    totals: [card('عدد المرتجعات', String(data.length)), card('قيمة المرتجعات', money(total))],
    note: 'قيمة المرتجع = الكميات المرتجعة × أسعار بنود الفاتورة الأصلية.',
  };
}

function purchaseInvoicesReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('invoices.invoice_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('invoices.invoice_date <= ?'); params.push(filters.to); }
  if (filters.supplierId) { where.push('invoices.supplier_id = ?'); params.push(filters.supplierId); }
  if (filters.status) { where.push('invoices.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT invoices.*, COALESCE(invoices.supplier_name, suppliers.name) AS party_name
    FROM purchase_invoices AS invoices
    LEFT JOIN suppliers ON suppliers.id = invoices.supplier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY invoices.invoice_date, invoices.id`, params);
  const lineTotals = new Map<number, bigint>();
  for (const line of rows(database, 'SELECT invoice_id, quantity, unit_price FROM purchase_invoice_lines')) {
    const id = Number(line.invoice_id);
    lineTotals.set(id, (lineTotals.get(id) ?? 0n) + product(amount(line.quantity), amount(line.unit_price)));
  }
  const total = data.reduce((sum, row) => sum + (lineTotals.get(Number(row.id)) ?? 0n), 0n);
  return {
    rows: data.map((row) => ({
      number: String(row.number), date: String(row.invoice_date), supplier: String(row.party_name ?? ''),
      reference: String(row.supplier_invoice_number ?? ''), category: String(row.category ?? ''),
      total: money(lineTotals.get(Number(row.id)) ?? 0n), status: label({}, row.status),
    })),
    totals: [card('عدد الفواتير', String(data.length)), card('إجمالي القيمة', money(total))],
    note: 'إجمالي الفاتورة محسوب من بنودها (الكمية × سعر الوحدة) وليس من حقل إجمالي مستقل.',
  };
}

function purchaseReturnsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('returns.return_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('returns.return_date <= ?'); params.push(filters.to); }
  if (filters.supplierId) { where.push('returns.supplier_id = ?'); params.push(filters.supplierId); }
  if (filters.status) { where.push('returns.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT returns.*, invoices.number AS invoice_number, suppliers.name AS supplier_name,
      COALESCE((SELECT SUM(return_lines.quantity * invoice_lines.unit_price)
        FROM purchase_return_lines AS return_lines
        INNER JOIN purchase_invoice_lines AS invoice_lines ON invoice_lines.id = return_lines.invoice_line_id
        WHERE return_lines.return_id = returns.id), 0) AS total
    FROM purchase_returns AS returns
    INNER JOIN purchase_invoices AS invoices ON invoices.id = returns.invoice_id
    INNER JOIN suppliers ON suppliers.id = returns.supplier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY returns.return_date, returns.id`, params);
  const total = data.reduce((sum, row) => sum + amount(row.total), 0n);
  return {
    rows: data.map((row) => ({
      number: String(row.number), date: String(row.return_date), invoice: String(row.invoice_number),
      supplier: String(row.supplier_name), reason: String(row.reason), total: money(amount(row.total)), status: label({}, row.status),
    })),
    totals: [card('عدد المرتجعات', String(data.length)), card('قيمة المرتجعات', money(total))],
    note: 'قيمة المرتجع = الكميات المرتجعة × أسعار بنود فاتورة المشتريات الأصلية.',
  };
}

// ── المخزون ─────────────────────────────────────────────────────────

interface StockRow {
  itemId: number;
  code: string;
  name: string;
  unit: string;
  warehouseId: number;
  warehouse: string;
  quantity: bigint;
  cost: bigint;
}

function stockRows(database: DatabaseSync, filters: ReportRunFilters): StockRow[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.itemId) { where.push('movements.item_id = ?'); params.push(filters.itemId); }
  if (filters.from) { where.push('movements.movement_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('movements.movement_date <= ?'); params.push(filters.to); }
  const data = rows(database, `SELECT movements.item_id, items.code, items.name_ar, units.name_ar AS unit_name,
      movements.warehouse_id, warehouses.name AS warehouse_name, movements.quantity_delta, movements.unit_cost,
      movements.movement_date, movements.id
    FROM inventory_stock_movements AS movements
    INNER JOIN inventory_items AS items ON items.id = movements.item_id
    INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
    INNER JOIN warehouses ON warehouses.id = movements.warehouse_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY items.code, warehouses.name, movements.movement_date, movements.id`, params);
  const grouped = new Map<string, StockRow>();
  for (const row of data) {
    const key = `${row.item_id}:${row.warehouse_id}`;
    const entry = grouped.get(key) ?? {
      itemId: Number(row.item_id), code: String(row.code), name: String(row.name_ar), unit: String(row.unit_name),
      warehouseId: Number(row.warehouse_id), warehouse: String(row.warehouse_name), quantity: 0n, cost: amount(row.unit_cost),
    };
    entry.quantity += amount(row.quantity_delta);
    entry.cost = amount(row.unit_cost);
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}

function inventoryBalances(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const data = stockRows(database, { ...filters, from: '', to: '' });
  return {
    rows: data.map((row) => ({
      code: row.code, item: row.name, warehouse: row.warehouse, unit: row.unit,
      quantity: money(row.quantity), cost: money(row.cost), value: money(product(row.quantity, row.cost)),
    })),
    totals: [card('عدد الأصناف/المخازن', String(data.length)), card('إجمالي الكميات', money(data.reduce((total, row) => total + row.quantity, 0n))), card('قيمة المخزون', money(data.reduce((total, row) => total + product(row.quantity, row.cost), 0n)))],
    note: 'الكميات من حركات المخزون الفعلية. القيمة تقديرية بآخر تكلفة وحدة مسجلة لكل صنف ومخزن.',
  };
}

function itemMovement(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('movements.movement_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('movements.movement_date <= ?'); params.push(filters.to); }
  if (filters.itemId) { where.push('movements.item_id = ?'); params.push(filters.itemId); }
  const data = rows(database, `SELECT movements.*, items.code, items.name_ar, units.name_ar AS unit_name, warehouses.name AS warehouse_name
    FROM inventory_stock_movements AS movements
    INNER JOIN inventory_items AS items ON items.id = movements.item_id
    INNER JOIN inventory_units AS units ON units.id = items.base_unit_id
    INNER JOIN warehouses ON warehouses.id = movements.warehouse_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY movements.movement_date, movements.id`, params);
  return {
    rows: data.map((row) => {
      const quantity = amount(row.quantity_delta);
      const cost = amount(row.unit_cost);
      return {
        date: String(row.movement_date), type: label(MOVEMENT_TYPES, row.movement_type),
        document: `${String(row.document_number)} · ${label({ opening: 'افتتاحي', receipt: 'استلام', issue: 'صرف', transfer: 'تحويل' }, row.document_type)}`,
        item: `${String(row.code)} — ${String(row.name_ar)}`, warehouse: String(row.warehouse_name),
        quantity: money(quantity), cost: money(cost), value: money(product(quantity, cost)),
      };
    }),
    totals: [card('عدد الحركات', String(data.length)), card('إجمالي الكميات', money(data.reduce((total, row) => total + amount(row.quantity_delta), 0n)))],
    note: 'الكميات السالبة تمثل صرفًا أو تحويلًا صادرًا. القيمة محسوبة بتكلفة الوحدة المسجلة في الحركة.',
  };
}

function zeroStock(database: DatabaseSync): ReportBuild {
  const data = stockRows(database, { ...defaultReportFilters(), from: '', to: '', itemId: null });
  const grouped = new Map<number, { code: string; name: string; unit: string; quantity: bigint; warehouses: Set<number> }>();
  for (const row of data) {
    const entry = grouped.get(row.itemId) ?? { code: row.code, name: row.name, unit: row.unit, quantity: 0n, warehouses: new Set<number>() };
    entry.quantity += row.quantity;
    entry.warehouses.add(row.warehouseId);
    grouped.set(row.itemId, entry);
  }
  const items = [...grouped.values()].filter((entry) => entry.quantity <= 0n);
  return {
    rows: items.map((entry) => ({
      code: entry.code, item: entry.name, unit: entry.unit,
      quantity: money(entry.quantity), warehouses: String(entry.warehouses.size),
    })),
    totals: [card('أصناف برصيد صفري أو سالب', String(items.length), items.length ? 'negative' : 'positive')],
    note: 'يعتمد على صافي كل الحركات المسجلة لكل صنف في جميع المخازن. لا توجد حدود إعادة طلب مسجلة في النظام بعد.',
  };
}

function inventoryDocuments(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('date_value >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('date_value <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT * FROM (
    SELECT 'إذن استلام' AS kind, receipts.number, receipts.receipt_date AS date_value, receipts.status,
      warehouses.name AS warehouse_name,
      (SELECT COUNT(*) FROM inventory_receipt_lines WHERE receipt_id = receipts.id) AS line_count,
      COALESCE((SELECT SUM(quantity) FROM inventory_receipt_lines WHERE receipt_id = receipts.id), 0) AS total_quantity
    FROM inventory_receipts AS receipts INNER JOIN warehouses ON warehouses.id = receipts.warehouse_id
    UNION ALL
    SELECT 'سند صرف' AS kind, issues.number, issues.issue_date, issues.status,
      warehouses.name, (SELECT COUNT(*) FROM inventory_issue_lines WHERE issue_id = issues.id),
      COALESCE((SELECT SUM(quantity) FROM inventory_issue_lines WHERE issue_id = issues.id), 0)
    FROM inventory_issues AS issues INNER JOIN warehouses ON warehouses.id = issues.warehouse_id
    UNION ALL
    SELECT 'تحويل مخزني' AS kind, transfers.number, transfers.transfer_date, transfers.status,
      sources.name || ' → ' || destinations.name,
      (SELECT COUNT(*) FROM inventory_transfer_lines WHERE transfer_id = transfers.id),
      COALESCE((SELECT SUM(quantity) FROM inventory_transfer_lines WHERE transfer_id = transfers.id), 0)
    FROM inventory_transfers AS transfers
    INNER JOIN warehouses AS sources ON sources.id = transfers.source_warehouse_id
    INNER JOIN warehouses AS destinations ON destinations.id = transfers.destination_warehouse_id
  ) AS documents
  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  ORDER BY date_value, kind`, params);
  return {
    rows: data.map((row) => ({
      type: String(row.kind), number: String(row.number), date: String(row.date_value),
      warehouse: String(row.warehouse_name), lines: String(row.line_count),
      quantity: money(amount(row.total_quantity)), status: label({}, row.status),
    })),
    totals: [card('عدد المستندات', String(data.length)), card('إجمالي الكميات', money(data.reduce((total, row) => total + amount(row.total_quantity), 0n)))],
    note: 'يجمع أذون الاستلام وسندات الصرف والتحويل في تقرير واحد. المستندات الملغاة لا تُحتسب في أرصدة المخزون.',
  };
}

// ── المشروعات والمقاولون ────────────────────────────────────────────

function projectsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('projects.start_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('projects.start_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('projects.id = ?'); params.push(filters.projectId); }
  if (filters.status) { where.push('projects.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT projects.*,
      (SELECT COUNT(*) FROM project_work_items WHERE project_id = projects.id) AS work_item_count,
      (SELECT COUNT(*) FROM inventory_issues WHERE project_id = projects.id AND status <> 'cancelled') AS issue_count,
      COALESCE((SELECT SUM(total_amount) FROM expenses WHERE project_id = projects.id), 0) AS expenses_total
    FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY projects.code`, params);
  return {
    rows: data.map((row) => ({
      code: String(row.code), name: String(row.name), start: String(row.start_date ?? ''),
      end: String(row.end_date ?? ''), status: label({}, row.status),
      workItems: String(row.work_item_count), issues: String(row.issue_count), expenses: money(amount(row.expenses_total)),
    })),
    totals: [card('عدد المشروعات', String(data.length)), card('إجمالي المصروفات المرتبطة', money(data.reduce((total, row) => total + amount(row.expenses_total), 0n)))],
    note: 'المصروفات المرتبطة تُجمع من المصروفات التي تحمل معرّف المشروع. الفترة تُطبق على تاريخ بداية المشروع.',
  };
}

function contractorContractsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('contracts.contract_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('contracts.contract_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('contracts.project_id = ?'); params.push(filters.projectId); }
  if (filters.status) { where.push('contracts.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT contracts.*, contractors.name AS contractor_name, projects.name AS project_name
    FROM contractor_contracts AS contracts
    INNER JOIN contractors ON contractors.id = contracts.contractor_id
    LEFT JOIN projects ON projects.id = contracts.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY contracts.contract_date, contracts.id`, params);
  return {
    rows: data.map((row) => ({
      number: String(row.number), date: String(row.contract_date), contractor: String(row.contractor_name),
      project: String(row.project_name ?? '—'), status: label({}, row.status), total: money(amount(row.total)),
    })),
    totals: [card('عدد العقود', String(data.length)), card('إجمالي العقود', money(data.reduce((total, row) => total + amount(row.total), 0n)))],
    note: 'قيم العقود من الإجمالي المسجل في العقد بعد اعتماد بنوده.',
  };
}

function contractorCertificatesReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('certificates.certificate_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('certificates.certificate_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('certificates.project_id = ?'); params.push(filters.projectId); }
  if (filters.status) { where.push('certificates.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT certificates.*, contractors.name AS contractor_name, projects.name AS project_name,
      contracts.number AS contract_number
    FROM contractor_certificate_documents AS certificates
    INNER JOIN contractors ON contractors.id = certificates.contractor_id
    LEFT JOIN projects ON projects.id = certificates.project_id
    LEFT JOIN contractor_contracts AS contracts ON contracts.id = certificates.contract_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY certificates.certificate_date, certificates.id`, params);
  return {
    rows: data.map((row) => ({
      number: String(row.number), date: String(row.certificate_date), contractor: String(row.contractor_name),
      project: String(row.project_name ?? '—'), contract: String(row.contract_number ?? '—'),
      status: label({}, row.status), total: money(amount(row.total)),
    })),
    totals: [card('عدد المستخلصات', String(data.length)), card('إجمالي المستخلصات', money(data.reduce((total, row) => total + amount(row.total), 0n)))],
    note: 'يشمل المستخلصات المسودة والمعتمدة وفق فلتر الحالة؛ المستخلصات الملغاة لا تُرحّل للحسابات.',
  };
}

function contractorVouchersReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('vouchers.voucher_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('vouchers.voucher_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('vouchers.project_id = ?'); params.push(filters.projectId); }
  if (filters.status) { where.push('vouchers.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT vouchers.*, contractors.name AS contractor_name, projects.name AS project_name
    FROM contractor_vouchers AS vouchers
    INNER JOIN contractors ON contractors.id = vouchers.contractor_id
    LEFT JOIN projects ON projects.id = vouchers.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY vouchers.voucher_date, vouchers.id`, params);
  return {
    rows: data.map((row) => ({
      number: String(row.number), date: String(row.voucher_date), contractor: String(row.contractor_name),
      project: String(row.project_name ?? '—'), method: row.payment_method === 'cash' ? 'نقدي' : 'بنكي',
      status: label({}, row.status), amount: money(amount(row.amount)),
    })),
    totals: [card('عدد السندات', String(data.length)), card('إجمالي المبالغ', money(data.reduce((total, row) => total + amount(row.amount), 0n)))],
    note: 'السندات المسودة لا تؤثر على الحسابات حتى تُعتمد.',
  };
}

function projectExpenses(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = ['expenses.project_id IS NOT NULL'];
  const params: Param[] = [];
  if (filters.from) { where.push('expenses.expense_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('expenses.expense_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('expenses.project_id = ?'); params.push(filters.projectId); }
  if (filters.costCenterId) { where.push('expenses.cost_center_id = ?'); params.push(filters.costCenterId); }
  const data = rows(database, `SELECT expenses.*, projects.name AS project_name, centers.name AS center_name
    FROM expenses INNER JOIN projects ON projects.id = expenses.project_id
    LEFT JOIN cost_centers AS centers ON centers.id = expenses.cost_center_id
    WHERE ${where.join(' AND ')} ORDER BY expenses.expense_date, expenses.id`, params);
  let total = 0n;
  let paid = 0n;
  const dataRows = data.map((row) => {
    const totalAmount = amount(row.total_amount);
    const paidAmount = amount(row.paid_amount);
    total += totalAmount;
    paid += paidAmount;
    return {
      date: String(row.expense_date), number: String(row.number), description: String(row.description),
      project: String(row.project_name), costCenter: String(row.center_name ?? '—'),
      total: money(totalAmount), paid: money(paidAmount), remaining: money(totalAmount > paidAmount ? totalAmount - paidAmount : 0n),
    };
  });
  return {
    rows: dataRows,
    totals: [card('عدد المصروفات', String(dataRows.length)), card('الإجمالي', money(total)), card('المتبقي', money(total > paid ? total - paid : 0n))],
    note: 'يشمل المصروفات المسجلة على مشروع فقط. مصروفات بلا مشروع تظهر في تقرير المصروفات العام.',
  };
}

function projectCosts(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const params: Param[] = [];
  const where: string[] = [];
  if (filters.from) { where.push('issues.issue_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('issues.issue_date <= ?'); params.push(filters.to); }
  if (filters.projectId) { where.push('issues.project_id = ?'); params.push(filters.projectId); }
  const materialLines = rows(database, `SELECT issues.project_id, lines.quantity, lines.unit_cost
    FROM inventory_issues AS issues INNER JOIN inventory_issue_lines AS lines ON lines.issue_id = issues.id
    WHERE issues.status = 'approved' ${where.length ? `AND ${where.join(' AND ')}` : ''}`, params);
  const materials = [...new Set(materialLines.map((line) => Number(line.project_id)))].map((projectId) => ({
    project_id: projectId,
    total: materialLines.filter((line) => Number(line.project_id) === projectId)
      .reduce((total, line) => total + product(amount(line.quantity), amount(line.unit_cost)), 0n),
  }));
  const expenseWhere: string[] = ['expense_allocations.project_id IS NOT NULL'];
  const expenseParams: Param[] = [];
  if (filters.from) { expenseWhere.push('expenses.expense_date >= ?'); expenseParams.push(filters.from); }
  if (filters.to) { expenseWhere.push('expenses.expense_date <= ?'); expenseParams.push(filters.to); }
  if (filters.projectId) { expenseWhere.push('expense_allocations.project_id = ?'); expenseParams.push(filters.projectId); }
  const expenseLines = rows(database, `SELECT expense_allocations.project_id, expense_allocations.amount
    FROM expense_allocations INNER JOIN expenses ON expenses.id = expense_allocations.expense_id
    WHERE ${expenseWhere.join(' AND ')}`, expenseParams);
  const expenses = [...new Set(expenseLines.map((line) => Number(line.project_id)))].map((projectId) => ({
    project_id: projectId,
    total: expenseLines.filter((line) => Number(line.project_id) === projectId).reduce((total, line) => total + amount(line.amount), 0n),
  }));
  const projects = rows(database, 'SELECT id, code, name FROM projects ORDER BY code');
  const dataRows = projects.map((project) => {
    const material = materials.find((row) => Number(row.project_id) === Number(project.id))?.total ?? 0n;
    const expense = expenses.find((row) => Number(row.project_id) === Number(project.id))?.total ?? 0n;
    return { code: String(project.code), project: String(project.name), materials: money(material), expenses: money(expense), total: money(material + expense), _total: material + expense };
  }).filter((row) => row._total > 0n);
  return {
    rows: dataRows.map(({ _total, ...row }) => row),
    totals: [
      card('المواد المخزنية', money(dataRows.reduce((total, row) => total + amount(row.materials), 0n))),
      card('المصروفات', money(dataRows.reduce((total, row) => total + amount(row.expenses), 0n))),
      card('إجمالي التكلفة', money(dataRows.reduce((total, row) => total + row._total, 0n))),
    ],
    note: 'تكلفة المواد من سندات الصرف المعتمدة، والمصروفات من توزيعات المصروفات المرتبطة بالمشروعات.',
  };
}

// ── الأصول ──────────────────────────────────────────────────────────

function assetAccumulated(database: DatabaseSync): Map<number, bigint> {
  const totals = new Map<number, bigint>();
  for (const row of rows(database, 'SELECT asset_id, amount FROM asset_depreciation_lines')) {
    totals.set(Number(row.asset_id), (totals.get(Number(row.asset_id)) ?? 0n) + amount(row.amount));
  }
  return totals;
}

function assetsRegister(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.assetGroupId) { where.push('assets.group_id = ?'); params.push(filters.assetGroupId); }
  if (filters.status) { where.push('assets.status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT assets.*, groups.name AS group_name FROM fixed_assets AS assets
    INNER JOIN asset_groups AS groups ON groups.id = assets.group_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY assets.code`, params);
  return {
    rows: data.map((row) => ({
      code: String(row.code), name: String(row.name), group: String(row.group_name),
      purchaseDate: String(row.purchase_date), cost: money(amount(row.purchase_value)), salvage: money(amount(row.salvage_value)),
      life: String(row.useful_life_years), status: row.status === 'active' ? 'نشط' : 'موقوف',
    })),
    totals: [card('عدد الأصول', String(data.length)), card('قيمة الشراء', money(data.reduce((total, row) => total + amount(row.purchase_value), 0n))), card('القيمة التخريدية', money(data.reduce((total, row) => total + amount(row.salvage_value), 0n)))],
    note: 'سجل الأصول يعرض البيانات المسجلة دون احتساب إهلاك الفترة الحالية غير المرحلة.',
  };
}

function assetGroupsReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.assetGroupId) { where.push('groups.id = ?'); params.push(filters.assetGroupId); }
  const data = rows(database, `SELECT groups.*,
      (SELECT COUNT(*) FROM fixed_assets AS assets WHERE assets.group_id = groups.id) AS asset_count
    FROM asset_groups AS groups
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY groups.code`, params);
  const accumulated = assetAccumulated(database);
  const assets = rows(database, 'SELECT id, group_id, purchase_value FROM fixed_assets');
  const dataRows = data.map((row) => {
    const cost = assets.filter((asset) => Number(asset.group_id) === Number(row.id)).reduce((total, asset) => total + amount(asset.purchase_value), 0n);
    const accumulatedTotal = assets
      .filter((asset) => Number(asset.group_id) === Number(row.id))
      .reduce((total, asset) => total + (accumulated.get(Number(asset.id)) ?? 0n), 0n);
    return {
      code: String(row.code), name: String(row.name), assets: String(row.asset_count),
      cost: money(cost), accumulated: money(accumulatedTotal), book: money(cost > accumulatedTotal ? cost - accumulatedTotal : 0n),
      _cost: cost, _accumulated: accumulatedTotal,
    };
  });
  return {
    rows: dataRows.map(({ _cost, _accumulated, ...row }) => row),
    totals: [card('عدد المجموعات', String(dataRows.length)), card('قيمة الشراء', money(dataRows.reduce((total, row) => total + row._cost, 0n))), card('مجمع الإهلاك', money(dataRows.reduce((total, row) => total + row._accumulated, 0n)))],
    note: 'مجمع الإهلاك من بنود عمليات الإهلاك المرحلة فقط، ولا يشمل إهلاكًا لم يُرحّل بعد.',
  };
}

function assetDepreciationReport(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('runs.ends_on >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('runs.starts_on <= ?'); params.push(filters.to); }
  if (filters.assetGroupId) { where.push('assets.group_id = ?'); params.push(filters.assetGroupId); }
  const data = rows(database, `SELECT runs.number AS run_number, runs.starts_on, runs.ends_on, assets.code, assets.name, groups.name AS group_name, lines.amount
    FROM asset_depreciation_lines AS lines
    INNER JOIN asset_depreciation_runs AS runs ON runs.id = lines.run_id
    INNER JOIN fixed_assets AS assets ON assets.id = lines.asset_id
    INNER JOIN asset_groups AS groups ON groups.id = assets.group_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY runs.starts_on, assets.code`, params);
  return {
    rows: data.map((row) => ({
      run: String(row.run_number), from: String(row.starts_on), to: String(row.ends_on),
      asset: `${String(row.code)} — ${String(row.name)}`, group: String(row.group_name), amount: money(amount(row.amount)),
    })),
    totals: [card('عدد البنود', String(data.length)), card('إجمالي الإهلاك', money(data.reduce((total, row) => total + amount(row.amount), 0n)))],
    note: 'يشمل عمليات الإهلاك المرحلة التي تتقاطع فترتها مع الفترة المحددة.',
  };
}

function assetDepreciationLog(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = [];
  const params: Param[] = [];
  if (filters.from) { where.push('runs.ends_on >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('runs.starts_on <= ?'); params.push(filters.to); }
  const data = rows(database, `SELECT runs.*, COUNT(lines.asset_id) AS asset_count,
      COALESCE(SUM(lines.amount), 0) AS total, COALESCE(entries.created_at, '') AS posted_at
    FROM asset_depreciation_runs AS runs
    INNER JOIN journal_entries AS entries ON entries.id = runs.journal_entry_id
    LEFT JOIN asset_depreciation_lines AS lines ON lines.run_id = runs.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY runs.id ORDER BY runs.starts_on DESC`, params);
  return {
    rows: data.map((row) => ({
      run: String(row.number), from: String(row.starts_on), to: String(row.ends_on),
      assets: String(row.asset_count), total: money(amount(row.total)),
      journal: `#${String(row.journal_entry_id)}`, postedAt: String(row.posted_at ?? ''),
    })),
    totals: [card('عدد العمليات', String(data.length)), card('إجمالي الإهلاك', money(data.reduce((total, row) => total + amount(row.total), 0n)))],
    note: 'كل عملية إهلاك مرتبطة بقيد محاسبي مرحّل ولا يمكن تكرار ترحيلها لنفس الفترة.',
  };
}

// ── الإدارية ────────────────────────────────────────────────────────

function hrRecords(database: DatabaseSync, filters: ReportRunFilters): ReportBuild {
  const where: string[] = ["module = 'hr'"];
  const params: Param[] = [];
  if (filters.from) { where.push('substr(date, 1, 10) >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('substr(date, 1, 10) <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  const data = rows(database, `SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`, params);
  return {
    rows: data.map((row) => ({
      date: String(row.date ?? ''), title: String(row.title), party: String(row.party ?? ''),
      reference: String(row.reference ?? ''), amount: String(row.amount ?? ''), status: label({}, row.status),
    })),
    totals: [card('عدد السجلات', String(data.length))],
    note: 'تقرير لسجلات قسم الموارد البشرية. لا توجد جداول موظفين أو رواتب مستقلة في النظام الحالي.',
  };
}

// ── المحرك ──────────────────────────────────────────────────────────

type Builder = (database: DatabaseSync, filters: ReportRunFilters) => ReportBuild;

const BUILDERS: Record<string, Builder> = {
  'system-overview': (database) => systemOverview(database),
  'records-log': recordsLog,
  'master-data': (database) => masterData(database),
  'activity-log': activityLog,
  'chart-of-accounts': chartOfAccounts,
  'account-balances': accountBalances,
  'general-ledger': generalLedger,
  'trial-balance': trialBalance,
  'journal-entries': journalEntriesReport,
  'account-movement': accountMovement,
  'receivables-payables': receivablesPayables,
  'cost-centers-report': costCentersReport,
  'budget-vs-actual': budgetComparison,
  'cash-movement': (database, filters) => treasuryMovements(database, filters, 'cash'),
  'bank-movement': (database, filters) => treasuryMovements(database, filters, 'bank'),
  'treasury-balances': treasuryBalances,
  'receipts-payments': (database, filters) => receiptsPayments(database, filters),
  'revenue-expense': revenueExpense,
  'expenses-report': expensesReport,
  'customer-statement': (database, filters) => partyStatement(database, filters, 'customer'),
  'supplier-statement': (database, filters) => partyStatement(database, filters, 'supplier'),
  'party-balances': partyBalances,
  'customer-vouchers': (database, filters) => receiptsPayments(database, filters, 'customer'),
  'supplier-vouchers': (database, filters) => receiptsPayments(database, filters, 'supplier'),
  'party-contracts': propertyContractsReport,
  'collections-report': collectionsReport,
  installments: (database, filters) => installmentReport(database, filters, ''),
  'installments-due': (database, filters) => installmentReport(database, filters, 'due'),
  'installments-overdue': (database, filters) => installmentReport(database, filters, 'overdue'),
  'installments-paid': (database, filters) => installmentReport(database, filters, 'paid'),
  'installments-remaining': (database, filters) => installmentReport(database, filters, 'remaining'),
  'customer-installments-statement': customerInstallmentsStatement,
  'sales-documents': salesDocumentsReport,
  'sales-returns-report': salesReturnsReport,
  'purchase-invoices': purchaseInvoicesReport,
  'purchase-returns-report': purchaseReturnsReport,
  'inventory-balances': inventoryBalances,
  'item-movement': itemMovement,
  'zero-stock': (database) => zeroStock(database),
  'inventory-documents': inventoryDocuments,
  'projects-report': projectsReport,
  'contractor-contracts': contractorContractsReport,
  'contractor-certificates': contractorCertificatesReport,
  'contractor-vouchers': contractorVouchersReport,
  'project-expenses': projectExpenses,
  'project-costs': projectCosts,
  'assets-register': assetsRegister,
  'asset-groups-report': assetGroupsReport,
  'asset-depreciation': assetDepreciationReport,
  'asset-depreciation-log': assetDepreciationLog,
  'hr-records': hrRecords,
};

export function runReport(database: DatabaseSync, payload: unknown): ReportResult {
  if (!payload || typeof payload !== 'object') throw new Error('طلب التقرير غير صالح.');
  const { key, filters: rawFilters } = payload as { key?: unknown; filters?: unknown };
  if (typeof key !== 'string') throw new Error('لم يتم تحديد التقرير المطلوب.');
  const definition = findReportDefinition(key);
  const builder = BUILDERS[key];
  if (!definition || !builder) throw new Error('التقرير المطلوب غير معروف أو غير متاح.');
  const filters = readFilters(rawFilters);
  const buildResult = builder(database, filters);
  return build(definition, buildResult, filters, entityName(database));
}

export function readReportLibrary(database: DatabaseSync): ReportLibrary {
  const options: ReportFilterOptions = {
    customers: rows(database, "SELECT id, code, name FROM customers ORDER BY status = 'active' DESC, name, id").map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    suppliers: rows(database, "SELECT id, code, name FROM suppliers ORDER BY status = 'active' DESC, name, id").map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    accounts: rows(database, 'SELECT id, code, name FROM accounts WHERE postable = 1 ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    projects: rows(database, 'SELECT id, code, name FROM projects ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    costCenters: rows(database, 'SELECT id, code, name FROM cost_centers ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    treasury: [
      ...rows(database, 'SELECT id, code, name FROM treasury_cash_boxes ORDER BY code').map((row) => ({ value: `cash:${String(row.id)}`, label: `خزينة: ${String(row.name)} (${String(row.code)})` })),
      ...rows(database, 'SELECT id, code, name FROM treasury_bank_accounts ORDER BY code').map((row) => ({ value: `bank:${String(row.id)}`, label: `بنك: ${String(row.name)} (${String(row.code)})` })),
    ],
    items: rows(database, 'SELECT id, code, name_ar AS name FROM inventory_items ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    units: rows(database, 'SELECT id, code, name FROM property_units ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
    assetGroups: rows(database, 'SELECT id, code, name FROM asset_groups ORDER BY code').map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name) })),
  };
  return {
    definitions: REPORT_DEFINITIONS,
    options,
    entityName: entityName(database),
    defaults: defaultReportFilters(),
    generatedAt: new Date().toISOString(),
  };
}

function csvSafe(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportCsv(result: ReportResult): string {
  const lines = [
    [result.title],
    ['الفترة', formatReportRange(result.from, result.to)],
    ['تاريخ الإعداد', result.generatedAt],
    [],
    result.columns.map((column) => column.label),
    ...result.rows.map((row) => result.columns.map((column) => row[column.key] ?? '')),
    [],
    ['الإجماليات'],
    ...result.totals.map((total) => [total.label, total.value]),
  ];
  return lines.map((line) => line.map(csvSafe).join(',')).join('\r\n');
}

export function registerReportHandlers(requireDatabase: () => DatabaseSync): void {
  ipcMain.handle('reports:library', () => readReportLibrary(requireDatabase()));
  ipcMain.handle('reports:run', (_event, payload: unknown) => runReport(requireDatabase(), payload));

  ipcMain.handle('reports:export-pdf', async (event) => {
    requireDatabase();
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('تعذر تحديد نافذة التطبيق لتصدير التقرير.');
    const pdfOptions = {
      pageSize: 'A4',
      printBackground: true,
      landscape: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="direction: rtl; width: 100%; font-family: Tahoma, Arial, sans-serif; font-size: 9px; color: #555; text-align: center;">'
        + '<span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>'
        + '</div>',
    } as const;
    const testFilename = process.env.ELSAAD_TEST_PDF_FILE?.trim();
    if (testFilename && /^[\w.-]+\.pdf$/i.test(testFilename) && !testFilename.includes('..')) {
      const directory = join(app.getPath('userData'), 'screenshots');
      mkdirSync(directory, { recursive: true });
      const pdf = await window.webContents.printToPDF(pdfOptions);
      writeFileSync(join(directory, testFilename), pdf);
      return true;
    }
    const destination = await dialog.showSaveDialog(window, {
      title: 'تصدير التقرير كملف PDF',
      defaultPath: 'تقرير.pdf',
      filters: [{ name: 'ملف PDF', extensions: ['pdf'] }],
    });
    if (destination.canceled || !destination.filePath) return false;
    const pdf = await window.webContents.printToPDF(pdfOptions);
    writeFileSync(destination.filePath, pdf);
    return true;
  });

  ipcMain.handle('reports:export-csv', async (event, payload: unknown) => {
    requireDatabase();
    if (!payload || typeof payload !== 'object') throw new Error('بيانات تصدير التقرير غير صالحة.');
    const { fileName, content } = payload as { fileName?: unknown; content?: unknown };
    if (typeof fileName !== 'string' || !/^[\w\u0600-\u06FF .-]{1,120}$/u.test(fileName)) throw new Error('اسم ملف التصدير غير صالح.');
    if (typeof content !== 'string' || !content.trim()) throw new Error('لا يوجد تقرير معروض لتصديره.');
    if (content.length > 8_000_000) throw new Error('حجم التقرير أكبر من الحد المسموح للتصدير.');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('تعذر تحديد نافذة التطبيق لتصدير التقرير.');
    const safeName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
    const testFilename = process.env.ELSAAD_TEST_CSV_FILE?.trim();
    if (testFilename && /^[\w.-]+\.csv$/i.test(testFilename) && !testFilename.includes('..')) {
      const directory = join(app.getPath('userData'), 'screenshots');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, testFilename), `\uFEFF${content}`, 'utf8');
      return true;
    }
    const destination = await dialog.showSaveDialog(window, {
      title: 'تصدير التقرير إلى Excel (CSV)',
      defaultPath: safeName,
      filters: [{ name: 'ملف Excel (CSV)', extensions: ['csv'] }],
    });
    if (destination.canceled || !destination.filePath) return false;
    writeFileSync(destination.filePath, `\uFEFF${content}`, 'utf8');
    return true;
  });

}
