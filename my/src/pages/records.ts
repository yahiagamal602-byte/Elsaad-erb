import { RECORD_STATUSES } from '../shared/modules.js';
import type { ModuleKey, RecordItem } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

export function renderRecordsPage(module: ModuleKey, label: string, records: RecordItem[]): string {
  const rows = records.map((record) => `
    <tr data-record-row data-search="${escapeHtml([record.title, record.reference, record.party, record.date, record.status, record.notes].join(' ').toLocaleLowerCase('ar'))}">
      <td><strong>${escapeHtml(record.title)}</strong><small>${record.reference ? `مرجع: ${escapeHtml(record.reference)}` : '—'}</small></td>
      <td>${escapeHtml(record.party || '—')}</td>
      <td>${escapeHtml(record.date || '—')}</td>
      <td>${escapeHtml(record.amount || '—')}</td>
      <td><span class="status-badge status-badge--${escapeHtml(record.status)}">${escapeHtml(RECORD_STATUSES.find((status) => status.value === record.status)?.label ?? record.status)}</span></td>
      <td class="row-actions">
        <button class="icon-button" type="button" data-action="edit" data-id="${record.id}" aria-label="تعديل ${escapeHtml(record.title)}">تعديل</button>
        <button class="icon-button icon-button--danger" type="button" data-action="delete" data-id="${record.id}" aria-label="حذف ${escapeHtml(record.title)}">حذف</button>
      </td>
    </tr>
  `).join('');
  const statusOptions = RECORD_STATUSES.map(({ value, label: statusLabel }) =>
    `<option value="${value}">${statusLabel}</option>`).join('');

  return `
    <section class="section-heading section-heading--page">
      <div><p class="eyebrow">إدارة السجلات</p><h2>${escapeHtml(label)}</h2><p class="muted">القيمة نصّ يدخله المستخدم؛ لا تُحسب منها أرصدة أو إجماليات.</p></div>
      <button class="button button--primary" type="button" data-action="add">إضافة سجل</button>
    </section>
    <section class="table-panel">
      <div class="table-toolbar">
        <label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="record-search" placeholder="بحث في السجلات" aria-label="بحث في السجلات"></label>
        <div class="toolbar-actions"><span class="muted">${records.length} سجل</span><button class="button button--secondary" type="button" data-action="export">تصدير CSV</button></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>الاسم / المرجع</th><th>الطرف</th><th>التاريخ</th><th>القيمة المدخلة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody>${rows || '<tr><td class="empty-state" colspan="6">لا توجد سجلات في هذا القسم بعد. أضف سجلًا لبدء العمل.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <div class="modal-backdrop" id="record-modal" hidden>
      <section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-modal-title">
        <div class="modal-heading"><div><p class="eyebrow">بيانات السجل</p><h2 id="record-modal-title">إضافة سجل</h2></div><button class="icon-button" type="button" data-action="close-modal" aria-label="إغلاق">إغلاق</button></div>
        <form id="record-form" data-form="record" class="record-form">
          <input name="id" type="hidden">
          <input name="module" type="hidden" value="${module}">
          <label class="field"><span>الاسم <b>*</b></span><input name="title" maxlength="180" required autocomplete="off"></label>
          <label class="field"><span>المرجع</span><input name="reference" maxlength="80" autocomplete="off"></label>
          <label class="field"><span>الطرف المرتبط</span><input name="party" maxlength="180" autocomplete="off"></label>
          <label class="field"><span>التاريخ</span><input name="date" type="date"></label>
          <label class="field"><span>القيمة (اختياري)</span><input name="amount" maxlength="40" inputmode="decimal" autocomplete="off" placeholder="تُحفظ كما أُدخلت دون حساب"></label>
          <label class="field"><span>الحالة</span><select name="status">${statusOptions}</select></label>
          <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="3"></textarea></label>
          <p class="form-error field--wide" id="record-error" role="alert" hidden></p>
          <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="close-modal">إلغاء</button><button class="button button--primary" type="submit">حفظ السجل</button></div>
        </form>
      </section>
    </div>
  `;
}
