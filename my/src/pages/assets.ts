import { formatAmount, parseAmount } from '../shared/accounting.js';
import type { AccountItem, Asset, AssetDepreciationReport, AssetGroup, AssetInput } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

const amount = (value: string): string => formatAmount(parseAmount(value));

function accountOptions(accounts: AccountItem[], type: 'asset' | 'expense', selectedId: number | null): string {
  const choices = accounts.filter((account) => account.type === type && account.postable);
  return `<option value="">اختر الحساب</option>${choices.map((account) => `<option value="${account.id}" ${account.id === selectedId ? 'selected' : ''}>${escapeHtml(`${account.code} — ${account.name}`)}</option>`).join('')}`;
}

function metric(label: string, value: string | number): string {
  return `<div class="asset-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function sectionHeading(title: string, description: string, action: string, label: string): string {
  return `<div class="section-heading section-heading--page asset-heading"><div><p class="eyebrow">الأصول الثابتة</p><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(description)}</p></div><button class="button button--primary" type="button" data-action="${action}">＋ ${escapeHtml(label)}</button></div>`;
}

export function renderAssetGroupsPage(groups: AssetGroup[], accounts: AccountItem[], search: string): string {
  const assetCount = groups.reduce((sum, group) => sum + group.assetCount, 0);
  const query = search.trim().toLocaleLowerCase('ar');
  return `<section class="assets-page">
    ${sectionHeading('مجموعات الأصول', 'تنظيم الأصول وربطها بحساباتها المحاسبية.', 'asset-group-add', 'مجموعة جديدة')}
    <div class="asset-metrics">${metric('عدد المجموعات', groups.length)}${metric('الأصول المرتبطة', assetCount)}${metric('حسابات محاسبية متاحة', accounts.length)}</div>
    <div class="table-panel asset-list-panel"><form class="table-toolbar" data-form="asset-group-search"><label class="search-field"><span aria-hidden="true">⌕</span><input id="asset-group-search" name="search" value="${escapeHtml(search)}" placeholder="بحث بالكود أو الاسم" aria-label="بحث مجموعات الأصول"></label><span class="muted">${groups.length} مجموعة</span></form>
      <div class="table-scroll"><table class="asset-table"><thead><tr><th>الكود</th><th>اسم المجموعة</th><th>حساب الأصل</th><th>مجمع الإهلاك</th><th>مصروف الإهلاك</th><th>عدد الأصول</th><th></th></tr></thead><tbody>
      ${groups.length ? groups.map((group) => `<tr data-asset-group-row data-asset-search="${escapeHtml(`${group.code} ${group.name} ${group.nameEn}`.toLocaleLowerCase('ar'))}" ${query && !`${group.code} ${group.name} ${group.nameEn}`.toLocaleLowerCase('ar').includes(query) ? 'hidden' : ''}><td class="number-cell">${escapeHtml(group.code)}</td><td><strong>${escapeHtml(group.name)}</strong>${group.nameEn ? `<small>${escapeHtml(group.nameEn)}</small>` : ''}</td>
        <td>${escapeHtml(accounts.find((account) => account.id === group.assetAccountId)?.name ?? '—')}</td><td>${escapeHtml(accounts.find((account) => account.id === group.accumulatedDepreciationAccountId)?.name ?? '—')}</td><td>${escapeHtml(accounts.find((account) => account.id === group.depreciationExpenseAccountId)?.name ?? '—')}</td>
        <td>${group.assetCount}</td><td class="row-actions"><button class="icon-button" type="button" data-action="asset-group-edit" data-id="${group.id}">فتح</button></td></tr>`).join('') : '<tr><td class="empty-state" colspan="7">لا توجد مجموعات أصول. أضف أول مجموعة للبدء.</td></tr>'}
      </tbody></table></div></div><div id="asset-editor-host"></div></section>`;
}

export function renderAssetGroupEditor(group: AssetGroup | null, accounts: AccountItem[]): string {
  const editing = group !== null;
  return `<div class="modal-backdrop" id="asset-editor-modal"><section class="record-modal record-modal--wide asset-editor" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
    <div class="modal-heading"><div><p class="eyebrow">بيانات المجموعة</p><h2 id="asset-editor-title">${editing ? 'تعديل مجموعة الأصول' : 'مجموعة أصول جديدة'}</h2></div><button class="icon-button" type="button" data-action="asset-editor-close" aria-label="إغلاق">إغلاق</button></div>
    <form class="asset-form" data-form="asset-group"><input type="hidden" name="id" value="${group?.id ?? ''}">
      <label class="field"><span>كود المجموعة *</span><input name="code" required maxlength="40" value="${escapeHtml(group?.code ?? '')}"></label>
      <label class="field"><span>الاسم العربي *</span><input name="name" required maxlength="180" value="${escapeHtml(group?.name ?? '')}"></label>
      <label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" maxlength="180" value="${escapeHtml(group?.nameEn ?? '')}"></label>
      <label class="field"><span>حساب الأصل *</span><select name="assetAccountId" required>${accountOptions(accounts, 'asset', group?.assetAccountId ?? null)}</select></label>
      <label class="field"><span>حساب مجمع الإهلاك *</span><select name="accumulatedDepreciationAccountId" required>${accountOptions(accounts, 'asset', group?.accumulatedDepreciationAccountId ?? null)}</select></label>
      <label class="field"><span>حساب مصروف الإهلاك *</span><select name="depreciationExpenseAccountId" required>${accountOptions(accounts, 'expense', group?.depreciationExpenseAccountId ?? null)}</select></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="3" maxlength="2000">${escapeHtml(group?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="asset-error" role="alert" hidden></p>
      <div class="form-actions field--wide"><button class="button button--primary" type="submit">حفظ</button>${editing ? `<button class="button button--secondary" type="button" data-action="asset-group-delete" data-id="${group.id}">حذف المجموعة</button>` : ''}<button class="button button--secondary" type="button" data-action="asset-editor-close">إلغاء</button></div>
    </form></section></div>`;
}

export function renderAssetsPage(assets: Asset[], groups: AssetGroup[], accounts: AccountItem[], search: string): string {
  const purchaseTotal = assets.reduce((sum, asset) => sum + parseAmount(asset.purchaseValue), 0n);
  const activeCount = assets.filter((asset) => asset.status === 'active').length;
  const query = search.trim().toLocaleLowerCase('ar');
  return `<section class="assets-page">
    ${sectionHeading('تكويد الأصول', 'سجل الأصول وقيمها وحساباتها المرتبطة.', 'asset-add', 'أصل جديد')}
    <div class="asset-metrics">${metric('عدد الأصول', assets.length)}${metric('إجمالي قيمة الشراء', formatAmount(purchaseTotal))}${metric('الأصول النشطة', activeCount)}</div>
    <div class="table-panel asset-list-panel"><form class="table-toolbar" data-form="asset-search"><label class="search-field"><span aria-hidden="true">⌕</span><input id="asset-search" name="search" value="${escapeHtml(search)}" placeholder="بحث بالكود أو الاسم أو المجموعة" aria-label="بحث الأصول"></label><span class="muted">${assets.length} أصل</span></form>
      <div class="asset-card-grid">${assets.length ? assets.map((asset) => `<button class="asset-card" type="button" data-action="asset-edit" data-id="${asset.id}" data-asset-search="${escapeHtml(`${asset.code} ${asset.name} ${asset.groupName} ${asset.groupCode}`.toLocaleLowerCase('ar'))}" ${query && !`${asset.code} ${asset.name} ${asset.groupName} ${asset.groupCode}`.toLocaleLowerCase('ar').includes(query) ? 'hidden' : ''}>
        <span class="asset-card__top"><span class="asset-card__mark" aria-hidden="true">▤</span><span class="status-badge ${asset.status === 'active' ? 'status-badge--completed' : ''}">${asset.status === 'active' ? 'نشط' : 'غير نشط'}</span></span>
        <strong>${escapeHtml(asset.name)}</strong><span class="asset-card__code">${escapeHtml(asset.code)} · ${escapeHtml(asset.groupCode)}</span>
        <span class="asset-card__value">${amount(asset.purchaseValue)} <small>قيمة الشراء</small></span><span class="asset-card__foot">${escapeHtml(asset.groupName)}<span>${asset.usefulLifeYears} سنة</span></span></button>`).join('') : '<p class="empty-state asset-empty">لا توجد أصول مسجلة. أضف أول أصل للبدء.</p>'}</div>
    </div><div id="asset-editor-host"></div></section>`;
}

export function renderAssetEditor(asset: Asset | null, groups: AssetGroup[], accounts: AccountItem[]): string {
  const editing = asset !== null;
  const selectedGroup = groups.find((group) => group.id === asset?.groupId) ?? groups[0];
  const groupOptions = groups.map((group) => `<option value="${group.id}" ${group.id === (asset?.groupId ?? null) ? 'selected' : ''}>${escapeHtml(`${group.code} — ${group.name}`)}</option>`).join('');
  return `<div class="modal-backdrop" id="asset-editor-modal"><section class="record-modal record-modal--wide asset-editor" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
    <div class="modal-heading"><div><p class="eyebrow">بيانات الأصل الثابت</p><h2 id="asset-editor-title">${editing ? 'تعديل بيانات الأصل' : 'تكويد أصل جديد'}</h2></div><button class="icon-button" type="button" data-action="asset-editor-close">إغلاق</button></div>
    <form class="asset-form" data-form="asset"><input type="hidden" name="id" value="${asset?.id ?? ''}">
      <label class="field"><span>كود الأصل *</span><input name="code" required maxlength="40" value="${escapeHtml(asset?.code ?? '')}"></label>
      <label class="field"><span>الاسم العربي *</span><input name="name" required maxlength="180" value="${escapeHtml(asset?.name ?? '')}"></label>
      <label class="field"><span>الاسم الإنجليزي</span><input name="nameEn" maxlength="180" value="${escapeHtml(asset?.nameEn ?? '')}"></label>
      <label class="field"><span>مجموعة الأصل *</span><select name="groupId" required ${groups.length ? '' : 'disabled'}>${groupOptions || '<option value="">أنشئ مجموعة أصول أولًا</option>'}</select></label>
      <label class="field"><span>كود المجموعة</span><input data-group-code readonly value="${escapeHtml(selectedGroup?.code ?? '')}"></label>
      <label class="field"><span>اسم المجموعة</span><input data-group-name readonly value="${escapeHtml(selectedGroup?.name ?? '')}"></label>
      <label class="field"><span>تاريخ الشراء *</span><input name="purchaseDate" type="date" required value="${escapeHtml(asset?.purchaseDate ?? '')}"></label>
      <label class="field"><span>قيمة الشراء *</span><input name="purchaseValue" type="number" min="0.01" step="0.01" required value="${escapeHtml(asset?.purchaseValue ?? '')}"></label>
      <label class="field"><span>القيمة التخريدية *</span><input name="salvageValue" type="number" min="0" step="0.01" required value="${escapeHtml(asset?.salvageValue ?? '0')}"></label>
      <label class="field"><span>العمر الإنتاجي (سنة) *</span><input name="usefulLifeYears" type="number" min="1" max="100" step="1" required value="${asset?.usefulLifeYears ?? 5}"></label>
      <label class="field"><span>طريقة الإهلاك</span><select name="depreciationMethod"><option value="straight-line" selected>القسط الثابت</option></select></label>
      <label class="field"><span>الحالة *</span><select name="status"><option value="active" ${!asset || asset.status === 'active' ? 'selected' : ''}>نشط</option><option value="inactive" ${asset?.status === 'inactive' ? 'selected' : ''}>غير نشط</option></select></label>
      <label class="field"><span>حساب الأصل *</span><select name="assetAccountId" required>${accountOptions(accounts, 'asset', asset?.assetAccountId ?? selectedGroup?.assetAccountId ?? null)}</select></label>
      <label class="field"><span>حساب مجمع الإهلاك *</span><select name="accumulatedDepreciationAccountId" required>${accountOptions(accounts, 'asset', asset?.accumulatedDepreciationAccountId ?? selectedGroup?.accumulatedDepreciationAccountId ?? null)}</select></label>
      <label class="field"><span>حساب مصروف الإهلاك *</span><select name="depreciationExpenseAccountId" required>${accountOptions(accounts, 'expense', asset?.depreciationExpenseAccountId ?? selectedGroup?.depreciationExpenseAccountId ?? null)}</select></label>
      <label class="field field--wide"><span>ملاحظات</span><textarea name="notes" rows="3" maxlength="2000">${escapeHtml(asset?.notes ?? '')}</textarea></label>
      <p class="form-error field--wide" id="asset-error" role="alert" hidden></p>
      <div class="form-actions field--wide"><button class="button button--primary" type="submit" ${groups.length ? '' : 'disabled'}>حفظ</button>${editing ? `<button class="button button--secondary" type="button" data-action="asset-delete" data-id="${asset.id}">حذف الأصل</button>` : ''}<button class="button button--secondary" type="button" data-action="asset-editor-close">إلغاء</button></div>
    </form></section></div>`;
}

export function renderDepreciationPage(report: AssetDepreciationReport, groups: AssetGroup[], filters: { from: string; to: string }): string {
  const dueTotal = report.lines.filter((line) => !line.posted).reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  return `<section class="assets-page depreciation-page">
    ${sectionHeading('إهلاك الأصول', 'حساب إهلاك القسط الثابت للفترة ومراجعة عمليات الترحيل.', 'asset-depreciation-print', 'طباعة')}
    <div class="asset-metrics">${metric('الأصول المستحقة', report.dueCount)}${metric('إجمالي إهلاك الفترة', report.total)}${metric('الإهلاك المرحّل للفترة', report.postedTotal)}</div>
    <div class="table-panel asset-list-panel"><form class="report-toolbar asset-period-form" data-form="asset-depreciation-period">
      <label class="field"><span>من تاريخ</span><input type="date" name="from" required value="${escapeHtml(filters.from)}"></label><label class="field"><span>إلى تاريخ</span><input type="date" name="to" required value="${escapeHtml(filters.to)}"></label>
      <button class="button button--secondary" type="submit">عرض الفترة</button><button class="button button--primary" type="button" data-action="asset-depreciation-post" ${report.dueCount ? '' : 'disabled'}>ترحيل الإهلاك</button><button class="button button--secondary" type="button" data-action="asset-depreciation-pdf">تصدير PDF</button>
    </form>
    <div class="table-toolbar asset-filter-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input data-depreciation-search placeholder="بحث بالأصل أو المجموعة" aria-label="بحث إهلاك الأصول"></label>
      <select data-depreciation-group aria-label="تصفية المجموعة"><option value="">كل المجموعات</option>${groups.map((group) => `<option value="${group.id}">${escapeHtml(`${group.code} — ${group.name}`)}</option>`).join('')}</select>
      <select data-depreciation-status aria-label="حالة الترحيل"><option value="all">كل الحالات</option><option value="due">غير مرحل</option><option value="posted">مرحل سابقًا</option></select></div>
    <div class="table-scroll"><table class="asset-table depreciation-table"><thead><tr><th>كود الأصل</th><th>الأصل</th><th>المجموعة</th><th>قيمة الشراء</th><th>الإهلاك للفترة</th><th>الحالة</th></tr></thead><tbody>
      ${report.lines.length ? report.lines.map((line) => `<tr data-depreciation-row data-asset-search="${escapeHtml(`${line.assetCode} ${line.assetName} ${line.groupCode} ${line.groupName}`.toLocaleLowerCase('ar'))}" data-group-id="${line.groupId}" data-posted="${line.posted}"><td class="number-cell">${escapeHtml(line.assetCode)}</td><td><strong>${escapeHtml(line.assetName)}</strong></td><td>${escapeHtml(`${line.groupCode} — ${line.groupName}`)}</td><td class="number-cell">${amount(line.purchaseValue)}</td><td class="number-cell"><strong>${amount(line.amount)}</strong></td><td><span class="status-badge ${line.posted ? 'status-badge--completed' : 'status-badge--in-progress'}">${line.posted ? 'مرحل سابقًا' : 'مستحق'}</span></td></tr>`).join('') : '<tr><td class="empty-state" colspan="6">لا توجد أصول نشطة مستحقة خلال الفترة المحددة.</td></tr>'}
    </tbody><tfoot><tr><th colspan="4">إجمالي الفترة غير المرحّل</th><th class="number-cell">${formatAmount(dueTotal)}</th><th></th></tr></tfoot></table></div></div>
    <section class="asset-history"><div class="section-heading"><div><p class="eyebrow">سجل العمليات</p><h2>ترحيلات الإهلاك</h2></div><span class="muted">${report.runs.length} عملية</span></div>
      <div class="table-panel"><div class="table-scroll"><table class="asset-table"><thead><tr><th>رقم الترحيل</th><th>الفترة</th><th>تاريخ الترحيل</th><th>عدد الأصول</th><th>الإجمالي</th><th>القيد</th><th></th></tr></thead><tbody>
        ${report.runs.length ? report.runs.map((run) => `<tr><td><strong>${escapeHtml(run.number)}</strong></td><td dir="ltr">${escapeHtml(run.from)} — ${escapeHtml(run.to)}</td><td>${escapeHtml(run.postedAt)}</td><td>${run.assetCount}</td><td class="number-cell">${amount(run.total)}</td><td>#${run.journalEntryId}</td><td class="row-actions"><button class="icon-button" type="button" data-action="asset-depreciation-run" data-id="${run.id}">التفاصيل</button></td></tr>`).join('') : '<tr><td class="empty-state" colspan="7">لا توجد عمليات ترحيل سابقة.</td></tr>'}
      </tbody></table></div></div></section><div id="asset-editor-host"></div></section>`;
}

export function renderDepreciationRun(run: AssetDepreciationReport['runs'][number]): string {
  return `<div class="modal-backdrop" id="asset-editor-modal"><section class="record-modal record-modal--wide asset-editor" role="dialog" aria-modal="true" aria-labelledby="asset-run-title">
    <div class="modal-heading"><div><p class="eyebrow">تفاصيل عملية الترحيل</p><h2 id="asset-run-title">${escapeHtml(run.number)}</h2><p class="muted">${escapeHtml(run.from)} إلى ${escapeHtml(run.to)} · القيد رقم ${run.journalEntryId}</p></div><button class="icon-button" type="button" data-action="asset-editor-close">إغلاق</button></div>
    <div class="table-scroll"><table class="asset-table"><thead><tr><th>الأصل</th><th>المجموعة</th><th>الإهلاك المرحّل</th></tr></thead><tbody>${run.lines.map((line) => `<tr><td><strong>${escapeHtml(line.assetCode)} · ${escapeHtml(line.assetName)}</strong></td><td>${escapeHtml(`${line.groupCode} — ${line.groupName}`)}</td><td class="number-cell">${amount(line.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">الإجمالي · ${run.assetCount} أصل</th><th class="number-cell">${amount(run.total)}</th></tr></tfoot></table></div>
  </section></div>`;
}