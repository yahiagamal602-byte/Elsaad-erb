import type {
  InventoryDocumentLine,
  InventoryIssue,
  InventoryIssueInput,
  InventoryReceipt,
  InventoryReceiptInput,
  InventoryStockBalance,
  InventoryTransfer,
  InventoryTransferInput,
  InventoryView,
  InventoryItem,
  Warehouse,
  PurchaseInvoice,
  SalesDocument,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

type InventoryDocument = InventoryReceipt | InventoryIssue | InventoryTransfer;

const statusName = (status: InventoryDocument['status']): string =>
  status === 'approved' ? 'معتمد' : status === 'cancelled' ? 'ملغي' : 'مسودة';
const dateToday = (): string => new Date().toISOString().slice(0, 10);

function warehouseOptions(warehouses: Warehouse[], selected: number | null): string {
  return `<option value="">اختر المخزن</option>${warehouses.filter((entry) => entry.status === 'active').map((entry) =>
    `<option value="${entry.id}" ${selected === entry.id ? 'selected' : ''}>${escapeHtml(entry.code)} — ${escapeHtml(entry.name)}</option>`).join('')}`;
}

function itemOptions(items: InventoryItem[], selected: number | null): string {
  return `<option value="">اختر الصنف</option>${items.filter((entry) => entry.status === 'active' && entry.baseUnitStatus === 'active').map((entry) =>
    `<option value="${entry.id}" data-unit-id="${entry.baseUnitId}" data-unit-name="${escapeHtml(entry.baseUnitName)}" ${selected === entry.id ? 'selected' : ''}>${escapeHtml(entry.code)} — ${escapeHtml(entry.nameAr)}</option>`).join('')}`;
}

function movementLine(line: Partial<InventoryDocumentLine> & { itemId?: number; unitId?: number; quantity?: string; unitCost?: string }, items: InventoryItem[], balances: InventoryStockBalance[], warehouseId: number): string {
  const item = items.find((entry) => entry.id === line.itemId);
  const balance = balances.find((entry) => entry.itemId === line.itemId && entry.warehouseId === warehouseId);
  return `<tr data-inventory-doc-line>
    <td><select name="itemId" required>${itemOptions(items, line.itemId ?? null)}</select></td>
    <td class="doc-unit">${escapeHtml(item?.baseUnitName ?? line.unitName ?? '—')}</td>
    <td class="doc-available" dir="ltr">${escapeHtml(balance?.quantity ?? line.availableQuantity ?? '0')}</td>
    <td><input name="quantity" type="number" min="0.000001" step="any" required value="${escapeHtml(line.quantity ?? '')}"></td>
    <td><input name="unitCost" type="number" min="0" step="any" required value="${escapeHtml(line.unitCost ?? '')}"></td>
    <td class="doc-total" dir="ltr">${escapeHtml(line.totalCost ?? '0')}</td>
    <td><button class="icon-button icon-button--danger" type="button" data-action="inventory-doc-line-delete">حذف</button></td>
  </tr>`;
}

export function renderReceiptLines(receipt: InventoryReceipt | null, invoices: PurchaseInvoice[], receipts: InventoryReceipt[], invoiceId?: number): string {
  const invoice = invoices.find((entry) => entry.id === (receipt?.invoiceId ?? invoiceId));
  if (!invoice) return '<tr><td colspan="5" class="empty-state">اختر فاتورة لعرض بنودها المرتبطة بالأصناف.</td></tr>';
  return invoice.lines.filter((line) => line.itemId && line.unitId).map((line) => {
    const saved = receipt?.lines.find((entry) => entry.invoiceLineId === line.id);
    const receivedElsewhere = receipts.filter((entry) => entry.status !== 'cancelled' && entry.id !== receipt?.id)
      .flatMap((entry) => entry.lines).filter((entry) => entry.invoiceLineId === line.id)
      .reduce((sum, entry) => sum + Number(entry.quantity), 0);
    const previouslyReceived = Number(saved?.previouslyReceived ?? receivedElsewhere);
    const availableBeforeThisReceipt = Math.max(0, Number(line.quantity) - previouslyReceived);
    const currentQuantity = Number(saved?.quantity ?? 0);
    const remainingAfterThisReceipt = Math.max(0, availableBeforeThisReceipt - currentQuantity);
    return `<tr data-receipt-line data-invoice-line-id="${line.id}" data-available-before="${escapeHtml(String(availableBeforeThisReceipt))}"><td><strong>${escapeHtml(line.itemCode)}</strong><small>${escapeHtml(line.description)}</small></td>
      <td>${escapeHtml(line.unit)}</td><td dir="ltr">${escapeHtml(line.quantity)}</td><td data-receipt-remaining dir="ltr">${escapeHtml(String(remainingAfterThisReceipt))}</td>
      <td><input name="receiptQuantity" aria-label="الكمية المستلمة" type="number" min="0" max="${escapeHtml(String(availableBeforeThisReceipt))}" step="any" value="${escapeHtml(saved?.quantity ?? '')}"></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-state">الفاتورة لا تحتوي بنودًا مرتبطة بأصناف المخزون.</td></tr>';
}

function statusClass(status: InventoryDocument['status']): string {
  return status === 'approved' ? 'approved' : status === 'cancelled' ? 'cancelled' : 'draft';
}

export function renderInventoryDocumentsPage(
  view: InventoryView,
  documents: InventoryDocument[],
  balances: InventoryStockBalance[],
): string {
  const title = view === 'goods-receipts' ? 'إذن استلام بضاعة' : view === 'stock-issues' ? 'سند صرف مخزني' : 'التحويل بين المخازن';
  const tag = view === 'goods-receipts' ? 'receipt' : view === 'stock-issues' ? 'issue' : 'transfer';
  const rows = documents.map((doc) => {
    const details = doc.lines.map((line) => `${escapeHtml(line.itemCode ?? '')} × ${escapeHtml(line.quantity)}`).join('، ');
    const warehouse = 'warehouseName' in doc ? doc.warehouseName : `${doc.sourceWarehouseName} ← ${doc.destinationWarehouseName}`;
    const secondary = 'invoiceNumber' in doc ? `فاتورة ${escapeHtml(doc.invoiceNumber)} · ${escapeHtml(doc.supplierName)}` : ('reason' in doc ? escapeHtml(doc.reason) : '');
    return `<tr data-inventory-document-row data-search="${escapeHtml(`${doc.number} ${warehouse} ${secondary} ${details}`.toLocaleLowerCase('ar'))}">
      <td><strong>${escapeHtml(doc.number)}</strong><small>${escapeHtml(doc.date)}</small></td>
      <td>${escapeHtml(warehouse)}<small>${secondary}</small></td>
      <td>${details || '—'}</td><td dir="ltr">${'totalQuantity' in doc ? escapeHtml(doc.totalQuantity) : doc.lines.reduce((sum, line) => sum + Number(line.quantity), 0)}</td>
      <td><span class="sales-status sales-status--${statusClass(doc.status)}">${statusName(doc.status)}</span></td>
      <td class="sales-row-actions">
        ${doc.status === 'draft' ? `<button class="icon-button" data-action="inventory-document-edit" data-kind="${tag}" data-id="${doc.id}">تعديل</button>
        <button class="icon-button" data-action="inventory-document-approve" data-kind="${tag}" data-id="${doc.id}">اعتماد</button>
        <button class="icon-button icon-button--danger" data-action="inventory-document-delete" data-kind="${tag}" data-id="${doc.id}">حذف المسودة</button>` : ''}
        ${doc.status === 'approved' ? `<button class="icon-button icon-button--danger" data-action="inventory-document-cancel" data-kind="${tag}" data-id="${doc.id}">إلغاء بعكس موثق</button>` : ''}
        <button class="icon-button" data-action="inventory-document-print" data-kind="${tag}" data-id="${doc.id}">طباعة</button>
      </td></tr>`;
  }).join('');
  const blockedNote = view === 'goods-receipts'
    ? '<p class="inventory-inline-note">يتطلب اعتماد الاستلام فاتورة مشتريات معتمدة وحساب شراء مطابقًا لحساب المخزون؛ الاستلام يضيف الكمية ولا ينشئ قيدًا ماليًا.</p>'
    : view === 'stock-issues'
      ? '<p class="inventory-inline-note">الاعتماد يخصم الكمية بمتوسط تكلفة المخزن ويرحّل مصروف الصرف مقابل حساب المخزون.</p>' : '';
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المخزون · سجل الحركات</p><h2>${title}</h2>
    <p class="muted">الأرصدة المعروضة محسوبة من الحركات المعتمدة فقط؛ أذون الصرف تنشئ قيد تكلفة متوازنًا عند اعتمادها.</p></div>
    <button class="button button--primary" data-action="inventory-document-add" data-kind="${tag}">مستند جديد</button></section>
    ${blockedNote}<section class="table-panel"><div class="table-toolbar inventory-toolbar">
    <label class="search-field"><span>⌕</span><input id="inventory-document-search" type="search" placeholder="بحث برقم المستند أو المخزن أو الصنف"></label>
    <span class="muted">${documents.length} مستند</span><span class="muted">${balances.length} رصيد صنف/مخزن</span></div>
    <div class="table-scroll"><table class="inventory-table inventory-documents-table"><thead><tr><th>المستند / التاريخ</th><th>المخزن / المصدر</th><th>الأصناف والكميات</th><th>إجمالي الكمية</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد مستندات بعد. أنشئ مستندًا لبدء تسجيل الحركة.</td></tr>'}</tbody></table></div></section>
    <div id="inventory-document-modal-host"></div><div id="inventory-document-print-host" hidden></div>`;
}

export function renderInventoryDocumentForm(
  kind: 'receipt' | 'issue' | 'transfer',
  document: InventoryDocument | null,
  items: InventoryItem[],
  warehouses: Warehouse[],
  balances: InventoryStockBalance[],
  invoices: PurchaseInvoice[],
  receipts: InventoryReceipt[] = [],
  salesInvoices: SalesDocument[] = [],
): string {
  const editing = document?.status === 'draft';
  const title = kind === 'receipt' ? 'إذن استلام بضاعة' : kind === 'issue' ? 'سند صرف مخزني' : 'تحويل بين المخازن';
  if (kind === 'receipt') {
    const receipt = document as InventoryReceipt | null;
    const eligibleInvoices = invoices.filter((invoice) => invoice.status !== 'cancelled');
    return `<div class="modal-backdrop" id="inventory-document-modal"><section class="record-modal inventory-editor inventory-document-editor" role="dialog" aria-modal="true">
      <header class="modal-heading"><div><p class="eyebrow">المخزون · مسودة فقط</p><h2>${editing ? `تعديل ${escapeHtml(receipt?.number ?? '')}` : `إنشاء ${title}`}</h2></div><button class="icon-button" type="button" data-action="inventory-document-close">إغلاق</button></header>
      <form class="inventory-form inventory-document-form" data-form="inventory-receipt"><input type="hidden" name="id" value="${receipt?.id ?? ''}">
      <label class="field"><span>فاتورة المشتريات *</span><select name="invoiceId" required ${receipt ? 'disabled' : ''}><option value="">اختر فاتورة</option>${eligibleInvoices.map((invoice) => `<option value="${invoice.id}" ${receipt?.invoiceId === invoice.id ? 'selected' : ''}>${escapeHtml(invoice.number)} — ${escapeHtml(invoice.supplierName)} (${invoice.status === 'approved' ? 'معتمدة' : 'مسودة'})</option>`).join('')}</select></label>
      <label class="field"><span>المخزن *</span><select name="warehouseId" required>${warehouseOptions(warehouses, receipt?.warehouseId ?? null)}</select></label>
      <label class="field"><span>تاريخ الاستلام *</span><input name="date" type="date" required value="${escapeHtml(receipt?.date ?? dateToday())}"></label>
      <div class="field--wide table-scroll"><table class="inventory-table"><thead><tr><th>الصنف</th><th>الوحدة</th><th>كمية الفاتورة</th><th>المتبقي بعد هذا الإذن</th><th>الكمية في هذا الإذن</th></tr></thead><tbody id="receipt-lines">${renderReceiptLines(receipt, eligibleInvoices, receipts, receipt?.invoiceId)}</tbody></table></div>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2">${escapeHtml(receipt?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="inventory-document-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="inventory-document-close">إلغاء</button><button class="button button--primary" type="submit">حفظ كمسودة</button></div></form></section></div>`;
  }

  const movement = document as InventoryIssue | InventoryTransfer | null;
  const issue = kind === 'issue' ? movement as InventoryIssue | null : null;
  const transfer = kind === 'transfer' ? movement as InventoryTransfer | null : null;
  const sourceId = issue?.warehouseId ?? transfer?.sourceWarehouseId ?? null;
  const lines = movement?.lines.length ? movement.lines.map((line) => movementLine(line, items, balances, sourceId ?? 0)).join('') : movementLine({}, items, balances, sourceId ?? 0);
  return `<div class="modal-backdrop" id="inventory-document-modal"><section class="record-modal inventory-editor inventory-document-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">المخزون · ${editing ? 'مسودة' : 'مستند جديد'}</p><h2>${editing ? `تعديل ${escapeHtml(movement?.number ?? '')}` : `إنشاء ${title}`}</h2></div><button class="icon-button" type="button" data-action="inventory-document-close">إغلاق</button></header>
    <form class="inventory-form inventory-document-form" data-form="${kind === 'issue' ? 'inventory-issue' : 'inventory-transfer'}"><input type="hidden" name="id" value="${movement?.id ?? ''}">
    ${kind === 'issue' ? `<label class="field"><span>المخزن *</span><select name="warehouseId" required>${warehouseOptions(warehouses, sourceId)}</select></label>
      <label class="field"><span>سبب الصرف / الجهة المستفيدة *</span><input name="reason" maxlength="240" required value="${escapeHtml(issue?.reason ?? '')}"></label>
      <label class="field"><span>فاتورة بيع مرتبطة (اختياري لصرف البيع)</span><select name="salesInvoiceId"><option value="">صرف داخلي / مشروع</option>${salesInvoices.filter((invoice) => invoice.type === 'invoice' && invoice.status === 'approved')
        .map((invoice) => `<option value="${invoice.id}" ${issue?.salesInvoiceId === invoice.id ? 'selected' : ''}>${escapeHtml(invoice.number)} — ${escapeHtml(invoice.clientName)}</option>`).join('')}</select></label>` :
      `<label class="field"><span>مخزن المصدر *</span><select name="sourceWarehouseId" required>${warehouseOptions(warehouses, sourceId)}</select></label>
      <label class="field"><span>مخزن الاستلام *</span><select name="destinationWarehouseId" required>${warehouseOptions(warehouses, transfer?.destinationWarehouseId ?? null)}</select></label>`}
    <label class="field"><span>التاريخ *</span><input name="date" type="date" required value="${escapeHtml(movement?.date ?? dateToday())}"></label>
    <label class="field"><span>ملاحظات</span><input name="notes" maxlength="2000" value="${escapeHtml(movement?.notes ?? '')}"></label>
    <div class="field--wide table-scroll"><table class="inventory-table"><thead><tr><th>الصنف</th><th>الوحدة</th><th>الرصيد المتاح</th><th>الكمية</th><th>تكلفة الوحدة اليدوية</th><th>القيمة</th><th></th></tr></thead><tbody id="inventory-doc-lines">${lines}</tbody></table>
      <button class="button button--secondary" type="button" data-action="inventory-doc-line-add">إضافة صنف</button></div>
    <div class="inventory-document-totals field--wide"><span>إجمالي الكميات <strong id="inventory-doc-total-quantity">0</strong></span><span>إجمالي التكلفة اليدوية <strong id="inventory-doc-total-cost" dir="ltr">0</strong></span></div>
    <p class="inventory-inline-note field--wide">تُحتسب التكلفة بمتوسط تكلفة المخزن عند الاعتماد. الصرف المرتبط بفاتورة البيع يستخدم حساب تكلفة البضاعة المباعة؛ الصرف الآخر يستخدم حساب المصروف.</p>
    <p class="form-error field--wide" id="inventory-document-error" hidden role="alert"></p>
    <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="inventory-document-close">إلغاء</button><button class="button button--primary" type="submit">حفظ كمسودة</button></div></form></section></div>`;
}

export function getInventoryMovementInput(form: HTMLFormElement): InventoryIssueInput | InventoryTransferInput {
  const data = new FormData(form);
  const lines = [...form.querySelectorAll<HTMLTableRowElement>('[data-inventory-doc-line]')].map((row) => {
    const itemSelect = row.querySelector<HTMLSelectElement>('[name="itemId"]');
    const item = itemSelect?.selectedOptions[0];
    return {
      itemId: Number(itemSelect?.value),
      unitId: Number(item?.dataset.unitId),
      quantity: row.querySelector<HTMLInputElement>('[name="quantity"]')?.value.trim() ?? '',
      unitCost: row.querySelector<HTMLInputElement>('[name="unitCost"]')?.value.trim() ?? '',
    };
  });
  const id = String(data.get('id') ?? '');
  const common = {
    date: String(data.get('date') ?? ''),
    notes: String(data.get('notes') ?? ''),
    lines,
    ...(id ? { id: Number(id) } : {}),
  };
  if (form.dataset.form === 'inventory-issue') return {
    ...common, warehouseId: Number(data.get('warehouseId')), reason: String(data.get('reason') ?? ''),
    salesInvoiceId: data.get('salesInvoiceId') ? Number(data.get('salesInvoiceId')) : null,
  };
  return {
    ...common, sourceWarehouseId: Number(data.get('sourceWarehouseId')),
    destinationWarehouseId: Number(data.get('destinationWarehouseId')),
  };
}

export function getInventoryReceiptInput(form: HTMLFormElement): InventoryReceiptInput {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '');
  return {
    invoiceId: Number(data.get('invoiceId') ?? form.querySelector<HTMLSelectElement>('[name="invoiceId"]')?.value),
    warehouseId: Number(data.get('warehouseId')),
    date: String(data.get('date') ?? ''), notes: String(data.get('notes') ?? ''),
    lines: [...form.querySelectorAll<HTMLTableRowElement>('[data-receipt-line]')].map((row) => ({
      invoiceLineId: Number(row.dataset.invoiceLineId),
      quantity: row.querySelector<HTMLInputElement>('[name="receiptQuantity"]')?.value.trim() ?? '',
    })).filter((line) => Number(line.quantity) > 0),
    ...(id ? { id: Number(id) } : {}),
  };
}

export function documentLinesForPrint(document: InventoryDocument): string {
  return `<article class="print-inventory-document" dir="rtl"><h1>Elsaad ERP · مستند مخزني</h1><h2>${escapeHtml(document.number)}</h2>
    <p>التاريخ: ${escapeHtml(document.date)} · الحالة: ${statusName(document.status)}</p><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>التكلفة</th></tr></thead><tbody>
    ${document.lines.map((line) => `<tr><td>${escapeHtml(line.itemCode ?? '')} — ${escapeHtml(('itemName' in line ? line.itemName : line.description) ?? '')}</td><td>${escapeHtml('unitName' in line ? line.unitName : line.unit)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml('unitCost' in line ? line.unitCost : '')}</td></tr>`).join('')}
    </tbody></table></article>`;
}
