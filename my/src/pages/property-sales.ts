import type {
  AccountItem,
  BankAccount,
  BrokerCommissionTreatment,
  CashBox,
  Customer,
  Project,
  PropertyBroker,
  PropertyContract,
  PropertyFreePaymentInput,
  PropertyInstallmentFrequency,
  PropertyScheduleInput,
  PropertyUnit,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';
import { calculateContractAmounts, fromCents, generateInstallments, toCents } from '../shared/property-sales.js';

const frequencies: Array<{ key: Exclude<PropertyInstallmentFrequency, 'free' | 'down-payment'>; label: string }> = [
  { key: 'monthly', label: 'شهري' },
  { key: 'quarterly', label: 'ربع سنوي' },
  { key: 'semiannual', label: 'نصف سنوي' },
  { key: 'annual', label: 'سنوي' },
];

function money(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return value;
  const whole = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(BigInt(match[1]));
  return `${whole}.${(match[2] ?? '').padEnd(2, '0')}`;
}

function today(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function projectOptions(projects: Project[], selectedId: number): string {
  return projects.map((project) => `<option value="${project.id}" ${selectedId === project.id ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('');
}

function freePaymentRow(payment?: PropertyFreePaymentInput, index = 0, locked = false): string {
  return `<tr data-property-free-payment><td><input name="freeAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(payment?.amount ?? '')}" aria-label="مبلغ الدفعة الحرة ${index + 1}" ${locked ? 'disabled' : ''}></td>
    <td><input name="freeDueDate" type="date" value="${escapeHtml(payment?.dueDate ?? '')}" aria-label="تاريخ الدفعة الحرة ${index + 1}" ${locked ? 'disabled' : ''}></td>
    <td><input name="freeDescription" maxlength="240" value="${escapeHtml(payment?.description ?? '')}" aria-label="بيان الدفعة الحرة ${index + 1}" placeholder="البيان" ${payment ? 'required' : ''} ${locked ? 'disabled' : ''}></td>
    <td><input name="freeNotes" maxlength="2000" value="${escapeHtml(payment?.notes ?? '')}" aria-label="ملاحظات الدفعة الحرة ${index + 1}" placeholder="ملاحظات" ${locked ? 'disabled' : ''}></td>
    <td>${locked ? '' : '<button class="button button--tiny button--danger" type="button" data-action="property-free-remove">حذف</button>'}</td></tr>`;
}

function feeRow(fee?: { description: string; amount: string }, index = 0, locked = false): string {
  return `<tr data-property-fee><td><input name="feeDescription" maxlength="160" required value="${escapeHtml(fee?.description ?? '')}" placeholder="وصف الرسم" aria-label="وصف الرسم ${index + 1}" ${locked ? 'disabled' : ''}></td>
    <td><input name="feeAmount" type="number" min="0.01" step="0.01" required value="${escapeHtml(fee?.amount ?? '')}" placeholder="0.00" aria-label="قيمة الرسم ${index + 1}" ${locked ? 'disabled' : ''}></td>
    <td>${locked ? '' : '<button class="button button--tiny button--danger" type="button" data-action="property-fee-remove">حذف</button>'}</td></tr>`;
}

function scheduleSection(frequency: typeof frequencies[number], schedule?: PropertyScheduleInput, locked = false): string {
  const { key, label } = frequency;
  const disabled = locked ? 'disabled' : '';
  return `<section class="property-schedule-section" data-property-schedule="${key}">
    <header><div><h3>أقساط ${label}</h3><span>تكرار كل ${key === 'monthly' ? 'شهر' : key === 'quarterly' ? '3 أشهر' : key === 'semiannual' ? '6 أشهر' : 'سنة'}</span></div>
      <div><strong data-schedule-total="${key}">${money(schedule?.amount ?? '0')}</strong>${locked ? '' : `<button class="button button--tiny button--primary" type="button" data-action="property-schedule-generate" data-frequency="${key}">توليد / تحديث</button>`}</div></header>
    <div class="property-schedule-fields">
      <label class="field"><span>المبلغ المخصص</span><input name="${key}Amount" type="number" min="0" step="0.01" value="${escapeHtml(schedule?.amount ?? '')}" ${disabled}></label>
      <label class="field"><span>عدد الأقساط</span><input name="${key}Count" type="number" min="1" max="1200" step="1" value="${schedule?.count ?? 1}" ${disabled}></label>
      <label class="field"><span>أول استحقاق</span><input name="${key}FirstDate" type="date" value="${escapeHtml(schedule?.firstDueDate ?? today())}" ${disabled}></label>
      <label class="field"><span>البيان</span><input name="${key}Description" maxlength="240" value="${escapeHtml(schedule?.description ?? '')}" ${disabled}></label>
      <label class="field field--wide"><span>ملاحظات</span><input name="${key}Notes" maxlength="2000" value="${escapeHtml(schedule?.notes ?? '')}" ${disabled}></label>
    </div>
    <div class="table-scroll property-schedule-preview"><table><thead><tr><th>القسط</th><th>تاريخ الاستحقاق</th><th>القيمة</th></tr></thead>
      <tbody data-schedule-preview="${key}"><tr><td class="empty-state" colspan="3">أدخل المبلغ والعدد لمعاينة الجدول.</td></tr></tbody></table></div>
  </section>`;
}

export function renderPropertyUnitsPage(projects: Project[], units: PropertyUnit[], projectId: number | null): string {
  const rows = units.map((unit) => `<tr data-property-unit data-search="${escapeHtml(`${unit.code} ${unit.name} ${unit.projectName}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(unit.code)}</strong></td><td>${escapeHtml(unit.name)}</td><td>${escapeHtml(unit.projectName)}</td>
    <td>${escapeHtml(unit.floor || '—')}</td><td>${escapeHtml(unit.area)}</td><td>${money(unit.pricePerMeter)} جنيه/م²</td><td>${money(unit.originalPrice)} جنيه</td>
    <td>${unit.status === 'available' ? 'متاحة' : unit.status === 'reserved' ? 'محجوزة' : `مباعة · ${escapeHtml(unit.contractNumber)}`}</td>
    <td>${unit.status === 'sold' ? '—' : `<button class="button button--tiny button--secondary" type="button" data-action="property-unit-edit" data-id="${unit.id}">تعديل</button>`}</td></tr>`).join('');
  return `<section class="project-page property-sales-page" dir="rtl"><div class="project-toolbar"><div><p class="eyebrow">العقارات · سجل الوحدات</p><h1>وحدات المشروع</h1><p class="muted">كل وحدة مرتبطة بمشروع وسعر فعلي قبل إدراجها في عقد بيع.</p></div>
    <button class="button button--primary" type="button" data-action="property-unit-add">＋ إضافة وحدة</button></div>
    <section class="panel project-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input id="property-unit-search" type="search" placeholder="بحث بالوحدة أو المشروع" aria-label="بحث في الوحدات"></label>
      <label class="field"><span>المشروع</span><select id="property-unit-project-filter"><option value="">كل المشاريع</option>${projectOptions(projects, projectId ?? 0)}</select></label></div>
      <div class="table-scroll"><table class="project-table"><thead><tr><th>كود الوحدة</th><th>الوصف</th><th>المشروع</th><th>الدور</th><th>المساحة</th><th>سعر المتر</th><th>السعر الأصلي</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty-state">لا توجد وحدات. أضف وحدة مرتبطة بمشروع قائم.</td></tr>'}</tbody></table></div></section><div id="property-unit-modal-host"></div></section>`;
}

export function renderPropertyUnitForm(projects: Project[], unit: PropertyUnit | null, projectId: number | null): string {
  return `<div class="modal-backdrop" id="property-unit-modal"><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="property-unit-title">
    <header class="modal-heading"><div><p class="eyebrow">بيانات الوحدة</p><h2 id="property-unit-title">${unit ? 'تعديل الوحدة' : 'وحدة جديدة'}</h2></div><button class="icon-button" type="button" data-action="property-modal-close">إغلاق</button></header>
    <form class="inventory-form" data-form="property-unit"><input type="hidden" name="id" value="${unit?.id ?? ''}">
      <label class="field"><span>المشروع *</span><select name="projectId" required><option value="">اختر المشروع</option>${projectOptions(projects, unit?.projectId ?? projectId ?? 0)}</select></label>
      <label class="field"><span>كود الوحدة *</span><input name="code" maxlength="40" required value="${escapeHtml(unit?.code ?? '')}"></label>
      <label class="field"><span>اسم / وصف الوحدة *</span><input name="name" maxlength="180" required value="${escapeHtml(unit?.name ?? '')}"></label>
        <label class="field"><span>الدور</span><input name="floor" maxlength="60" value="${escapeHtml(unit?.floor ?? '')}"></label>
      <label class="field"><span>المساحة</span><input name="area" type="number" min="0" step="0.01" value="${escapeHtml(unit?.area ?? '0')}"></label>
      <label class="field"><span>السعر الأصلي *</span><input name="originalPrice" type="number" min="0.01" step="0.01" required value="${escapeHtml(unit?.originalPrice ?? '')}"></label>
      <label class="field"><span>الحالة</span><select name="status"><option value="available" ${!unit || unit.status === 'available' ? 'selected' : ''}>متاحة</option><option value="reserved" ${unit?.status === 'reserved' ? 'selected' : ''}>محجوزة</option></select></label>
      <p class="form-error field--wide" id="property-unit-error" role="alert" hidden></p><div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="property-modal-close">إلغاء</button><button class="button button--primary" type="submit">حفظ الوحدة</button></div>
    </form></section></div>`;
}

export function renderPropertyContractEditor(contract: PropertyContract | null, projects: Project[], units: PropertyUnit[], customers: Customer[], brokers: PropertyBroker[]): string {
  const readonly = contract?.status === 'approved' || contract?.status === 'cancelled';
  const selectedProjectId = contract?.projectId ?? projects[0]?.id ?? 0;
  const selectedUnit = units.find((unit) => unit.id === contract?.unitId);
  const customerOptions = customers.filter((customer) => customer.status === 'active' || customer.id === contract?.customerId)
    .map((customer) => `<option value="${customer.id}" ${customer.id === contract?.customerId ? 'selected' : ''}>${escapeHtml(`${customer.code} — ${customer.name}`)}</option>`).join('');
  const brokerOptions = brokers.filter((broker) => broker.status === 'active' || broker.id === contract?.brokerId)
    .map((broker) => `<option value="${broker.id}" data-commission-rate="${escapeHtml(broker.commissionRate)}" ${broker.id === contract?.brokerId ? 'selected' : ''}>${escapeHtml(`${broker.code} — ${broker.name}`)}</option>`).join('');
  const scheduleByFrequency = new Map(contract?.schedules.map((schedule) => [schedule.frequency, schedule]) ?? []);
  const freeRows = contract?.freePayments.map((payment, index) => freePaymentRow(payment, index, readonly)).join('') ?? '';
  const amount = contract ? calculateContractAmounts({ originalPrice: contract.originalPrice, discount: contract.discount, fees: contract.fees, downPayment: contract.downPayment, brokerRate: contract.brokerRate, brokerCommissionMode: contract.brokerCommissionMode, brokerOnOriginalPrice: contract.brokerOnOriginalPrice }) : null;
  const formValue = (key: 'originalPrice' | 'discount' | 'fees' | 'downPayment' | 'brokerRate') => contract?.[key] ?? (key === 'discount' || key === 'fees' || key === 'downPayment' || key === 'brokerRate' ? '0' : selectedUnit?.originalPrice ?? '');
  return `<div class="modal-backdrop" id="property-contract-modal"><section class="record-modal property-contract-editor" role="dialog" aria-modal="true" aria-labelledby="property-contract-title">
    <header class="modal-heading"><div><p class="eyebrow">مبيعات الوحدات · ${escapeHtml(contract?.number ?? 'مسودة عقد')}</p><h2 id="property-contract-title">${readonly ? 'عرض عقد بيع وحدة' : contract ? 'تعديل عقد بيع وحدة' : 'عقد بيع وحدة جديد'}</h2></div><button class="icon-button" type="button" data-action="property-modal-close">إغلاق</button></header>
    <form data-form="property-contract" data-readonly="${readonly}"><input type="hidden" name="id" value="${contract?.id ?? ''}">
      <div class="property-contract-grid">
        <label class="field"><span>المشروع *</span><select name="projectId" required ${readonly ? 'disabled' : ''}><option value="">اختر المشروع</option>${projectOptions(projects, selectedProjectId)}</select></label>
        <label class="field"><span>الوحدة *</span><select name="unitId" required ${readonly ? 'disabled' : ''}><option value="">اختر الوحدة</option>${units.filter((unit) => unit.status === 'available' || unit.id === contract?.unitId).map((unit) => `<option value="${unit.id}" data-price="${escapeHtml(unit.originalPrice)}" data-project-id="${unit.projectId}" ${unit.projectId !== selectedProjectId && !readonly ? 'hidden' : ''} ${unit.id === contract?.unitId ? 'selected' : ''}>${escapeHtml(`${unit.projectName} · ${unit.code} · ${unit.name} · الدور ${unit.floor || '—'} · ${unit.area}م² · ${money(unit.pricePerMeter)} جنيه/م² · ${money(unit.originalPrice)} جنيه`)}</option>`).join('')}</select></label>
        <label class="field"><span>العميل *</span><select name="customerId" required ${readonly ? 'disabled' : ''}><option value="">اختر العميل</option>${customerOptions}</select></label>
        <label class="field"><span>تاريخ العقد *</span><input name="contractDate" type="date" required value="${escapeHtml(contract?.contractDate ?? today())}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>سعر الوحدة الأصلي</span><input name="originalPrice" type="number" min="0" step="0.01" required value="${escapeHtml(formValue('originalPrice'))}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>الخصم</span><input name="discount" type="number" min="0" step="0.01" value="${escapeHtml(formValue('discount'))}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>إجمالي الرسوم المفصلة</span><input name="fees" type="number" min="0" step="0.01" value="${escapeHtml(formValue('fees'))}" readonly></label>
        <label class="field"><span>المقدم</span><input name="downPayment" type="number" min="0" step="0.01" value="${escapeHtml(formValue('downPayment'))}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>تاريخ استحقاق المقدم</span><input name="downPaymentDueDate" type="date" required value="${escapeHtml(contract?.downPaymentDueDate ?? contract?.contractDate ?? today())}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>السمسار</span><span class="property-broker-select"><select name="brokerId" data-applied-commission="${escapeHtml(contract?.brokerRate ?? '0')}" ${readonly ? 'disabled' : ''}><option value="" data-commission-rate="0">بدون سمسار</option>${brokerOptions}</select>${readonly ? '' : '<button class="button button--tiny button--search" type="button" data-action="property-broker-add">إضافة سمسار</button>'}</span></label>
        <label class="field"><span>طريقة العمولة</span><select name="brokerCommissionMode" ${readonly ? 'disabled' : ''}><option value="rate" ${!contract || contract.brokerCommissionMode === 'rate' ? 'selected' : ''}>نسبة مئوية</option><option value="fixed" ${contract?.brokerCommissionMode === 'fixed' ? 'selected' : ''}>قيمة ثابتة</option></select></label>
        <label class="field"><span data-broker-value-label>${contract?.brokerCommissionMode === 'fixed' ? 'قيمة العمولة بالجنيه' : 'نسبة العمولة %'}</span><input name="brokerRate" type="number" min="0" ${contract?.brokerCommissionMode === 'fixed' ? '' : 'max="100"'} step="0.01" value="${escapeHtml(formValue('brokerRate'))}" ${readonly ? 'disabled' : ''}></label>
        <label class="field property-checkbox" ${contract?.brokerCommissionMode === 'fixed' ? 'hidden' : ''}><input name="brokerOnOriginalPrice" type="checkbox" ${contract?.brokerOnOriginalPrice ? 'checked' : ''} ${readonly ? 'disabled' : ''}><span>احتساب العمولة على السعر الأصلي</span></label>
        <label class="field field--wide"><span>ملاحظات العقد</span><textarea name="notes" rows="2" maxlength="4000" ${readonly ? 'disabled' : ''}>${escapeHtml(contract?.notes ?? '')}</textarea></label>
      </div>
      <section class="property-schedule-section property-fees-section"><header><div><h3>الرسوم الإضافية</h3><span>القيمة النهائية تجمع الرسوم المفصلة تلقائيًا</span></div>
        ${readonly ? '' : '<button class="button button--tiny button--secondary" type="button" data-action="property-fee-add">＋ إضافة رسم</button>'}</header>
        <div class="table-scroll"><table><thead><tr><th>الرسم</th><th>القيمة</th><th>إجراء</th></tr></thead><tbody id="property-fee-items">${contract?.feeItems.map((fee, index) => feeRow(fee, index, readonly)).join('') || '<tr data-empty-fees><td colspan="3" class="empty-state">لا توجد رسوم إضافية.</td></tr>'}</tbody></table></div>
      </section>
      <div class="property-financial-summary" id="property-contract-summary">
        <div><span>سعر الوحدة</span><strong data-money="original">${money(amount?.originalPrice ?? (formValue('originalPrice') || '0'))}</strong></div>
        <div><span>قيمة الخصم · النسبة</span><strong><span data-money="discount">${money(amount?.discount ?? formValue('discount'))}</span> · <span data-discount-rate>${amount?.discountRate ?? '0.00'}%</span></strong></div>
        <div><span>الرسوم</span><strong data-money="fees">${money(amount?.fees ?? formValue('fees'))}</strong></div>
        <div><span>القيمة النهائية</span><strong data-money="contract">${money(amount?.contractValue ?? '0')}</strong></div>
        <div><span>المقدم</span><strong data-money="down">${money(amount?.downPayment ?? formValue('downPayment'))}</strong></div>
        <div><span>المتبقي للتوزيع</span><strong data-money="remaining">${money(amount?.remaining ?? '0')}</strong></div>
        <div><span>عمولة السمسار</span><strong data-money="commission">${money(amount?.brokerCommission ?? '0')}</strong></div>
      </div>
      <h3 class="property-section-title">خطة السداد الدورية</h3>
      <div class="property-schedule-grid">${frequencies.map((frequency) => scheduleSection(frequency, scheduleByFrequency.get(frequency.key), readonly)).join('')}</div>
      <section class="property-schedule-section property-free-section"><header><div><h3>الدفعات الحرة</h3><span>مبالغ وتواريخ مستقلة</span></div><strong data-free-total>0.00</strong></header>
        ${readonly ? '' : '<button class="button button--secondary" type="button" data-action="property-free-add">＋ إضافة دفعة</button>'}
        <div class="table-scroll"><table><thead><tr><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>البيان</th><th>ملاحظات</th><th>إجراء</th></tr></thead><tbody id="property-free-payments">${freeRows || '<tr data-empty-free><td class="empty-state" colspan="5">لم تتم إضافة دفعات حرة.</td></tr>'}</tbody></table></div>
      </section>
      <div class="property-plan-summary"><div><span>إجمالي الأقساط الشهرية</span><strong data-total-frequency="monthly">0.00</strong></div>
        <div><span>ربع السنوية</span><strong data-total-frequency="quarterly">0.00</strong></div><div><span>نصف السنوية</span><strong data-total-frequency="semiannual">0.00</strong></div>
        <div><span>السنوية</span><strong data-total-frequency="annual">0.00</strong></div><div><span>الدفعات الحرة</span><strong data-total-frequency="free">0.00</strong></div>
        <div><span>إجمالي المخصص</span><strong data-total-frequency="allocated">0.00</strong></div><div><span>غير موزع</span><strong data-total-frequency="undistributed">0.00</strong></div>
        <div><span>حالة الخطة</span><strong data-total-frequency="status">غير مكتملة</strong></div></div>
      <p class="form-error property-form-error" id="property-contract-error" role="alert" hidden></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="property-modal-close">إغلاق</button>
        ${readonly ? '' : `<button class="button button--secondary" type="submit" name="mode" value="draft">حفظ كمسودة</button><button class="button button--primary" type="submit" name="mode" value="approve">حفظ واعتماد العقد</button>`}
      </div>
    </form>
    ${contract?.status === 'approved' ? `<div class="property-commission-summary">طريقة العمولة: ${contract.commissionTreatment === 'deduct' ? 'خصم من مستحقات الوحدة' : contract.commissionTreatment === 'cash' ? 'صرف من الخزينة' : contract.commissionTreatment === 'bank' ? 'صرف من البنك' : 'لا توجد عمولة'} · ${money(contract.brokerCommission)} جنيه</div>` : ''}
  </section></div>`;
}

export function renderPropertyContractsPage(
  contracts: PropertyContract[], projects: Project[], units: PropertyUnit[], customers: Customer[], brokers: PropertyBroker[],
): string {
  const rows = contracts.map((contract) => `<tr data-property-contract data-search="${escapeHtml(`${contract.number} ${contract.customerName} ${contract.unitCode} ${contract.projectName}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(contract.number)}</strong><small>${escapeHtml(contract.contractDate)}</small></td><td>${escapeHtml(contract.customerName)}</td>
    <td>${escapeHtml(contract.projectName)} · ${escapeHtml(contract.unitCode)}</td><td>${money(contract.contractValue)} جنيه</td><td>${money(contract.outstanding)} جنيه</td>
    <td>${contract.status === 'draft' ? 'مسودة' : contract.status === 'approved' ? 'معتمد' : 'ملغي'}</td>
    <td><button class="button button--tiny button--secondary" type="button" data-action="property-contract-edit" data-id="${contract.id}">${contract.status === 'draft' ? 'تعديل' : 'عرض'}</button></td></tr>`).join('');
  return `<section class="project-page property-sales-page" dir="rtl"><div class="project-toolbar"><div><p class="eyebrow">مبيعات الوحدات</p><h1>عقود بيع الوحدات</h1><p class="muted">العقود والاستحقاقات المعتمدة مرتبطة بوحدات ومشاريع وعملاء مسجلين.</p></div>
    <button class="button button--primary" type="button" data-action="property-contract-add">＋ عقد بيع وحدة</button></div>
    <section class="panel project-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input id="property-contract-search" type="search" placeholder="بحث برقم العقد أو العميل أو الوحدة" aria-label="بحث في عقود الوحدات"></label></div>
      <div class="table-scroll"><table class="project-table property-contracts-table"><thead><tr><th>رقم العقد / التاريخ</th><th>العميل</th><th>المشروع / الوحدة</th><th>قيمة العقد</th><th>المتبقي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-state">لا توجد عقود. يلزم إنشاء مشروع ووحدة وعميل أولًا.</td></tr>'}</tbody></table></div></section>
    <div id="property-contract-modal-host"></div><div id="property-broker-modal-host"></div><div id="property-commission-modal-host"></div></section>`;
}

export function renderPropertyBrokerForm(): string {
  return `<div class="modal-backdrop" id="property-broker-modal"><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="property-broker-title">
    <header class="modal-heading"><div><p class="eyebrow">دليل السمسارة</p><h2 id="property-broker-title">إضافة سمسار</h2></div><button class="icon-button" type="button" data-action="property-broker-close">إغلاق</button></header>
    <form class="inventory-form" data-form="property-broker"><label class="field"><span>كود السمسار *</span><input name="code" maxlength="40" required></label>
      <label class="field"><span>اسم السمسار *</span><input name="name" maxlength="180" required></label><label class="field"><span>نسبة العمولة %</span><input name="commissionRate" type="number" min="0" max="100" step="0.01" value="0" required></label>
      <label class="field"><span>الهاتف</span><input name="phone" maxlength="40" inputmode="tel"></label>
      <p class="form-error field--wide" id="property-broker-error" role="alert" hidden></p><div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="property-broker-close">إلغاء</button><button class="button button--primary" type="submit">حفظ السمسار</button></div>
    </form></section></div>`;
}

  export function renderBrokeragePage(brokers: PropertyBroker[], search: string, notice = ''): string {
    const rows = brokers.map((broker) => `<tr data-broker-id="${broker.id}" data-broker-code="${escapeHtml(broker.code)}">
      <td><strong>${escapeHtml(broker.code)}</strong></td><td>${escapeHtml(broker.name)}</td><td>${escapeHtml(broker.phone || '—')}</td>
      <td>${escapeHtml(broker.commissionRate)}%</td><td>${broker.status === 'active' ? 'نشط' : 'موقوف'}</td>
      <td class="brokerage-actions"><button class="button button--tiny button--secondary" type="button" data-action="brokerage-edit" data-id="${broker.id}">تعديل</button>
        <button class="button button--tiny button--secondary" type="button" data-action="brokerage-print" data-id="${broker.id}">طباعة</button>
        <button class="button button--tiny button--danger" type="button" data-action="brokerage-delete" data-id="${broker.id}">حذف</button></td></tr>`).join('');
    return `<section class="project-page property-sales-page brokerage-page" dir="rtl"><div class="project-toolbar"><div><p class="eyebrow">السمسرة · دليل السماسرة</p><h1>بيانات السمسرة</h1><p class="muted">نسبة العمولة هنا تُقترح عند اختيار السمسار في عقد الوحدة، ويمكن تعديلها للعقد.</p></div>
      <button class="button button--primary" type="button" data-action="brokerage-new">＋ جديد</button></div>
      ${notice ? `<p class="brokerage-notice" role="status" aria-live="polite">${escapeHtml(notice)}</p>` : ''}
      <section class="panel project-panel"><form class="table-toolbar brokerage-search" data-form="brokerage-search"><label class="search-field"><span>⌕</span><input name="search" type="search" value="${escapeHtml(search)}" maxlength="180" placeholder="بحث بالكود أو الاسم أو الهاتف" aria-label="بحث في بيانات السمسرة"></label>
        <button class="button button--secondary" type="submit">بحث</button><button class="button button--quiet" type="button" data-action="brokerage-clear-search">إلغاء البحث</button></form>
        <div class="table-scroll"><table class="project-table"><thead><tr><th>كود السمسار</th><th>اسم السمسار</th><th>رقم الهاتف</th><th>نسبة العمولة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty-state">لا توجد بيانات سمسرة مطابقة.</td></tr>'}</tbody></table></div></section>
      <div id="brokerage-editor-host"></div><div id="brokerage-print-host"></div></section>`;
  }

  export function renderBrokerageEditor(broker: PropertyBroker | null): string {
    return `<div class="modal-backdrop" id="brokerage-editor-modal"><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="brokerage-editor-title">
      <header class="modal-heading"><div><p class="eyebrow">دليل السمسرة</p><h2 id="brokerage-editor-title">${broker ? 'تعديل بيانات السمسار' : 'سمسار جديد'}</h2></div><button class="icon-button" type="button" data-action="brokerage-cancel">إغلاق</button></header>
      <form class="inventory-form" data-form="brokerage-broker"><input type="hidden" name="id" value="${broker?.id ?? ''}">
        <label class="field"><span>كود السمسار *</span><input name="code" maxlength="40" required value="${escapeHtml(broker?.code ?? '')}"></label>
        <label class="field"><span>اسم السمسار *</span><input name="name" maxlength="180" required value="${escapeHtml(broker?.name ?? '')}"></label>
        <label class="field"><span>نسبة العمولة % *</span><input name="commissionRate" type="number" min="0" max="100" step="0.01" required value="${escapeHtml(broker?.commissionRate ?? '0')}"></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" maxlength="40" inputmode="tel" value="${escapeHtml(broker?.phone ?? '')}"></label>
        <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!broker || broker.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${broker?.status === 'inactive' ? 'selected' : ''}>موقوف</option></select></label>
        <p class="form-error field--wide" id="brokerage-error" role="alert" hidden></p><div class="form-actions field--wide"><button class="button button--secondary" type="button" data-action="brokerage-cancel">إلغاء</button><button class="button button--primary" type="submit">حفظ</button></div>
      </form></section></div>`;
  }

  export function renderBrokeragePrint(broker: PropertyBroker): string {
    return `<article class="brokerage-print-sheet" dir="rtl"><header><div><p>Elsaad ERP</p><h1>بيانات السمسار</h1></div><p>تاريخ الطباعة: ${escapeHtml(today())}</p></header>
      <dl><dt>كود السمسار</dt><dd>${escapeHtml(broker.code)}</dd><dt>اسم السمسار</dt><dd>${escapeHtml(broker.name)}</dd>
        <dt>رقم الهاتف</dt><dd>${escapeHtml(broker.phone || '—')}</dd><dt>نسبة العمولة</dt><dd>${escapeHtml(broker.commissionRate)}%</dd>
        <dt>الحالة</dt><dd>${broker.status === 'active' ? 'نشط' : 'موقوف'}</dd></dl></article>`;
  }

function installmentLabel(frequency: PropertyInstallmentFrequency): string {
  return { monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي', free: 'دفعة حرة', 'down-payment': 'مقدم' }[frequency];
}

function paymentRows(contract: PropertyContract): string {
  return contract.installments.map((installment) => `<tr data-payment-installment data-id="${installment.id}" data-remaining="${escapeHtml(installment.remaining)}">
    <td><input type="checkbox" name="installmentSelected" value="${installment.id}" aria-label="اختيار ${escapeHtml(installment.description)}" ${Number(installment.remaining) <= 0 ? 'disabled' : ''}></td>
    <td>${escapeHtml(installment.description)}</td><td>${installmentLabel(installment.frequency)}</td><td>${escapeHtml(installment.dueDate)}</td>
    <td>${money(installment.amount)}</td><td>${money(installment.paid)}</td><td>${money(installment.adjusted)}</td><td>${money(installment.remaining)}</td>
    <td>${installment.status === 'paid' ? 'مسدد' : installment.status === 'partial' ? 'مسدد جزئيًا' : 'غير مسدد'}</td>
    <td>${installment.timeStatus === 'overdue' ? 'متأخر' : installment.timeStatus === 'due' ? 'مستحق اليوم' : 'قادم'}</td>
    <td><input name="allocationAmount" type="number" min="0" max="${escapeHtml(installment.remaining)}" step="0.01" value="0" data-allocation-for="${installment.id}" ${Number(installment.remaining) <= 0 ? 'disabled' : ''} aria-label="مبلغ التحصيل المخصص"></td>
  </tr>`).join('');
}

function accountOptions(accounts: AccountItem[]): string {
  return accounts.filter((account) => account.type === 'asset').map((account) => `<option value="${account.id}">${escapeHtml(`${account.code} — ${account.name}`)}</option>`).join('');
}

export function renderPropertyPaymentsPage(
  contracts: PropertyContract[], cashBoxes: CashBox[], banks: BankAccount[], accounts: AccountItem[], search = '', selectedId: number | null = null,
): string {
  const contract = contracts.find((entry) => entry.id === selectedId) ?? null;
  const choices = contracts.map((entry) => `<button class="property-contract-choice ${entry.id === selectedId ? 'is-selected' : ''}" type="button" data-action="property-payment-select" data-id="${entry.id}">
    <strong>${escapeHtml(entry.number)}</strong><span>${escapeHtml(entry.customerName)} · ${escapeHtml(entry.unitCode)}</span><b>${money(entry.outstanding)} جنيه متبقي</b></button>`).join('');
  const nextInstallment = contract?.installments.find((item) => Number(item.remaining) > 0);
  const receiptRows = contract?.receipts.map((receipt) => `<tr data-property-receipt="${receipt.id}"><td>${escapeHtml(receipt.date)}</td><td>${receipt.channel === 'cash' ? 'خزينة' : 'بنك'}</td>
    <td>${escapeHtml(receipt.accountName)}</td><td>${escapeHtml(receipt.reference || '—')}</td><td>${money(receipt.amount)} جنيه</td>
    <td>${escapeHtml(receipt.notes || '—')}</td></tr>`).join('') ?? '';
  return `<section class="project-page property-sales-page" dir="rtl"><div class="project-toolbar"><div><p class="eyebrow">مبيعات الوحدات · التحصيل</p><h1>سداد مبيعات الوحدات</h1><p class="muted">يعرض الاستحقاقات المحفوظة في العقد، ولا ينشئ أقساطًا عند فتح الصفحة.</p></div></div>
    <section class="panel property-payment-search"><form data-form="property-payment-search"><label class="field"><span>بحث بالعقد أو العميل</span><input name="search" type="search" value="${escapeHtml(search)}" placeholder="رقم العقد أو اسم العميل"></label><button class="button button--search" type="submit">بحث</button></form>
      <div class="property-contract-choices">${choices || '<p class="empty-state">لا توجد عقود معتمدة مطابقة للبحث.</p>'}</div></section>
    ${contract ? `<section class="panel property-payment-contract"><header class="panel-heading"><div><p class="eyebrow">${escapeHtml(contract.number)}</p><h2>${escapeHtml(contract.customerName)} · ${escapeHtml(contract.projectName)} · ${escapeHtml(contract.unitCode)}</h2></div></header>
      <div class="property-plan-summary"><div><span>قيمة العقد</span><strong>${money(contract.contractValue)}</strong></div><div><span>المقدم</span><strong>${money(contract.downPayment)}</strong></div>
        <div><span>إجمالي المحصل نقدًا</span><strong>${money(contract.collected)}</strong></div><div><span>المتبقي</span><strong>${money(contract.outstanding)}</strong></div>
        <div><span>القسط القادم</span><strong>${nextInstallment ? money(nextInstallment.remaining) : '—'}</strong></div><div><span>تاريخ الاستحقاق</span><strong>${escapeHtml(nextInstallment?.dueDate ?? '—')}</strong></div></div>
      <section class="property-receipt-history"><header class="panel-heading"><div><p class="eyebrow">سجل الدفعات</p><h3>التحصيلات المسجلة</h3></div><span class="muted">${contract.receipts.length} حركة</span></header>
        <div class="table-scroll"><table class="project-table"><thead><tr><th>التاريخ</th><th>الطريقة</th><th>الحساب</th><th>المرجع</th><th>المبلغ</th><th>ملاحظات</th></tr></thead>
          <tbody>${receiptRows || '<tr><td colspan="6" class="empty-state">لا توجد تحصيلات مسجلة لهذا العقد.</td></tr>'}</tbody></table></div></section>
      <div class="table-scroll"><table class="project-table property-installments-table"><thead><tr><th>تحديد</th><th>البيان</th><th>النوع</th><th>الاستحقاق</th><th>الأصلي</th><th>المدفوع</th><th>التسوية</th><th>المتبقي</th><th>الحالة</th><th>الوقت</th><th>المخصص للتحصيل</th></tr></thead>
        <tbody>${paymentRows(contract) || '<tr><td colspan="11" class="empty-state">لا توجد استحقاقات محفوظة لهذا العقد.</td></tr>'}</tbody></table></div>
      <form class="property-receipt-form" data-form="property-receipt" data-contract-id="${contract.id}"><h3>تسجيل تحصيل</h3>
        <div class="property-contract-grid"><label class="field"><span>تاريخ التحصيل</span><input name="date" type="date" required value="${today()}"></label>
          <label class="field"><span>طريقة التحصيل</span><select name="channel"><option value="cash">الخزينة</option><option value="bank">البنك</option></select></label>
          <label class="field"><span>الخزينة</span><select name="cashBoxId"><option value="">اختر خزينة</option>${cashBoxes.filter((box) => box.status === 'active').map((box) => `<option value="${box.id}">${escapeHtml(`${box.code} — ${box.name} (${box.currency})`)}</option>`).join('')}</select></label>
          <label class="field" hidden><span>البنك</span><select name="bankAccountId"><option value="">اختر بنكًا</option>${banks.filter((bank) => bank.status === 'active').map((bank) => `<option value="${bank.id}">${escapeHtml(`${bank.code} — ${bank.name} (${bank.currency})`)}</option>`).join('')}</select></label>
          <label class="field"><span>حساب الذمم المدينة *</span><select name="receivableAccountId" required><option value="">اختر حساب أصول للذمم</option>${accountOptions(accounts)}</select></label>
          <label class="field"><span>المرجع</span><input name="reference" maxlength="100" placeholder="رقم سند القبض"></label>
          <label class="field"><span>إجمالي التحصيل المحدد</span><input name="receiptTotal" value="0.00" readonly></label></div>
        <label class="field"><span>ملاحظات</span><textarea name="notes" maxlength="2000" rows="2"></textarea></label>
        <p class="form-error" id="property-receipt-error" role="alert" hidden></p><div class="form-actions"><button class="button button--primary" type="submit">تسجيل التحصيل وتوزيعه</button></div>
      </form></section>` : ''}
    </section>`;
}

export function renderPropertyCommissionDialog(
  commission: string, brokerName: string, cashBoxes: CashBox[], banks: BankAccount[], accounts: AccountItem[],
): string {
  const expenseOptions = accounts.filter((account) => account.type === 'expense').map((account) => `<option value="${account.id}">${escapeHtml(`${account.code} — ${account.name}`)}</option>`).join('');
  return `<div class="modal-backdrop" id="property-commission-modal"><section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="property-commission-title">
    <header class="modal-heading"><div><p class="eyebrow">تأكيد مالي قبل الاعتماد</p><h2 id="property-commission-title">معالجة عمولة السمسار</h2></div><button class="icon-button" type="button" data-action="property-commission-cancel">إلغاء</button></header>
    <form data-form="property-commission"><p><strong>${escapeHtml(brokerName)}</strong> · عمولة <strong>${money(commission)} جنيه</strong></p>
      <fieldset class="property-treatment-options"><legend>اختر طريقة واحدة</legend>
        <label><input type="radio" name="treatment" value="deduct" required><span>خصم العمولة من مستحقات ثمن الوحدة</span></label>
        <label><input type="radio" name="treatment" value="cash"><span>صرف العمولة من الخزينة</span></label>
        <label><input type="radio" name="treatment" value="bank"><span>صرف العمولة من البنك</span></label>
      </fieldset>
      <label class="field"><span>الخزينة</span><select name="cashBoxId"><option value="">اختر خزينة</option>${cashBoxes.filter((box) => box.status === 'active').map((box) => `<option value="${box.id}">${escapeHtml(`${box.code} — ${box.name} (${box.currency})`)}</option>`).join('')}</select></label>
      <label class="field"><span>البنك</span><select name="bankAccountId"><option value="">اختر بنكًا</option>${banks.filter((bank) => bank.status === 'active').map((bank) => `<option value="${bank.id}">${escapeHtml(`${bank.code} — ${bank.name} (${bank.currency})`)}</option>`).join('')}</select></label>
      <label class="field"><span>حساب مصروف العمولة</span><select name="expenseAccountId"><option value="">اختر حساب مصروف</option>${expenseOptions}</select></label>
      <p class="property-commission-warning">سيتم اعتماد العقد مع الخيار المحدد. عند الإلغاء لن يُعتمد العقد ولن تُسجّل حركة مالية.</p>
      <p class="form-error" id="property-commission-error" role="alert" hidden></p><div class="form-actions"><button class="button button--secondary" type="button" data-action="property-commission-cancel">إلغاء</button><button class="button button--primary" type="submit">تأكيد واعتماد</button></div>
    </form></section></div>`;
}

export function propertyFrequencyLabel(frequency: PropertyInstallmentFrequency): string {
  return installmentLabel(frequency);
}

export function previewPropertySchedule(frequency: Exclude<PropertyInstallmentFrequency, 'free' | 'down-payment'>, amount: string, count: number, firstDate: string): string {
  const rows = generateInstallments({ frequency, amount, count, firstDueDate: firstDate });
  return rows.map((row) => `<tr><td>${row.sequence}</td><td>${escapeHtml(row.dueDate)}</td><td>${money(row.amount)}</td></tr>`).join('');
}