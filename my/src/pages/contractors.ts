import type {
  Contractor,
  ContractorCertificate,
  ContractorCertificateLineInput,
  ContractorContract,
  ContractorContractLineInput,
  ContractorInput,
  ContractorStatus,
  ContractorVoucher,
  Project,
} from '../shared/types.js';
import { formatAmount, parseAmount } from '../shared/accounting.js';
import { escapeHtml } from '../utils/html.js';

function number(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  try {
    const formatted = formatAmount(parseAmount(normalized));
    const [whole, fraction = ''] = formatted.split('.');
    const grouped = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(BigInt(whole));
    return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return value;
  }
}

function today(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function renderContractorOpeningEntry(entry?: Contractor['openingEntries'][number]): string {
  return `<tr data-contractor-opening-row>
    <td><input name="openingDate" type="date" required value="${escapeHtml(entry?.date ?? today())}" aria-label="تاريخ الحركة"></td>
    <td><input name="openingDebit" type="number" min="0" step="0.01" value="${escapeHtml(entry?.debit ?? '')}" aria-label="مدين"></td>
    <td><input name="openingCredit" type="number" min="0" step="0.01" value="${escapeHtml(entry?.credit ?? '')}" aria-label="دائن"></td>
    <td><input name="openingEquivalent" readonly value="${escapeHtml(entry?.baseEquivalent ?? '0')}" aria-label="المعادل بالعملة الأساسية"></td>
    <td><select name="openingStatus" aria-label="حالة الحركة"><option value="active" ${!entry || entry.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${entry?.status === 'inactive' ? 'selected' : ''}>معطل</option></select></td>
    <td><button class="button button--tiny button--danger" type="button" data-action="contractor-opening-remove" aria-label="حذف حركة الرصيد">حذف</button></td>
  </tr>`;
}

export function renderContractorsPage(contractors: Contractor[]): string {
  const rows = contractors.map((contractor) => `<tr data-contractor-row data-search="${escapeHtml(`${contractor.code} ${contractor.name} ${contractor.phone} ${contractor.specialty}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(contractor.code)}</strong></td><td>${escapeHtml(contractor.name)}</td><td dir="ltr">${escapeHtml(contractor.phone || '—')}</td>
    <td>${escapeHtml(contractor.specialty || '—')}</td><td>${escapeHtml(contractor.governorate || '—')}</td>
    <td>${number(contractor.totalDebit)}</td><td>${number(contractor.totalCredit)}</td><td><strong>${number(contractor.netBalance)}</strong></td>
    <td><span class="contractor-status contractor-status--${contractor.status}">${contractor.status === 'active' ? 'نشط' : 'معطل'}</span></td>
    <td class="contractor-row-actions"><button class="button button--tiny button--secondary" type="button" data-action="contractor-edit" data-id="${contractor.id}">فتح / تعديل</button>
      <button class="button button--tiny button--secondary" type="button" data-action="contractor-open-contracts" data-id="${contractor.id}">العقود</button>
      <button class="button button--tiny ${contractor.status === 'active' ? 'button--danger' : 'button--primary'}" type="button" data-action="contractor-status" data-id="${contractor.id}" data-status="${contractor.status === 'active' ? 'inactive' : 'active'}">${contractor.status === 'active' ? 'تعطيل' : 'تفعيل'}</button></td>
  </tr>`).join('');
  const debit = contractors.reduce((sum, contractor) => sum + parseAmount(contractor.totalDebit), 0n);
  const credit = contractors.reduce((sum, contractor) => sum + parseAmount(contractor.totalCredit), 0n);
  return `<section class="contractor-page" dir="rtl"><div class="contractor-heading"><div><p class="eyebrow">المقاولون · دليل المقاولين</p><h1>المقاولون</h1><p class="muted">بيانات تعريفية وأرصدة افتتاحية مستقلة عن حركات الخزينة والبنك.</p></div>
    <div class="contractor-toolbar"><button class="button button--primary" type="button" data-action="contractor-new">＋ جديد</button>
      <button class="button button--secondary" type="button" data-action="contractor-search-focus">بحث</button>
      <button class="button button--secondary" type="button" data-action="contractor-contracts-page">عقود المقاولين</button>
      <button class="button button--secondary" type="button" data-action="contractor-refresh">تحديث</button>
      <button class="button button--quiet" type="button" data-action="contractor-exit">خروج</button></div></div>
    <section class="panel contractor-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="contractor-search" placeholder="بحث بالكود أو الاسم أو الهاتف أو التخصص" aria-label="بحث عن مقاول"></label><span class="muted">${contractors.length} مقاول</span></div>
      <div class="table-scroll"><table class="contractor-table"><thead><tr><th>الكود</th><th>اسم المقاول</th><th>الهاتف</th><th>التخصص</th><th>المحافظة</th><th>إجمالي المدين</th><th>إجمالي الدائن</th><th>صافي الرصيد</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10" class="empty-state">لا يوجد مقاولون مسجلون. أضف مقاولًا للبدء.</td></tr>'}</tbody>
        <tfoot><tr><th colspan="5">إجمالي المقاولين المعروضين</th><th>${number(formatAmount(debit))}</th><th>${number(formatAmount(credit))}</th><th>${number(`${debit >= credit ? '' : '-'}${formatAmount(debit >= credit ? debit - credit : credit - debit)}`)}</th><th colspan="2"></th></tr></tfoot></table></div></section>
    <div id="contractor-editor-host"></div></section>`;
}

export function renderContractorEditor(contractor: Contractor | null): string {
  const entries = contractor?.openingEntries.map((entry) => renderContractorOpeningEntry(entry)).join('') ?? '';
  return `<div class="modal-backdrop" id="contractor-editor-modal"><section class="record-modal contractor-editor" role="dialog" aria-modal="true" aria-labelledby="contractor-editor-title">
    <header class="modal-heading"><div><p class="eyebrow">ملف المقاول</p><h2 id="contractor-editor-title">${contractor ? 'تعديل بيانات المقاول' : 'مقاول جديد'}</h2></div><button class="icon-button" type="button" data-action="contractor-cancel">إغلاق</button></header>
    <form data-form="contractor"><input type="hidden" name="id" value="${contractor?.id ?? ''}">
      <div class="contractor-fields">
        <label class="field"><span>كود المقاول</span><input name="code" maxlength="40" value="${escapeHtml(contractor?.code ?? '')}" placeholder="يولد تلقائيًا عند الحفظ" ${contractor ? '' : 'readonly'}></label>
        <label class="field"><span>اسم المقاول <b>*</b></span><input name="name" maxlength="180" required value="${escapeHtml(contractor?.name ?? '')}" autofocus></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" type="tel" maxlength="40" inputmode="tel" value="${escapeHtml(contractor?.phone ?? '')}"></label>
        <label class="field"><span>التخصص</span><input name="specialty" maxlength="120" value="${escapeHtml(contractor?.specialty ?? '')}"></label>
        <label class="field"><span>الدولة</span><input name="country" maxlength="100" value="${escapeHtml(contractor?.country ?? '')}"></label>
        <label class="field"><span>المحافظة</span><input name="governorate" maxlength="100" value="${escapeHtml(contractor?.governorate ?? '')}"></label>
        <label class="field field--wide"><span>العنوان</span><input name="address" maxlength="500" value="${escapeHtml(contractor?.address ?? '')}"></label>
        <label class="field"><span>الحالة</span><select name="status"><option value="active" ${!contractor || contractor.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${contractor?.status === 'inactive' ? 'selected' : ''}>معطل</option></select></label>
      </div>
      <div class="contractor-opening-heading"><div><h3>الأرصدة الافتتاحية</h3><p>المبالغ مدخلة بالعملة الأساسية، ولا تنشئ حركة خزينة أو قيدًا محاسبيًا.</p></div><button class="button button--secondary" type="button" data-action="contractor-opening-add">＋ إضافة حركة</button></div>
      <div class="table-scroll"><table class="contractor-opening-table"><thead><tr><th>التاريخ</th><th>مدين</th><th>دائن</th><th>المعادل بالعملة الأساسية</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="contractor-opening-entries">${entries || '<tr data-empty-opening><td colspan="6" class="empty-state">لا توجد أرصدة افتتاحية.</td></tr>'}</tbody></table></div>
      <div class="contractor-balance-summary"><div><span>إجمالي المدين</span><strong data-opening-total="debit">0.00</strong></div><div><span>إجمالي الدائن</span><strong data-opening-total="credit">0.00</strong></div><div><span>صافي الرصيد</span><strong data-opening-total="net">0.00</strong></div></div>
      <p class="form-error contractor-form-error" id="contractor-error" role="alert" hidden></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="contractor-cancel">إلغاء</button><button class="button button--primary" type="submit">حفظ المقاول</button></div>
    </form></section></div>`;
}

export function renderContractorContractLine(line?: ContractorContractLineInput & { total?: string }, index = 0, readonly = false): string {
  const disabled = readonly ? 'disabled' : '';
  return `<tr data-contractor-contract-line><td><input name="lineCode" maxlength="60" required value="${escapeHtml(line?.code ?? '')}" aria-label="كود البند ${index + 1}" ${disabled}></td>
    <td><input name="lineName" maxlength="240" required value="${escapeHtml(line?.name ?? '')}" aria-label="اسم البند ${index + 1}" ${disabled}></td>
    <td><input name="lineType" maxlength="100" required value="${escapeHtml(line?.itemType ?? '')}" aria-label="نوع البند ${index + 1}" ${disabled}></td>
    <td><input name="lineUnit" maxlength="60" required value="${escapeHtml(line?.unit ?? '')}" aria-label="الوحدة ${index + 1}" ${disabled}></td>
    <td><input name="lineQuantity" type="number" min="0.000000000001" step="0.000000000001" required value="${escapeHtml(line?.quantity ?? '')}" aria-label="الكمية ${index + 1}" ${disabled}></td>
    <td><input name="lineUnitPrice" type="number" min="0" step="0.01" required value="${escapeHtml(line?.unitPrice ?? '')}" aria-label="سعر الوحدة ${index + 1}" ${disabled}></td>
    <td data-contractor-line-total>${number(line?.total ?? '0')}</td>
    <td>${readonly ? '' : `<button class="button button--tiny button--danger" type="button" data-action="contractor-line-remove" aria-label="حذف البند ${index + 1}">حذف</button>`}</td>
  </tr>`;
}

export function renderContractorContractsPage(contracts: ContractorContract[], contractors: Contractor[], projects: Project[]): string {
  const rows = contracts.map((contract) => `<tr data-contractor-contract-row data-search="${escapeHtml(`${contract.number} ${contract.contractorName} ${contract.projectName}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(contract.number)}</strong></td><td>${escapeHtml(contract.date)}</td><td>${escapeHtml(contract.contractorCode)} — ${escapeHtml(contract.contractorName)}</td>
    <td>${escapeHtml(contract.projectName || 'غير مرتبط بمشروع')}</td><td>${number(contract.total)}</td>
    <td><span class="contractor-status contractor-status--${contract.status}">${contract.status === 'draft' ? 'مسودة' : contract.status === 'approved' ? 'معتمد' : 'ملغي'}</span></td>
    <td><button class="button button--tiny button--secondary" type="button" data-action="contractor-contract-edit" data-id="${contract.id}">${contract.status === 'draft' ? 'تعديل' : 'عرض'}</button>
      ${contract.status === 'draft' ? `<button class="button button--tiny button--danger" type="button" data-action="contractor-contract-delete" data-id="${contract.id}">حذف المسودة</button>` : ''}</td>
  </tr>`).join('');
  return `<section class="contractor-page" dir="rtl"><div class="contractor-heading"><div><p class="eyebrow">المقاولون · التعاقدات</p><h1>عقود المقاولين / المقايسات</h1><p class="muted">عقود مرتبطة بالمقاولين والمشاريع وبنودها محفوظة تفصيليًا.</p></div>
    <div class="contractor-toolbar"><button class="button button--primary" type="button" data-action="contractor-contract-new">＋ عقد جديد</button>
      <button class="button button--secondary" type="button" data-action="contractor-contract-search-focus">بحث</button>
      <button class="button button--secondary" type="button" data-action="contractor-list-page">المقاولون</button><button class="button button--secondary" type="button" data-action="contractor-contract-refresh">تحديث</button>
      <button class="button button--quiet" type="button" data-action="contractor-exit">خروج</button></div></div>
    <section class="panel contractor-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="contractor-contract-search" placeholder="بحث برقم العقد أو المقاول أو المشروع" aria-label="بحث في عقود المقاولين"></label><span class="muted">${contracts.length} عقد</span></div>
      <div class="table-scroll"><table class="contractor-contract-table"><thead><tr><th>رقم العقد</th><th>التاريخ</th><th>المقاول</th><th>المشروع</th><th>الإجمالي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty-state">لا توجد عقود مقاولين مسجلة.</td></tr>'}</tbody></table></div></section>
    <div id="contractor-contract-editor-host" data-project-count="${projects.length}" data-contractor-count="${contractors.length}"></div></section>`;
}

export function renderContractorContractEditor(
  contract: ContractorContract | null,
  contractors: Contractor[],
  projects: Project[],
  preferredContractorId: number | null,
): string {
  const readonly = contract?.status !== undefined && contract.status !== 'draft';
  const availableContractors = contractors.filter((contractor) => contractor.status === 'active' || contractor.id === contract?.contractorId);
  const rows = contract?.lines.map((line, index) => renderContractorContractLine(line, index, readonly)).join('') ?? renderContractorContractLine();
  return `<div class="modal-backdrop" id="contractor-contract-editor-modal"><section class="record-modal contractor-contract-editor" role="dialog" aria-modal="true" aria-labelledby="contractor-contract-editor-title">
    <header class="modal-heading"><div><p class="eyebrow">عقود المقاولين / المقايسات</p><h2 id="contractor-contract-editor-title">${contract ? `${readonly ? 'عرض' : 'تعديل'} ${escapeHtml(contract.number)}` : 'عقد مقاول جديد'}</h2></div><button class="icon-button" type="button" data-action="contractor-contract-cancel">إغلاق</button></header>
    <form data-form="contractor-contract" data-readonly="${readonly}"><input type="hidden" name="id" value="${contract?.id ?? ''}">
      <div class="contractor-contract-fields">
        <label class="field"><span>رقم العقد</span><input readonly value="${escapeHtml(contract?.number ?? 'ينشأ تلقائيًا عند الحفظ')}"></label>
        <label class="field"><span>تاريخ العقد <b>*</b></span><input name="date" type="date" required value="${escapeHtml(contract?.date ?? today())}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>المقاول <b>*</b></span><select name="contractorId" required ${readonly ? 'disabled' : ''}><option value="">اختر المقاول</option>${availableContractors.map((contractor) => `<option value="${contractor.id}" ${contractor.id === (contract?.contractorId ?? preferredContractorId) ? 'selected' : ''}>${escapeHtml(`${contractor.code} — ${contractor.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>المشروع</span><select name="projectId" ${readonly ? 'disabled' : ''}><option value="">غير مرتبط بمشروع</option>${projects.filter((project) => project.status !== 'cancelled').map((project) => `<option value="${project.id}" ${project.id === contract?.projectId ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('')}</select></label>
        <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="4000" ${readonly ? 'disabled' : ''}>${escapeHtml(contract?.notes ?? '')}</textarea></label>
      </div>
      <div class="contractor-lines-heading"><div><h3>بنود العقد</h3><span>تُحسب قيمة البند والإجمالي تلقائيًا</span></div><div>${readonly ? '' : '<button class="button button--secondary" type="button" data-action="contractor-line-add">＋ إضافة بند</button>'}<button class="button button--quiet" type="button" data-action="contractor-lines-toggle" aria-expanded="true">طي البنود</button></div></div>
      <div class="table-scroll" id="contractor-lines-scroll"><table class="contractor-contract-lines"><thead><tr><th>كود البند</th><th>اسم البند</th><th>نوع البند</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody id="contractor-contract-lines">${rows}</tbody><tfoot><tr><th colspan="6">إجمالي العقد</th><th id="contractor-contract-total">${number(contract?.total ?? '0')}</th><th></th></tr></tfoot></table></div>
      <p class="form-error contractor-form-error" id="contractor-contract-error" role="alert" hidden></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="contractor-contract-cancel">إلغاء</button>
        ${readonly ? '' : '<button class="button button--secondary" type="submit" name="mode" value="draft">حفظ كمسودة</button><button class="button button--primary" type="submit" name="mode" value="approve">حفظ واعتماد</button>'}</div>
    </form></section></div>`;
}

export function renderContractorCertificateLine(line?: ContractorCertificateLineInput & { total?: string }, index = 0, readonly = false): string {
  const disabled = readonly ? 'disabled' : '';
  return `<tr data-contractor-certificate-line>
    <td><input name="lineCode" maxlength="60" required value="${escapeHtml(line?.code ?? '')}" aria-label="كود البند ${index + 1}" ${disabled}></td>
    <td><input name="lineName" maxlength="240" required value="${escapeHtml(line?.name ?? '')}" aria-label="اسم البند ${index + 1}" ${disabled}></td>
    <td><input name="lineUnit" maxlength="60" required value="${escapeHtml(line?.unit ?? '')}" aria-label="الوحدة ${index + 1}" ${disabled}></td>
    <td><input name="linePrevQty" type="number" min="0" step="0.000000000001" value="${escapeHtml(line?.previousQuantity ?? '0')}" aria-label="الكمية السابقة ${index + 1}" ${disabled}></td>
    <td><input name="lineCurrentQty" type="number" min="0" step="0.000000000001" required value="${escapeHtml(line?.currentQuantity ?? '')}" aria-label="الكمية الحالية ${index + 1}" ${disabled}></td>
    <td><input name="lineContractQty" type="number" min="0" step="0.000000000001" value="${escapeHtml(line?.contractQuantity ?? '0')}" aria-label="الكمية المتعاقد عليها ${index + 1}" ${disabled}></td>
    <td><input name="lineCompletionRate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(line?.completionRate ?? '0')}" aria-label="نسبة الإنجاز ${index + 1}" ${disabled}></td>
    <td><input name="lineUnitPrice" type="number" min="0" step="0.01" required value="${escapeHtml(line?.unitPrice ?? '')}" aria-label="سعر الوحدة ${index + 1}" ${disabled}></td>
    <td><input name="lineDiscount" type="number" min="0" step="0.01" value="${escapeHtml(line?.discount ?? '0')}" aria-label="الخصم ${index + 1}" ${disabled}></td>
    <td data-contractor-certificate-line-total>${number(line?.total ?? '0')}</td>
    <td>${readonly ? '' : `<button class="button button--tiny button--danger" type="button" data-action="contractor-certificate-line-remove" aria-label="حذف البند ${index + 1}">حذف</button>`}</td>
  </tr>`;
}

export function renderContractorCertificatesPage(certificates: ContractorCertificate[], contractors: Contractor[], projects: Project[]): string {
  const rows = certificates.map((certificate) => `<tr data-contractor-certificate-row data-search="${escapeHtml(`${certificate.number} ${certificate.contractorName} ${certificate.projectName}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(certificate.number)}</strong></td><td>${escapeHtml(certificate.date)}</td>
    <td>${escapeHtml(certificate.contractorCode)} — ${escapeHtml(certificate.contractorName)}</td>
    <td>${escapeHtml(certificate.projectName || 'غير مرتبط بمشروع')}</td>
    <td>${escapeHtml(certificate.contractNumber || '—')}</td>
    <td>${number(certificate.total)}</td>
    <td><span class="contractor-status contractor-status--${certificate.status}">${certificate.status === 'draft' ? 'مسودة' : certificate.status === 'approved' ? 'معتمد' : 'ملغي'}</span></td>
    <td><button class="button button--tiny button--secondary" type="button" data-action="contractor-certificate-edit" data-id="${certificate.id}">${certificate.status === 'draft' ? 'تعديل' : 'عرض'}</button>
      ${certificate.status === 'draft' ? `<button class="button button--tiny button--danger" type="button" data-action="contractor-certificate-delete" data-id="${certificate.id}">حذف المسودة</button>` : ''}</td>
  </tr>`).join('');
  return `<section class="contractor-page" dir="rtl"><div class="contractor-heading"><div><p class="eyebrow">المقاولون · المستخلصات</p><h1>مستخلصات المقاولين</h1><p class="muted">مستخلصات قياس تقدم الأعمال مع ربط بالمقاول والمشروع والعقد.</p></div>
    <div class="contractor-toolbar"><button class="button button--primary" type="button" data-action="contractor-certificate-new">＋ مستخلص جديد</button>
      <button class="button button--secondary" type="button" data-action="contractor-certificate-search-focus">بحث</button>
      <button class="button button--secondary" type="button" data-action="contractor-list-page">المقاولون</button>
      <button class="button button--secondary" type="button" data-action="contractor-certificate-refresh">تحديث</button>
      <button class="button button--quiet" type="button" data-action="contractor-exit">خروج</button></div></div>
    <section class="panel contractor-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="contractor-certificate-search" placeholder="بحث برقم المستخلص أو المقاول أو المشروع" aria-label="بحث في مستخلصات المقاولين"></label><span class="muted">${certificates.length} مستخلص</span></div>
      <div class="table-scroll"><table class="contractor-table"><thead><tr><th>رقم المستخلص</th><th>التاريخ</th><th>المقاول</th><th>المشروع</th><th>العقد</th><th>الإجمالي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">لا توجد مستخلصات مقاولين مسجلة.</td></tr>'}</tbody></table></div></section>
    <div id="contractor-certificate-editor-host" data-contractor-count="${contractors.length}" data-project-count="${projects.length}"></div></section>`;
}

export function renderContractorCertificateEditor(
  certificate: ContractorCertificate | null,
  contractors: Contractor[],
  projects: Project[],
  contracts: ContractorContract[],
  preferredContractorId: number | null,
): string {
  const readonly = certificate?.status !== undefined && certificate.status !== 'draft';
  const availableContractors = contractors.filter((contractor) => contractor.status === 'active' || contractor.id === certificate?.contractorId);
  const availableContracts = contracts.filter((contract) => contract.contractorId === (certificate?.contractorId ?? preferredContractorId ?? 0) || contract.id === certificate?.contractId);
  const rows = certificate?.lines?.map((line, index) => renderContractorCertificateLine(line, index, readonly)).join('') ?? renderContractorCertificateLine(undefined, 0, readonly);
  return `<div class="modal-backdrop" id="contractor-certificate-editor-modal"><section class="record-modal contractor-certificate-editor" role="dialog" aria-modal="true" aria-labelledby="contractor-certificate-editor-title">
    <header class="modal-heading"><div><p class="eyebrow">مستخلصات المقاولين</p><h2 id="contractor-certificate-editor-title">${certificate ? `${readonly ? 'عرض' : 'تعديل'} ${escapeHtml(certificate.number)}` : 'مستخلص مقاول جديد'}</h2></div><button class="icon-button" type="button" data-action="contractor-certificate-cancel">إغلاق</button></header>
    <form data-form="contractor-certificate" data-readonly="${readonly}"><input type="hidden" name="id" value="${certificate?.id ?? ''}">
      <div class="contractor-contract-fields">
        <label class="field"><span>رقم المستخلص</span><input readonly value="${escapeHtml(certificate?.number ?? 'ينشأ تلقائيًا عند الحفظ')}"></label>
        <label class="field"><span>تاريخ المستخلص <b>*</b></span><input name="date" type="date" required value="${escapeHtml(certificate?.date ?? today())}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>المقاول <b>*</b></span><select name="contractorId" required ${readonly ? 'disabled' : ''}><option value="">اختر المقاول</option>${availableContractors.map((contractor) => `<option value="${contractor.id}" ${contractor.id === (certificate?.contractorId ?? preferredContractorId) ? 'selected' : ''}>${escapeHtml(`${contractor.code} — ${contractor.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>المشروع</span><select name="projectId" ${readonly ? 'disabled' : ''}><option value="">غير مرتبط بمشروع</option>${projects.filter((project) => project.status !== 'cancelled').map((project) => `<option value="${project.id}" ${project.id === certificate?.projectId ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>العقد</span><select name="contractId" ${readonly ? 'disabled' : ''}><option value="">لا يوجد عقد</option>${availableContracts.map((contract) => `<option value="${contract.id}" ${contract.id === certificate?.contractId ? 'selected' : ''}>${escapeHtml(`${contract.number} — ${contract.contractorName}`)}</option>`).join('')}</select></label>
        <label class="field"><span>مركز التكلفة</span><input name="costCenter" maxlength="200" value="${escapeHtml(certificate?.costCenter ?? '')}" ${readonly ? 'disabled' : ''}></label>
        <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="4000" ${readonly ? 'disabled' : ''}>${escapeHtml(certificate?.notes ?? '')}</textarea></label>
      </div>
      <div class="contractor-lines-heading"><div><h3>بنود المستخلص</h3><span>يتم احتساب الإجمالي تلقائيًا حسب الكمية والسعر والخصم</span></div><div>${readonly ? '' : '<button class="button button--secondary" type="button" data-action="contractor-certificate-line-add">＋ إضافة بند</button>'}</div></div>
      <div class="table-scroll"><table class="contractor-contract-lines"><thead><tr><th>كود البند</th><th>اسم البند</th><th>الوحدة</th><th>كمية سابقة</th><th>كمية حالية</th><th>كمية بالعقد</th><th>نسبة الإنجاز</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody id="contractor-certificate-lines">${rows}</tbody><tfoot><tr><th colspan="9">إجمالي المستخلص</th><th id="contractor-certificate-total">${number(certificate?.total ?? '0')}</th><th></th></tr></tfoot></table></div>
      <p class="form-error contractor-form-error" id="contractor-certificate-error" role="alert" hidden></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="contractor-certificate-cancel">إلغاء</button>
        ${readonly ? '' : '<button class="button button--secondary" type="submit" name="mode" value="draft">حفظ كمسودة</button><button class="button button--primary" type="submit" name="mode" value="approve">حفظ واعتماد</button>'}</div>
    </form></section></div>`;
}

export function renderContractorVouchersPage(vouchers: ContractorVoucher[], contractors: Contractor[], projects: Project[]): string {
  const rows = vouchers.map((voucher) => `<tr data-contractor-voucher-row data-search="${escapeHtml(`${voucher.number} ${voucher.contractorName} ${voucher.projectName} ${voucher.referenceNo}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(voucher.number)}</strong></td><td>${escapeHtml(voucher.date)}</td>
    <td>${escapeHtml(voucher.contractorCode)} — ${escapeHtml(voucher.contractorName)}</td>
    <td>${escapeHtml(voucher.projectName || 'غير مرتبط بمشروع')}</td>
    <td>${voucher.paymentMethod === 'cash' ? 'نقدي' : 'بنكي'}</td>
    <td>${number(voucher.amount)}</td>
    <td><span class="contractor-status contractor-status--${voucher.status}">${voucher.status === 'draft' ? 'مسودة' : voucher.status === 'approved' ? 'معتمد' : 'ملغي'}</span></td>
    <td><button class="button button--tiny button--secondary" type="button" data-action="contractor-voucher-edit" data-id="${voucher.id}">${voucher.status === 'draft' ? 'تعديل' : 'عرض'}</button>
      ${voucher.status === 'draft' ? `<button class="button button--tiny button--danger" type="button" data-action="contractor-voucher-delete" data-id="${voucher.id}">حذف المسودة</button>` : ''}</td>
  </tr>`).join('');
  return `<section class="contractor-page" dir="rtl"><div class="contractor-heading"><div><p class="eyebrow">المقاولون · السندات</p><h1>سندات المقاولين</h1><p class="muted">إصدار سند صرف/تحويل للمقاول مع ربط بوسيلة الدفع ومركز التكلفة.</p></div>
    <div class="contractor-toolbar"><button class="button button--primary" type="button" data-action="contractor-voucher-new">＋ سند جديد</button>
      <button class="button button--secondary" type="button" data-action="contractor-voucher-search-focus">بحث</button>
      <button class="button button--secondary" type="button" data-action="contractor-list-page">المقاولون</button>
      <button class="button button--secondary" type="button" data-action="contractor-voucher-refresh">تحديث</button>
      <button class="button button--quiet" type="button" data-action="contractor-exit">خروج</button></div></div>
    <section class="panel contractor-panel"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input type="search" id="contractor-voucher-search" placeholder="بحث برقم السند أو المقاول أو المرجع" aria-label="بحث في سندات المقاولين"></label><span class="muted">${vouchers.length} سند</span></div>
      <div class="table-scroll"><table class="contractor-table"><thead><tr><th>رقم السند</th><th>التاريخ</th><th>المقاول</th><th>المشروع</th><th>طريقة الدفع</th><th>المبلغ</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">لا توجد سندات مقاولين مسجلة.</td></tr>'}</tbody></table></div></section>
    <div id="contractor-voucher-editor-host" data-contractor-count="${contractors.length}" data-project-count="${projects.length}"></div></section>`;
}

export function renderContractorVoucherEditor(voucher: ContractorVoucher | null, contractors: Contractor[], projects: Project[], preferredContractorId: number | null): string {
  const readonly = voucher?.status !== undefined && voucher.status !== 'draft';
  const availableContractors = contractors.filter((contractor) => contractor.status === 'active' || contractor.id === voucher?.contractorId);
  return `<div class="modal-backdrop" id="contractor-voucher-editor-modal"><section class="record-modal contractor-voucher-editor" role="dialog" aria-modal="true" aria-labelledby="contractor-voucher-editor-title">
    <header class="modal-heading"><div><p class="eyebrow">سندات المقاولين</p><h2 id="contractor-voucher-editor-title">${voucher ? `${readonly ? 'عرض' : 'تعديل'} ${escapeHtml(voucher.number)}` : 'سند مقاول جديد'}</h2></div><button class="icon-button" type="button" data-action="contractor-voucher-cancel">إغلاق</button></header>
    <form data-form="contractor-voucher" data-readonly="${readonly}"><input type="hidden" name="id" value="${voucher?.id ?? ''}">
      <div class="contractor-contract-fields">
        <label class="field"><span>رقم السند</span><input readonly value="${escapeHtml(voucher?.number ?? 'ينشأ تلقائيًا عند الحفظ')}"></label>
        <label class="field"><span>تاريخ السند <b>*</b></span><input name="date" type="date" required value="${escapeHtml(voucher?.date ?? today())}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>المقاول <b>*</b></span><select name="contractorId" required ${readonly ? 'disabled' : ''}><option value="">اختر المقاول</option>${availableContractors.map((contractor) => `<option value="${contractor.id}" ${contractor.id === (voucher?.contractorId ?? preferredContractorId) ? 'selected' : ''}>${escapeHtml(`${contractor.code} — ${contractor.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>المشروع</span><select name="projectId" ${readonly ? 'disabled' : ''}><option value="">غير مرتبط بمشروع</option>${projects.filter((project) => project.status !== 'cancelled').map((project) => `<option value="${project.id}" ${project.id === voucher?.projectId ? 'selected' : ''}>${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>طريقة الدفع</span><select name="paymentMethod" ${readonly ? 'disabled' : ''}><option value="cash" ${voucher?.paymentMethod === 'cash' || !voucher ? 'selected' : ''}>نقدي</option><option value="bank" ${voucher?.paymentMethod === 'bank' ? 'selected' : ''}>بنكي</option></select></label>
        <label class="field"><span>رقم المرجع</span><input name="referenceNo" maxlength="120" value="${escapeHtml(voucher?.referenceNo ?? '')}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>مركز التكلفة</span><input name="costCenter" maxlength="200" value="${escapeHtml(voucher?.costCenter ?? '')}" ${readonly ? 'disabled' : ''}></label>
        <label class="field"><span>المبلغ <b>*</b></span><input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(voucher?.amount ?? '0')}" ${readonly ? 'disabled' : ''}></label>
        <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="4000" ${readonly ? 'disabled' : ''}>${escapeHtml(voucher?.notes ?? '')}</textarea></label>
      </div>
      <p class="form-error contractor-form-error" id="contractor-voucher-error" role="alert" hidden></p>
      <div class="form-actions"><button class="button button--secondary" type="button" data-action="contractor-voucher-cancel">إلغاء</button>
        ${readonly ? '' : '<button class="button button--secondary" type="submit" name="mode" value="draft">حفظ كمسودة</button><button class="button button--primary" type="submit" name="mode" value="approve">حفظ واعتماد</button>'}</div>
    </form></section></div>`;
}