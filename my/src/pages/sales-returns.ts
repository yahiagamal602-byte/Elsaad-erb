import type { SalesDocument, SalesReturn } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function number(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(parsed) : value;
}

function status(status: SalesReturn['status']): string {
  return { draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغي' }[status];
}

export function renderSalesReturnsPage(invoices: SalesDocument[], returns: SalesReturn[]): string {
  const eligible = invoices.filter((invoice) => invoice.status === 'approved');
  const rows = returns.map((item) => `
    <tr data-return-row data-search="${escapeHtml([item.number, item.invoiceNumber, item.customerName, item.date, item.reason].join(' ').toLocaleLowerCase('ar'))}">
      <td><strong>${escapeHtml(item.number)}</strong><small>فاتورة: ${escapeHtml(item.invoiceNumber)}</small></td>
      <td>${escapeHtml(item.customerName)}</td><td>${escapeHtml(item.date)}</td>
      <td dir="ltr" class="sales-amount">${number(item.total)}</td>
      <td><span class="sales-status sales-status--${item.status}">${status(item.status)}</span></td>
      <td class="sales-row-actions">
        <button class="icon-button" type="button" data-action="sales-return-edit" data-id="${item.id}">${item.status === 'draft' ? 'تعديل' : 'عرض'}</button>
        ${item.status === 'draft' ? `<button class="icon-button" type="button" data-action="sales-return-approve" data-id="${item.id}">اعتماد وترحيل</button>` : ''}
        ${item.status === 'draft' ? '<button class="icon-button icon-button--danger" type="button" data-action="sales-return-delete" data-id="' + item.id + '">حذف</button>' : ''}
        ${item.status === 'approved' ? `<button class="icon-button icon-button--danger" type="button" data-action="sales-return-cancel" data-id="${item.id}">إلغاء بعكس القيد</button>` : ''}
        <button class="icon-button" type="button" data-action="sales-return-print" data-id="${item.id}">طباعة</button>
      </td>
    </tr>
  `).join('');
  return `
    <section class="section-heading section-heading--page"><div><p class="eyebrow">المبيعات · المرتجعات</p><h2>مرتجعات المبيعات</h2><p class="muted">المسودات مرتبطة بفواتير معتمدة وببنودها الأصلية مباشرة.</p></div>
      <button class="button button--primary" type="button" data-action="sales-return-add" ${eligible.length ? '' : 'disabled title="لا توجد فواتير معتمدة صالحة للربط"'}>إنشاء مرتجع</button>
    </section>
    <div class="notice-panel notice-panel--warning sales-flow-note"><span class="notice-panel__mark" aria-hidden="true">!</span><div>
      <strong>اعتماد المرتجع يعكس الإيراد ويخفض ذمة العميل</strong>
      <p>لا يُنشأ رد نقدي تلقائي، ولا يعاد المخزون من هذه الشاشة لعدم ربط المرتجع بإذن الصرف الأصلي. فواتير النظام لا تحفظ خصمًا أو ضريبة أو طريقة دفع.</p>
    </div></div>
    <section class="table-panel"><div class="table-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="sales-return-search" placeholder="بحث برقم المرتجع أو الفاتورة أو العميل" aria-label="بحث مرتجعات المبيعات"></label><div class="toolbar-actions"><span class="muted">${returns.length} مرتجع</span></div></div>
      <div class="table-scroll"><table class="sales-documents-table"><thead><tr><th>المرتجع / الفاتورة</th><th>العميل</th><th>التاريخ</th><th>القيمة الأساسية</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد مرتجعات مسجلة.</td></tr>'}</tbody></table></div>
    </section>
    <div id="sales-return-editor-host"></div><div id="sales-return-print-host"></div>
  `;
}

export function renderSalesReturnEditor(
  invoices: SalesDocument[],
  returns: SalesReturn[],
  invoiceId: number | null,
  current: SalesReturn | null,
): string {
  const invoice = invoices.find((item) => item.id === invoiceId && item.status === 'approved') ?? null;
  const readOnly = current !== null && current.status !== 'draft';
  const availableInvoices = invoices.filter((item) => item.status === 'approved');
  const invoiceOptions = availableInvoices.map((item) =>
    `<option value="${item.id}" ${item.id === invoiceId ? 'selected' : ''}>${escapeHtml(item.number)} — ${escapeHtml(item.clientName)} — ${escapeHtml(item.date)}</option>`).join('');
  const lines = invoice?.lines.map((line) => {
    const ownLine = current?.lines.find((item) => item.invoiceLineId === line.id);
    const reservedElsewhere = returns
      .filter((item) => item.invoiceId === invoice.id && item.status !== 'cancelled' && item.id !== current?.id)
      .reduce((sum, item) => sum + Number(item.lines.find((entry) => entry.invoiceLineId === line.id)?.quantity ?? 0), 0);
    const remaining = Math.max(0, Number(line.quantity) - reservedElsewhere);
    return `<tr data-return-line data-invoice-line-id="${line.id}">
      <td><strong>${escapeHtml(line.description)}</strong></td><td>${escapeHtml(line.unit || '—')}</td>
      <td>${number(line.quantity)}</td><td>${number(String(reservedElsewhere))}</td><td>${number(String(remaining))}</td>
      <td><input name="returnQuantity" value="${escapeHtml(ownLine?.quantity ?? '0')}" type="number" min="0" max="${escapeHtml(String(remaining))}" step="any" ${readOnly ? 'disabled' : ''} aria-label="كمية مرتجعة ${escapeHtml(line.description)}"></td>
      <td dir="ltr" class="return-line-amount">${number(ownLine ? String(Number(ownLine.quantity) * Number(line.unitPrice)) : '0')}</td>
    </tr>`;
  }).join('') ?? '';
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `
    <div class="modal-backdrop sales-master-backdrop" id="sales-return-modal">
      <section class="record-modal sales-return-modal" role="dialog" aria-modal="true" aria-labelledby="sales-return-title">
        <div class="modal-heading"><div><p class="eyebrow">مرتجعات المبيعات</p><h2 id="sales-return-title">${current ? (readOnly ? 'عرض المرتجع' : 'تعديل المرتجع') : 'إنشاء مسودة مرتجع'}</h2></div><button class="icon-button" type="button" data-action="sales-return-close">إغلاق</button></div>
        <form data-form="sales-return" class="sales-document-form">
          <input type="hidden" name="id" value="${current?.id ?? ''}">
          ${current ? `<input type="hidden" name="invoiceId" value="${current.invoiceId}">` : ''}
          <label class="field"><span>الفاتورة الأصلية المعتمدة <b>*</b></span><select name="invoiceId" required ${current ? 'disabled' : ''}><option value="">اختر فاتورة معتمدة</option>${invoiceOptions}</select></label>
          ${invoice ? `<div class="sales-source-ref">الفاتورة <strong>${escapeHtml(invoice.number)}</strong> · العميل ${escapeHtml(invoice.clientName)} · ${escapeHtml(invoice.date)}</div>` : ''}
          <div class="sales-document-fields">
            <label class="field"><span>تاريخ المرتجع <b>*</b></span><input name="date" type="date" value="${escapeHtml(current?.date ?? date)}" required ${readOnly ? 'disabled' : ''}></label>
            <label class="field"><span>سبب المرتجع <b>*</b></span><input name="reason" maxlength="240" value="${escapeHtml(current?.reason ?? '')}" required ${readOnly ? 'disabled' : ''}></label>
            <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2" ${readOnly ? 'disabled' : ''}>${escapeHtml(current?.notes ?? '')}</textarea></label>
          </div>
          <div class="table-scroll sales-lines-scroll"><table class="sales-lines-table sales-return-lines-table">
            <thead><tr><th>الصنف الأصلي</th><th>الوحدة</th><th>المباع</th><th>محجوز بمسودات/مرتجعات سابقة</th><th>المتبقي</th><th>كمية المرتجع</th><th>القيمة الأساسية</th></tr></thead>
            <tbody>${lines || `<tr><td colspan="7" class="empty-state">${invoice ? 'لا توجد بنود في الفاتورة المحددة.' : 'اختر فاتورة لعرض بنودها الأصلية.'}</td></tr>`}</tbody>
          </table></div>
          <div class="sales-totals"><span>القيمة الأساسية — دون خصم أو ضريبة</span><strong id="sales-return-total" dir="ltr">${number(current?.total ?? '0')}</strong></div>
          <p class="sales-dependency">الاعتماد يرحّل تخفيض ذمم العميل وعكس الإيراد. لا يُنشأ رد نقدي أو حركة مخزون تلقائية؛ يسجل رد النقد بسند مستقل، وإعادة المخزون تحتاج ربطًا بإذن الصرف.</p>
          <p class="form-error" id="sales-return-error" role="alert" hidden></p>
          <div class="form-actions"><button class="button button--secondary" type="button" data-action="sales-return-close">إغلاق</button>
            ${readOnly ? '' : '<button class="button button--primary" type="submit">حفظ المسودة</button>'}
            ${current?.status === 'draft' ? `<button class="button button--secondary" type="button" data-action="sales-return-approve" data-id="${current.id}">اعتماد وترحيل</button>` : ''}
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderSalesReturnPrint(salesReturn: SalesReturn): string {
  const rows = salesReturn.lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.unit || '—')}</td><td>${number(line.quantity)}</td><td>${number(line.unitPrice)}</td><td>${number(line.amount)}</td></tr>`).join('');
  return `<article class="sales-print-sheet" dir="rtl"><header><div class="brand__name">Elsaad <b>ERP</b></div><strong>مرتجع مبيعات — مسودة</strong></header>
    <h1>${escapeHtml(salesReturn.number)}</h1><dl><div><dt>الفاتورة</dt><dd>${escapeHtml(salesReturn.invoiceNumber)}</dd></div>
      <div><dt>العميل</dt><dd>${escapeHtml(salesReturn.customerName)}</dd></div><div><dt>التاريخ</dt><dd>${escapeHtml(salesReturn.date)}</dd></div>
      <div><dt>السبب</dt><dd>${escapeHtml(salesReturn.reason)}</dd></div></dl>
    <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>القيمة الأساسية</th></tr></thead><tbody>${rows}</tbody></table>
    <footer><span>القيمة الأساسية — دون خصم أو ضريبة</span><strong>${number(salesReturn.total)}</strong></footer>
    <p>مسودة غير معتمدة — لا يوجد أثر مخزني أو مالي.</p></article>`;
}
