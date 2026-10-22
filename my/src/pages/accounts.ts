import { ACCOUNT_TYPES } from '../shared/accounting.js';
import type { AccountItem, JournalEntryItem } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

export function renderAccountsPage(accounts: AccountItem[], entries: JournalEntryItem[]): string {
  const typeLabel = (value: string): string => ACCOUNT_TYPES.find(({ value: type }) => type === value)?.label ?? value;
  const parentNames = new Map(accounts.map((account) => [account.id, account.name]));
  const accountRows = accounts.map((account) => `
    <tr data-account-row>
      <td>${escapeHtml(account.code)}</td>
      <td><strong>${escapeHtml(account.name)}</strong><small>${account.parentId ? `يتبع: ${escapeHtml(parentNames.get(account.parentId) ?? '')}` : 'حساب رئيسي'}</small></td>
      <td>${escapeHtml(typeLabel(account.type))}</td>
      <td class="row-actions">
        <button class="icon-button" type="button" data-action="account-edit" data-id="${account.id}">تعديل</button>
        <button class="icon-button icon-button--danger" type="button" data-action="account-delete" data-id="${account.id}">حذف</button>
      </td>
    </tr>
  `).join('');
  const entryRows = entries.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.date)}</td>
      <td>${escapeHtml(entry.reference || '—')}</td>
      <td><strong>${escapeHtml(entry.description)}</strong></td>
      <td>${entry.lineCount}</td>
      <td><span class="status-badge status-badge--completed">مرحّل</span></td>
    </tr>
  `).join('');
  const typeOptions = ACCOUNT_TYPES.map(({ value, label }) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  const parentOptions = accounts.map((account) =>
    `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  const accountOptions = accounts.map((account) =>
    `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');

  return `
    <section class="section-heading section-heading--page">
      <div><p class="eyebrow">دفتر الأستاذ</p><h2>دليل الحسابات والقيود اليومية</h2><p class="muted">أنشئ حساباتك ثم سجّل قيودًا متوازنة يدويًا؛ لا يوجد ترحيل تلقائي من أقسام التشغيل.</p></div>
      <div class="toolbar-actions">
        <button class="button button--secondary" type="button" data-action="account-add">إضافة حساب</button>
        <button class="button button--primary" type="button" data-action="journal-add" ${accounts.length < 2 ? 'disabled title="أضف حسابين على الأقل أولًا"' : ''}>قيد يومية جديد</button>
      </div>
    </section>
    <section class="accounting-summary">
      <article class="accounting-summary__card"><span>دليل الحسابات</span><strong>${accounts.length}</strong></article>
      <article class="accounting-summary__card"><span>القيود المرحلة</span><strong>${entries.length}</strong></article>
      <article class="accounting-summary__card"><span>العملات والضرائب</span><strong class="accounting-summary__note">غير محددة</strong></article>
    </section>
    <section class="table-panel accounting-panel">
      <div class="panel-title"><div><p class="eyebrow">شجرة الحسابات</p><h3>الحسابات</h3></div><span class="muted">${accounts.length} حساب</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>الرمز</th><th>اسم الحساب</th><th>النوع</th><th>الإجراءات</th></tr></thead>
        <tbody>${accountRows || '<tr><td class="empty-state" colspan="4">لا توجد حسابات بعد. أضف حساباتك الفعلية قبل تسجيل القيود.</td></tr>'}</tbody>
      </table></div>
    </section>
    <section class="table-panel accounting-panel">
      <div class="panel-title"><div><p class="eyebrow">سجل الأستاذ العام</p><h3>القيود المرحلة</h3></div><span class="muted">القيود المرحلة غير قابلة للتعديل أو الحذف</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>التاريخ</th><th>المرجع</th><th>الوصف</th><th>الأسطر</th><th>الحالة</th></tr></thead>
        <tbody>${entryRows || '<tr><td class="empty-state" colspan="5">لا توجد قيود مرحلة. لن تُضاف أرصدة تلقائيًا.</td></tr>'}</tbody>
      </table></div>
    </section>
    <div class="modal-backdrop" id="account-modal" hidden>
      <section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <div class="modal-heading"><div><p class="eyebrow">دليل الحسابات</p><h2 id="account-modal-title">إضافة حساب</h2></div><button class="icon-button" type="button" data-action="close-account-modal">إغلاق</button></div>
        <form id="account-form" data-form="account" class="record-form">
          <input name="id" type="hidden">
          <label class="field"><span>رمز الحساب <b>*</b></span><input name="code" maxlength="40" required autocomplete="off"></label>
          <label class="field"><span>اسم الحساب <b>*</b></span><input name="name" maxlength="180" required autocomplete="off"></label>
          <label class="field"><span>نوع الحساب</span><select name="type">${typeOptions}</select></label>
          <label class="field"><span>الحساب الأب</span><select name="parentId"><option value="">دون حساب أب</option>${parentOptions}</select></label>
          <p class="form-error field--wide" id="account-error" role="alert" hidden></p>
          <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="close-account-modal">إلغاء</button><button class="button button--primary" type="submit">حفظ الحساب</button></div>
        </form>
      </section>
    </div>
    <div class="modal-backdrop" id="journal-modal" hidden>
      <section class="record-modal record-modal--wide" role="dialog" aria-modal="true" aria-labelledby="journal-modal-title">
        <div class="modal-heading"><div><p class="eyebrow">القيد المزدوج</p><h2 id="journal-modal-title">قيد يومية جديد</h2></div><button class="icon-button" type="button" data-action="close-journal-modal">إغلاق</button></div>
        <form id="journal-form" data-form="journal" class="journal-form">
          <div class="journal-meta">
            <label class="field"><span>التاريخ <b>*</b></span><input name="date" type="date" required></label>
            <label class="field"><span>المرجع</span><input name="reference" maxlength="100" autocomplete="off"></label>
            <label class="field journal-meta__description"><span>البيان <b>*</b></span><input name="description" maxlength="500" required autocomplete="off"></label>
          </div>
          <div class="journal-lines-heading"><strong>أسطر القيد</strong><span class="muted">المدين والدائن يجب أن يتساويا بدقة عشرية</span></div>
          <div id="journal-lines" class="journal-lines">
            ${renderJournalLine(accountOptions)}
            ${renderJournalLine(accountOptions)}
          </div>
          <button class="button button--secondary" type="button" data-action="journal-line-add" ${accounts.length === 0 ? 'disabled' : ''}>إضافة سطر</button>
          <p class="form-error" id="journal-error" role="alert" hidden></p>
          <p class="journal-help">تُحفظ القيود المرحلة كسجل ثابت. لتصحيح قيد، يُسجّل قيد مقابل؛ لا تُحذف القيود المرحلة.</p>
          <div class="form-actions"><button class="button button--secondary" type="button" data-action="close-journal-modal">إلغاء</button><button class="button button--primary" type="submit" ${accounts.length < 2 ? 'disabled' : ''}>حفظ وترحيل</button></div>
        </form>
      </section>
    </div>
  `;
}

export function renderJournalLine(accountOptions: string): string {
  return `
    <div class="journal-line" data-journal-line>
      <label class="field"><span>الحساب</span><select name="accountId" required><option value="">اختر حسابًا</option>${accountOptions}</select></label>
      <label class="field"><span>مدين</span><input name="debit" value="0" inputmode="decimal" maxlength="28" required></label>
      <label class="field"><span>دائن</span><input name="credit" value="0" inputmode="decimal" maxlength="28" required></label>
      <button class="icon-button icon-button--danger journal-line__remove" type="button" data-action="journal-line-remove" aria-label="حذف السطر">حذف</button>
    </div>
  `;
}
