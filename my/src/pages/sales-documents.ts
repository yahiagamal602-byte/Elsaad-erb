import type { Customer, InventoryItem, SalesDocument, SalesDocumentLine, SalesDocumentType } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

export const SALES_DOCUMENT_LABELS: Record<SalesDocumentType, string> = {
  estimate: 'مقايسة العميل',
  'work-order': 'أوامر التشغيل',
  certificate: 'مستخلص العميل',
  invoice: 'الفواتير',
};

const NEXT_DOCUMENT: Partial<Record<SalesDocumentType, SalesDocumentType>> = {
  estimate: 'work-order',
  'work-order': 'certificate',
  certificate: 'invoice',
};

function statusLabel(status: SalesDocument['status']): string {
  return { draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغي' }[status];
}

function formatAmount(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(parsed)
    : value;
}

function localDateString(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function lineMarkup(
  type: SalesDocumentType,
  line: Partial<SalesDocumentLine>,
  index: number,
  readonly: boolean,
  lockTerms: boolean,
  editableLines: boolean,
  items: InventoryItem[],
): string {
  const certificate = type === 'certificate';
  const quantity = line.quantity ?? '';
  const currentQuantity = line.currentQuantity ?? '0';
  const amount = line.amount ?? '0';
  const disabled = readonly ? 'disabled' : '';
  const termsDisabled = lockTerms ? 'disabled' : '';
  return `
    <tr data-sales-line data-prior-quantity="${escapeHtml(line.previousQuantity ?? '0')}">
      <td class="sales-line__description">
        <input type="hidden" name="sourceDocumentLineId" value="${line.sourceDocumentLineId ?? ''}">
        <input type="hidden" name="sourceWorkOrderLineId" value="${line.sourceWorkOrderLineId ?? ''}">
        <select name="masterItemId" aria-label="الصنف المرتبط ${index + 1}" ${termsDisabled} ${type === 'invoice' ? 'required' : ''}>
          <option value="">اختر صنف المخزون</option>
          ${items.filter((item) => item.status === 'active' && item.sellable)
    .map((item) => `<option value="${item.id}" data-item-name="${escapeHtml(item.nameAr)}" data-unit-name="${escapeHtml(item.baseUnitName)}" ${line.masterItemId === item.id ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.nameAr)}</option>`).join('')}
        </select>
        ${certificate ? '' : '<input type="hidden" name="currentQuantity" value="0">'}
        <input name="description" value="${escapeHtml(line.description ?? '')}" maxlength="240" required ${termsDisabled} aria-label="وصف البند ${index + 1}" placeholder="أدخل وصف البند">
      </td>
      <td><input name="unit" value="${escapeHtml(line.unit ?? '')}" maxlength="40" ${termsDisabled} aria-label="الوحدة ${index + 1}" placeholder="—"></td>
      <td><input name="quantity" value="${escapeHtml(quantity)}" inputmode="decimal" required ${termsDisabled} aria-label="الكمية المتعاقد عليها ${index + 1}"></td>
      ${certificate ? `
        <td><input name="currentQuantity" value="${escapeHtml(currentQuantity)}" inputmode="decimal" required ${disabled} aria-label="الكمية الحالية ${index + 1}"></td>
        <td class="sales-line__cumulative">${escapeHtml(line.cumulativeQuantity ?? '0')}</td>
        <td class="sales-line__percent">${escapeHtml(line.completionPercent ?? '0')}%</td>
      ` : ''}
      <td><input name="unitPrice" value="${escapeHtml(line.unitPrice ?? '')}" inputmode="decimal" required ${termsDisabled} aria-label="سعر الوحدة ${index + 1}"></td>
      <td class="sales-line__amount" dir="ltr">${formatAmount(amount)}</td>
      ${editableLines ? `<td><button class="icon-button icon-button--danger" type="button" data-action="sales-line-remove" aria-label="حذف البند ${index + 1}">حذف</button></td>` : ''}
    </tr>
  `;
}

function tableHead(type: SalesDocumentType, editableLines: boolean): string {
  return `
    <thead><tr>
      <th>الصنف / الوصف</th><th>الوحدة</th><th>الكمية المتعاقد عليها</th>
      ${type === 'certificate' ? '<th>الكمية الحالية</th><th>التراكمي</th><th>نسبة الإنجاز</th>' : ''}
      <th>سعر الوحدة</th><th>الإجمالي</th>${editableLines ? '<th>إجراء</th>' : ''}
    </tr></thead>
  `;
}

function editor(type: SalesDocumentType, document: SalesDocument | null, customers: Customer[], items: InventoryItem[]): string {
  const readonly = document !== null && document.status !== 'draft';
  const lockTerms = readonly || (document?.sourceDocumentId !== null && document?.sourceDocumentId !== undefined);
  const lockClient = readonly || document?.sourceDocumentId !== null && document?.sourceDocumentId !== undefined;
  const editableLines = !readonly && type === 'estimate';
  const title = document ? `${readonly ? 'عرض' : 'تعديل'} ${SALES_DOCUMENT_LABELS[type]}` : `إنشاء ${SALES_DOCUMENT_LABELS[type]}`;
  const today = localDateString();
  const lines = document?.lines ?? [{
    sourceDocumentLineId: null,
    sourceWorkOrderLineId: null,
    masterItemId: null,
    description: '',
    unit: '',
    quantity: '',
    currentQuantity: '0',
    unitPrice: '',
    amount: '0',
    previousQuantity: '0',
    cumulativeQuantity: '0',
    completionPercent: '0',
  } as SalesDocumentLine];
  const lineRows = lines.map((line, index) => lineMarkup(type, line, index, readonly, lockTerms, editableLines, items)).join('');
  const customerOptions = customers
    .filter((customer) => customer.status === 'active' || customer.id === document?.masterClientId)
    .map((customer) => `<option value="${customer.id}" data-customer-name="${escapeHtml(customer.name)}" ${document?.masterClientId === customer.id ? 'selected' : ''}>${escapeHtml(customer.code)} — ${escapeHtml(customer.name)}</option>`)
    .join('');
  const unlinkedCustomer = document && document.masterClientId === null
    ? `<option value="" data-customer-name="${escapeHtml(document.clientName)}" selected>${escapeHtml(document.clientName)} — عميل محفوظ بالاسم فقط</option>`
    : '<option value="">اختر عميلًا مسجلًا</option>';
  return `
    <div class="modal-backdrop" id="sales-document-modal">
      <section class="record-modal sales-editor" role="dialog" aria-modal="true" aria-labelledby="sales-editor-title">
        <div class="modal-heading">
          <div><p class="eyebrow">${escapeHtml(SALES_DOCUMENT_LABELS[type])}</p><h2 id="sales-editor-title">${escapeHtml(title)}</h2></div>
          <button class="icon-button" type="button" data-action="sales-close" aria-label="إغلاق">إغلاق</button>
        </div>
        <form data-form="sales-document" class="sales-document-form">
          <input type="hidden" name="id" value="${document?.id ?? ''}">
          <input type="hidden" name="type" value="${type}">
          <input type="hidden" name="sourceDocumentId" value="${document?.sourceDocumentId ?? ''}">
          <input type="hidden" name="clientName" value="${escapeHtml(document?.clientName ?? '')}">
          ${document?.sourceNumber ? `<div class="sales-source-ref">المستند السابق: <strong>${escapeHtml(document.sourceNumber)}</strong></div>` : ''}
          <div class="sales-document-fields">
            <label class="field"><span>العميل <b>*</b></span><select name="masterClientId" ${!document && type === 'estimate' ? 'required' : ''} ${lockClient ? 'disabled' : ''} data-master-link="customer">${unlinkedCustomer}${customerOptions}</select></label>
            <label class="field"><span>التاريخ <b>*</b></span><input name="date" type="date" value="${escapeHtml(document?.date ?? today)}" required ${readonly ? 'disabled' : ''}></label>
            <label class="field"><span>المرجع</span><input name="reference" value="${escapeHtml(document?.reference ?? '')}" maxlength="100" ${readonly ? 'disabled' : ''}></label>
            <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2" ${readonly ? 'disabled' : ''}>${escapeHtml(document?.notes ?? '')}</textarea></label>
          </div>
          <div class="notice-panel notice-panel--warning sales-master-note">
            <span class="notice-panel__mark" aria-hidden="true">!</span>
            <div><strong>حسابات البيع تتبع دليل العملاء والأصناف</strong><p>اعتماد الفاتورة يتطلب عميلًا بحساب ذمم وصنفًا نشطًا بحساب مبيعات صحيح. لا تُخصم الكمية إلا بإذن صرف مستقل مرتبط بالفاتورة.</p></div>
          </div>
          <div class="sales-lines-heading">
            <div><h3>بنود المستند</h3><span>${type === 'certificate' ? 'أدخل الكمية الحالية؛ التراكمي يجمع المستخلصات السابقة المعتمدة مع الكمية الحالية.' : 'تُنقل البنود تلقائيًا عند إنشاء المستند التالي من مصدر معتمد.'}</span></div>
            ${editableLines ? '<button class="button button--secondary" type="button" data-action="sales-line-add">إضافة بند</button>' : ''}
          </div>
          <div class="table-scroll sales-lines-scroll"><table class="sales-lines-table">${tableHead(type, editableLines)}<tbody id="sales-lines">${lineRows}</tbody></table></div>
          <div class="sales-totals"><span>الإجمالي</span><strong id="sales-total" dir="ltr">${formatAmount(document?.total ?? '0')}</strong></div>
          ${type === 'invoice' ? '<p class="sales-dependency">اعتماد الفاتورة يرحّل ذمم العميل والإيراد فقط؛ حركة المخزون تحتاج إذن صرف مستقلًا.</p>' : ''}
          ${type === 'work-order' && document?.status === 'approved' ? '<p class="sales-dependency">حالة المخزون: بانتظار تنفيذ وربط وحدة المخزون. لم تُخصم أي كميات.</p>' : ''}
          <p class="form-error sales-form-error" id="sales-document-error" role="alert" hidden></p>
          <div class="form-actions">
            <button class="button button--secondary" type="button" data-action="sales-close">إغلاق</button>
            ${readonly ? '' : '<button class="button button--primary" type="submit">حفظ المسودة</button>'}
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderSalesPage(type: SalesDocumentType, documents: SalesDocument[]): string {
  const nextType = NEXT_DOCUMENT[type];
  const rows = documents.map((document) => `
    <tr data-sales-document data-search="${escapeHtml([document.number, document.clientName, document.reference, document.date, statusLabel(document.status), document.sourceNumber].join(' ').toLocaleLowerCase('ar'))}">
      <td><strong>${escapeHtml(document.number)}</strong><small>${document.sourceNumber ? `المصدر: ${escapeHtml(document.sourceNumber)}` : '—'}</small></td>
      <td>${escapeHtml(document.clientName)}</td>
      <td>${escapeHtml(document.date)}</td>
      <td class="sales-amount" dir="ltr">${formatAmount(document.total)}</td>
      <td><span class="sales-status sales-status--${document.status}">${statusLabel(document.status)}</span></td>
      <td class="sales-row-actions">
        <button class="icon-button" type="button" data-action="sales-edit" data-id="${document.id}">${document.status === 'draft' ? 'تعديل' : 'عرض'}</button>
        ${document.status === 'draft' ? `<button class="icon-button sales-action--approve" type="button" data-action="sales-approve" data-id="${document.id}">اعتماد</button><button class="icon-button icon-button--danger" type="button" data-action="sales-delete" data-id="${document.id}">حذف</button>` : ''}
        ${document.status === 'approved' ? `<button class="icon-button icon-button--danger" type="button" data-action="sales-cancel" data-id="${document.id}">إلغاء</button>` : ''}
        ${document.status === 'approved' && nextType ? `<button class="icon-button" type="button" data-action="sales-derive" data-id="${document.id}" data-target-type="${nextType}">إنشاء ${escapeHtml(SALES_DOCUMENT_LABELS[nextType])}</button>` : ''}
        <button class="icon-button" type="button" data-action="sales-print" data-id="${document.id}">طباعة</button>
      </td>
    </tr>
  `).join('');
  const dependency = type === 'invoice'
    ? 'اعتماد الفاتورة يرحّل ذمم العميل والإيراد. المخزون لا يتحرك قبل اعتماد إذن صرف مرتبط.'
    : type === 'work-order'
      ? 'اعتماد أمر التشغيل يسجل طلب ربط للمخزون؛ لا يُخصم رصيد قبل تنفيذ مصدر المخزون.'
      : type === 'certificate'
        ? 'تُحسب الكمية التراكمية من المستخلصات المعتمدة المرتبطة ببند أمر التشغيل نفسه.'
        : 'اعتماد المقايسة يتيح إنشاء أمر تشغيل مرتبط مع نقل البنود.';
  return `
    <section class="section-heading section-heading--page">
      <div><p class="eyebrow">المبيعات · دورة المستندات</p><h2>${escapeHtml(SALES_DOCUMENT_LABELS[type])}</h2><p class="muted">إنشاء وحفظ واعتماد وربط مستندات المبيعات دون ترحيل مالي تلقائي.</p></div>
      ${type === 'estimate' ? `<button class="button button--primary" type="button" data-action="sales-add">إنشاء ${escapeHtml(SALES_DOCUMENT_LABELS[type])}</button>` : ''}
    </section>
    <div class="notice-panel sales-flow-note"><span class="notice-panel__mark" aria-hidden="true">i</span><div><strong>${escapeHtml(dependency)}</strong><p>المستندات مرتبة ضمن مقايسة ← أمر تشغيل ← مستخلص ← فاتورة؛ تُسجل القيود باستخدام حسابات العميل والصنف المرتبطة فعليًا.</p></div></div>
    <section class="table-panel sales-documents-panel">
      <div class="table-toolbar">
        <label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="sales-search" placeholder="بحث برقم المستند أو العميل أو المرجع" aria-label="بحث في مستندات المبيعات"></label>
        <div class="toolbar-actions"><span class="muted">${documents.length} مستند</span></div>
      </div>
      <div class="table-scroll"><table class="sales-documents-table">
        <thead><tr><th>رقم / المصدر</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td class="empty-state" colspan="6">لا توجد مستندات في هذه الصفحة بعد.</td></tr>'}</tbody>
      </table></div>
    </section>
    <div id="sales-editor-host"></div>
    <div id="sales-print-host"></div>
  `;
}

export function renderSalesEditor(type: SalesDocumentType, document: SalesDocument | null, customers: Customer[], items: InventoryItem[]): string {
  return editor(type, document, customers, items);
}

export function renderSalesLine(type: SalesDocumentType, index: number, items: InventoryItem[]): string {
  return lineMarkup(type, {
    sourceDocumentLineId: null,
    sourceWorkOrderLineId: null,
    masterItemId: null,
    description: '',
    unit: '',
    quantity: '',
    currentQuantity: '0',
    unitPrice: '',
    amount: '0',
    previousQuantity: '0',
    cumulativeQuantity: '0',
    completionPercent: '0',
  }, index, false, false, true, items);
}

export function renderSalesPrint(document: SalesDocument): string {
  const rows = document.lines.map((line, index) => `
    <tr><td>${index + 1}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.unit || '—')}</td>
      <td>${escapeHtml(document.type === 'certificate' ? line.currentQuantity : line.quantity)}</td>
      <td>${formatAmount(line.unitPrice)}</td><td>${formatAmount(line.amount)}</td></tr>
  `).join('');
  return `
    <article class="sales-print-sheet" dir="rtl">
      <header><div class="brand__name">Elsaad <b>ERP</b></div><strong>${escapeHtml(SALES_DOCUMENT_LABELS[document.type])}</strong></header>
      <h1>${escapeHtml(document.number)}</h1>
      <dl><div><dt>العميل</dt><dd>${escapeHtml(document.clientName)}</dd></div>
        <div><dt>التاريخ</dt><dd>${escapeHtml(document.date)}</dd></div>
        <div><dt>المرجع</dt><dd>${escapeHtml(document.reference || '—')}</dd></div>
        <div><dt>المصدر</dt><dd>${escapeHtml(document.sourceNumber || '—')}</dd></div>
        <div><dt>الحالة</dt><dd>${statusLabel(document.status)}</dd></div></dl>
      <table><thead><tr><th>#</th><th>الصنف / الوصف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
      <footer><span>الإجمالي</span><strong>${formatAmount(document.total)}</strong></footer>
      ${document.type === 'invoice' ? '<p>تُرحّل ذمم العميل والإيراد عند الاعتماد؛ المخزون يتحرك فقط بإذن صرف مستقل معتمد.</p>' : ''}
    </article>
  `;
}
