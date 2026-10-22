import type {
  AccountItem, BankAccount, CashBox, CostCenter, Customer, Expense, FinancialVoucher,
  FinancialVoucherParty, Project, Supplier,
} from '../shared/types.js';
import { formatAmount, parseAmount } from '../shared/accounting.js';
import { escapeHtml } from '../utils/html.js';

type Party = Customer | Supplier;
type OptionItem = { id: number; code: string; name: string };

function money(value: string): string {
  try { return formatAmount(parseAmount(value)); } catch { return value; }
}

function optionList(items: OptionItem[], selected: number | null, label: string): string {
  return `<option value="">${escapeHtml(label)}</option>${items.map((item) => `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.name}`)}</option>`).join('')}`;
}

function leafAccounts(accounts: AccountItem[], type: AccountItem['type']): AccountItem[] {
  const parents = new Set(accounts.map((item) => item.parentId).filter((id): id is number => id !== null));
  return accounts.filter((item) => item.type === type && item.postable && !parents.has(item.id));
}

function cashOptions(boxes: CashBox[]): OptionItem[] {
  return boxes.filter((item) => item.status === 'active' && item.currency.toUpperCase() === 'EGP')
    .map(({ id, code, name }) => ({ id, code, name }));
}

function bankOptions(banks: BankAccount[]): OptionItem[] {
  return banks.filter((item) => item.status === 'active' && item.currency.toUpperCase() === 'EGP')
    .map(({ id, code, name }) => ({ id, code, name }));
}

function payoutFields(boxes: CashBox[], banks: BankAccount[], method: 'cash' | 'bank', cashBoxId: number | null, bankId: number | null, disabled = false): string {
  return `<label class="field" data-payout-cash ${method === 'cash' ? '' : 'hidden'}><span>الخزينة *</span><select name="cashBoxId" ${disabled || method !== 'cash' ? 'disabled' : ''}>${optionList(cashOptions(boxes), cashBoxId, 'اختر خزينة EGP نشطة')}</select></label>
    <label class="field" data-payout-bank ${method === 'bank' ? '' : 'hidden'}><span>البنك *</span><select name="bankAccountId" ${disabled || method !== 'bank' ? 'disabled' : ''}>${optionList(bankOptions(banks), bankId, 'اختر بنك EGP نشط')}</select></label>`;
}

function paymentMethodOptions(method: 'cash' | 'bank', disabled = false): string {
  return `<label class="field"><span>طريقة الدفع *</span><select name="paymentMethod" ${disabled ? 'disabled' : ''}><option value="cash" ${method === 'cash' ? 'selected' : ''}>نقدًا</option><option value="bank" ${method === 'bank' ? 'selected' : ''}>تحويل بنكي</option></select></label>`;
}

export function renderFinancialVouchersPage(
  partyKind: FinancialVoucherParty, vouchers: FinancialVoucher[], parties: Party[], boxes: CashBox[], banks: BankAccount[],
  centers: CostCenter[], projects: Project[], search = '',
): string {
  const partyLabel = partyKind === 'customer' ? 'العملاء' : 'الموردين';
  const actionLabel = partyKind === 'customer' ? 'القبض' : 'السداد';
  const posted = vouchers.filter((item) => item.status === 'posted');
  const postedTotal = posted.reduce((sum, item) => sum + parseAmount(item.amount), 0n);
  const rows = vouchers.map((voucher) => `<tr data-search="${escapeHtml(`${voucher.number} ${voucher.partyName} ${voucher.partyCode} ${voucher.reference} ${voucher.date}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(voucher.number)}</strong></td><td>${escapeHtml(voucher.date)}</td><td>${escapeHtml(voucher.partyCode)} — ${escapeHtml(voucher.partyName)}</td>
    <td>${voucher.paymentMethod === 'cash' ? 'نقدًا' : 'تحويل بنكي'} · ${escapeHtml(voucher.payoutAccountName)}</td><td>${escapeHtml(voucher.reference || '—')}</td>
    <td class="number-cell">${money(voucher.amount)} ${escapeHtml(voucher.payoutCurrency)}</td><td>${voucher.status === 'posted' ? 'مرحّل' : 'مسودة'}</td>
    <td class="sales-row-actions">${voucher.status === 'draft' ? `<button class="icon-button" type="button" data-action="financial-voucher-edit" data-id="${voucher.id}">تعديل</button>
      <button class="icon-button" type="button" data-action="financial-voucher-approve" data-id="${voucher.id}" data-kind="${partyKind}">اعتماد وترحيل</button>
      <button class="icon-button icon-button--danger" type="button" data-action="financial-voucher-delete" data-id="${voucher.id}" data-kind="${partyKind}">حذف</button>`
      : `<button class="icon-button" type="button" data-action="financial-voucher-open" data-id="${voucher.id}">عرض القيد</button>`}</td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المالية · ${partyLabel}</p><h1>سندات ${partyLabel}</h1><p class="muted">${partyKind === 'customer' ? 'قبض العميل يزيد الخزينة أو البنك ويخفض ذمم العميل.' : 'سداد المورد يخفض الخزينة أو البنك وذمم المورد.'}</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="financial-voucher-new">＋ جديد</button><button class="button button--secondary" type="button" data-action="financial-voucher-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="financial-document-exit">خروج</button></div></section>
    <section class="accounting-summary"><article class="accounting-summary__card"><span>إجمالي ${actionLabel} المرحّل</span><strong>${money(formatAmount(postedTotal))} ج.م</strong></article><article class="accounting-summary__card"><span>عدد السندات المرحلة</span><strong>${posted.length}</strong></article><article class="accounting-summary__card"><span>مسودات</span><strong>${vouchers.length - posted.length}</strong></article></section>
    <section class="table-panel financial-document-panel"><div class="table-toolbar"><form class="accounting-search" data-form="financial-voucher-search"><label class="search-field"><span>⌕</span><input name="search" type="search" maxlength="180" value="${escapeHtml(search)}" placeholder="بحث برقم السند أو الطرف أو المرجع"></label><button class="button button--secondary" type="submit">بحث</button></form><span class="muted">${vouchers.length} سند</span></div>
      <div class="table-scroll"><table class="financial-document-table"><thead><tr><th>رقم السند</th><th>التاريخ</th><th>${partyKind === 'customer' ? 'العميل' : 'المورد'}</th><th>طريقة الدفع / الحساب</th><th>المرجع</th><th>المبلغ</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty-state">لا توجد سندات مطابقة.</td></tr>'}</tbody></table></div></section>
    <div id="financial-voucher-editor-host"></div><div id="financial-voucher-detail-host"></div>`;
}

export function renderFinancialVoucherEditor(
  partyKind: FinancialVoucherParty, voucher: FinancialVoucher | null, parties: Party[], boxes: CashBox[], banks: BankAccount[],
  centers: CostCenter[], projects: Project[],
): string {
  const locked = voucher?.status === 'posted';
  const partyLabel = partyKind === 'customer' ? 'العميل' : 'المورد';
  const partyOptions = parties.filter((party) => party.status === 'active' || party.id === voucher?.partyId)
    .map((party) => `<option value="${party.id}" ${party.id === voucher?.partyId ? 'selected' : ''}>${escapeHtml(`${party.code} — ${party.name}${party.accountId ? ` · ${party.accountCode} ${party.accountName}` : ' · الحساب غير مربوط'}`)}</option>`).join('');
  const centerOptions = centers.filter((center) => center.postable).map((center) => `<option value="${center.id}" ${center.id === voucher?.costCenterId ? 'selected' : ''}>${escapeHtml(`${center.code} — ${center.name}`)}</option>`).join('');
  const projectOptions = projects.filter((project) => project.status !== 'cancelled').map((project) => `<option value="${project.id}" ${project.id === voucher?.projectId ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('');
  const method = voucher?.paymentMethod ?? 'cash';
  return `<div class="modal-backdrop" id="financial-voucher-modal"><section class="record-modal record-modal--wide financial-document-modal" role="dialog" aria-modal="true" aria-labelledby="financial-voucher-title">
    <header class="modal-heading"><div><p class="eyebrow">${partyKind === 'customer' ? 'قبض عميل' : 'سداد مورد'}</p><h2 id="financial-voucher-title">${voucher ? `سند ${escapeHtml(voucher.number)} · ${locked ? 'مرحّل' : 'تعديل مسودة'}` : 'سند جديد'}</h2></div><button class="icon-button" type="button" data-action="financial-voucher-cancel">إغلاق</button></header>
    <form class="record-form financial-document-form" data-form="financial-voucher" data-kind="${partyKind}"><input name="id" type="hidden" value="${voucher?.id ?? ''}"><input name="partyKind" type="hidden" value="${partyKind}">
      <label class="field"><span>نوع السند</span><input value="${partyKind === 'customer' ? 'سند قبض عميل' : 'سند سداد مورد'}" disabled></label><label class="field"><span>رقم السند</span><input value="${escapeHtml(voucher?.number ?? 'يُولّد عند الحفظ')}" disabled></label>
      <label class="field"><span>التاريخ *</span><input name="date" type="date" required value="${escapeHtml(voucher?.date ?? '')}" ${locked ? 'disabled' : ''}></label>
      <label class="field"><span>${partyLabel} *</span><select name="partyId" required ${locked ? 'disabled' : ''}><option value="">اختر ${partyLabel}</option>${partyOptions}</select></label>
      <label class="field"><span>المبلغ *</span><input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(voucher?.amount ?? '')}" ${locked ? 'disabled' : ''}></label>
      ${paymentMethodOptions(method, locked)}${payoutFields(boxes, banks, method, voucher?.cashBoxId ?? null, voucher?.bankAccountId ?? null, locked)}
      <label class="field"><span>مركز التكلفة</span><select name="costCenterId" ${locked ? 'disabled' : ''}><option value="">دون مركز</option>${centerOptions}</select></label>
      <label class="field"><span>المشروع</span><select name="projectId" ${locked ? 'disabled' : ''}><option value="">دون مشروع</option>${projectOptions}</select></label>
      <label class="field"><span>رقم المرجع</span><input name="reference" maxlength="100" value="${escapeHtml(voucher?.reference ?? '')}" ${locked ? 'disabled' : ''}></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="2000" ${locked ? 'disabled' : ''}>${escapeHtml(voucher?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="financial-voucher-error" role="alert" hidden></p><div class="form-actions field--wide">${locked ? '<button class="button button--secondary" type="button" data-action="financial-voucher-cancel">إغلاق</button>' : '<button class="button button--secondary" type="button" data-action="financial-voucher-cancel">إلغاء</button><button class="button button--primary" type="submit">حفظ مسودة</button>'}</div>
    </form></section></div>`;
}

export function renderExpenseAllocationRow(accounts: AccountItem[], centers: CostCenter[], projects: Project[], allocation?: Expense['allocations'][number]): string {
  const accountOptions = leafAccounts(accounts, 'expense').map((account) => `<option value="${account.id}" ${allocation?.expenseAccountId === account.id ? 'selected' : ''}>${escapeHtml(`${account.code} — ${account.name}`)}</option>`).join('');
  const centerOptions = centers.filter((item) => item.postable).map((center) => `<option value="${center.id}" ${allocation?.costCenterId === center.id ? 'selected' : ''}>${escapeHtml(`${center.code} — ${center.name}`)}</option>`).join('');
  const projectOptions = projects.filter((item) => item.status !== 'cancelled').map((project) => `<option value="${project.id}" ${allocation?.projectId === project.id ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('');
  return `<tr data-expense-allocation><td><select name="expenseAccountId" required><option value="">اختر حساب مصروف</option>${accountOptions}</select></td><td><select name="projectId"><option value="">دون مشروع</option>${projectOptions}</select></td>
    <td><select name="costCenterId"><option value="">دون مركز</option>${centerOptions}</select></td><td><input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(allocation?.amount ?? '')}"></td>
    <td><input name="notes" maxlength="500" value="${escapeHtml(allocation?.notes ?? '')}"></td><td><button class="button button--tiny button--danger" type="button" data-action="expense-allocation-remove">حذف</button></td></tr>`;
}

export function renderExpenseEditor(expense: Expense | null, accounts: AccountItem[], boxes: CashBox[], banks: BankAccount[], centers: CostCenter[], projects: Project[], duplicate = false): string {
  const locked = expense?.status === 'posted' && !duplicate;
  const method = expense?.paymentMethod ?? 'cash';
  const payableOptions = leafAccounts(accounts, 'liability').map((account) => `<option value="${account.id}" ${expense?.payableAccountId === account.id ? 'selected' : ''}>${escapeHtml(`${account.code} — ${account.name}`)}</option>`).join('');
  const centerOptions = centers.filter((item) => item.postable).map((center) => `<option value="${center.id}" ${expense?.costCenterId === center.id ? 'selected' : ''}>${escapeHtml(`${center.code} — ${center.name}`)}</option>`).join('');
  const projectOptions = projects.filter((item) => item.status !== 'cancelled').map((project) => `<option value="${project.id}" ${expense?.projectId === project.id ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('');
  const allocationRows = expense?.allocations.map((line) => renderExpenseAllocationRow(accounts, centers, projects, line)).join('') ?? renderExpenseAllocationRow(accounts, centers, projects);
  return `<div class="modal-backdrop" id="expense-modal"><section class="record-modal record-modal--wide expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-title">
    <header class="modal-heading"><div><p class="eyebrow">إدارة المصروفات · ${expense && !duplicate ? escapeHtml(expense.number) : 'مسودة جديدة'}</p><h2 id="expense-title">${locked ? `مصروف مرحّل ${escapeHtml(expense.number)}` : duplicate ? 'نسخة مصروف جديدة' : expense ? 'تعديل مسودة المصروف' : 'مصروف جديد'}</h2></div><button class="icon-button" type="button" data-action="expense-cancel">إغلاق</button></header>
    <form class="expense-form" data-form="expense"><input name="id" type="hidden" value="${duplicate ? '' : expense?.id ?? ''}"><div class="expense-meta">
      <label class="field"><span>المسلسل</span><input value="${escapeHtml(duplicate ? 'يُولّد مسلسل جديد' : expense?.number ?? 'يُولّد عند الحفظ')}" disabled></label><label class="field"><span>التاريخ *</span><input name="date" type="date" required value="${escapeHtml(duplicate ? '' : expense?.date ?? '')}" ${locked ? 'disabled' : ''}></label>
      <label class="field"><span>نوع العملية *</span><input name="operationType" maxlength="100" required value="${escapeHtml(expense?.operationType ?? '')}" ${locked ? 'disabled' : ''}></label><label class="field"><span>اسم البند *</span><input name="description" maxlength="300" required value="${escapeHtml(expense?.description ?? '')}" ${locked ? 'disabled' : ''}></label>
      <label class="field"><span>العملة</span><input value="جنيه مصري (EGP)" disabled></label><label class="field"><span>الإجمالي *</span><input name="totalAmount" type="number" min="0.01" step="0.01" required value="${escapeHtml(expense?.totalAmount ?? '')}" ${locked ? 'disabled' : ''}></label>
      <label class="field"><span>المبلغ المدفوع *</span><input name="paidAmount" type="number" min="0" step="0.01" required value="${escapeHtml(duplicate ? '0' : expense?.paidAmount ?? '0')}" ${locked ? 'disabled' : ''}></label>
      <label class="field"><span>المتبقي</span><input data-expense-remaining value="${escapeHtml(expense?.remaining ?? '')}" disabled></label>${paymentMethodOptions(method, locked)}
      ${payoutFields(boxes, banks, method, duplicate ? null : expense?.cashBoxId ?? null, duplicate ? null : expense?.bankAccountId ?? null, locked)}
      <label class="field"><span>حساب الالتزام للمبلغ المتبقي</span><select name="payableAccountId" ${locked ? 'disabled' : ''}><option value="">اختر عند وجود متبقي</option>${payableOptions}</select></label>
      <label class="field"><span>مركز التكلفة العام</span><select name="costCenterId" ${locked ? 'disabled' : ''}><option value="">دون مركز</option>${centerOptions}</select></label><label class="field"><span>المشروع العام</span><select name="projectId" ${locked ? 'disabled' : ''}><option value="">دون مشروع</option>${projectOptions}</select></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2" ${locked ? 'disabled' : ''}>${escapeHtml(expense?.notes ?? '')}</textarea></label></div>
      <div class="expense-allocation-heading"><div><strong>توزيع الأوامر والمشروعات</strong><small>يجب أن يساوي مجموع التوزيع إجمالي المصروف.</small></div>${locked ? '' : '<button class="button button--secondary" type="button" data-action="expense-allocation-add">＋ إضافة توزيع</button>'}</div>
      <div class="table-scroll"><table class="expense-allocation-table"><thead><tr><th>حساب المصروف *</th><th>المشروع</th><th>مركز التكلفة</th><th>المبلغ *</th><th>ملاحظات</th><th></th></tr></thead><tbody id="expense-allocations">${allocationRows}</tbody></table></div>
      <div class="expense-total-strip"><span>مجموع التوزيع <strong data-expense-allocated>0</strong> ج.م</span><span>المتبقي <strong data-expense-remaining-label>${money(duplicate ? expense?.totalAmount ?? '0' : expense?.remaining ?? expense?.totalAmount ?? '0')}</strong> ج.م</span></div>
      ${locked ? '<p class="journal-help">المصروف مرحّل ولا يمكن تعديله أو حذفه.</p>' : ''}<p class="form-error" id="expense-error" role="alert" hidden></p>
      <div class="form-actions">${locked ? '<button class="button button--secondary" type="button" data-action="expense-cancel">إغلاق</button>' : `<button class="button button--secondary" type="button" data-action="expense-cancel">إلغاء</button>${expense && !duplicate ? `<button class="button button--secondary" type="button" data-action="expense-duplicate" data-id="${expense.id}">تكرار المصروف</button>` : ''}<button class="button button--primary" type="submit">حفظ مسودة</button>`}</div>
    </form></section></div>`;
}

export function renderExpensesPage(expenses: Expense[], search = ''): string {
  const posted = expenses.filter((item) => item.status === 'posted');
  const total = posted.reduce((sum, item) => sum + parseAmount(item.total), 0n);
  const rows = expenses.map((expense) => `<tr data-search="${escapeHtml(`${expense.number} ${expense.operationType} ${expense.description} ${expense.notes}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(expense.number)}</strong></td><td>${escapeHtml(expense.date)}</td><td>${escapeHtml(expense.operationType)}</td><td>${escapeHtml(expense.description)}</td><td>${expense.currency}</td>
    <td>${expense.paymentMethod === 'cash' ? 'نقدًا' : 'تحويل بنكي'}</td><td>${expense.settlementStatus === 'paid' ? 'مسدد' : expense.settlementStatus === 'partial' ? 'مسدد جزئيًا' : 'غير مسدد'}</td>
    <td class="number-cell">${money(expense.total)} ج.م</td><td class="number-cell">${money(expense.paidAmount)} ج.م</td><td class="number-cell">${money(expense.remaining)} ج.م</td>
    <td class="sales-row-actions">${expense.status === 'draft' ? `<button class="icon-button" type="button" data-action="expense-edit" data-id="${expense.id}">تعديل</button><button class="icon-button" type="button" data-action="expense-approve" data-id="${expense.id}">اعتماد وترحيل</button><button class="icon-button" type="button" data-action="expense-duplicate" data-id="${expense.id}">تكرار</button><button class="icon-button icon-button--danger" type="button" data-action="expense-delete" data-id="${expense.id}">حذف</button>` : `مرحّل <button class="icon-button" type="button" data-action="expense-duplicate" data-id="${expense.id}">تكرار</button>`}</td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المالية · المصروفات</p><h1>إدارة المصروفات</h1><p class="muted">مسودات قبل الاعتماد؛ المصروف المرحّل ثابت ويُصحح بقيد مقابل.</p></div>
    <div class="toolbar-actions"><button class="button button--primary" type="button" data-action="expense-new">＋ جديد</button><button class="button button--secondary" type="button" data-action="expense-refresh">تحديث</button><button class="button button--quiet" type="button" data-action="financial-document-exit">خروج</button></div></section>
    <section class="accounting-summary"><article class="accounting-summary__card"><span>إجمالي المصروفات المرحلة</span><strong>${money(formatAmount(total))} ج.م</strong></article><article class="accounting-summary__card"><span>عدد المصروفات المرحلة</span><strong>${posted.length}</strong></article><article class="accounting-summary__card"><span>مسودات</span><strong>${expenses.length - posted.length}</strong></article></section>
    <section class="table-panel financial-document-panel"><div class="table-toolbar"><form class="accounting-search" data-form="expense-search"><label class="search-field"><span>⌕</span><input name="search" id="expense-search" type="search" maxlength="180" value="${escapeHtml(search)}" placeholder="بحث بالمسلسل أو العملية أو البند"></label><button class="button button--secondary" type="submit">بحث</button></form><span class="muted">${expenses.length} مصروف</span></div>
      <div class="table-scroll"><table class="expense-table"><thead><tr><th>المسلسل</th><th>التاريخ</th><th>نوع العملية</th><th>اسم البند</th><th>العملة</th><th>الدفع</th><th>حالة السداد</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الإجراءات</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="empty-state">لا توجد مصروفات مطابقة.</td></tr>'}</tbody></table></div></section><div id="expense-editor-host"></div>`;
}
