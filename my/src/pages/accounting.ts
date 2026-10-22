import { ACCOUNT_TYPES } from '../shared/accounting.js';
import type { AccountingPeriodClosure, AccountItem, Budget, BudgetCategory, CostCenter, JournalEntryDetail, JournalEntryItem } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

const accountTypeLabel = (value: string): string => ACCOUNT_TYPES.find(({ value: key }) => key === value)?.label ?? value;
const categories: Array<{ value: BudgetCategory; label: string }> = [
  { value: 'sales', label: 'مبيعات مقدرة' },
  { value: 'cash-purchases', label: 'مشتريات نقدية مقدرة' },
  { value: 'cash-expenses', label: 'مصروفات نقدية مقدرة' },
];

function accountNodes(accounts: AccountItem[], parentId: number | null = null): string {
  const children = accounts.filter((account) => account.parentId === parentId);
  return children.length ? `<ul>${children.map((account) => `<li><details open class="account-tree-node" data-account-search="${escapeHtml(`${account.code} ${account.name} ${account.nameEn}`.toLocaleLowerCase('ar'))}">
    <summary><span><strong>${escapeHtml(account.code)}</strong> ${escapeHtml(account.name)}${account.nameEn ? `<small>${escapeHtml(account.nameEn)}</small>` : ''}</span>
    <span class="account-tree-node__actions"><small>${escapeHtml(accountTypeLabel(account.type))} · ${account.postable ? 'قابل للترحيل' : 'تجميعي'}</small>
      <button class="button button--tiny button--secondary" type="button" data-action="account-edit" data-id="${account.id}">تعديل</button>
      <button class="button button--tiny button--danger" type="button" data-action="account-delete" data-id="${account.id}">حذف</button></span></summary>${accountNodes(accounts, account.id)}</details></li>`).join('')}</ul>` : '';
}

function centerNodes(centers: CostCenter[], parentId: number | null = null): string {
  const children = centers.filter((center) => center.parentId === parentId);
  return children.length ? `<ul>${children.map((center) => `<li><details open class="account-tree-node" data-center-search="${escapeHtml(`${center.code} ${center.name} ${center.nameEn}`.toLocaleLowerCase('ar'))}">
    <summary><span><strong>${escapeHtml(center.code)}</strong> ${escapeHtml(center.name)}${center.nameEn ? `<small>${escapeHtml(center.nameEn)}</small>` : ''}</span>
    <span class="account-tree-node__actions"><small>${escapeHtml(center.type || '—')} · ${center.postable ? 'قابل للترحيل' : 'تجميعي'}</small>
      <button class="button button--tiny button--secondary" type="button" data-action="center-edit" data-id="${center.id}">تعديل</button>
      <button class="button button--tiny button--danger" type="button" data-action="center-delete" data-id="${center.id}">حذف</button></span></summary>${centerNodes(centers, center.id)}</details></li>`).join('')}</ul>` : '';
}

function searchForm(form: string, search: string, placeholder: string): string {
  return `<form class="accounting-search" data-form="${form}"><label class="search-field"><span>⌕</span><input name="search" type="search" maxlength="180" value="${escapeHtml(search)}" placeholder="${escapeHtml(placeholder)}"></label>
    <button class="button button--secondary" type="submit">بحث</button><button class="button button--quiet" type="button" data-action="accounting-clear-search">مسح البحث</button></form>`;
}

function accountForm(accounts: AccountItem[]): string {
  const types = ACCOUNT_TYPES.map(({ value, label }) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  const parents = accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  return `<div class="modal-backdrop" id="account-modal" hidden><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
    <div class="modal-heading"><div><p class="eyebrow">الدليل المحاسبي</p><h2 id="account-modal-title">حساب جديد</h2></div><button class="icon-button" type="button" data-action="close-account-modal">إغلاق</button></div>
    <form id="account-form" data-form="account" class="record-form"><input name="id" type="hidden">
      <label class="field"><span>كود الحساب *</span><input name="code" maxlength="40" required></label><label class="field"><span>الاسم العربي *</span><input name="name" maxlength="180" required></label>
      <label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" maxlength="180" dir="ltr"></label><label class="field"><span>نوع الحساب *</span><select name="type">${types}</select></label>
      <label class="field"><span>الحساب الأب</span><select name="parentId"><option value="">دون حساب أب</option>${parents}</select></label><label class="field checkbox-field"><input name="postable" type="checkbox" checked><span>السماح بالترحيل</span></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="2000"></textarea></label><p class="form-error field--wide" id="account-error" role="alert" hidden></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="close-account-modal">إلغاء</button><button class="button button--primary" type="submit">حفظ الحساب</button></div>
    </form></section></div>`;
}

export function renderChartOfAccounts(accounts: AccountItem[], search = ''): string {
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الحسابات · الدليل</p><h1>الدليل المحاسبي</h1><p class="muted">الحسابات التجميعية لا تقبل الترحيل، والحسابات المستخدمة في قيود مرحلة محمية.</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="account-add">＋ جديد</button><button class="button button--secondary" type="button" data-action="account-export">تصدير Excel/CSV</button><button class="button button--secondary" type="button" data-action="account-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="account-exit">خروج</button></div></section>
    <section class="table-panel accounting-panel"><div class="panel-title"><div><p class="eyebrow">شجرة الحسابات</p><h2>الحسابات</h2></div><span class="muted">${accounts.length} حساب</span></div>${searchForm('account-search', search, 'بحث بالكود أو الاسم العربي أو الإنجليزي')}
      <div class="account-tree" data-account-tree>${accountNodes(accounts) || '<p class="empty-state">لا توجد حسابات. أضف حسابًا للبدء.</p>'}</div></section>${accountForm(accounts)}`;
}

function centerForm(centers: CostCenter[]): string {
  const parents = centers.map((center) => `<option value="${center.id}">${escapeHtml(center.code)} — ${escapeHtml(center.name)}</option>`).join('');
  return `<div class="modal-backdrop" id="center-modal" hidden><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="center-modal-title">
    <div class="modal-heading"><div><p class="eyebrow">مراكز التكلفة</p><h2 id="center-modal-title">مركز تكلفة جديد</h2></div><button class="icon-button" type="button" data-action="close-center-modal">إغلاق</button></div>
    <form class="record-form" data-form="cost-center"><input name="id" type="hidden"><label class="field"><span>كود المركز *</span><input name="code" maxlength="40" required></label>
      <label class="field"><span>الاسم العربي *</span><input name="name" maxlength="180" required></label><label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" maxlength="180" dir="ltr"></label>
      <label class="field"><span>المركز الأب</span><select name="parentId"><option value="">دون مركز أب</option>${parents}</select></label><label class="field"><span>نوع المركز</span><input name="type" maxlength="80"></label>
      <label class="field checkbox-field"><input name="postable" type="checkbox" checked><span>السماح بالترحيل</span></label><label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2"></textarea></label>
      <p class="form-error field--wide" id="center-error" role="alert" hidden></p><div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="close-center-modal">إلغاء</button><button class="button button--primary" type="submit">حفظ المركز</button></div>
    </form></section></div>`;
}

export function renderCostCenters(centers: CostCenter[], search = ''): string {
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الحسابات · مراكز التكلفة</p><h1>مراكز التكلفة</h1><p class="muted">ترتبط المعرفات الفعلية بالقيود وبنود الموازنات، دون أثر عند الإنشاء.</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="center-add">＋ جديد</button><button class="button button--secondary" type="button" data-action="center-export">تصدير Excel/CSV</button><button class="button button--secondary" type="button" data-action="center-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="account-exit">خروج</button></div></section>
    <section class="table-panel accounting-panel"><div class="panel-title"><div><p class="eyebrow">الهيكل التنظيمي</p><h2>شجرة مراكز التكلفة</h2></div><span class="muted">${centers.length} مركز</span></div>${searchForm('center-search', search, 'بحث بالكود أو الاسم العربي أو الإنجليزي')}
      <div class="account-tree" data-center-tree>${centerNodes(centers) || '<p class="empty-state">لا توجد مراكز تكلفة.</p>'}</div></section>${centerForm(centers)}`;
}

export function renderJournalLine(accounts: AccountItem[], centers: CostCenter[]): string {
  const accountParents = new Set(accounts.map((item) => item.parentId).filter((id): id is number => id !== null));
  const centerParents = new Set(centers.map((item) => item.parentId).filter((id): id is number => id !== null));
  const accountOptions = accounts.filter((item) => item.postable && !accountParents.has(item.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('');
  const centerOptions = centers.filter((item) => item.postable && !centerParents.has(item.id)).map((item) => `<option value="${item.id}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('');
  return `<div class="journal-line" data-journal-line><label class="field"><span>الحساب *</span><select name="accountId" required><option value="">اختر حسابًا</option>${accountOptions}</select></label>
    <label class="field"><span>البيان</span><input name="description" maxlength="240"></label><label class="field"><span>مدين</span><input name="debit" value="0" inputmode="decimal" maxlength="28" required></label>
    <label class="field"><span>دائن</span><input name="credit" value="0" inputmode="decimal" maxlength="28" required></label><label class="field"><span>مركز التكلفة</span><select name="costCenterId"><option value="">دون مركز</option>${centerOptions}</select></label>
    <button class="icon-button icon-button--danger journal-line__remove" type="button" data-action="journal-line-remove" aria-label="حذف السطر">حذف</button></div>`;
}

export function renderJournals(entries: JournalEntryItem[], accounts: AccountItem[], centers: CostCenter[], search = ''): string {
  const rows = entries.map((entry) => `<tr><td>${entry.id}</td><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.reference || '—')}</td><td>${escapeHtml(entry.description)}</td><td>${entry.lineCount}</td><td>مرحّل</td>
    <td><button class="button button--tiny button--secondary" type="button" data-action="journal-open" data-id="${entry.id}">فتح</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الحسابات · الأستاذ العام</p><h1>القيود اليومية</h1><p class="muted">القيد يُرحّل فور الحفظ؛ تصحيحه يكون بقيد مقابل ولا يُعدّل أو يُحذف.</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="journal-add" ${accounts.filter((item) => item.postable).length < 2 ? 'disabled' : ''}>＋ قيد جديد</button><button class="button button--secondary" type="button" data-action="journal-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="account-exit">خروج</button></div></section>
    <section class="table-panel accounting-panel"><div class="panel-title"><div><p class="eyebrow">سجل القيود المرحلة</p><h2>القيود اليومية</h2></div><span class="muted">${entries.length} قيد</span></div>${searchForm('journal-search', search, 'بحث برقم القيد أو التاريخ أو المرجع أو البيان')}
      <div class="table-scroll"><table><thead><tr><th>رقم القيد</th><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>السطور</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || '<tr><td class="empty-state" colspan="7">لا توجد قيود مطابقة.</td></tr>'}</tbody></table></div></section><div id="journal-editor-host"></div><div id="journal-detail-host"></div>`;
}

export function renderJournalEditor(accounts: AccountItem[], centers: CostCenter[]): string {
  return `<div class="modal-backdrop" id="journal-modal"><section class="record-modal record-modal--wide" role="dialog" aria-modal="true" aria-labelledby="journal-modal-title">
    <div class="modal-heading"><div><p class="eyebrow">قيد مزدوج</p><h2 id="journal-modal-title">قيد يومية جديد</h2></div><button class="icon-button" type="button" data-action="close-journal-modal">إغلاق</button></div>
    <form data-form="journal" class="journal-form"><input name="requestKey" type="hidden"><div class="journal-meta"><label class="field"><span>رقم القيد</span><input value="يُولّد عند الحفظ" disabled></label>
      <label class="field"><span>التاريخ *</span><input name="date" type="date" required></label><label class="field"><span>رقم المرجع</span><input name="reference" maxlength="100"></label><label class="field journal-meta__description"><span>البيان العام *</span><input name="description" maxlength="500" required></label></div>
      <div class="journal-lines-heading"><strong>سطور القيد</strong><button class="button button--secondary" type="button" data-action="journal-line-add">＋ إضافة سطر</button></div>
      <div id="journal-lines" class="journal-lines">${renderJournalLine(accounts, centers)}${renderJournalLine(accounts, centers)}</div>
      <div class="journal-totals"><span>المدين <strong data-journal-debit>0</strong></span><span>الدائن <strong data-journal-credit>0</strong></span><span>الفرق <strong data-journal-difference>0</strong></span></div>
      <p class="form-error" id="journal-error" role="alert" hidden></p><p class="journal-help">لا يمكن تعديل القيد بعد ترحيله؛ صحّح الأخطاء بقيد مقابل.</p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="close-journal-modal">إلغاء</button><button class="button button--primary" type="submit">حفظ وترحيل</button></div>
    </form></section></div>`;
}

export function renderJournalDetail(entry: JournalEntryDetail): string {
  const rows = entry.lines.map((line) => `<tr><td>${escapeHtml(line.accountCode)} — ${escapeHtml(line.accountName)}</td><td>${escapeHtml(line.description || '—')}</td>
    <td>${escapeHtml(line.costCenterCode ? `${line.costCenterCode} — ${line.costCenterName}` : '—')}</td><td class="number-cell">${escapeHtml(line.debit)}</td><td class="number-cell">${escapeHtml(line.credit)}</td></tr>`).join('');
  return `<div class="modal-backdrop" id="journal-detail-modal"><section class="record-modal record-modal--wide" role="dialog" aria-modal="true" aria-labelledby="journal-detail-title">
    <div class="modal-heading"><div><p class="eyebrow">قيد مرحّل · للعرض فقط</p><h2 id="journal-detail-title">قيد رقم ${entry.id}</h2></div><button class="icon-button" type="button" data-action="journal-detail-close">إغلاق</button></div>
    <p>التاريخ: ${escapeHtml(entry.date)} · المرجع: ${escapeHtml(entry.reference || '—')} · ${escapeHtml(entry.description)}</p><div class="table-scroll"><table><thead><tr><th>الحساب</th><th>البيان</th><th>مركز التكلفة</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><th colspan="3">الإجمالي</th><th>${escapeHtml(entry.totalDebit)}</th><th>${escapeHtml(entry.totalCredit)}</th></tr></tfoot></table></div><p class="journal-help">لتصحيح القيد المرحّل، أنشئ قيدًا مقابلًا.</p></section></div>`;
}

function budgetLine(accounts: AccountItem[], centers: CostCenter[], line?: Budget['lines'][number]): string {
  const accountOptions = accounts.filter((item) => item.postable).map((item) => `<option value="${item.id}" ${line?.accountId === item.id ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('');
  const centerOptions = centers.filter((item) => item.postable).map((item) => `<option value="${item.id}" ${line?.costCenterId === item.id ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('');
  const categoryOptions = categories.map(({ value, label }) => `<option value="${value}" ${line?.category === value ? 'selected' : ''}>${label}</option>`).join('');
  return `<tr data-budget-line><td><select name="accountId" required><option value="">اختر الحساب</option>${accountOptions}</select></td><td><select name="category">${categoryOptions}</select></td>
    <td><select name="costCenterId"><option value="">المركز العام</option>${centerOptions}</select></td><td><input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(line?.amount ?? '')}"></td>
    <td><input name="notes" maxlength="500" value="${escapeHtml(line?.notes ?? '')}"></td><td><button class="button button--tiny button--danger" type="button" data-action="budget-line-remove">حذف</button></td></tr>`;
}

export function renderBudgetLine(accounts: AccountItem[], centers: CostCenter[]): string {
  return budgetLine(accounts, centers);
}

export function renderBudgetEditor(budget: Budget | null, accounts: AccountItem[], centers: CostCenter[]): string {
  const centerOptions = centers.map((center) => `<option value="${center.id}" ${budget?.costCenterId === center.id ? 'selected' : ''}>${escapeHtml(center.code)} — ${escapeHtml(center.name)}</option>`).join('');
  const lines = budget?.lines.length ? budget.lines.map((line) => budgetLine(accounts, centers, line)).join('') : budgetLine(accounts, centers);
  return `<div class="modal-backdrop" id="budget-modal"><section class="record-modal record-modal--wide budget-modal" role="dialog" aria-modal="true" aria-labelledby="budget-modal-title">
    <div class="modal-heading"><div><p class="eyebrow">موازنة تقديرية · ${budget ? escapeHtml(budget.number) : 'جديدة'}</p><h2 id="budget-modal-title">${budget ? 'تعديل الموازنة' : 'موازنة جديدة'}</h2></div><button class="icon-button" type="button" data-action="budget-cancel">إغلاق</button></div>
    <form data-form="budget" class="budget-form"><input type="hidden" name="id" value="${budget?.id ?? ''}"><div class="budget-meta"><label class="field"><span>رقم الموازنة</span><input value="${escapeHtml(budget?.number ?? 'يُولّد عند الحفظ')}" disabled></label>
      <label class="field"><span>من تاريخ *</span><input name="from" type="date" required value="${escapeHtml(budget?.from ?? '')}"></label><label class="field"><span>إلى تاريخ *</span><input name="to" type="date" required value="${escapeHtml(budget?.to ?? '')}"></label>
      <label class="field"><span>مركز التكلفة</span><select name="costCenterId"><option value="">كل المراكز</option>${centerOptions}</select></label><label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2">${escapeHtml(budget?.notes ?? '')}</textarea></label></div>
      <div class="journal-lines-heading"><strong>تفاصيل التقديرات</strong><button class="button button--secondary" type="button" data-action="budget-line-add">＋ إضافة بند</button></div>
      <div class="table-scroll"><table class="budget-lines-table"><thead><tr><th>الحساب</th><th>التصنيف</th><th>مركز التكلفة</th><th>المبلغ</th><th>ملاحظات</th><th></th></tr></thead><tbody id="budget-lines">${lines}</tbody></table></div>
      <p class="form-error" id="budget-error" role="alert" hidden></p><div class="form-actions"><button class="button button--secondary" type="button" data-action="budget-cancel">إلغاء</button><button class="button button--primary" type="submit">حفظ الموازنة</button></div>
    </form></section></div>`;
}

export function renderBudgets(budgets: Budget[], search = ''): string {
  const rows = budgets.map((budget) => `<tr><td>${budget.id}</td><td><strong>${escapeHtml(budget.number)}</strong></td><td>${escapeHtml(budget.from)}</td><td>${escapeHtml(budget.to)}</td>
    <td class="number-cell">${escapeHtml(budget.sales)}</td><td class="number-cell">${escapeHtml(budget.cashPurchases)}</td><td class="number-cell">${escapeHtml(budget.cashExpenses)}</td><td class="number-cell">${escapeHtml(budget.net)}</td>
    <td class="row-actions"><button class="button button--tiny button--secondary" type="button" data-action="budget-edit" data-id="${budget.id}">تعديل</button><button class="button button--tiny button--danger" type="button" data-action="budget-delete" data-id="${budget.id}">حذف</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الحسابات · التخطيط</p><h1>الموازنة التقديرية</h1><p class="muted">تقديرات مرتبطة بالحسابات والمراكز؛ حفظها لا ينشئ قيدًا محاسبيًا.</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="budget-add">＋ جديد</button><button class="button button--secondary" type="button" data-action="budget-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="account-exit">خروج</button></div></section>
    <section class="table-panel accounting-panel"><div class="panel-title"><div><p class="eyebrow">السجل الفعلي</p><h2>الموازنات المحفوظة</h2></div><span class="muted">${budgets.length} موازنة</span></div>${searchForm('budget-search', search, 'بحث برقم الموازنة أو الملاحظات')}
      <div class="table-scroll"><table class="budget-table"><thead><tr><th>المعرّف</th><th>رقم الموازنة</th><th>من تاريخ</th><th>إلى تاريخ</th><th>مبيعات مقدرة</th><th>مشتريات نقدية</th><th>مصروفات نقدية</th><th>صافي الموازنة</th><th>إجراء</th></tr></thead><tbody>${rows || '<tr><td class="empty-state" colspan="9">لا توجد موازنات مطابقة.</td></tr>'}</tbody></table></div>
      <p class="report-footnote">صافي الموازنة = المبيعات المقدرة − المشتريات النقدية المقدرة − المصروفات النقدية المقدرة.</p></section><div id="budget-editor-host"></div>`;
}

export function renderAccountingPeriods(closures: AccountingPeriodClosure[]): string {
  const rows = closures.map((period) => `<tr><td>${escapeHtml(period.from)}</td><td>${escapeHtml(period.to)}</td>
    <td>${period.closedByUserId}</td><td>${escapeHtml(period.closedAt)}</td><td>مغلقة نهائيًا</td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الحسابات · الرقابة</p><h1>الفترات المحاسبية</h1>
    <p class="muted">لا يُسمح بالترحيل داخل فترة مغلقة. لا يمكن إعادة فتح الفترات؛ تُرحّل القيود العكسية إلى أول تاريخ مفتوح.</p></div>
    <button class="button button--secondary" type="button" data-action="accounting-periods-refresh">تحديث</button></section>
    <section class="table-panel accounting-panel"><div class="panel-title"><h2>إقفال فترة</h2></div>
      <form class="record-form" data-form="accounting-period-close">
        <label class="field"><span>من تاريخ *</span><input name="from" type="date" required></label>
        <label class="field"><span>إلى تاريخ *</span><input name="to" type="date" required></label>
        <p class="form-error field--wide" id="accounting-period-error" role="alert" hidden></p>
        <div class="form-actions field--wide"><button class="button button--primary" type="submit">إقفال نهائي</button></div>
      </form>
    </section>
    <section class="table-panel accounting-panel"><div class="panel-title"><h2>الفترات المغلقة</h2><span class="muted">${closures.length} فترة</span></div>
      <div class="table-scroll"><table><thead><tr><th>من</th><th>إلى</th><th>معرّف المدير</th><th>تاريخ الإقفال</th><th>الحالة</th></tr></thead>
      <tbody>${rows || '<tr><td class="empty-state" colspan="5">لا توجد فترات مغلقة.</td></tr>'}</tbody></table></div>
    </section>`;
}
