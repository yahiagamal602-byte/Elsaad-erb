import type { AccountItem, Customer, CustomerGroup } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function statusLabel(status: 'active' | 'inactive'): string {
  return status === 'active' ? 'نشط' : 'معطّل';
}

function customerForm(customer: Customer | null, groups: CustomerGroup[], accounts: AccountItem[]): string {
  const options = groups.filter((group) => group.status === 'active' || customer?.groupId === group.id).map((group) =>
    `<option value="${group.id}" ${customer?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.code)} — ${escapeHtml(group.nameAr)}${group.status === 'inactive' ? ' (معطّلة)' : ''}</option>`).join('');
  const accountOptions = accounts.filter((account) => account.type === 'asset' && account.postable).map((account) =>
    `<option value="${account.id}" ${customer?.accountId === account.id ? 'selected' : ''}>${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join('');
  return `
    <div class="modal-backdrop sales-master-backdrop" id="sales-master-modal">
      <section class="record-modal sales-master-modal" role="dialog" aria-modal="true" aria-labelledby="sales-master-title">
        <div class="modal-heading"><div><p class="eyebrow">دليل المبيعات</p><h2 id="sales-master-title">${customer ? 'تعديل بيانات العميل' : 'إضافة عميل'}</h2></div><button class="icon-button" type="button" data-action="sales-master-close">إغلاق</button></div>
        <form data-form="customer" class="sales-master-form">
          <input type="hidden" name="id" value="${customer?.id ?? ''}">
          <label class="field"><span>كود العميل <b>*</b></span><input name="code" value="${escapeHtml(customer?.code ?? '')}" required maxlength="40"></label>
          <label class="field"><span>اسم العميل <b>*</b></span><input name="name" value="${escapeHtml(customer?.name ?? '')}" required maxlength="180"></label>
          <label class="field"><span>الاسم التجاري</span><input name="tradeName" value="${escapeHtml(customer?.tradeName ?? '')}" maxlength="180"></label>
          <label class="field"><span>الهاتف</span><input name="phone" value="${escapeHtml(customer?.phone ?? '')}" maxlength="60" inputmode="tel"></label>
          <label class="field"><span>البريد الإلكتروني</span><input name="email" value="${escapeHtml(customer?.email ?? '')}" maxlength="180" type="email"></label>
          <label class="field"><span>مجموعة العميل</span><select name="groupId"><option value="">بدون مجموعة</option>${options}</select></label>
          <label class="field"><span>الحساب المحاسبي للعميل</span><select name="accountId"><option value="">غير مربوط</option>${accountOptions}</select></label>
          <label class="field"><span>المدينة</span><input name="city" value="${escapeHtml(customer?.city ?? '')}" maxlength="100"></label>
          <label class="field"><span>الدولة</span><input name="country" value="${escapeHtml(customer?.country ?? '')}" maxlength="100"></label>
          <label class="field"><span>الرقم الضريبي</span><input name="taxNumber" value="${escapeHtml(customer?.taxNumber ?? '')}" maxlength="100"></label>
          <label class="field field--wide"><span>العنوان</span><input name="address" value="${escapeHtml(customer?.address ?? '')}" maxlength="500"></label>
          <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="3">${escapeHtml(customer?.notes ?? '')}</textarea></label>
          <label class="field"><span>الحالة</span><select name="status"><option value="active" ${customer?.status !== 'inactive' ? 'selected' : ''}>نشط</option><option value="inactive" ${customer?.status === 'inactive' ? 'selected' : ''}>معطّل</option></select></label>
          <p class="form-error field--wide" id="sales-master-error" role="alert" hidden></p>
          <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="sales-master-close">إلغاء</button><button class="button button--primary" type="submit">حفظ العميل</button></div>
        </form>
      </section>
    </div>
  `;
}

function groupForm(group: CustomerGroup | null): string {
  return `
    <div class="modal-backdrop sales-master-backdrop" id="sales-master-modal">
      <section class="record-modal sales-master-modal" role="dialog" aria-modal="true" aria-labelledby="sales-master-title">
        <div class="modal-heading"><div><p class="eyebrow">دليل المبيعات</p><h2 id="sales-master-title">${group ? 'تعديل مجموعة العملاء' : 'إضافة مجموعة عملاء'}</h2></div><button class="icon-button" type="button" data-action="sales-master-close">إغلاق</button></div>
        <form data-form="customer-group" class="sales-master-form">
          <input type="hidden" name="id" value="${group?.id ?? ''}">
          <label class="field"><span>كود المجموعة <b>*</b></span><input name="code" value="${escapeHtml(group?.code ?? '')}" required maxlength="40"></label>
          <label class="field"><span>الاسم العربي <b>*</b></span><input name="nameAr" value="${escapeHtml(group?.nameAr ?? '')}" required maxlength="160"></label>
          <label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" value="${escapeHtml(group?.nameEn ?? '')}" maxlength="160" dir="ltr"></label>
          <label class="field"><span>الحالة</span><select name="status"><option value="active" ${group?.status !== 'inactive' ? 'selected' : ''}>نشطة</option><option value="inactive" ${group?.status === 'inactive' ? 'selected' : ''}>معطّلة</option></select></label>
          <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="3">${escapeHtml(group?.notes ?? '')}</textarea></label>
          <p class="form-error field--wide" id="sales-master-error" role="alert" hidden></p>
          <div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="sales-master-close">إلغاء</button><button class="button button--primary" type="submit">حفظ المجموعة</button></div>
        </form>
      </section>
    </div>
  `;
}

export function renderCustomersPage(customers: Customer[], groups: CustomerGroup[], selectedGroup = '', accounts: AccountItem[] = []): string {
  const groupNames = new Map(groups.map((group) => [group.id, `${group.code} — ${group.nameAr}`]));
  const rows = customers.map((customer) => `
    <tr data-customer-row data-search="${escapeHtml([customer.code, customer.name, customer.tradeName, customer.phone, customer.email, customer.city, customer.taxNumber].join(' ').toLocaleLowerCase('ar'))}" data-group="${customer.groupId ?? ''}" data-status="${customer.status}">
      <td><strong>${escapeHtml(customer.code)}</strong></td>
      <td><strong>${escapeHtml(customer.name)}</strong>${customer.tradeName ? `<small>${escapeHtml(customer.tradeName)}</small>` : ''}</td>
      <td>${escapeHtml(customer.phone || '—')}</td><td dir="ltr">${escapeHtml(customer.email || '—')}</td>
      <td>${escapeHtml(customer.groupId === null ? '—' : groupNames.get(customer.groupId) ?? 'مجموعة غير متاحة')}</td>
      <td>${escapeHtml([customer.city, customer.country].filter(Boolean).join('، ') || '—')}</td>
      <td><span class="sales-status sales-status--${customer.status}">${statusLabel(customer.status)}</span></td>
      <td class="sales-row-actions">
        <button class="icon-button" type="button" data-action="customer-edit" data-id="${customer.id}">تعديل</button>
        <button class="icon-button" type="button" data-action="customer-status" data-id="${customer.id}" data-status="${customer.status === 'active' ? 'inactive' : 'active'}">${customer.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>
        <button class="icon-button icon-button--danger" type="button" data-action="customer-delete" data-id="${customer.id}">حذف</button>
      </td>
    </tr>
  `).join('');
  const groupFilters = groups.map((group) => `<option value="${group.id}" ${selectedGroup === String(group.id) ? 'selected' : ''}>${escapeHtml(group.nameAr)}</option>`).join('');
  return `
    <section class="section-heading section-heading--page">
      <div><p class="eyebrow">المبيعات · دليل العملاء</p><h2>العملاء</h2><p class="muted">سجل العملاء المحلي ومجموعاتهم وروابط المستندات الجديدة.</p></div>
      <button class="button button--primary" type="button" data-action="customer-add">إضافة عميل</button>
    </section>
    <section class="table-panel">
      <div class="table-toolbar sales-master-toolbar">
        <label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="customer-search" placeholder="بحث بالكود أو الاسم أو الهاتف" aria-label="بحث العملاء"></label>
        <select id="customer-group-filter" class="sales-filter"><option value="">كل المجموعات</option>${groupFilters}</select>
        <select id="customer-status-filter" class="sales-filter"><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">معطّل</option></select>
        <div class="toolbar-actions"><span class="muted">${customers.length} عميل</span><button class="button button--secondary" type="button" data-action="customers-export">تصدير Excel/CSV</button><label class="button button--secondary sales-import-label">استيراد CSV<input type="file" id="customers-import" accept=".csv,text/csv" hidden></label><button class="button button--secondary" type="button" data-action="sales-print-list">طباعة</button></div>
      </div>
      <div id="customer-import-result" class="sales-import-result" role="status" hidden></div>
      <div class="table-scroll sales-master-table-wrap"><table class="sales-master-table" id="customers-table">
        <thead><tr><th>الكود</th><th>العميل</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>المجموعة</th><th>المدينة / الدولة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">لا يوجد عملاء مسجلون. أضف سجلًا حقيقيًا للمتابعة.</td></tr>'}</tbody>
      </table></div>
    </section>
    <p class="sales-dependency">الاستيراد والتصدير بصيغة CSV المتوافقة مع Excel؛ ملفات ‎.xlsx غير مدعومة حاليًا لعدم وجود مكتبة Excel ضمن المشروع.</p>
    <div id="sales-master-modal-host"></div>
  `;
}

export function renderCustomerGroupsPage(groups: CustomerGroup[]): string {
  const rows = groups.map((group) => `
    <tr data-group-row data-search="${escapeHtml([group.code, group.nameAr, group.nameEn, group.notes].join(' ').toLocaleLowerCase('ar'))}">
      <td><strong>${escapeHtml(group.code)}</strong></td><td><strong>${escapeHtml(group.nameAr)}</strong><small dir="ltr">${escapeHtml(group.nameEn || '—')}</small></td>
      <td>${group.customerCount}</td><td><span class="sales-status sales-status--${group.status}">${group.status === 'active' ? 'نشطة' : 'معطّلة'}</span></td>
      <td class="sales-row-actions"><button class="icon-button" type="button" data-action="customer-group-edit" data-id="${group.id}">تعديل</button>
      <button class="icon-button" type="button" data-action="customer-group-customers" data-id="${group.id}">عرض العملاء</button>
      <button class="icon-button icon-button--danger" type="button" data-action="customer-group-delete" data-id="${group.id}">حذف</button></td>
    </tr>
  `).join('');
  return `
    <section class="section-heading section-heading--page"><div><p class="eyebrow">المبيعات · تنظيم العملاء</p><h2>مجموعات العملاء</h2><p class="muted">تجميع العملاء ومتابعة استخدام كل مجموعة.</p></div><button class="button button--primary" type="button" data-action="customer-group-add">إضافة مجموعة</button></section>
    <section class="table-panel"><div class="table-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="customer-group-search" placeholder="بحث عن مجموعة" aria-label="بحث مجموعات العملاء"></label><div class="toolbar-actions"><span class="muted">${groups.length} مجموعة</span></div></div>
      <div class="table-scroll"><table class="sales-master-table"><thead><tr><th>الكود</th><th>المجموعة</th><th>عدد العملاء</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty-state">لا توجد مجموعات بعد.</td></tr>'}</tbody></table></div></section>
    <div id="sales-master-modal-host"></div>
  `;
}

export function renderCustomerForm(customer: Customer | null, groups: CustomerGroup[], accounts: AccountItem[] = []): string {
  return customerForm(customer, groups, accounts);
}

export function renderCustomerGroupForm(group: CustomerGroup | null): string {
  return groupForm(group);
}

export function customersCsv(customers: Customer[], groups: CustomerGroup[]): string {
  const groupCodes = new Map(groups.map((group) => [group.id, group.code]));
  const fields: Array<keyof Customer | 'groupCode'> = [
    'code', 'name', 'tradeName', 'phone', 'email', 'groupCode', 'city', 'country', 'address', 'taxNumber', 'notes',
  ];
  const headers = ['code', 'name', 'tradeName', 'phone', 'email', 'groupCode', 'city', 'country', 'address', 'taxNumber', 'notes'];
  const quote = (value: string): string => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = customers.map((customer) => fields.map((field) =>
    quote(field === 'groupCode' ? groupCodes.get(customer.groupId ?? -1) ?? '' : String(customer[field] ?? ''))).join(','));
  return `\uFEFF${[headers.map(quote).join(','), ...rows].join('\r\n')}`;
}

export function parseCustomersCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error('ملف CSV يحتوي على حقل نصي غير مكتمل.');
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}
