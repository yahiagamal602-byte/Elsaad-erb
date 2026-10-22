import type {
  AccountItem,
  InventoryItem,
  PurchaseDashboardSummary,
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseReturn,
  PurchaseStatus,
  PurchaseView,
  Supplier,
  SupplierGroup,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function display(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount) : value;
}

function statusLabel(status: PurchaseStatus): string {
  return { draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغي' }[status];
}

function statusClass(status: string): string {
  return status === 'approved' ? 'approved' : status === 'cancelled' ? 'cancelled' : status === 'active' ? 'active' : 'draft';
}

function navButton(view: PurchaseView, label: string): string {
  return `<button class="icon-button" type="button" data-action="purchase-navigate" data-view="${view}">${label}</button>`;
}

export function renderPurchaseDashboard(
  summary: PurchaseDashboardSummary,
  suppliers: Supplier[],
  categories: string[],
): string {
  const supplierOptions = suppliers.map((supplier) =>
    `<option value="${supplier.id}" ${summary.supplierId === supplier.id ? 'selected' : ''}>${escapeHtml(supplier.code)} — ${escapeHtml(supplier.name)}</option>`).join('');
  const categoryOptions = categories.map((category) => `<option value="${escapeHtml(category)}" ${summary.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  const max = summary.monthly.reduce((value, item) => Math.max(value, Number(item.purchases), Number(item.returns)), 0);
  const months = summary.monthly.map((item) => {
    const month = Number(item.month.slice(5));
    const label = new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(new Date(2020, month - 1, 1));
    const purchaseHeight = max ? Number(item.purchases) / max * 100 : 0;
    const returnHeight = max ? Number(item.returns) / max * 100 : 0;
    return `<div class="purchase-chart-month" title="${escapeHtml(item.month)}"><div class="purchase-chart-bars">
      <span class="purchase-chart-bar" style="height:${purchaseHeight.toFixed(2)}%" title="مشتريات ${display(item.purchases)}"></span>
      <span class="purchase-chart-bar purchase-chart-bar--return" style="height:${returnHeight.toFixed(2)}%" title="مرتجعات ${display(item.returns)}"></span>
      </div><small>${escapeHtml(label)}</small></div>`;
  }).join('');
  const statuses = summary.statuses.map((item) =>
    `<button class="purchase-status-count" type="button" data-action="purchase-status-filter" data-status="${item.status}"><span class="sales-status sales-status--${statusClass(item.status)}">${statusLabel(item.status)}</span><strong>${item.count}</strong></button>`).join('');
  const topSuppliers = summary.topSuppliers.map((supplier, index) =>
    `<tr><td>${index + 1}</td><td>${escapeHtml(supplier.name)}</td><td class="sales-amount" dir="ltr">${display(supplier.total)}</td></tr>`).join('');
  const topItems = summary.topItems.map((item, index) =>
    `<tr><td>${index + 1}</td><td>${escapeHtml(item.code || '—')}</td><td>${escapeHtml(item.name)}</td><td class="sales-amount" dir="ltr">${display(item.total)}</td></tr>`).join('');
  const range = summary.from || summary.to ? `${summary.from || 'بداية البيانات'} — ${summary.to || 'اليوم'}` : 'كل الفترات';
  return `
    <section class="section-heading section-heading--page"><div><p class="eyebrow">المشتريات · ملخص البيانات المسجلة</p><h2>لوحة تحكم المشتريات</h2><p class="muted">الفترة: ${escapeHtml(range)} · الإجماليات تشمل الفواتير والمرتجعات المعتمدة فقط.</p></div></section>
    <form class="purchase-filters" data-form="purchase-dashboard">
      <label class="field"><span>من تاريخ</span><input name="from" type="date" value="${escapeHtml(summary.from)}"></label>
      <label class="field"><span>إلى تاريخ</span><input name="to" type="date" value="${escapeHtml(summary.to)}"></label>
      <label class="field"><span>المورد</span><select name="supplierId"><option value="">كل الموردين</option>${supplierOptions}</select></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="all" ${summary.status === 'all' ? 'selected' : ''}>كل الحالات</option><option value="draft" ${summary.status === 'draft' ? 'selected' : ''}>مسودة</option><option value="approved" ${summary.status === 'approved' ? 'selected' : ''}>معتمد</option><option value="cancelled" ${summary.status === 'cancelled' ? 'selected' : ''}>ملغي</option></select></label>
      <label class="field"><span>التصنيف</span><select name="category"><option value="">كل التصنيفات</option>${categoryOptions}</select></label>
      <button class="button button--primary" type="submit">تطبيق الفلاتر</button>
    </form>
    <div class="purchase-metrics">
      <button class="purchase-metric" type="button" data-action="purchase-navigate" data-view="purchase-invoices"><span>إجمالي المشتريات المعتمدة</span><strong>${display(summary.grossPurchases)}</strong><small>الفترة المحددة · دون ضريبة أو خصومات غير مهيأة</small></button>
      <button class="purchase-metric" type="button" data-action="purchase-navigate" data-view="purchase-returns"><span>مرتجعات معتمدة</span><strong>${display(summary.returnsTotal)}</strong><small>تُحسب فقط بعد توفر أثر اعتماد فعلي</small></button>
      <button class="purchase-metric purchase-metric--total" type="button" data-action="purchase-navigate" data-view="purchase-invoices"><span>صافي المشتريات</span><strong>${display(summary.netPurchases)}</strong><small>المشتريات المعتمدة − المرتجعات المعتمدة</small></button>
      <article class="purchase-metric"><span>المبالغ المسددة</span><strong>${summary.paidAmount === null ? 'غير متاح' : display(summary.paidAmount)}</strong><small>لا توجد خدمة دفعات مسجلة حاليًا</small></article>
      <article class="purchase-metric"><span>المتبقي المستحق</span><strong>${summary.dueAmount === null ? 'غير متاح' : display(summary.dueAmount)}</strong><small>لا تُحتسب أعمار أو أرصدة غير متوفرة</small></article>
      <button class="purchase-metric" type="button" data-action="purchase-navigate" data-view="purchase-invoices"><span>عدد الفواتير</span><strong>${summary.invoiceCount}</strong><small>يشمل الحالات المحددة في الفلتر</small></button>
    </div>
    <div class="purchase-dashboard-grid">
      <article class="dashboard-panel purchase-chart-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">اتجاه زمني · آخر 12 شهرًا</p><h3>المشتريات والمرتجعات</h3></div><div class="purchase-legend"><span><i></i>مشتريات</span><span><i></i>مرتجعات</span></div></header>
        <div class="purchase-chart">${months}</div><p class="dashboard-data-note">الفترات التي لا تحتوي مستندات معتمدة تظهر دون أعمدة. المسودات لا تدخل في الإجماليات.</p></article>
      <article class="dashboard-panel purchase-status-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">حالة الفواتير</p><h3>التوزيع</h3></div></header><div class="purchase-status-list">${statuses}</div><div class="purchase-aging"><strong>أعمار المستحقات</strong><span>غير متاحة حتى تنفيذ الدفعات وربطها بالفواتير.</span></div></article>
      <article class="dashboard-panel purchase-top-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">الفواتير المعتمدة</p><h3>أعلى الموردين</h3></div>${navButton('suppliers', 'قائمة الموردين')}</header>
        <div class="table-scroll"><table><thead><tr><th>#</th><th>المورد</th><th>القيمة</th></tr></thead><tbody>${topSuppliers || '<tr><td colspan="3" class="empty-state">لا توجد مشتريات معتمدة ضمن الفلاتر.</td></tr>'}</tbody></table></div></article>
      <article class="dashboard-panel purchase-top-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">الفواتير المعتمدة</p><h3>أعلى الأصناف</h3></div>${navButton('purchase-invoices', 'الفواتير')}</header>
        <div class="table-scroll"><table><thead><tr><th>#</th><th>الكود</th><th>الصنف</th><th>القيمة</th></tr></thead><tbody>${topItems || '<tr><td colspan="4" class="empty-state">لا توجد تفاصيل أصناف معتمدة.</td></tr>'}</tbody></table></div></article>
    </div>
    <div class="notice-panel notice-panel--warning purchase-note"><span class="notice-panel__mark">!</span><div><strong>الاعتماد والدفع مؤجلان بأمان</strong><p>لا يوجد مصدر مخزون أو خدمة دفعات/خزائن في المشروع الحالي. لذلك تُحفظ الفواتير والمرتجعات كمسودات فقط، ولا تُنشأ قيود أو أرصدة أو حركات نقدية. الخصم والضريبة غير مهيئين ولا تُفترض قيمهما.</p></div></div>`;
}

function supplierGroupForm(group: SupplierGroup | null, accounts: AccountItem[]): string {
  const options = accounts.filter((account) => account.type === 'liability').map((account) =>
    `<option value="${account.id}" ${group?.accountId === account.id ? 'selected' : ''}>${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  return `<div class="modal-backdrop" id="purchase-master-modal"><section class="record-modal supplier-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">بيانات الموردين</p><h2>${group ? 'تعديل مجموعة الموردين' : 'إضافة مجموعة موردين'}</h2></div><button class="icon-button" type="button" data-action="purchase-close">إغلاق</button></header>
    <form class="supplier-form" data-form="supplier-group"><input type="hidden" name="id" value="${group?.id ?? ''}">
      <label class="field"><span>الكود *</span><input required maxlength="40" name="code" value="${escapeHtml(group?.code ?? '')}"></label>
      <label class="field"><span>الاسم العربي *</span><input required maxlength="160" name="nameAr" value="${escapeHtml(group?.nameAr ?? '')}"></label>
      <label class="field"><span>الاسم الإنجليزي</span><input maxlength="160" name="nameEn" value="${escapeHtml(group?.nameEn ?? '')}" dir="ltr"></label>
      <label class="field"><span>حساب التزام مرتبط (اختياري)</span><select name="accountId"><option value="">دون ربط</option>${options}</select></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${group?.status !== 'inactive' ? 'selected' : ''}>نشطة</option><option value="inactive" ${group?.status === 'inactive' ? 'selected' : ''}>معطلة</option></select></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000">${escapeHtml(group?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="purchase-master-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="purchase-close">إلغاء</button><button class="button button--primary" type="submit">حفظ المجموعة</button></div>
    </form></section></div>`;
}

function supplierForm(supplier: Supplier | null, groups: SupplierGroup[], accounts: AccountItem[]): string {
  const groupOptions = groups.filter((group) => group.status === 'active' || group.id === supplier?.groupId).map((group) =>
    `<option value="${group.id}" ${supplier?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.code)} — ${escapeHtml(group.nameAr)}</option>`).join('');
  const accountOptions = accounts.filter((account) => account.type === 'liability').map((account) =>
    `<option value="${account.id}" ${supplier?.accountId === account.id ? 'selected' : ''}>${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  const input = (name: string, label: string, value: string, max: number, wide = false): string =>
    `<label class="field ${wide ? 'field--wide' : ''}"><span>${label}</span><input name="${name}" maxlength="${max}" value="${escapeHtml(value)}"></label>`;
  return `<div class="modal-backdrop" id="purchase-master-modal"><section class="record-modal supplier-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">دليل الموردين</p><h2>${supplier ? 'تعديل المورد' : 'إضافة مورد'}</h2></div><button class="icon-button" type="button" data-action="purchase-close">إغلاق</button></header>
    <form class="supplier-form" data-form="supplier"><input type="hidden" name="id" value="${supplier?.id ?? ''}">
      ${input('code', 'كود المورد *', supplier?.code ?? '', 40)}${input('name', 'الاسم العربي *', supplier?.name ?? '', 180)}
      ${input('tradeName', 'الاسم التجاري', supplier?.tradeName ?? '', 180)}${input('phone', 'الهاتف', supplier?.phone ?? '', 60)}
      ${input('email', 'البريد الإلكتروني', supplier?.email ?? '', 180)}
      <label class="field"><span>مجموعة المورد</span><select name="groupId"><option value="">بدون مجموعة</option>${groupOptions}</select></label>
      ${input('city', 'المدينة', supplier?.city ?? '', 100)}${input('country', 'الدولة', supplier?.country ?? '', 100)}
      ${input('taxNumber', 'الرقم الضريبي', supplier?.taxNumber ?? '', 100)}${input('commercialRegister', 'السجل التجاري', supplier?.commercialRegister ?? '', 100)}
      <label class="field field--wide"><span>العنوان</span><input name="address" maxlength="500" value="${escapeHtml(supplier?.address ?? '')}"></label>
      <label class="field"><span>حساب التزام (اختياري)</span><select name="accountId"><option value="">دون ربط</option>${accountOptions}</select></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${supplier?.status !== 'inactive' ? 'selected' : ''}>نشط</option><option value="inactive" ${supplier?.status === 'inactive' ? 'selected' : ''}>معطل</option></select></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000">${escapeHtml(supplier?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="purchase-master-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="purchase-close">إلغاء</button><button class="button button--primary" type="submit">حفظ المورد</button></div>
    </form></section></div>`;
}

export function renderSupplierGroups(groups: SupplierGroup[]): string {
  const rows = groups.map((group) => `<tr data-purchase-group-row data-search="${escapeHtml([group.code, group.nameAr, group.nameEn].join(' ').toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(group.code)}</strong></td><td>${escapeHtml(group.nameAr)}<small dir="ltr">${escapeHtml(group.nameEn)}</small></td>
    <td>${group.accountName ? `${escapeHtml(group.accountCode)} — ${escapeHtml(group.accountName)}` : 'دون ربط'}</td><td>${group.supplierCount}</td>
    <td><span class="sales-status sales-status--${statusClass(group.status)}">${group.status === 'active' ? 'نشطة' : 'معطلة'}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="supplier-group-edit" data-id="${group.id}">تعديل</button>
    <button class="icon-button" data-action="supplier-group-status" data-id="${group.id}" data-status="${group.status === 'active' ? 'inactive' : 'active'}">${group.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
    <button class="icon-button icon-button--danger" data-action="supplier-group-delete" data-id="${group.id}">حذف</button></td>
  </tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المشتريات · دليل الموردين</p><h2>مجموعات الموردين</h2><p class="muted">مجموعات فعلية، مع حساب التزام اختياري دون إنشاء حسابات تلقائيًا.</p></div>
    <button class="button button--primary" data-action="supplier-group-add">إضافة مجموعة</button></section>
    <section class="table-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="supplier-group-search" placeholder="بحث عن مجموعة"></label><span class="muted">${groups.length} مجموعة</span></div>
    <div class="table-scroll"><table class="supplier-table"><thead><tr><th>الكود</th><th>المجموعة</th><th>الحساب</th><th>الموردون</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد مجموعات موردين.</td></tr>'}</tbody></table></div></section><div id="purchase-master-host"></div>`;
}

export function renderSuppliers(suppliers: Supplier[], groups: SupplierGroup[]): string {
  const groupNames = new Map(groups.map((group) => [group.id, `${group.code} — ${group.nameAr}`]));
  const rows = suppliers.map((supplier) => `<tr data-supplier-row data-search="${escapeHtml([supplier.code, supplier.name, supplier.tradeName, supplier.phone, supplier.email, supplier.taxNumber].join(' ').toLocaleLowerCase('ar'))}" data-status="${supplier.status}">
    <td><strong>${escapeHtml(supplier.code)}</strong></td><td><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.tradeName)}</small></td>
    <td>${escapeHtml(supplier.phone || '—')}</td><td dir="ltr">${escapeHtml(supplier.email || '—')}</td>
    <td>${escapeHtml(supplier.groupId ? groupNames.get(supplier.groupId) ?? '—' : '—')}</td>
    <td>${supplier.accountName ? `${escapeHtml(supplier.accountCode)} — ${escapeHtml(supplier.accountName)}` : 'دون ربط'}</td>
    <td><span class="sales-status sales-status--${statusClass(supplier.status)}">${supplier.status === 'active' ? 'نشط' : 'معطل'}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="supplier-edit" data-id="${supplier.id}">تعديل</button>
    <button class="icon-button" data-action="supplier-status" data-id="${supplier.id}" data-status="${supplier.status === 'active' ? 'inactive' : 'active'}">${supplier.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
    <button class="icon-button icon-button--danger" data-action="supplier-delete" data-id="${supplier.id}">حذف</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المشتريات · بيانات الأطراف</p><h2>الموردون</h2><p class="muted">لا يُنشأ رصيد افتتاحي أو حركة مالية لعدم وجود خدمة موثقة لهما.</p></div>
    <button class="button button--primary" data-action="supplier-add">إضافة مورد</button></section>
    <section class="table-panel"><div class="table-toolbar supplier-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="supplier-search" placeholder="بحث بالكود أو الاسم أو الهاتف"></label>
    <select class="sales-filter" id="supplier-status-filter"><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">معطل</option></select>
    <div class="toolbar-actions"><span class="muted">${suppliers.length} مورد</span><button class="button button--secondary" data-action="supplier-export">تصدير CSV</button>
    <label class="button button--secondary purchase-import-label">استيراد CSV<input hidden type="file" id="supplier-import" accept=".csv,text/csv"></label><button class="button button--secondary" data-action="purchase-print">طباعة</button></div></div>
    <div class="table-scroll supplier-table-wrap"><table class="supplier-table"><thead><tr><th>الكود</th><th>المورد</th><th>الهاتف</th><th>البريد</th><th>المجموعة</th><th>الحساب المرتبط</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="empty-state">لا توجد بيانات موردين.</td></tr>'}</tbody></table></div></section><p class="sales-dependency">يدعم هذا الإصدار CSV المتوافق مع Excel؛ لا توجد مكتبة ‎.xlsx بالمشروع.</p><div id="purchase-master-host"></div>`;
}

export function renderSupplierForm(supplier: Supplier | null, groups: SupplierGroup[], accounts: AccountItem[]): string {
  return supplierForm(supplier, groups, accounts);
}

export function renderSupplierGroupForm(group: SupplierGroup | null, accounts: AccountItem[]): string {
  return supplierGroupForm(group, accounts);
}

export function renderPurchaseInvoiceLine(
  line: Partial<PurchaseInvoice['lines'][number]> = {},
  disabled = false,
  items: InventoryItem[] = [],
): string {
  const readonly = disabled ? 'disabled' : '';
  const linkedItems = items.filter((item) => (item.status === 'active' && item.purchasable && item.baseUnitStatus === 'active') || item.id === line.itemId).map((item) =>
    `<option value="${item.id}" ${item.id === line.itemId ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.nameAr)}</option>`).join('');
  return `<tr data-purchase-line><td><select name="itemId" aria-label="اختيار صنف من دليل المخزون" ${readonly}><option value="">صنف يدوي / دون ربط</option>${linkedItems}</select><input name="itemCode" maxlength="80" value="${escapeHtml(line.itemCode ?? '')}" placeholder="كود الصنف" ${readonly}><input type="hidden" name="unitId" value="${line.unitId ?? ''}"></td>
    <td><input name="description" maxlength="240" required value="${escapeHtml(line.description ?? '')}" placeholder="وصف الصنف الفعلي" ${readonly}></td>
    <td><input name="unit" maxlength="40" value="${escapeHtml(line.unit ?? '')}" ${readonly}></td>
    <td><input name="quantity" type="number" min="0.000001" step="any" required value="${escapeHtml(line.quantity ?? '')}" ${readonly}></td>
    <td><input name="unitPrice" type="number" min="0" step="any" required value="${escapeHtml(line.unitPrice ?? '')}" ${readonly}></td>
    <td class="purchase-line-total" dir="ltr">${display(line.amount ?? '0')}</td>
    <td>${disabled ? '' : '<button type="button" class="icon-button icon-button--danger" data-action="purchase-line-delete">حذف</button>'}</td></tr>`;
}

export function renderPurchaseInvoiceForm(invoice: PurchaseInvoice | null, suppliers: Supplier[], items: InventoryItem[] = []): string {
  const readOnly = invoice !== null && invoice.status !== 'draft';
  const choices = suppliers.filter((item) => item.status === 'active' || item.id === invoice?.supplierId).map((item) =>
    `<option value="${item.id}" ${invoice?.supplierId === item.id ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('');
  const lineRows = invoice?.lines.map((line) => renderPurchaseInvoiceLine(line, readOnly, items)).join('') || renderPurchaseInvoiceLine({}, false, items);
  return `<div class="modal-backdrop" id="purchase-invoice-modal"><section class="record-modal purchase-invoice-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">فاتورة مشتريات ${invoice ? `· ${escapeHtml(invoice.number)}` : '· مسودة جديدة'}</p><h2>${invoice ? readOnly ? 'عرض الفاتورة' : 'تعديل المسودة' : 'إنشاء فاتورة مشتريات'}</h2></div><button class="icon-button" data-action="purchase-close">إغلاق</button></header>
    <form data-form="purchase-invoice" class="purchase-document-form"><input name="id" type="hidden" value="${invoice?.id ?? ''}">
      <div class="purchase-document-fields">
        <label class="field"><span>المورد *</span><select required name="supplierId" ${readOnly ? 'disabled' : ''}><option value="">اختر المورد</option>${choices}</select></label>
        <label class="field"><span>رقم فاتورة المورد</span><input name="supplierInvoiceNumber" maxlength="100" value="${escapeHtml(invoice?.supplierInvoiceNumber ?? '')}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field"><span>تاريخ الفاتورة *</span><input name="invoiceDate" type="date" required value="${escapeHtml(invoice?.invoiceDate ?? new Date().toISOString().slice(0, 10))}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field"><span>تاريخ الاستحقاق</span><input name="dueDate" type="date" value="${escapeHtml(invoice?.dueDate ?? '')}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field"><span>طريقة الربط (لا تسجل دفعة)</span><select name="paymentLink" ${readOnly ? 'disabled' : ''}><option value="unlinked" ${invoice?.paymentLink === 'unlinked' || !invoice ? 'selected' : ''}>دون ربط</option><option value="cash" ${invoice?.paymentLink === 'cash' ? 'selected' : ''}>خزينة (اختيار فقط)</option><option value="bank" ${invoice?.paymentLink === 'bank' ? 'selected' : ''}>بنك (اختيار فقط)</option></select></label>
        <label class="field"><span>التصنيف</span><input name="category" maxlength="120" value="${escapeHtml(invoice?.category ?? '')}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field"><span>المشروع</span><input name="project" maxlength="160" value="${escapeHtml(invoice?.project ?? '')}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field"><span>مركز التكلفة</span><input name="costCenter" maxlength="160" value="${escapeHtml(invoice?.costCenter ?? '')}" ${readOnly ? 'disabled' : ''}></label>
        <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" ${readOnly ? 'disabled' : ''}>${escapeHtml(invoice?.notes ?? '')}</textarea></label>
      </div>
      <div class="notice-panel notice-panel--warning purchase-note"><span class="notice-panel__mark">!</span><div><strong>الفاتورة تثبت ذمة المورد والمشتريات، ولا تزيد المخزون</strong><p>يتطلب الاعتماد ربط كل بند بصنف قابل للشراء وأن يتطابق حساب الشراء مع حساب المخزون. تُضاف الكميات بإذن استلام مستقل. لا تُحتسب ضريبة أو خصومات غير مهيأة، واختيار الخزينة أو البنك لا ينشئ دفعة.</p></div></div>
      <div class="sales-lines-heading"><div><h3>تفاصيل الأصناف</h3><span>اختر من دليل المخزون أو أدخل وصفًا يدويًا؛ لا تتوفر تحويلات وحدات تلقائية.</span></div>${readOnly ? '' : '<button class="button button--secondary" type="button" data-action="purchase-line-add">إضافة صنف</button>'}</div>
      <div class="table-scroll sales-lines-scroll"><table class="purchase-lines-table"><thead><tr><th>كود الصنف</th><th>الصنف *</th><th>الوحدة</th><th>الكمية *</th><th>سعر الوحدة *</th><th>الإجمالي</th><th></th></tr></thead><tbody id="purchase-lines">${lineRows}</tbody></table></div>
      <div class="sales-totals"><span>إجمالي البنود — دون ضريبة أو خصم</span><strong id="purchase-total">${display(invoice?.total ?? '0')}</strong></div>
      <div class="purchase-payment-note"><span>السداد:</span><strong>غير متاح — لم تُسجل دفعات</strong><span>المتبقي:</span><strong>غير متاح</strong></div>
      <p class="form-error" id="purchase-document-error" hidden role="alert"></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="purchase-close">إغلاق</button>${readOnly ? '' : '<button class="button button--primary" type="submit">حفظ المسودة</button>'}
      <button class="button button--secondary" type="button" data-action="purchase-approve" ${invoice?.status === 'draft' ? `data-id="${invoice.id}"` : ''} ${!invoice || readOnly ? 'disabled' : ''}>اعتماد وترحيل</button></div>
    </form></section></div>`;
}

export function renderPurchaseInvoices(invoices: PurchaseInvoice[], suppliers: Supplier[], statusFilter: PurchaseStatus | '' = ''): string {
  const options = suppliers.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  const categories = [...new Set(invoices.map((item) => item.category).filter(Boolean))].sort();
  const rows = invoices.map((invoice) => `<tr data-purchase-invoice-row data-date="${invoice.invoiceDate}" data-status="${invoice.status}" data-category="${escapeHtml(invoice.category)}" data-supplier="${invoice.supplierId}" data-search="${escapeHtml([invoice.number, invoice.supplierInvoiceNumber, invoice.supplierName, invoice.invoiceDate, invoice.category].join(' ').toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(invoice.number)}</strong><small>${escapeHtml(invoice.supplierInvoiceNumber || '—')}</small></td><td>${escapeHtml(invoice.supplierName)}</td><td>${escapeHtml(invoice.invoiceDate)}</td>
    <td>${escapeHtml(invoice.category || '—')}</td><td class="sales-amount" dir="ltr">${display(invoice.total)}</td>
    <td><span class="sales-status sales-status--${statusClass(invoice.status)}">${statusLabel(invoice.status)}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="purchase-invoice-view" data-id="${invoice.id}">${invoice.status === 'draft' ? 'تعديل' : 'عرض'}</button>
    <button class="icon-button" data-action="purchase-invoice-duplicate" data-id="${invoice.id}">تكرار كمسودة</button>
    ${invoice.status === 'draft' ? `<button class="icon-button icon-button--danger" data-action="purchase-invoice-delete" data-id="${invoice.id}">حذف</button>` : ''}
    ${invoice.status === 'approved' ? `<button class="icon-button icon-button--danger" data-action="purchase-invoice-cancel" data-id="${invoice.id}">إلغاء بعكس القيد</button>` : ''}
    <button class="icon-button" data-action="purchase-invoice-print" data-id="${invoice.id}">طباعة</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المشتريات · المستندات</p><h2>فواتير المشتريات</h2><p class="muted">الاعتماد يثبت ذمة المورد وقيمة المشتريات؛ إذن الاستلام المنفصل هو الذي يزيد كمية المخزون.</p></div>
    <button class="button button--primary" data-action="purchase-invoice-add">إنشاء فاتورة</button></section>
    <section class="table-panel"><div class="table-toolbar purchase-invoice-toolbar"><label class="search-field"><span>⌕</span><input id="purchase-invoice-search" type="search" placeholder="رقم الفاتورة أو المورد"></label>
    <label class="purchase-date-filter"><span>من</span><input class="sales-filter" id="purchase-invoice-from" type="date" aria-label="من تاريخ"></label>
    <label class="purchase-date-filter"><span>إلى</span><input class="sales-filter" id="purchase-invoice-to" type="date" aria-label="إلى تاريخ"></label>
    <select class="sales-filter" id="purchase-invoice-supplier"><option value="">كل الموردين</option>${options}</select>
    <select class="sales-filter" id="purchase-invoice-status"><option value="" ${statusFilter === '' ? 'selected' : ''}>كل الحالات</option><option value="draft" ${statusFilter === 'draft' ? 'selected' : ''}>مسودة</option><option value="approved" ${statusFilter === 'approved' ? 'selected' : ''}>معتمد</option><option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>ملغي</option></select>
    <select class="sales-filter" id="purchase-invoice-category"><option value="">كل التصنيفات</option>${categories.map((item) => `<option>${escapeHtml(item)}</option>`).join('')}</select>
    <div class="toolbar-actions"><span class="muted">${invoices.length} فاتورة</span><button class="button button--secondary" data-action="purchase-print">طباعة</button></div></div>
    <div class="table-scroll purchase-invoice-table-wrap"><table class="purchase-document-table"><thead><tr><th>رقم النظام / المورد</th><th>المورد</th><th>التاريخ</th><th>التصنيف</th><th>الإجمالي الأساسي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty-state">لا توجد فواتير مشتريات.</td></tr>'}</tbody></table></div></section><div id="purchase-invoice-host"></div><div id="purchase-print-host"></div>`;
}

export function renderPurchaseReturnEditor(invoices: PurchaseInvoice[], current: PurchaseReturn | null): string {
  const eligible = invoices.filter((invoice) => invoice.status === 'approved');
  const invoice = current ? eligible.find((item) => item.id === current.invoiceId) ?? null : null;
  const choices = eligible.map((item) => `<option value="${item.id}" ${item.id === current?.invoiceId ? 'selected' : ''}>${escapeHtml(item.number)} — ${escapeHtml(item.supplierName)}</option>`).join('');
  const lines = invoice?.lines.map((line) => {
    const currentLine = current?.lines.find((item) => item.invoiceLineId === line.id);
    const maximum = Number(line.remainingQuantity) + Number(currentLine?.quantity ?? 0);
    return `<tr data-purchase-return-line data-invoice-line-id="${line.id}"><td>${escapeHtml(line.itemCode || '—')}</td><td>${escapeHtml(line.description)}</td>
      <td>${display(line.quantity)}</td><td>${display(line.previouslyReturned)}</td><td>${display(String(maximum))}</td>
      <td><input name="returnQuantity" type="number" min="0" max="${maximum}" step="any" value="${escapeHtml(currentLine?.quantity ?? '0')}" ${readonly ? 'disabled' : ''}></td>
      <td class="purchase-return-line-total">${display(currentLine?.amount ?? '0')}</td></tr>`;
  }).join('') ?? '';
  const readonly = current !== null && current.status !== 'draft';
  return `<div class="modal-backdrop" id="purchase-return-modal"><section class="record-modal purchase-return-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">مرتجع مشتريات</p><h2>${current ? readonly ? 'عرض المرتجع' : 'تعديل المسودة' : 'إنشاء مسودة مرتجع'}</h2></div><button class="icon-button" data-action="purchase-close">إغلاق</button></header>
    <form data-form="purchase-return" class="purchase-document-form"><input type="hidden" name="id" value="${current?.id ?? ''}">${current ? `<input type="hidden" name="invoiceId" value="${current.invoiceId}">` : ''}
      <label class="field"><span>فاتورة مشتريات معتمدة *</span><select name="invoiceId" required ${current || readonly ? 'disabled' : ''}><option value="">اختر فاتورة</option>${choices}</select></label>
      ${invoice ? `<p class="sales-source-ref">الفاتورة ${escapeHtml(invoice.number)} · المورد ${escapeHtml(invoice.supplierName)}</p>` : ''}
      <div class="purchase-document-fields"><label class="field"><span>تاريخ المرتجع *</span><input name="date" type="date" required value="${escapeHtml(current?.date ?? new Date().toISOString().slice(0, 10))}" ${readonly ? 'disabled' : ''}></label>
      <label class="field"><span>سبب المرتجع *</span><input name="reason" required maxlength="240" value="${escapeHtml(current?.reason ?? '')}" ${readonly ? 'disabled' : ''}></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" ${readonly ? 'disabled' : ''}>${escapeHtml(current?.notes ?? '')}</textarea></label></div>
      <div class="notice-panel notice-panel--warning purchase-note"><span class="notice-panel__mark">!</span><div><strong>المرتجع يبقى مسودة</strong><p>لا يتغير المخزون أو رصيد المورد ولا يُنشأ رد مبلغ؛ اعتماد المرتجع يتطلب تكاملًا غير موجود.</p></div></div>
      <div class="table-scroll sales-lines-scroll"><table class="purchase-lines-table"><thead><tr><th>كود</th><th>الصنف</th><th>المباع</th><th>مرتجع سابق/محجوز</th><th>المتبقي</th><th>الكمية المرتجعة</th><th>القيمة</th></tr></thead><tbody>${lines || '<tr><td colspan="7" class="empty-state">اختر فاتورة معتمدة لعرض البنود.</td></tr>'}</tbody></table></div>
      <div class="sales-totals"><span>القيمة الأساسية — دون خصم أو ضريبة</span><strong id="purchase-return-total">${display(current?.total ?? '0')}</strong></div>
      <p class="form-error" id="purchase-return-error" hidden role="alert"></p><div class="form-actions"><button class="button button--secondary" type="button" data-action="purchase-close">إغلاق</button>${readonly ? '' : '<button class="button button--primary" type="submit">حفظ المسودة</button>'}
      <button class="button button--secondary" type="button" data-action="purchase-return-approve" ${current ? `data-id="${current.id}"` : ''} disabled title="يتطلب تكامل المخزون والحسابات">اعتماد (غير متاح)</button></div>
    </form></section></div>`;
}

export function renderPurchaseReturns(invoices: PurchaseInvoice[], returns: PurchaseReturn[]): string {
  const eligible = invoices.some((invoice) => invoice.status === 'approved');
  const rows = returns.map((item) => `<tr data-purchase-return-row data-status="${item.status}" data-date="${item.date}" data-search="${escapeHtml([item.number, item.invoiceNumber, item.supplierName, item.date, item.reason].join(' ').toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(item.number)}</strong><small>${escapeHtml(item.invoiceNumber)}</small></td><td>${escapeHtml(item.supplierName)}</td><td>${escapeHtml(item.date)}</td>
    <td class="sales-amount">${display(item.total)}</td><td><span class="sales-status sales-status--${statusClass(item.status)}">${statusLabel(item.status)}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="purchase-return-edit" data-id="${item.id}">${item.status === 'draft' ? 'تعديل' : 'عرض'}</button>
    ${item.status === 'draft' ? `<button class="icon-button icon-button--danger" data-action="purchase-return-delete" data-id="${item.id}">حذف</button>` : ''}
    <button class="icon-button" data-action="purchase-return-print" data-id="${item.id}">طباعة</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المشتريات · المرتجعات</p><h2>مرتجع المشتريات</h2><p class="muted">المرتجع مرتبط بفاتورة معتمدة فقط؛ المسودات لا تحدث أرصدة.</p></div>
    <button class="button button--primary" data-action="purchase-return-add" ${eligible ? '' : 'disabled title="لا توجد فاتورة مشتريات معتمدة"'}>إنشاء مرتجع</button></section>
    <section class="table-panel"><div class="table-toolbar purchase-return-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="purchase-return-search" placeholder="بحث برقم المرتجع أو المورد"></label>
    <label class="purchase-date-filter"><span>من</span><input class="sales-filter" id="purchase-return-from" type="date" aria-label="من تاريخ"></label>
    <label class="purchase-date-filter"><span>إلى</span><input class="sales-filter" id="purchase-return-to" type="date" aria-label="إلى تاريخ"></label>
    <select class="sales-filter" id="purchase-return-status"><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="approved">معتمد</option><option value="cancelled">ملغي</option></select>
    <button class="button button--secondary" data-action="purchase-print">طباعة</button></div>
    <div class="table-scroll"><table class="purchase-document-table"><thead><tr><th>المرتجع / الفاتورة</th><th>المورد</th><th>التاريخ</th><th>القيمة الأساسية</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد مرتجعات مشتريات.</td></tr>'}</tbody></table></div></section><div id="purchase-return-host"></div><div id="purchase-print-host"></div>`;
}

export function invoiceCsv(suppliers: Supplier[]): string {
  const quote = (value: string): string => `"${(/^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const rows = suppliers.map((item) => [item.code, item.name, item.tradeName, item.phone, item.email, item.groupName,
    item.address, item.city, item.country, item.taxNumber, item.commercialRegister, item.accountCode, item.notes, item.status]
    .map((value) => quote(String(value ?? ''))).join(','));
  return `\uFEFF${[['code', 'name', 'tradeName', 'phone', 'email', 'group', 'address', 'city', 'country', 'taxNumber', 'commercialRegister', 'accountCode', 'notes', 'status'].map(quote).join(','), ...rows].join('\r\n')}`;
}

export function renderPurchasePrint(invoice: PurchaseInvoice): string {
  const rows = invoice.lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.itemCode)}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.unit)}</td><td>${display(line.quantity)}</td><td>${display(line.unitPrice)}</td><td>${display(line.amount)}</td></tr>`).join('');
  return `<article class="sales-print-sheet" dir="rtl"><header><div class="brand__name">Elsaad <b>ERP</b></div><strong>فاتورة مشتريات · ${statusLabel(invoice.status)}</strong></header>
    <h1>${escapeHtml(invoice.number)}</h1><dl><div><dt>المورد</dt><dd>${escapeHtml(invoice.supplierName)}</dd></div><div><dt>كود المورد</dt><dd>${escapeHtml(invoice.supplierCode)}</dd></div>
    <div><dt>التاريخ</dt><dd>${escapeHtml(invoice.invoiceDate)}</dd></div><div><dt>الاستحقاق</dt><dd>${escapeHtml(invoice.dueDate || '—')}</dd></div>
    <div><dt>رقم المورد</dt><dd>${escapeHtml(invoice.supplierInvoiceNumber || '—')}</dd></div><div><dt>التصنيف</dt><dd>${escapeHtml(invoice.category || '—')}</dd></div></dl>
    <table><thead><tr><th>#</th><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table>
    <footer><span>الإجمالي الأساسي — دون خصم أو ضريبة</span><strong>${display(invoice.total)}</strong></footer><p>مستند محفوظ محليًا؛ لا يمثل إثبات ترحيل أو دفع.</p></article>`;
}

export function renderPurchaseReturnPrint(item: PurchaseReturn): string {
  const rows = item.lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.itemCode)}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.unit)}</td><td>${display(line.quantity)}</td><td>${display(line.unitPrice)}</td><td>${display(line.amount)}</td></tr>`).join('');
  return `<article class="sales-print-sheet" dir="rtl"><header><div class="brand__name">Elsaad <b>ERP</b></div><strong>مرتجع مشتريات · ${statusLabel(item.status)}</strong></header>
    <h1>${escapeHtml(item.number)}</h1><dl><div><dt>الفاتورة</dt><dd>${escapeHtml(item.invoiceNumber)}</dd></div><div><dt>المورد</dt><dd>${escapeHtml(item.supplierName)}</dd></div>
    <div><dt>التاريخ</dt><dd>${escapeHtml(item.date)}</dd></div><div><dt>السبب</dt><dd>${escapeHtml(item.reason)}</dd></div></dl>
    <table><thead><tr><th>#</th><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table>
    <footer><span>قيمة أساسية؛ لا أثر مخزني أو مالي</span><strong>${display(item.total)}</strong></footer></article>`;
}
