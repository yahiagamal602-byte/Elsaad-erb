import { REPORT_GROUPS, REPORT_GROUPS_MAP, formatReportRange } from '../shared/reports.js';
import type {
  ReportColumn,
  ReportDefinition,
  ReportFilterKey,
  ReportFilterOption,
  ReportLibrary,
  ReportResult,
  ReportRunFilters,
} from '../shared/reports.js';
import { escapeHtml } from '../utils/html.js';

export const REPORT_PREVIEW_LIMIT = 400;

export interface ReportsPageState {
  library: ReportLibrary;
  selectedKey: string;
  filters: ReportRunFilters;
  result: ReportResult | null;
  search: string;
  favorites: string[];
  recent: string[];
  expandedGroups: string[];
  loading: boolean;
  error: string;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function selectedDefinition(state: ReportsPageState): ReportDefinition | undefined {
  return state.library.definitions.find((definition) => definition.key === state.selectedKey);
}

function reportCount(state: ReportsPageState, group: string): number {
  return state.library.definitions.filter((definition) => definition.group === group).length;
}

function statCard(label: string, value: string, hint: string, statId?: string): string {
  return `<article class="report-stat">
    <span class="report-stat__label">${escapeHtml(label)}</span>
    <strong class="report-stat__value" ${statId ? `data-report-stat="${statId}"` : ''}>${escapeHtml(value)}</strong>
    <span class="report-stat__hint">${escapeHtml(hint)}</span>
  </article>`;
}

function renderStats(state: ReportsPageState): string {
  const total = state.library.definitions.length;
  const financial = reportCount(state, 'accounting') + reportCount(state, 'financial');
  const operational = reportCount(state, 'sales') + reportCount(state, 'inventory') + reportCount(state, 'projects')
    + reportCount(state, 'assets') + reportCount(state, 'parties') + reportCount(state, 'installments');
  return `<section class="reports-stats" aria-label="ملخصات مركز التقارير">
    ${statCard('إجمالي التقارير المتاحة', String(total), 'تقارير مبنية على بيانات فعلية')}
    ${statCard('المالية والمحاسبية', String(financial), 'الدليل والأرصدة والحركة المالية')}
    ${statCard('التشغيلية والإدارية', String(operational + reportCount(state, 'admin')), 'مبيعات ومخزون ومشروعات وأصول')}
    ${statCard('المفضلة والمستخدمة مؤخرًا', `${state.favorites.length} / ${state.recent.length}`, 'محفوظة محليًا على هذا الجهاز', 'favorites')}
  </section>`;
}

function reportButton(definition: ReportDefinition, state: ReportsPageState): string {
  const favorite = state.favorites.includes(definition.key);
  const active = state.selectedKey === definition.key;
  return `<div class="report-item ${active ? 'is-active' : ''}">
    <button class="report-item__main" type="button" data-report-key="${definition.key}" ${active ? 'aria-current="true"' : ''} title="${escapeHtml(definition.description)}">
      <span class="report-item__title">${escapeHtml(definition.title)}</span>
      <span class="report-item__count">${definition.filters.length ? `${definition.filters.length} فلتر` : 'بدون فلاتر'}</span>
    </button>
    <button class="report-item__fav ${favorite ? 'is-favorite' : ''}" type="button" data-report-favorite="${definition.key}" aria-pressed="${favorite ? 'true' : 'false'}" aria-label="${favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}" title="${favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}">★</button>
  </div>`;
}

function renderFavoriteList(state: ReportsPageState): string {
  const favorites = state.library.definitions.filter((definition) => state.favorites.includes(definition.key));
  if (!favorites.length) return '';
  return `<section class="report-shortcut-group">
    <h3>المفضلة</h3>
    ${favorites.map((definition) => `<div class="report-shortcut ${state.selectedKey === definition.key ? 'is-active' : ''}">
      <button type="button" class="report-shortcut__open" data-report-key="${definition.key}">${escapeHtml(definition.title)}</button>
      <button type="button" class="report-shortcut__remove" data-report-favorite="${definition.key}" aria-label="إزالة ${escapeHtml(definition.title)} من المفضلة" title="إزالة من المفضلة">×</button>
    </div>`).join('')}
  </section>`;
}

function renderRecentList(state: ReportsPageState): string {
  const recent = state.recent
    .map((key) => state.library.definitions.find((definition) => definition.key === key))
    .filter((definition): definition is ReportDefinition => Boolean(definition))
    .slice(0, 5);
  if (!recent.length) return '';
  return `<section class="report-shortcut-group">
    <h3>المستخدمة مؤخرًا</h3>
    ${recent.map((definition) => `<button type="button" class="report-shortcut report-shortcut--single ${state.selectedKey === definition.key ? 'is-active' : ''}" data-report-key="${definition.key}">${escapeHtml(definition.title)}</button>`).join('')}
  </section>`;
}

function renderGroup(definitionList: ReportDefinition[], state: ReportsPageState, groupKey: string, label: string, hint: string): string {
  const items = definitionList.filter((definition) => definition.group === groupKey);
  if (!items.length) return '';
  const expanded = state.expandedGroups.includes(groupKey);
  return `<section class="report-group ${expanded ? 'is-open' : ''}">
    <button class="report-group__toggle" type="button" data-report-group="${groupKey}" aria-expanded="${expanded ? 'true' : 'false'}">
      <span class="report-group__title">${escapeHtml(label)}</span>
      <span class="report-group__meta"><span>${items.length}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg></span>
    </button>
    <p class="report-group__hint">${escapeHtml(hint)}</p>
    ${expanded ? `<div class="report-group__items">${items.map((definition) => reportButton(definition, state)).join('')}</div>` : ''}
  </section>`;
}

export function renderReportLibraryBody(state: ReportsPageState): string {
  const query = state.search.trim();
  const matches = state.library.definitions.filter((definition) =>
    !query || `${definition.title} ${definition.description} ${REPORT_GROUPS_MAP[definition.group]}`.toLowerCase().includes(query.toLowerCase()));
  if (!matches.length) {
    return `${renderFavoriteList(state)}
      <p class="report-library__empty">لا يوجد تقرير يطابق «${escapeHtml(query)}». جرّب كلمة أخرى مثل «أقساط» أو «خزينة».</p>`;
  }
  return `${renderFavoriteList(state)}
    ${renderRecentList(state)}
    <div class="report-groups">
      ${REPORT_GROUPS.map(({ key, label, hint }) => renderGroup(matches, state, key, label, hint)).join('')}
    </div>`;
}

function optionList(options: Array<{ value: string; label: string }>, selected: string, placeholder: string): string {
  return `<option value="">${escapeHtml(placeholder)}</option>${options.map((option) =>
    `<option value="${escapeHtml(option.value)}" ${option.value === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}`;
}

function idOptions(options: ReportFilterOption[], selected: number | null, placeholder: string): string {
  return `<option value="">${escapeHtml(placeholder)}</option>${options.map((option) =>
    `<option value="${option.id}" ${option.id === selected ? 'selected' : ''}>${escapeHtml(`${option.code} — ${option.name}`)}</option>`).join('')}`;
}

function field(label: string, name: string, control: string, extraClass = ''): string {
  return `<label class="field report-filter ${extraClass}"><span>${escapeHtml(label)}</span>${control}</label>`;
}

export function renderReportFilters(definition: ReportDefinition, options: ReportLibrary['options'], filters: ReportRunFilters): string {
  const controls: string[] = [];
  const keys = new Set<ReportFilterKey>(definition.filters);
  if (keys.has('asOf')) {
    controls.push(field('الرصيد حتى تاريخ', 'to', `<input name="to" type="date" value="${escapeHtml(filters.to)}" required>`));
  }
  if (keys.has('period')) {
    controls.push(`<div class="report-period-field">
      <span>الفترة</span>
      <div class="report-period-field__inputs">
        <label class="field"><span>من تاريخ</span><input name="from" type="date" value="${escapeHtml(filters.from)}"></label>
        <label class="field"><span>إلى تاريخ</span><input name="to" type="date" value="${escapeHtml(filters.to)}"></label>
      </div>
    </div>`);
  }
  if (keys.has('customer')) {
    controls.push(field('العميل', 'customerId', `<select name="customerId">${idOptions(options.customers, filters.customerId, 'كل العملاء')}</select>`));
  }
  if (keys.has('supplier')) {
    controls.push(field('المورد', 'supplierId', `<select name="supplierId">${idOptions(options.suppliers, filters.supplierId, 'كل الموردين')}</select>`));
  }
  if (keys.has('account')) {
    controls.push(field('الحساب المحاسبي', 'accountId', `<select name="accountId">${idOptions(options.accounts, filters.accountId, 'كل الحسابات')}</select>`));
  }
  if (keys.has('project')) {
    controls.push(field('المشروع', 'projectId', `<select name="projectId">${idOptions(options.projects, filters.projectId, 'كل المشروعات')}</select>`));
  }
  if (keys.has('costCenter')) {
    controls.push(field('مركز التكلفة', 'costCenterId', `<select name="costCenterId">${idOptions(options.costCenters, filters.costCenterId, 'كل المراكز')}</select>`));
  }
  if (keys.has('item')) {
    controls.push(field('الصنف', 'itemId', `<select name="itemId">${idOptions(options.items, filters.itemId, 'كل الأصناف')}</select>`));
  }
  if (keys.has('unit')) {
    controls.push(field('الوحدة', 'unitId', `<select name="unitId">${idOptions(options.units, filters.unitId, 'كل الوحدات')}</select>`));
  }
  if (keys.has('assetGroup')) {
    controls.push(field('مجموعة الأصول', 'assetGroupId', `<select name="assetGroupId">${idOptions(options.assetGroups, filters.assetGroupId, 'كل المجموعات')}</select>`));
  }
  if (keys.has('treasury')) {
    controls.push(field('الخزينة / البنك', 'treasury', `<select name="treasury">${optionList(options.treasury, filters.treasury, 'كل الخزائن والبنوك')}</select>`));
  }
  if (keys.has('status') && definition.statusOptions?.length) {
    controls.push(field('الحالة', 'status', `<select name="status">${optionList(definition.statusOptions, filters.status, 'كل الحالات')}</select>`));
  }
  if (keys.has('installmentStatus') && definition.statusOptions?.length) {
    controls.push(field('حالة القسط', 'installmentStatus', `<select name="installmentStatus">${optionList(definition.statusOptions, filters.installmentStatus, 'كل حالات الأقساط')}</select>`));
  }
  if (!controls.length) {
    return `<p class="report-filter-note">هذا التقرير لا يحتاج فلاتر — يعرض كل البيانات المتاحة عند الضغط على «عرض التقرير».</p>`;
  }
  return `<div class="report-filter-grid">${controls.join('')}</div>`;
}

function renderPreviewRows(result: ReportResult, columns: ReportColumn[], rows: Array<Record<string, string>>): string {
  return rows.map((row) => `<tr>${columns.map((column) => {
    const value = row[column.key] ?? '';
    const className = column.kind === 'amount' ? 'number-cell report-amount' : column.kind === 'number' ? 'number-cell' : '';
    return `<td class="${className}">${escapeHtml(value)}</td>`;
  }).join('')}</tr>`).join('');
}

function reportTable(result: ReportResult, rows: Array<Record<string, string>>): string {
  return `<div class="table-scroll report-table-scroll">
    <table class="report-table">
      <thead><tr>${result.columns.map((column) => `<th class="${column.kind === 'amount' || column.kind === 'number' ? 'number-cell' : ''}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>${renderPreviewRows(result, result.columns, rows)}</tbody>
    </table>
  </div>`;
}

function reportTotals(result: ReportResult): string {
  if (!result.totals.length) return '';
  return `<div class="report-totals">${result.totals.map((total) =>
    `<div class="report-total ${total.tone ? `report-total--${total.tone}` : ''}"><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.value)}</strong></div>`).join('')}</div>`;
}

export function renderReportPreview(result: ReportResult, entityName: string): string {
  const visibleRows = result.rows.slice(0, REPORT_PREVIEW_LIMIT);
  const truncated = result.rows.length > visibleRows.length;
  return `<article class="report-preview" id="report-preview" data-report-preview>
    <header class="report-preview__header">
      <div class="report-preview__entity">
        <span class="report-preview__mark">E</span>
        <div><strong>${escapeHtml(entityName)}</strong><small>Elsaad ERP</small></div>
      </div>
      <div class="report-preview__title">
        <p class="eyebrow">${escapeHtml(REPORT_GROUPS_MAP[result.group])}</p>
        <h3>${escapeHtml(result.title)}</h3>
        <p class="muted">${escapeHtml(formatReportRange(result.from, result.to))}</p>
      </div>
      <div class="report-preview__meta">
        <span>تاريخ الإعداد</span>
        <strong>${escapeHtml(formatGeneratedAt(result.generatedAt))}</strong>
        <span>عدد السجلات</span>
        <strong>${result.rows.length}</strong>
      </div>
    </header>
    <div class="report-preview__toolbar">
      <span class="report-preview__status"><span class="online-dot"></span>معاينة التقرير من بيانات النظام الفعلية</span>
      <div class="report-preview__actions">
        <button class="button button--secondary button--small" type="button" data-action="report-print">طباعة</button>
        <button class="button button--secondary button--small" type="button" data-action="report-pdf">تصدير PDF</button>
        <button class="button button--secondary button--small" type="button" data-action="report-excel" ${result.rows.length ? '' : 'disabled'}>تصدير CSV (Excel)</button>
        <button class="button button--quiet button--small" type="button" data-action="report-refresh">تحديث</button>
      </div>
    </div>
    ${reportTotals(result)}
    ${result.rows.length
      ? reportTable(result, visibleRows)
      : `<div class="report-empty-preview"><strong>لا توجد نتائج</strong><p>${escapeHtml(result.note || 'جرّب توسيع الفترة أو تغيير الفلاتر.')}</p></div>`}
    ${truncated ? `<p class="report-truncation">تُعرض معاينة أول ${visibleRows.length} سجل من إجمالي ${result.rows.length}. تصدير Excel يشمل كل السجلات.</p>` : ''}
    <footer class="report-preview__footer">
      <p>${escapeHtml(result.note)}</p>
      <dl>${result.footer.map((item) => `<div><dt>${escapeHtml(item.key)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>
    </footer>
  </article>`;
}

function renderWorkspaceEmpty(definition: ReportDefinition, error: string): string {
  return `<section class="report-empty-preview">
    <span class="report-empty-preview__mark">▤</span>
    <strong>${escapeHtml(definition.title)}</strong>
    <p>${escapeHtml(error || 'حدد الفلاتر المناسبة ثم اضغط «عرض التقرير» لعرض النتائج من قاعدة البيانات.')}</p>
  </section>`;
}

export function renderReportWorkspace(state: ReportsPageState): string {
  const definition = selectedDefinition(state);
  if (!definition) {
    return `<section class="report-empty-preview"><strong>اختر تقريرًا من المكتبة</strong><p>اختر تقريرًا من القائمة الجانبية لعرض فلاتره ومعاينته.</p></section>`;
  }
  const favorite = state.favorites.includes(definition.key);
  return `<header class="report-workspace__header">
    <div>
      <p class="eyebrow">${escapeHtml(REPORT_GROUPS_MAP[definition.group])}</p>
      <h2>${escapeHtml(definition.title)}</h2>
      <p class="muted">${escapeHtml(definition.description)}</p>
    </div>
    <button class="button button--quiet report-favorite-toggle ${favorite ? 'is-favorite' : ''}" type="button" data-report-favorite="${definition.key}" aria-pressed="${favorite ? 'true' : 'false'}">
      <span aria-hidden="true">★</span><span data-favorite-label>${favorite ? 'في المفضلة' : 'إضافة للمفضلة'}</span>
    </button>
  </header>
  <form class="report-filter-panel" data-form="report-filters" id="report-filter-form" novalidate>
    ${renderReportFilters(definition, state.library.options, state.filters)}
    <div class="report-filter-actions">
      <button class="button button--primary" type="submit" ${state.loading ? 'disabled' : ''}>${state.loading ? 'جارٍ إعداد التقرير…' : 'عرض التقرير'}</button>
      <button class="button button--secondary" type="button" data-action="report-reset-form">إعادة ضبط الفلاتر</button>
      <button class="button button--quiet" type="button" data-action="report-refresh" ${state.result ? '' : 'disabled'}>تحديث التقرير</button>
      <span class="report-filter-hint">${escapeHtml(formatReportRange(state.filters.from, state.filters.to))}</span>
    </div>
    <p class="form-error report-form-error" id="report-page-error" role="alert" ${state.error ? '' : 'hidden'}>${escapeHtml(state.error)}</p>
  </form>
  <div id="report-preview-host">
    ${state.loading
      ? `<section class="report-loading" role="status" aria-live="polite"><span class="online-dot"></span>جارٍ إعداد التقرير من البيانات الفعلية…</section>`
      : state.result ? renderReportPreview(state.result, state.library.entityName) : renderWorkspaceEmpty(definition, state.error)}
  </div>`;
}

export function renderReportsPage(state: ReportsPageState): string {
  return `<section class="reports-page" data-reports-page>
    <header class="reports-hero">
      <div>
        <p class="eyebrow">مركز التقارير</p>
        <h2>التقارير والطباعة</h2>
        <p class="muted">اختر تقريرًا، حدد الفلاتر، ثم اعرض النتائج واطبعها أو صدّرها من بيانات ${escapeHtml(state.library.entityName)} الفعلية.</p>
      </div>
      <div class="reports-hero__meta"><span class="online-dot"></span>${state.library.definitions.length} تقريرًا متاحًا · البيانات محلية</div>
    </header>
    ${renderStats(state)}
    <div class="reports-layout">
      <aside class="report-library" aria-label="مكتبة التقارير">
        <div class="report-search">
          <label class="field"><span>ابحث عن تقرير</span>
            <input type="search" id="report-search" name="report-search" value="${escapeHtml(state.search)}" placeholder="مثال: كشف حساب، مخزون، إهلاك" autocomplete="off">
          </label>
          <span class="report-search__hint">Ctrl + F للبحث السريع</span>
        </div>
        <div id="reports-library-body">${renderReportLibraryBody(state)}</div>
      </aside>
      <section class="report-workspace" id="reports-workspace">${renderReportWorkspace(state)}</section>
    </div>
  </section>`;
}

export function renderReportPrint(result: ReportResult, entityName: string): string {
  return `<div id="report-print-host" class="report-print-document" aria-hidden="true">
    <header class="report-print-document__header">
      <div class="report-print-document__entity"><span class="report-print-document__mark">E</span><div><strong>${escapeHtml(entityName)}</strong><small>Elsaad ERP</small></div></div>
      <div class="report-print-document__title"><h1>${escapeHtml(result.title)}</h1><p>${escapeHtml(formatReportRange(result.from, result.to))}</p></div>
      <div class="report-print-document__meta"><span>تاريخ الإعداد: ${escapeHtml(formatGeneratedAt(result.generatedAt))}</span><span>عدد السجلات: ${result.rows.length}</span></div>
    </header>
    ${reportTotals(result)}
    <table class="report-print-document__table">
      <thead><tr>${result.columns.map((column) => `<th class="${column.kind === 'amount' || column.kind === 'number' ? 'number-cell' : ''}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>${renderPreviewRows(result, result.columns, result.rows)}</tbody>
    </table>
    <footer class="report-print-document__footer">
      <p>${escapeHtml(result.note)}</p>
      <div>${result.footer.map((item) => `<span>${escapeHtml(item.key)}: ${escapeHtml(item.value)}</span>`).join('')}</div>
      <p class="report-print-document__brand">Elsaad ERP — تقرير آلي من بيانات النظام</p>
    </footer>
  </div>`;
}
