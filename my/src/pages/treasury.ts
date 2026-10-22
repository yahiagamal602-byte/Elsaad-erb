import type { AccountItem, BankAccount, CashBox, TreasuryView } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function accountOptions(accounts: AccountItem[], selectedId: number): string {
  return accounts.filter((account) => account.type === 'asset').map((account) =>
    `<option value="${account.id}" ${account.id === selectedId ? 'selected' : ''}>${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`,
  ).join('');
}

function statusBadge(status: 'active' | 'inactive'): string {
  return `<span class="sales-status sales-status--${status}">${status === 'active' ? 'نشط' : 'غير نشط'}</span>`;
}

function renderCashBoxes(boxes: CashBox[]): string {
  const rows = boxes.map((box) => `<tr data-treasury-row data-code="${escapeHtml(box.code)}"
    data-search="${escapeHtml(`${box.code} ${box.name}`.toLocaleLowerCase('ar'))}" data-status="${box.status}">
    <td><strong>${escapeHtml(box.code)}</strong></td><td>${escapeHtml(box.name)}</td>
    <td>${escapeHtml(box.accountCode)} — ${escapeHtml(box.accountName)}</td>
    <td class="number-cell">${escapeHtml(box.openingBalance)} <small>${escapeHtml(box.currency)}</small></td>
    <td>${escapeHtml(box.openingDate)}</td><td>${statusBadge(box.status)}</td>
    <td class="sales-row-actions"><button class="icon-button" type="button" data-action="treasury-edit" data-kind="cash-box" data-id="${box.id}">تعديل</button>
      <button class="icon-button" type="button" data-action="treasury-status" data-kind="cash-box" data-id="${box.id}" data-status="${box.status === 'active' ? 'inactive' : 'active'}">${box.status === 'active' ? 'تعطيل' : 'تفعيل'}</button></td>
  </tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الخزائن والبنوك · بيانات تعريفية</p><h2>الخزائن</h2>
      <p class="muted">رصيد أول المدة تأسيسي ولا ينشئ سند قبض أو قيدًا محاسبيًا.</p></div>
    <button class="button button--primary" type="button" data-action="treasury-add" data-kind="cash-box">إضافة خزنة</button></section>
    <section class="table-panel"><div class="treasury-tabs" role="tablist" aria-label="صفحات الخزائن والبنوك">
      <button type="button" class="treasury-tab treasury-tab--active" data-treasury-view="cash-boxes" role="tab" aria-selected="true">الخزائن</button>
      <button type="button" class="treasury-tab" data-treasury-view="banks" role="tab" aria-selected="false">البنوك</button></div>
      <div class="table-toolbar"><label class="search-field"><span>⌕</span><input id="cash-box-search" type="search" placeholder="بحث برقم الخزنة أو اسمها" aria-label="بحث بالخزائن"></label><span class="muted">${boxes.length} خزنة</span></div>
      <div class="table-scroll"><table class="inventory-table treasury-table"><thead><tr><th>رقم الخزنة</th><th>اسم الخزنة</th><th>الحساب المحاسبي</th><th>رصيد أول المدة</th><th>تاريخ أول المدة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty-state">لا توجد خزائن مسجلة. أضف خزنة مرتبطة بحساب أصول من دليل الحسابات.</td></tr>'}</tbody></table></div></section>
    <div id="treasury-modal-host"></div>`;
}

function renderBanks(banks: BankAccount[]): string {
  const rows = banks.map((bank) => `<tr data-treasury-row data-code="${escapeHtml(bank.code)}"
    data-search="${escapeHtml(`${bank.code} ${bank.name}`.toLocaleLowerCase('ar'))}" data-status="${bank.status}">
    <td><strong>${escapeHtml(bank.code)}</strong></td><td>${escapeHtml(bank.name)}</td>
    <td>${escapeHtml(bank.accountCode)} — ${escapeHtml(bank.accountName)}</td><td dir="ltr">${escapeHtml(bank.bankAccountNumber)}</td>
    <td>${escapeHtml(bank.currency)}</td>
    <td class="number-cell">${escapeHtml(bank.openingBalance)} <small>${escapeHtml(bank.currency)}</small></td>
    <td>${escapeHtml(bank.openingDate)}</td><td>${statusBadge(bank.status)}</td>
    <td class="sales-row-actions"><button class="icon-button" type="button" data-action="treasury-edit" data-kind="bank" data-id="${bank.id}">تعديل</button>
      <button class="icon-button" type="button" data-action="treasury-status" data-kind="bank" data-id="${bank.id}" data-status="${bank.status === 'active' ? 'inactive' : 'active'}">${bank.status === 'active' ? 'تعطيل' : 'تفعيل'}</button></td>
  </tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">الخزائن والبنوك · بيانات تعريفية</p><h2>البنوك</h2>
      <p class="muted">يُعرض كل رصيد بعملته دون جمع أرصدة العملات المختلفة.</p></div>
    <button class="button button--primary" type="button" data-action="treasury-add" data-kind="bank">إضافة بنك</button></section>
    <section class="table-panel"><div class="treasury-tabs" role="tablist" aria-label="صفحات الخزائن والبنوك">
      <button type="button" class="treasury-tab" data-treasury-view="cash-boxes" role="tab" aria-selected="false">الخزائن</button>
      <button type="button" class="treasury-tab treasury-tab--active" data-treasury-view="banks" role="tab" aria-selected="true">البنوك</button></div>
      <div class="table-toolbar"><label class="search-field"><span>⌕</span><input id="bank-search" type="search" placeholder="بحث برقم البنك أو اسمه" aria-label="بحث بالبنوك"></label><span class="muted">${banks.length} بنك</span></div>
      <div class="table-scroll"><table class="inventory-table treasury-table"><thead><tr><th>رقم البنك</th><th>اسم البنك</th><th>الحساب المحاسبي</th><th>رقم الحساب البنكي</th><th>العملة</th><th>رصيد أول المدة</th><th>تاريخ أول المدة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="empty-state">لا توجد بنوك مسجلة. أضف حسابًا بنكيًا واختر عملته بوضوح.</td></tr>'}</tbody></table></div></section>
    <div id="treasury-modal-host"></div>`;
}

export function renderTreasuryPage(view: TreasuryView, cashBoxes: CashBox[], banks: BankAccount[]): string {
  return view === 'banks' ? renderBanks(banks) : renderCashBoxes(cashBoxes);
}

export function renderTreasuryForm(
  kind: 'cash-box' | 'bank',
  record: CashBox | BankAccount | null,
  accounts: AccountItem[],
): string {
  const isBank = kind === 'bank';
  const bank = record && 'bankAccountNumber' in record ? record : null;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `<div class="modal-backdrop" id="treasury-modal"><section class="record-modal treasury-editor" role="dialog" aria-modal="true" aria-labelledby="treasury-form-title">
    <header class="modal-heading"><div><p class="eyebrow">بيانات تعريفية · لا تنشئ حركة مالية</p><h2 id="treasury-form-title">${record ? 'تعديل' : 'إضافة'} ${isBank ? 'بنك' : 'خزنة'}</h2></div>
      <button class="icon-button" type="button" data-action="treasury-close">إغلاق</button></header>
    <form class="inventory-form" data-form="treasury-record" data-kind="${kind}">
      <input type="hidden" name="id" value="${record?.id ?? ''}">
      <label class="field"><span>رقم ${isBank ? 'البنك' : 'الخزنة'} *</span><input name="code" maxlength="40" required value="${escapeHtml(record?.code ?? '')}" autocomplete="off"></label>
      <label class="field"><span>اسم ${isBank ? 'البنك' : 'الخزنة'} *</span><input name="name" maxlength="160" required value="${escapeHtml(record?.name ?? '')}"></label>
      <label class="field"><span>الحساب المحاسبي (أصول) *</span><select name="accountId" required><option value="">اختر حسابًا</option>${accountOptions(accounts, record?.accountId ?? 0)}</select></label>
      ${isBank ? `<label class="field"><span>رقم الحساب البنكي *</span><input name="bankAccountNumber" maxlength="50" required value="${escapeHtml(bank?.bankAccountNumber ?? '')}" dir="ltr"></label>` : ''}
      <label class="field"><span>العملة (رمز أو اسم) *</span><input name="currency" maxlength="30" required value="${escapeHtml(record?.currency ?? 'EGP')}" placeholder="EGP أو جنيه مصري"></label>
      <label class="field"><span>رصيد أول المدة *</span><input name="openingBalance" type="number" min="0" max="999999999999999" step="any" required value="${escapeHtml(record?.openingBalance ?? '0')}" dir="ltr"></label>
      <label class="field"><span>تاريخ أول المدة *</span><input name="openingDate" type="date" required value="${escapeHtml(record?.openingDate ?? today)}"></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!record || record.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${record?.status === 'inactive' ? 'selected' : ''}>غير نشط</option></select></label>
      <p class="treasury-form-note field--wide">رصيد أول المدة قيمة تأسيسية مستقلة عن سندات القبض والصرف. لا تُدمج العملات المختلفة، ولا تُنشأ قيود محاسبية عند الحفظ.</p>
      <p class="form-error field--wide" id="treasury-form-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="treasury-close">إلغاء</button>
        <button class="button button--primary" type="submit">حفظ ${isBank ? 'البنك' : 'الخزنة'}</button></div>
    </form></section></div>`;
}
