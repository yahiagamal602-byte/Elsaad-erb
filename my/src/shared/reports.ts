export const REPORT_GROUPS = [
  { key: 'general', label: 'التقارير العامة', hint: 'نظرة شاملة على النظام والبيانات الأساسية' },
  { key: 'accounting', label: 'التقارير المحاسبية', hint: 'الدليل والأرصدة والقيود والموازنة' },
  { key: 'financial', label: 'التقارير المالية', hint: 'الخزائن والبنوك والمقبوضات والمصروفات' },
  { key: 'parties', label: 'تقارير العملاء والموردين', hint: 'كشوف الحساب والأرصدة والسندات' },
  { key: 'installments', label: 'تقارير الأقساط والتحصيلات', hint: 'أقساط عقود الوحدات والتحصيل' },
  { key: 'sales', label: 'تقارير المبيعات والمشتريات', hint: 'الفواتير والمستندات والمرتجعات' },
  { key: 'inventory', label: 'تقارير المخزون', hint: 'الأرصدة والحركات والمستندات' },
  { key: 'projects', label: 'تقارير المشروعات والمقاولين', hint: 'المشروعات والعقود والمستخلصات' },
  { key: 'assets', label: 'تقارير الأصول', hint: 'سجل الأصول والقيم والإهلاك' },
  { key: 'admin', label: 'التقارير الإدارية', hint: 'سجلات الموارد البشرية والبيانات الإدارية' },
] as const;

export type ReportGroupKey = (typeof REPORT_GROUPS)[number]['key'];

export type ReportFilterKey =
  | 'period'
  | 'asOf'
  | 'customer'
  | 'supplier'
  | 'account'
  | 'project'
  | 'costCenter'
  | 'treasury'
  | 'status'
  | 'installmentStatus'
  | 'item'
  | 'unit'
  | 'assetGroup';

export interface ReportColumn {
  key: string;
  label: string;
  kind?: 'text' | 'amount' | 'date' | 'number';
  width?: string;
}

export interface ReportStatusOption {
  value: string;
  label: string;
}

export interface ReportDefinition {
  key: string;
  title: string;
  group: ReportGroupKey;
  description: string;
  filters: ReportFilterKey[];
  columns: ReportColumn[];
  statusOptions?: ReportStatusOption[];
  emptyHint: string;
  exportable: boolean;
}

export interface ReportRunFilters {
  from: string;
  to: string;
  customerId: number | null;
  supplierId: number | null;
  accountId: number | null;
  projectId: number | null;
  costCenterId: number | null;
  treasury: string;
  status: string;
  installmentStatus: string;
  itemId: number | null;
  unitId: number | null;
  assetGroupId: number | null;
}

export interface ReportSummaryCard {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

export interface ReportResult {
  key: string;
  title: string;
  description: string;
  group: ReportGroupKey;
  generatedAt: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string>>;
  totals: ReportSummaryCard[];
  footer: Array<{ key: string; value: string }>;
  note: string;
}

export interface ReportFilterOption {
  id: number;
  code: string;
  name: string;
}

export interface ReportFilterOptions {
  customers: ReportFilterOption[];
  suppliers: ReportFilterOption[];
  accounts: ReportFilterOption[];
  projects: ReportFilterOption[];
  costCenters: ReportFilterOption[];
  treasury: Array<{ value: string; label: string }>;
  items: ReportFilterOption[];
  units: ReportFilterOption[];
  assetGroups: ReportFilterOption[];
}

export interface ReportLibrary {
  definitions: ReportDefinition[];
  options: ReportFilterOptions;
  entityName: string;
  defaults: ReportRunFilters;
  generatedAt: string;
}

export function emptyReportFilters(): ReportRunFilters {
  return {
    from: '',
    to: '',
    customerId: null,
    supplierId: null,
    accountId: null,
    projectId: null,
    costCenterId: null,
    treasury: '',
    status: '',
    installmentStatus: '',
    itemId: null,
    unitId: null,
    assetGroupId: null,
  };
}

export const REPORT_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  approved: 'معتمد',
  posted: 'مرحّل',
  cancelled: 'ملغي',
  active: 'نشط',
  inactive: 'موقوف',
  'in-progress': 'قيد التنفيذ',
  'on-hold': 'متوقف',
  completed: 'مكتمل',
  new: 'جديد',
  paid: 'مسدد',
  partial: 'مسدد جزئيًا',
  unpaid: 'غير مسدد',
  due: 'مستحق',
  overdue: 'متأخر',
  upcoming: 'قادم',
  available: 'متاح',
  reserved: 'محجوز',
  sold: 'مباع',
  cash: 'نقدي',
  bank: 'بنكي',
  receipt: 'مقبوضات',
  payment: 'مدفوعات',
};

const DOCUMENT_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'draft', label: 'مسودة' },
  { value: 'approved', label: 'معتمد' },
  { value: 'cancelled', label: 'ملغي' },
];

const VOUCHER_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'draft', label: 'مسودة' },
  { value: 'posted', label: 'مرحّل' },
];

const ACTIVE_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'active', label: 'نشط' },
  { value: 'inactive', label: 'موقوف' },
];

const PROJECT_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'new', label: 'جديد' },
  { value: 'in-progress', label: 'قيد التنفيذ' },
  { value: 'on-hold', label: 'متوقف' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغي' },
];

const RECORD_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'new', label: 'جديد' },
  { value: 'in-progress', label: 'قيد المعالجة' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغي' },
];

const INSTALLMENT_STATUS_OPTIONS: ReportStatusOption[] = [
  { value: 'unpaid', label: 'غير مسدد' },
  { value: 'partial', label: 'مسدد جزئيًا' },
  { value: 'paid', label: 'مسدد' },
  { value: 'overdue', label: 'متأخر' },
  { value: 'due', label: 'مستحق' },
  { value: 'upcoming', label: 'قادم' },
];

const columns = (...entries: Array<[string, string, ReportColumn['kind']?]>): ReportColumn[] =>
  entries.map(([key, label, kind]) => ({ key, label, kind }));

const periodColumn = columns(['date', 'التاريخ', 'date']);

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // ── التقارير العامة ──────────────────────────────────────────────
  {
    key: 'system-overview',
    title: 'تقرير شامل للنظام',
    group: 'general',
    description: 'عدد السجلات والمبالغ المسجلة في كل وحدة من وحدات النظام المتاحة.',
    filters: [],
    columns: columns(['section', 'الوحدة'], ['records', 'عدد السجلات', 'number'], ['amount', 'الإجمالي', 'amount'], ['extra', 'ملاحظة']),
    emptyHint: 'لم تُسجَّل بيانات تشغيلية بعد. ابدأ بإدخال الحسابات والعملاء والأصناف.',
    exportable: true,
  },
  {
    key: 'records-log',
    title: 'سجل العمليات خلال فترة',
    group: 'general',
    description: 'كل السجلات المسجلة في أقسام النظام خلال الفترة المحددة مع حالتها.',
    filters: ['period', 'status'],
    statusOptions: RECORD_STATUS_OPTIONS,
    columns: columns(['date', 'التاريخ', 'date'], ['module', 'القسم'], ['title', 'اسم السجل'], ['party', 'الطرف'], ['reference', 'المرجع'], ['amount', 'القيمة', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد سجلات مطابقة للفترة أو الحالة المحددة.',
    exportable: true,
  },
  {
    key: 'master-data',
    title: 'تقرير البيانات الأساسية',
    group: 'general',
    description: 'الحسابات والعملاء والموردون والأصناف والمشروعات ومراكز التكلفة في تقرير واحد.',
    filters: [],
    columns: columns(['type', 'نوع البيانات'], ['code', 'الكود'], ['name', 'الاسم'], ['detail', 'تفصيل'], ['status', 'الحالة']),
    emptyHint: 'لا توجد بيانات أساسية مسجلة بعد.',
    exportable: true,
  },
  {
    key: 'activity-log',
    title: 'تقرير النشاط والتغييرات',
    group: 'general',
    description: 'السجلات التي أُنشئت أو عُدّلت خلال الفترة، بحسب تاريخ آخر تحديث.',
    filters: ['period'],
    columns: columns(['updated', 'آخر تحديث', 'date'], ['module', 'القسم'], ['title', 'السجل'], ['reference', 'المرجع'], ['status', 'الحالة'], ['created', 'تاريخ الإنشاء', 'date']),
    emptyHint: 'لا يوجد نشاط مسجل خلال الفترة المحددة.',
    exportable: true,
  },

  // ── التقارير المحاسبية ───────────────────────────────────────────
  {
    key: 'chart-of-accounts',
    title: 'الدليل المحاسبي',
    group: 'accounting',
    description: 'شجرة الحسابات بالأنواع والحساب الأب وإمكانية الترحيل.',
    filters: ['account'],
    columns: columns(['code', 'الكود'], ['name', 'اسم الحساب'], ['type', 'النوع'], ['parent', 'الحساب الأب'], ['postable', 'قابل للترحيل'], ['notes', 'ملاحظات']),
    emptyHint: 'لم تُضف حسابات بعد.',
    exportable: true,
  },
  {
    key: 'account-balances',
    title: 'أرصدة الحسابات',
    group: 'accounting',
    description: 'إجمالي المدين والدائن والرصيد لكل حساب من القيود المرحلة.',
    filters: ['period', 'account'],
    columns: columns(['code', 'الكود'], ['name', 'الحساب'], ['type', 'النوع'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد حركة مرحّلة على الحسابات خلال الفترة.',
    exportable: true,
  },
  {
    key: 'general-ledger',
    title: 'دفتر الأستاذ',
    group: 'accounting',
    description: 'حركة القيود المرحلة سطرًا بسطر مع رصيد جارٍ لكل حساب.',
    filters: ['period', 'account', 'costCenter'],
    columns: columns(['date', 'التاريخ', 'date'], ['reference', 'المرجع'], ['account', 'الحساب'], ['description', 'البيان'], ['costCenter', 'مركز التكلفة'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد قيود مرحّلة مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'trial-balance',
    title: 'ميزان المراجعة',
    group: 'accounting',
    description: 'الأرصدة الختامية المدينة والدائنة للحسابات حتى التاريخ المحدد مع التحقق من التوازن.',
    filters: ['asOf'],
    columns: columns(['code', 'الكود'], ['name', 'الحساب'], ['type', 'النوع'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد قيود مرحّلة حتى التاريخ المحدد.',
    exportable: true,
  },
  {
    key: 'journal-entries',
    title: 'القيود اليومية',
    group: 'accounting',
    description: 'القيود المرحلة خلال الفترة مع عدد الأسطر وإجمالي المدين والدائن.',
    filters: ['period', 'costCenter'],
    columns: columns(['date', 'التاريخ', 'date'], ['reference', 'المرجع'], ['description', 'البيان'], ['lines', 'عدد الأسطر', 'number'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount']),
    emptyHint: 'لا توجد قيود يومية مرحّلة في الفترة.',
    exportable: true,
  },
  {
    key: 'account-movement',
    title: 'حركة الحساب خلال فترة',
    group: 'accounting',
    description: 'رصيد أول المدة وحركة المدين والدائن ورصيد آخر المدة لكل حساب.',
    filters: ['period', 'account'],
    columns: columns(['code', 'الكود'], ['name', 'الحساب'], ['type', 'النوع'], ['opening', 'أول المدة', 'amount'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['closing', 'آخر المدة', 'amount']),
    emptyHint: 'لا توجد حركة على الحسابات المحددة.',
    exportable: true,
  },
  {
    key: 'receivables-payables',
    title: 'تقرير المدين والدائن',
    group: 'accounting',
    description: 'أرصدة حسابات العملاء والموردين المدينة والدائنة في نهاية الفترة.',
    filters: ['period'],
    columns: columns(['type', 'النوع'], ['code', 'الكود'], ['name', 'الاسم'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد حسابات عملاء أو موردين مربوطة بحركة مرحّلة.',
    exportable: true,
  },
  {
    key: 'cost-centers-report',
    title: 'تقرير مراكز التكلفة',
    group: 'accounting',
    description: 'حركة المدين والدائن لكل مركز تكلفة من القيود المرحلة.',
    filters: ['period', 'costCenter'],
    columns: columns(['code', 'الكود'], ['name', 'مركز التكلفة'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد حركة مرتبطة بمراكز التكلفة في الفترة.',
    exportable: true,
  },
  {
    key: 'budget-vs-actual',
    title: 'الموازنة التقديرية ومقارنة الفعلي',
    group: 'accounting',
    description: 'مقارنة بنود الموازنة التقديرية بالحركة الفعلية المرحلة في فترة الموازنة.',
    filters: ['period', 'account'],
    columns: columns(['budget', 'الموازنة'], ['account', 'الحساب'], ['category', 'الفئة'], ['budgetAmount', 'المقدّر', 'amount'], ['actual', 'الفعلي', 'amount'], ['variance', 'الفرق', 'amount'], ['usage', 'نسبة الاستخدام']),
    emptyHint: 'لا توجد موازنات تقديرية مسجلة. أضف موازنة من صفحة الموازنة التقديرية.',
    exportable: true,
  },

  // ── التقارير المالية ─────────────────────────────────────────────
  {
    key: 'cash-movement',
    title: 'حركة الخزينة',
    group: 'financial',
    description: 'المقبوضات والمدفوعات المرحلة على حسابات الخزائن مع الرصيد الجاري.',
    filters: ['period', 'treasury'],
    columns: columns(['date', 'التاريخ', 'date'], ['treasury', 'الخزينة'], ['reference', 'المرجع'], ['description', 'البيان'], ['debit', 'قبض', 'amount'], ['credit', 'صرف', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد حركة مرحّلة على الخزائن في الفترة.',
    exportable: true,
  },
  {
    key: 'bank-movement',
    title: 'حركة البنوك',
    group: 'financial',
    description: 'الحركة المرحلة على حسابات البنوك مع الرصيد الجاري لكل بنك.',
    filters: ['period', 'treasury'],
    columns: columns(['date', 'التاريخ', 'date'], ['treasury', 'البنك'], ['reference', 'المرجع'], ['description', 'البيان'], ['debit', 'إيداع', 'amount'], ['credit', 'سحب', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا توجد حركة مرحّلة على البنوك في الفترة.',
    exportable: true,
  },
  {
    key: 'treasury-balances',
    title: 'أرصدة الخزائن والبنوك',
    group: 'financial',
    description: 'الرصيد الافتتاحي والحركة والرصيد الحالي لكل خزينة وبنك.',
    filters: ['period', 'treasury'],
    columns: columns(['type', 'النوع'], ['name', 'الخزينة / البنك'], ['account', 'الحساب المحاسبي'], ['opening', 'افتتاحي', 'amount'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['closing', 'الرصيد الحالي', 'amount']),
    emptyHint: 'لا توجد خزائن أو بنوك مسجلة.',
    exportable: true,
  },
  {
    key: 'receipts-payments',
    title: 'المقبوضات والمدفوعات',
    group: 'financial',
    description: 'سندات القبض من العملاء وسندات السداد للموردين مع طريقة الدفع والحالة.',
    filters: ['period', 'customer', 'supplier', 'treasury', 'status'],
    statusOptions: VOUCHER_STATUS_OPTIONS,
    columns: columns(['number', 'رقم السند'], ['date', 'التاريخ', 'date'], ['type', 'النوع'], ['party', 'الطرف'], ['method', 'طريقة الدفع'], ['reference', 'المرجع'], ['amount', 'المبلغ', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد سندات قبض أو سداد مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'revenue-expense',
    title: 'الإيرادات والمصروفات',
    group: 'financial',
    description: 'أرصدة حسابات الإيرادات والمصروفات من القيود المرحلة خلال الفترة.',
    filters: ['period'],
    columns: columns(['type', 'النوع'], ['code', 'الكود'], ['name', 'الحساب'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['net', 'الصافي', 'amount']),
    emptyHint: 'لا توجد حركة على حسابات الإيرادات أو المصروفات.',
    exportable: true,
  },
  {
    key: 'expenses-report',
    title: 'تقرير المصروفات',
    group: 'financial',
    description: 'المصروفات المسجلة مع الإجمالي والمدفوع والمتبقي ومركز التكلفة والمشروع.',
    filters: ['period', 'project', 'costCenter', 'status'],
    statusOptions: VOUCHER_STATUS_OPTIONS,
    columns: columns(['number', 'الرقم'], ['date', 'التاريخ', 'date'], ['description', 'البيان'], ['project', 'المشروع'], ['costCenter', 'مركز التكلفة'], ['total', 'الإجمالي', 'amount'], ['paid', 'المدفوع', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد مصروفات مسجلة مطابقة للفلاتر.',
    exportable: true,
  },

  // ── العملاء والموردون ────────────────────────────────────────────
  {
    key: 'customer-statement',
    title: 'كشف حساب عميل',
    group: 'parties',
    description: 'حركة حساب العميل المحاسبي مع رصيد أول المدة والرصيد الجاري.',
    filters: ['period', 'customer'],
    columns: columns(['date', 'التاريخ', 'date'], ['reference', 'المرجع'], ['description', 'البيان'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'اختر عميلًا لعرض كشف الحساب. يلزم ربط العميل بحساب محاسبي.',
    exportable: true,
  },
  {
    key: 'supplier-statement',
    title: 'كشف حساب مورد',
    group: 'parties',
    description: 'حركة حساب المورد المحاسبي مع رصيد أول المدة والرصيد الجاري.',
    filters: ['period', 'supplier'],
    columns: columns(['date', 'التاريخ', 'date'], ['reference', 'المرجع'], ['description', 'البيان'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'اختر موردًا لعرض كشف الحساب. يلزم ربط المورد بحساب محاسبي.',
    exportable: true,
  },
  {
    key: 'party-balances',
    title: 'أرصدة العملاء والموردين',
    group: 'parties',
    description: 'ميزان أرصدة جميع العملاء والموردين من الحسابات المرتبطة بهم.',
    filters: ['period'],
    columns: columns(['type', 'النوع'], ['code', 'الكود'], ['name', 'الاسم'], ['account', 'الحساب'], ['debit', 'مدين', 'amount'], ['credit', 'دائن', 'amount'], ['balance', 'الرصيد', 'amount']),
    emptyHint: 'لا يوجد عملاء أو موردون مسجلون.',
    exportable: true,
  },
  {
    key: 'customer-vouchers',
    title: 'سندات العملاء',
    group: 'parties',
    description: 'سندات القبض المسجلة على العملاء مع حالة الترحيل.',
    filters: ['period', 'customer', 'treasury', 'status'],
    statusOptions: VOUCHER_STATUS_OPTIONS,
    columns: columns(['number', 'رقم السند'], ['date', 'التاريخ', 'date'], ['party', 'العميل'], ['method', 'طريقة الدفع'], ['reference', 'المرجع'], ['amount', 'المبلغ', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد سندات عملاء مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'supplier-vouchers',
    title: 'سندات الموردين',
    group: 'parties',
    description: 'سندات السداد المسجلة للموردين مع حالة الترحيل.',
    filters: ['period', 'supplier', 'treasury', 'status'],
    statusOptions: VOUCHER_STATUS_OPTIONS,
    columns: columns(['number', 'رقم السند'], ['date', 'التاريخ', 'date'], ['party', 'المورد'], ['method', 'طريقة الدفع'], ['reference', 'المرجع'], ['amount', 'المبلغ', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد سندات موردين مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'party-contracts',
    title: 'عقود العملاء والأرصدة المستحقة',
    group: 'parties',
    description: 'عقود بيع الوحدات وقيمتها والتحصيل والمتبقي على كل عقد.',
    filters: ['period', 'customer', 'project'],
    columns: columns(['number', 'رقم العقد'], ['date', 'التاريخ', 'date'], ['customer', 'العميل'], ['project', 'المشروع'], ['total', 'قيمة العقد', 'amount'], ['collected', 'المحصّل', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد عقود بيع وحدات مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'collections-report',
    title: 'التحصيلات خلال فترة',
    group: 'parties',
    description: 'تحصيلات عقود بيع الوحدات المسجلة خلال الفترة مع قناة التحصيل.',
    filters: ['period', 'customer', 'treasury'],
    columns: columns(['date', 'التاريخ', 'date'], ['contract', 'العقد'], ['customer', 'العميل'], ['channel', 'قناة التحصيل'], ['reference', 'المرجع'], ['amount', 'المبلغ', 'amount']),
    emptyHint: 'لا توجد تحصيلات مسجلة في الفترة.',
    exportable: true,
  },

  // ── الأقساط والتحصيلات ───────────────────────────────────────────
  {
    key: 'installments',
    title: 'تقرير أقساط العملاء',
    group: 'installments',
    description: 'كل أقساط عقود الوحدات مع المسدد والمتبقي وحالة السداد والاستحقاق.',
    filters: ['period', 'customer', 'project', 'unit', 'installmentStatus'],
    statusOptions: INSTALLMENT_STATUS_OPTIONS,
    columns: columns(['contract', 'العقد'], ['customer', 'العميل'], ['description', 'القسط'], ['dueDate', 'الاستحقاق', 'date'], ['amount', 'القيمة', 'amount'], ['paid', 'المسدد', 'amount'], ['adjusted', 'الخصم', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أقساط مطابقة للفلاتر. تُنشأ الأقساط من عقود بيع الوحدات.',
    exportable: true,
  },
  {
    key: 'installments-due',
    title: 'الأقساط المستحقة',
    group: 'installments',
    description: 'الأقساط غير المسددة التي حلّ تاريخ استحقاقها حتى اليوم.',
    filters: ['period', 'customer', 'project', 'unit'],
    columns: columns(['contract', 'العقد'], ['customer', 'العميل'], ['description', 'القسط'], ['dueDate', 'الاستحقاق', 'date'], ['amount', 'القيمة', 'amount'], ['paid', 'المسدد', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أقساط مستحقة حاليًا.',
    exportable: true,
  },
  {
    key: 'installments-overdue',
    title: 'الأقساط المتأخرة',
    group: 'installments',
    description: 'الأقساط غير المسددة التي تجاوز تاريخ استحقاقها اليوم.',
    filters: ['period', 'customer', 'project', 'unit'],
    columns: columns(['contract', 'العقد'], ['customer', 'العميل'], ['description', 'القسط'], ['dueDate', 'الاستحقاق', 'date'], ['amount', 'القيمة', 'amount'], ['paid', 'المسدد', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أقساط متأخرة.',
    exportable: true,
  },
  {
    key: 'installments-paid',
    title: 'الأقساط المحصلة',
    group: 'installments',
    description: 'الأقساط المدفوعة بالكامل مع قيمة القسط والمبلغ المحصل.',
    filters: ['period', 'customer', 'project', 'unit'],
    columns: columns(['contract', 'العقد'], ['customer', 'العميل'], ['description', 'القسط'], ['dueDate', 'الاستحقاق', 'date'], ['amount', 'القيمة', 'amount'], ['paid', 'المحصل', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أقساط محصلة بالكامل.',
    exportable: true,
  },
  {
    key: 'installments-remaining',
    title: 'الأقساط المتبقية',
    group: 'installments',
    description: 'الأقساط غير المسددة أو المسددة جزئيًا مع المتبقي على كل قسط.',
    filters: ['period', 'customer', 'project', 'unit'],
    columns: columns(['contract', 'العقد'], ['customer', 'العميل'], ['description', 'القسط'], ['dueDate', 'الاستحقاق', 'date'], ['amount', 'القيمة', 'amount'], ['paid', 'المسدد', 'amount'], ['remaining', 'المتبقي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أقساط متبقية.',
    exportable: true,
  },
  {
    key: 'customer-installments-statement',
    title: 'كشف حساب العميل والأقساط',
    group: 'installments',
    description: 'ملخص تعاقدي لكل عميل: قيمة العقود والمحصل والمتبقي وعدد الأقساط.',
    filters: ['customer', 'project'],
    columns: columns(['customer', 'العميل'], ['contract', 'العقد'], ['project', 'المشروع'], ['total', 'قيمة العقد', 'amount'], ['collected', 'المحصّل', 'amount'], ['remaining', 'المتبقي', 'amount'], ['installments', 'عدد الأقساط', 'number'], ['overdue', 'متأخر', 'number']),
    emptyHint: 'اختر عميلًا أو اترك الفلتر فارغًا لعرض جميع العملاء الذين لديهم عقود.',
    exportable: true,
  },

  // ── المبيعات والمشتريات ──────────────────────────────────────────
  {
    key: 'sales-documents',
    title: 'مستندات المبيعات',
    group: 'sales',
    description: 'أوامر التشغيل والمقايسات والمستخلصات والفواتير مع قيمتها وحالتها.',
    filters: ['period', 'customer', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم المستند'], ['type', 'النوع'], ['date', 'التاريخ', 'date'], ['customer', 'العميل'], ['reference', 'المرجع'], ['total', 'القيمة', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد مستندات مبيعات مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'sales-returns-report',
    title: 'مرتجعات المبيعات',
    group: 'sales',
    description: 'مرتجعات فواتير المبيعات مع قيمة المرتجع وحالته.',
    filters: ['period', 'customer', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم المرتجع'], ['date', 'التاريخ', 'date'], ['invoice', 'الفاتورة'], ['customer', 'العميل'], ['reason', 'السبب'], ['total', 'قيمة المرتجع', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد مرتجعات مبيعات مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'purchase-invoices',
    title: 'فواتير المشتريات',
    group: 'sales',
    description: 'فواتير الموردين مع إجمالي البنود والحالة وتاريخ الاستحقاق.',
    filters: ['period', 'supplier', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'الفاتورة'], ['date', 'التاريخ', 'date'], ['supplier', 'المورد'], ['reference', 'مرجع المورد'], ['category', 'التصنيف'], ['total', 'الإجمالي', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد فواتير مشتريات مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'purchase-returns-report',
    title: 'مرتجعات المشتريات',
    group: 'sales',
    description: 'مرتجعات فواتير المشتريات مع قيمة المرتجع وحالته.',
    filters: ['period', 'supplier', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم المرتجع'], ['date', 'التاريخ', 'date'], ['invoice', 'الفاتورة'], ['supplier', 'المورد'], ['reason', 'السبب'], ['total', 'قيمة المرتجع', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد مرتجعات مشتريات مطابقة للفلاتر.',
    exportable: true,
  },

  // ── المخزون ──────────────────────────────────────────────────────
  {
    key: 'inventory-balances',
    title: 'أرصدة المخزون',
    group: 'inventory',
    description: 'رصيد كل صنف في كل مخزن محسوبًا من حركات المخزون الفعلية.',
    filters: ['item'],
    columns: columns(['code', 'كود الصنف'], ['item', 'الصنف'], ['warehouse', 'المخزن'], ['unit', 'الوحدة'], ['quantity', 'الرصيد', 'number'], ['cost', 'متوسط التكلفة', 'amount'], ['value', 'القيمة', 'amount']),
    emptyHint: 'لا توجد أرصدة مخزون. سجّل أرصدة افتتاحية أو أذون استلام.',
    exportable: true,
  },
  {
    key: 'item-movement',
    title: 'حركة الأصناف',
    group: 'inventory',
    description: 'كل حركات المخزون (افتتاحي، استلام، صرف، تحويل) خلال الفترة.',
    filters: ['period', 'item'],
    columns: columns(['date', 'التاريخ', 'date'], ['type', 'نوع الحركة'], ['document', 'المستند'], ['item', 'الصنف'], ['warehouse', 'المخزن'], ['quantity', 'الكمية', 'number'], ['cost', 'التكلفة', 'amount'], ['value', 'القيمة', 'amount']),
    emptyHint: 'لا توجد حركات مخزون في الفترة المحددة.',
    exportable: true,
  },
  {
    key: 'zero-stock',
    title: 'أصناف برصيد صفري أو سالب',
    group: 'inventory',
    description: 'الأصناف التي وصل رصيدها إلى صفر أو أقل بعد كل الحركات المسجلة.',
    filters: ['item'],
    columns: columns(['code', 'كود الصنف'], ['item', 'الصنف'], ['unit', 'الوحدة'], ['quantity', 'الرصيد', 'number'], ['warehouses', 'عدد المخازن', 'number']),
    emptyHint: 'كل الأصناف لديها أرصدة موجبة.',
    exportable: true,
  },
  {
    key: 'inventory-documents',
    title: 'المستندات المخزنية',
    group: 'inventory',
    description: 'أذون الاستلام وسندات الصرف والتحويل بين المخازن خلال الفترة.',
    filters: ['period', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['type', 'النوع'], ['number', 'الرقم'], ['date', 'التاريخ', 'date'], ['warehouse', 'المخزن'], ['lines', 'البنود', 'number'], ['quantity', 'إجمالي الكمية', 'number'], ['status', 'الحالة']),
    emptyHint: 'لا توجد مستندات مخزنية في الفترة.',
    exportable: true,
  },

  // ── المشروعات والمقاولون ─────────────────────────────────────────
  {
    key: 'projects-report',
    title: 'تقرير المشروعات',
    group: 'projects',
    description: 'المشروعات وتواريخها وحالتها وعدد بنود الأعمال وسندات الصرف.',
    filters: ['period', 'project', 'status'],
    statusOptions: PROJECT_STATUS_OPTIONS,
    columns: columns(['code', 'الكود'], ['name', 'المشروع'], ['start', 'البداية', 'date'], ['end', 'النهاية', 'date'], ['status', 'الحالة'], ['workItems', 'بنود الأعمال', 'number'], ['issues', 'سندات الصرف', 'number'], ['expenses', 'المصروفات', 'amount']),
    emptyHint: 'لا توجد مشروعات مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'contractor-contracts',
    title: 'عقود المقاولين',
    group: 'projects',
    description: 'عقود ومقايسات المقاولين مع قيمتها ومشروعها وحالتها.',
    filters: ['period', 'project', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم العقد'], ['date', 'التاريخ', 'date'], ['contractor', 'المقاول'], ['project', 'المشروع'], ['status', 'الحالة'], ['total', 'القيمة', 'amount']),
    emptyHint: 'لا توجد عقود مقاولين مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'contractor-certificates',
    title: 'مستخلصات المقاولين',
    group: 'projects',
    description: 'مستخلصات المقاولين مع العقد والمشروع والقيمة والحالة.',
    filters: ['period', 'project', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم المستخلص'], ['date', 'التاريخ', 'date'], ['contractor', 'المقاول'], ['project', 'المشروع'], ['contract', 'العقد'], ['status', 'الحالة'], ['total', 'القيمة', 'amount']),
    emptyHint: 'لا توجد مستخلصات مقاولين مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'contractor-vouchers',
    title: 'سندات المقاولين',
    group: 'projects',
    description: 'سندات صرف المقاولين مع طريقة الدفع والمشروع والحالة.',
    filters: ['period', 'project', 'status'],
    statusOptions: DOCUMENT_STATUS_OPTIONS,
    columns: columns(['number', 'رقم السند'], ['date', 'التاريخ', 'date'], ['contractor', 'المقاول'], ['project', 'المشروع'], ['method', 'طريقة الدفع'], ['status', 'الحالة'], ['amount', 'المبلغ', 'amount']),
    emptyHint: 'لا توجد سندات مقاولين مطابقة للفلاتر.',
    exportable: true,
  },
  {
    key: 'project-expenses',
    title: 'مصروفات المشروعات',
    group: 'projects',
    description: 'المصروفات المرتبطة بمشروعات ومراكز تكلفة محددة.',
    filters: ['period', 'project', 'costCenter'],
    columns: columns(['date', 'التاريخ', 'date'], ['number', 'الرقم'], ['description', 'البيان'], ['project', 'المشروع'], ['costCenter', 'مركز التكلفة'], ['total', 'الإجمالي', 'amount'], ['paid', 'المدفوع', 'amount'], ['remaining', 'المتبقي', 'amount']),
    emptyHint: 'لا توجد مصروفات مرتبطة بمشروعات في الفترة.',
    exportable: true,
  },
  {
    key: 'project-costs',
    title: 'تكاليف المشروعات ومراكز التكلفة',
    group: 'projects',
    description: 'تكلفة مواد الصرف المخزني والمصروفات لكل مشروع مقارنة بإجمالي التكلفة.',
    filters: ['period', 'project'],
    columns: columns(['code', 'كود المشروع'], ['project', 'المشروع'], ['materials', 'مواد مخزنية', 'amount'], ['expenses', 'مصروفات', 'amount'], ['total', 'إجمالي التكلفة', 'amount']),
    emptyHint: 'لا توجد تكاليف مرتبطة بالمشروعات في الفترة.',
    exportable: true,
  },

  // ── الأصول ───────────────────────────────────────────────────────
  {
    key: 'assets-register',
    title: 'سجل الأصول',
    group: 'assets',
    description: 'كل الأصول الثابتة مع مجموعتها وتاريخ الشراء والعمر الإنتاجي والحالة.',
    filters: ['assetGroup'],
    columns: columns(['code', 'الكود'], ['name', 'الأصل'], ['group', 'المجموعة'], ['purchaseDate', 'تاريخ الشراء', 'date'], ['cost', 'قيمة الشراء', 'amount'], ['salvage', 'القيمة التخريدية', 'amount'], ['life', 'العمر (سنة)', 'number'], ['status', 'الحالة']),
    emptyHint: 'لا توجد أصول مسجلة. أضف أصلًا من صفحة تكويد الأصول.',
    exportable: true,
  },
  {
    key: 'asset-groups-report',
    title: 'مجموعات الأصول',
    group: 'assets',
    description: 'مجموعات الأصول مع عدد الأصول والقيمة الدفترية لكل مجموعة.',
    filters: ['assetGroup'],
    columns: columns(['code', 'الكود'], ['name', 'المجموعة'], ['assets', 'عدد الأصول', 'number'], ['cost', 'قيمة الشراء', 'amount'], ['accumulated', 'مجمع الإهلاك', 'amount'], ['book', 'القيمة الدفترية', 'amount']),
    emptyHint: 'لا توجد مجموعات أصول مسجلة.',
    exportable: true,
  },
  {
    key: 'asset-depreciation',
    title: 'الإهلاك خلال فترة',
    group: 'assets',
    description: 'بنود الإهلاك المرحلة داخل الفترة لكل أصل.',
    filters: ['period', 'assetGroup'],
    columns: columns(['run', 'عملية الإهلاك'], ['from', 'من', 'date'], ['to', 'إلى', 'date'], ['asset', 'الأصل'], ['group', 'المجموعة'], ['amount', 'قيمة الإهلاك', 'amount']),
    emptyHint: 'لا توجد عمليات إهلاك مرحّلة في الفترة.',
    exportable: true,
  },
  {
    key: 'asset-depreciation-log',
    title: 'سجل ترحيل الإهلاك',
    group: 'assets',
    description: 'عمليات ترحيل الإهلاك مع القيد المحاسبي وعدد الأصول والإجمالي.',
    filters: ['period'],
    columns: columns(['run', 'العملية'], ['from', 'من', 'date'], ['to', 'إلى', 'date'], ['assets', 'عدد الأصول', 'number'], ['total', 'الإجمالي', 'amount'], ['journal', 'القيد المحاسبي'], ['postedAt', 'وقت الترحيل']),
    emptyHint: 'لم تُرحَّل أي عملية إهلاك بعد.',
    exportable: true,
  },

  // ── الإدارية ─────────────────────────────────────────────────────
  {
    key: 'hr-records',
    title: 'سجلات الموارد البشرية',
    group: 'admin',
    description: 'السجلات الإدارية المسجلة في قسم الموارد البشرية خلال الفترة.',
    filters: ['period', 'status'],
    statusOptions: RECORD_STATUS_OPTIONS,
    columns: columns(['date', 'التاريخ', 'date'], ['title', 'السجل'], ['party', 'الموظف'], ['reference', 'المرجع'], ['amount', 'القيمة', 'amount'], ['status', 'الحالة']),
    emptyHint: 'لا توجد سجلات موارد بشرية. سجّل بياناتها من قسم الموارد البشرية.',
    exportable: true,
  },
];

export const REPORT_GROUPS_MAP: Record<ReportGroupKey, string> = Object.fromEntries(
  REPORT_GROUPS.map(({ key, label }) => [key, label]),
) as Record<ReportGroupKey, string>;

export function findReportDefinition(key: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((definition) => definition.key === key);
}

export function defaultReportFilters(now = new Date()): ReportRunFilters {
  const iso = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    ...emptyReportFilters(),
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(now),
  };
}

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportCsv(result: ReportResult): string {
  const lines: string[][] = [
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
  return lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
}

export function formatReportRange(from: string, to: string): string {
  if (!from && !to) return 'جميع الفترات';
  if (from && !to) return `من ${from} حتى الآن`;
  if (!from && to) return `حتى ${to}`;
  return `من ${from} إلى ${to}`;
}
