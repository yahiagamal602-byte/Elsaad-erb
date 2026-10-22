import type {
  AccountItem,
  InventoryItem,
  InventoryStatus,
  InventoryUnit,
  Warehouse,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function statusLabel(status: InventoryStatus): string {
  return status === 'active' ? 'نشط' : 'غير نشط';
}

function accountOptions(accounts: AccountItem[], selectedId: number | null, allowed: readonly AccountItem['type'][]): string {
  const options = accounts.filter((account) => allowed.includes(account.type)).map((account) =>
    `<option value="${account.id}" ${selectedId === account.id ? 'selected' : ''}>${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  return `<option value="">دون ربط</option>${options}`;
}

function itemRow(item: InventoryItem): string {
  const opening = item.openingBalances.length
    ? item.openingBalances.map((balance) => `${escapeHtml(balance.quantity)} ${escapeHtml(item.baseUnitName)} · ${escapeHtml(balance.warehouseName)}`).join('<br>')
    : '—';
  return `<tr data-inventory-item-row data-sort-code="${escapeHtml(item.code)}" data-sort-name="${escapeHtml(item.nameAr)}" data-search="${escapeHtml([item.code, item.nameAr, item.nameEn, item.barcode, item.baseUnitName].join(' ').toLocaleLowerCase('ar'))}" data-status="${item.status}">
    <td><strong>${escapeHtml(item.code)}</strong><small>${escapeHtml(item.barcode || 'دون باركود')}</small></td>
    <td><strong>${escapeHtml(item.nameAr)}</strong><small>${escapeHtml(item.nameEn || '')}</small></td>
    <td>${escapeHtml(item.baseUnitName)}${item.baseUnitCode ? `<small>${escapeHtml(item.baseUnitCode)}</small>` : ''}</td>
    <td class="inventory-number" dir="ltr">${escapeHtml(item.purchasePrice)}</td><td class="inventory-number" dir="ltr">${escapeHtml(item.salesPrice)}</td>
    <td>${opening}</td><td><span class="sales-status sales-status--${item.status}">${statusLabel(item.status)}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="inventory-item-edit" data-id="${item.id}">تعديل</button>
      <button class="icon-button" data-action="inventory-item-status" data-id="${item.id}" data-status="${item.status === 'active' ? 'inactive' : 'active'}">${item.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
      <button class="icon-button icon-button--danger" data-action="inventory-item-delete" data-id="${item.id}">حذف</button></td></tr>`;
}

export function renderInventoryItems(items: InventoryItem[]): string {
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المخزون · بيانات الأصناف</p><h2>الأصناف</h2><p class="muted">الأرصدة الافتتاحية تُحفظ مرة واحدة لكل صنف ومخزن. لا تُرحّل هذه الصفحة فواتير أو حركات أخرى.</p></div>
    <button class="button button--primary" data-action="inventory-item-add">إضافة صنف</button></section>
    <section class="table-panel"><div class="table-toolbar inventory-toolbar"><label class="search-field"><span>⌕</span><input id="inventory-item-search" type="search" placeholder="بحث بالكود أو الاسم أو الباركود"></label>
      <select class="sales-filter" id="inventory-item-status"><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option></select><span class="muted">${items.length} صنف</span></div>
      <div class="table-scroll"><table class="inventory-table"><thead><tr><th><button class="inventory-sort" data-action="inventory-sort" data-key="code">الكود / الباركود ↕</button></th><th><button class="inventory-sort" data-action="inventory-sort" data-key="name">اسم الصنف ↕</button></th><th>الوحدة الأساسية</th><th>سعر الشراء</th><th>سعر البيع</th><th>الرصيد الافتتاحي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
      <tbody>${items.map(itemRow).join('') || '<tr><td colspan="8" class="empty-state">لا توجد أصناف بعد. أضف صنفًا لربطه بمسودات المشتريات.</td></tr>'}</tbody></table></div></section><div id="inventory-modal-host"></div>`;
}

export function renderInventoryUnits(units: InventoryUnit[]): string {
  const rows = units.map((unit) => `<tr data-inventory-unit-row data-sort-code="${escapeHtml(unit.code)}" data-sort-name="${escapeHtml(unit.nameAr)}" data-search="${escapeHtml([unit.code, unit.nameAr, unit.abbreviation].join(' ').toLocaleLowerCase('ar'))}" data-status="${unit.status}">
    <td><strong>${escapeHtml(unit.code)}</strong></td><td>${escapeHtml(unit.nameAr)}</td><td>${escapeHtml(unit.abbreviation || '—')}</td><td>${unit.itemCount}</td>
    <td><span class="sales-status sales-status--${unit.status}">${statusLabel(unit.status)}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="inventory-unit-edit" data-id="${unit.id}">تعديل</button>
      <button class="icon-button" data-action="inventory-unit-status" data-id="${unit.id}" data-status="${unit.status === 'active' ? 'inactive' : 'active'}">${unit.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
      <button class="icon-button icon-button--danger" data-action="inventory-unit-delete" data-id="${unit.id}">حذف</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المخزون · إعدادات القياس</p><h2>وحدات القياس</h2><p class="muted">الوحدة في هذه المرحلة مستقلة؛ لا تُطبّق تحويلات تلقائية على الكميات أو الأسعار.</p></div>
    <button class="button button--primary" data-action="inventory-unit-add">إضافة وحدة</button></section>
    <section class="table-panel"><div class="table-toolbar inventory-toolbar"><label class="search-field"><span>⌕</span><input id="inventory-unit-search" type="search" placeholder="بحث بالكود أو اسم الوحدة"></label>
      <select class="sales-filter" id="inventory-unit-status"><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option></select><span class="muted">${units.length} وحدة</span></div>
      <div class="table-scroll"><table class="inventory-table"><thead><tr><th><button class="inventory-sort" data-action="inventory-sort" data-key="code">الكود ↕</button></th><th><button class="inventory-sort" data-action="inventory-sort" data-key="name">اسم الوحدة ↕</button></th><th>الاسم المختصر</th><th>الأصناف المرتبطة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد وحدات قياس. أضف وحدة قبل إنشاء الأصناف.</td></tr>'}</tbody></table></div></section><div id="inventory-modal-host"></div>`;
}

export function renderWarehouses(warehouses: Warehouse[]): string {
  const rows = warehouses.map((warehouse) => `<tr data-warehouse-row data-sort-code="${escapeHtml(warehouse.code)}" data-sort-name="${escapeHtml(warehouse.name)}" data-search="${escapeHtml([warehouse.code, warehouse.name, warehouse.accountCode, warehouse.accountName].join(' ').toLocaleLowerCase('ar'))}" data-status="${warehouse.status}">
    <td><strong>${escapeHtml(warehouse.code)}</strong></td><td>${escapeHtml(warehouse.name)}</td>
    <td>${warehouse.accountName ? `${escapeHtml(warehouse.accountCode)} — ${escapeHtml(warehouse.accountName)}` : 'دون ربط'}</td><td>${warehouse.openingItemCount}</td>
    <td><span class="sales-status sales-status--${warehouse.status}">${statusLabel(warehouse.status)}</span></td>
    <td class="sales-row-actions"><button class="icon-button" data-action="warehouse-edit" data-id="${warehouse.id}">تعديل</button>
      <button class="icon-button" data-action="warehouse-status" data-id="${warehouse.id}" data-status="${warehouse.status === 'active' ? 'inactive' : 'active'}">${warehouse.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
      <button class="icon-button icon-button--danger" data-action="warehouse-delete" data-id="${warehouse.id}">حذف</button></td></tr>`).join('');
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">المخزون · مواقع التخزين</p><h2>المخازن</h2><p class="muted">لكل مخزن رصيد مستقل. حساب المخزون اختياري ويُختار من دليل الحسابات الموجود.</p></div>
    <button class="button button--primary" data-action="warehouse-add">إضافة مخزن</button></section>
    <section class="table-panel"><div class="table-toolbar inventory-toolbar"><label class="search-field"><span>⌕</span><input id="warehouse-search" type="search" placeholder="بحث بكود أو اسم المخزن"></label>
      <select class="sales-filter" id="warehouse-status"><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option></select><span class="muted">${warehouses.length} مخزن</span></div>
      <div class="table-scroll"><table class="inventory-table"><thead><tr><th><button class="inventory-sort" data-action="inventory-sort" data-key="code">الكود ↕</button></th><th><button class="inventory-sort" data-action="inventory-sort" data-key="name">اسم المخزن ↕</button></th><th>حساب المخزون</th><th>أصناف برصيد افتتاحي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد مخازن. أضف مخزنًا لحفظ أرصدة أول المدة.</td></tr>'}</tbody></table></div></section><div id="inventory-modal-host"></div>`;
}

export function renderInventoryItemForm(
  item: InventoryItem | null,
  units: InventoryUnit[],
  warehouses: Warehouse[],
  accounts: AccountItem[],
): string {
  const unitOptions = units.filter((unit) => unit.status === 'active' || unit.id === item?.baseUnitId).map((unit) =>
    `<option value="${unit.id}" ${unit.id === item?.baseUnitId ? 'selected' : ''}>${escapeHtml(unit.code)} — ${escapeHtml(unit.nameAr)}</option>`).join('');
  const warehouseOptions = warehouses.filter((warehouse) => warehouse.status === 'active').map((warehouse) =>
    `<option value="${warehouse.id}">${escapeHtml(warehouse.code)} — ${escapeHtml(warehouse.name)}</option>`).join('');
  const existingBalances = item?.openingBalances.length
    ? `<div class="inventory-opening-summary field--wide"><strong>أرصدة أول مدة محفوظة</strong>${item.openingBalances.map((balance) =>
      `<span>${escapeHtml(balance.quantity)} ${escapeHtml(item.baseUnitName)} · ${escapeHtml(balance.warehouseName)} · تكلفة الوحدة ${escapeHtml(balance.unitCost)}</span>`).join('')}
      <small>كل رصيد محفوظ غير قابل للتعديل أو التكرار في المخزن نفسه.</small></div>`
    : '';
  const openingEditor = `<div class="inventory-subheading field--wide"><strong>إضافة رصيد أول مدة — اختياري</strong><span>يمكن إضافة رصيد واحد لكل مخزن؛ لا ينشئ قيدًا أو حركة خزينة.</span></div>
      <label class="field"><span>المخزن</span><select name="openingWarehouseId"><option value="">دون رصيد جديد</option>${warehouseOptions}</select></label>
      <label class="field"><span>الكمية الافتتاحية</span><input name="openingQuantity" type="number" min="0.000001" step="any"></label>
      <label class="field"><span>تكلفة الوحدة</span><input name="openingUnitCost" type="number" min="0" step="any"></label>`;
  return `<div class="modal-backdrop" id="inventory-modal"><section class="record-modal inventory-editor" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">بيانات الأصناف</p><h2>${item ? 'تعديل الصنف' : 'إضافة صنف'}</h2></div><button class="icon-button" type="button" data-action="inventory-close">إغلاق</button></header>
    <form class="inventory-form" data-form="inventory-item"><input type="hidden" name="id" value="${item?.id ?? ''}">
      <label class="field"><span>كود الصنف *</span><input name="code" maxlength="80" required value="${escapeHtml(item?.code ?? '')}"></label>
      <label class="field"><span>الاسم العربي *</span><input name="nameAr" maxlength="180" required value="${escapeHtml(item?.nameAr ?? '')}"></label>
      <label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" maxlength="180" value="${escapeHtml(item?.nameEn ?? '')}"></label>
      <label class="field"><span>الباركود</span><input name="barcode" maxlength="100" value="${escapeHtml(item?.barcode ?? '')}"></label>
      <label class="field"><span>الوحدة الأساسية *</span><select name="baseUnitId" required><option value="">اختر وحدة</option>${unitOptions}</select></label>
      <label class="field"><span>سعر الشراء</span><input name="purchasePrice" type="number" min="0" step="any" required value="${escapeHtml(item?.purchasePrice ?? '0')}"></label>
      <label class="field"><span>سعر البيع</span><input name="salesPrice" type="number" min="0" step="any" required value="${escapeHtml(item?.salesPrice ?? '0')}"></label>
      <label class="field"><span>نسبة الضريبة % (اختياري)</span><input name="taxRate" type="number" min="0" max="100" step="any" value="${escapeHtml(item?.taxRate ?? '')}"><small>تُحفظ كبيان للصنف فقط؛ لا تُطبق حتى تهيئة إعدادات الضريبة.</small></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!item || item.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${item?.status === 'inactive' ? 'selected' : ''}>غير نشط</option></select></label>
      <label class="inventory-check"><input name="sellable" type="checkbox" ${!item || item.sellable ? 'checked' : ''}><span>قابل للبيع</span></label>
      <label class="inventory-check"><input name="purchasable" type="checkbox" ${!item || item.purchasable ? 'checked' : ''}><span>قابل للشراء</span></label>
      ${existingBalances}${openingEditor}
      <div class="inventory-subheading field--wide"><strong>الحسابات المرتبطة — اختيارية</strong><span>اختر من الحسابات الموجودة فقط؛ لا تُنشأ حسابات تلقائيًا.</span></div>
      <label class="field"><span>حساب المخزون (أصول)</span><select name="inventoryAccountId">${accountOptions(accounts, item?.inventoryAccountId ?? null, ['asset'])}</select></label>
      <label class="field"><span>حساب المشتريات</span><select name="purchaseAccountId">${accountOptions(accounts, item?.purchaseAccountId ?? null, ['asset', 'expense'])}</select></label>
      <label class="field"><span>حساب المبيعات (إيراد)</span><select name="salesAccountId">${accountOptions(accounts, item?.salesAccountId ?? null, ['revenue'])}</select></label>
      <label class="field"><span>تكلفة المبيعات (مصروف)</span><select name="cogsAccountId">${accountOptions(accounts, item?.cogsAccountId ?? null, ['expense'])}</select></label>
      <label class="field"><span>المصروفات</span><select name="expenseAccountId">${accountOptions(accounts, item?.expenseAccountId ?? null, ['expense'])}</select></label>
      <p class="form-error field--wide" id="inventory-form-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="inventory-close">إلغاء</button><button class="button button--primary" type="submit">حفظ الصنف</button></div>
    </form></section></div>`;
}

export function renderInventoryUnitForm(unit: InventoryUnit | null): string {
  return `<div class="modal-backdrop" id="inventory-modal"><section class="record-modal inventory-editor inventory-editor--small" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">إعدادات القياس</p><h2>${unit ? 'تعديل وحدة القياس' : 'إضافة وحدة قياس'}</h2></div><button class="icon-button" type="button" data-action="inventory-close">إغلاق</button></header>
    <form class="inventory-form" data-form="inventory-unit"><input type="hidden" name="id" value="${unit?.id ?? ''}">
      <label class="field"><span>كود الوحدة *</span><input name="code" maxlength="40" required value="${escapeHtml(unit?.code ?? '')}"></label>
      <label class="field"><span>اسم الوحدة بالعربية *</span><input name="nameAr" maxlength="100" required value="${escapeHtml(unit?.nameAr ?? '')}"></label>
      <label class="field"><span>الاسم المختصر</span><input name="abbreviation" maxlength="30" value="${escapeHtml(unit?.abbreviation ?? '')}"></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!unit || unit.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${unit?.status === 'inactive' ? 'selected' : ''}>غير نشط</option></select></label>
      <p class="inventory-inline-note field--wide">لا توجد تحويلات وحدات في هذه المرحلة؛ تبقى الكمية في الوحدة المسجلة دون تحويل تلقائي.</p>
      <p class="form-error field--wide" id="inventory-form-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="inventory-close">إلغاء</button><button class="button button--primary" type="submit">حفظ الوحدة</button></div>
    </form></section></div>`;
}

export function renderWarehouseForm(warehouse: Warehouse | null, accounts: AccountItem[]): string {
  return `<div class="modal-backdrop" id="inventory-modal"><section class="record-modal inventory-editor inventory-editor--small" role="dialog" aria-modal="true">
    <header class="modal-heading"><div><p class="eyebrow">مواقع التخزين</p><h2>${warehouse ? 'تعديل المخزن' : 'إضافة مخزن'}</h2></div><button class="icon-button" type="button" data-action="inventory-close">إغلاق</button></header>
    <form class="inventory-form" data-form="warehouse"><input type="hidden" name="id" value="${warehouse?.id ?? ''}">
      <label class="field"><span>كود المخزن *</span><input name="code" maxlength="40" required value="${escapeHtml(warehouse?.code ?? '')}"></label>
      <label class="field"><span>اسم المخزن *</span><input name="name" maxlength="160" required value="${escapeHtml(warehouse?.name ?? '')}"></label>
      <label class="field"><span>حساب المخزون المرتبط</span><select name="accountId">${accountOptions(accounts, warehouse?.accountId ?? null, ['asset'])}</select></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!warehouse || warehouse.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${warehouse?.status === 'inactive' ? 'selected' : ''}>غير نشط</option></select></label>
      <p class="inventory-inline-note field--wide">لا تُنشأ قيود أو حركات مالية عند إنشاء المخزن أو ربط الحساب.</p>
      <p class="form-error field--wide" id="inventory-form-error" hidden role="alert"></p>
      <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="inventory-close">إلغاء</button><button class="button button--primary" type="submit">حفظ المخزن</button></div>
    </form></section></div>`;
}
