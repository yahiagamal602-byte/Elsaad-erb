import { formatAmount, parseAmount } from '../shared/accounting.js';
import type { ReportFilterOptions, ReportResult, ReportRunFilters } from '../shared/reports.js';
import { escapeHtml } from '../utils/html.js';

export type InstallmentGrouping = 'customer' | 'project' | 'unit';

export interface InstallmentReportPageState {
  options: ReportFilterOptions;
  filters: ReportRunFilters;
  result: ReportResult | null;
  search: string;
  grouping: InstallmentGrouping;
  loading: boolean;
  error: string;
}

type InstallmentRow = Record<string, string>;

const installmentValue = (row: InstallmentRow, key: string): bigint => {
  try { return parseAmount(row[key] || '0'); } catch { return 0n; }
};

function statusOf(row: InstallmentRow): { key: string; label: string } {
  if (installmentValue(row, 'remaining') === 0n) return { key: 'paid', label: 'مسدد بالكامل' };
  if (row.timeStatus === 'overdue') return { key: 'overdue', label: installmentValue(row, 'paid') > 0n ? 'متأخر (مسدد جزئيًا)' : 'متأخر' };
  if (installmentValue(row, 'paid') > 0n) return { key: 'partial', label: 'مسدد جزئيًا' };
  if (row.timeStatus === 'due') return { key: 'due', label: 'مستحق' };
  return { key: 'upcoming', label: 'قادم' };
}

function summaryCard(label: string, value: string, modifier: string): string {
  return `<article class="installment-summary-card installment-summary-card--${modifier}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>جنيه</small></article>`;
}

function reportRows(state: InstallmentReportPageState): InstallmentRow[] {
  const rows = state.result?.rows ?? [];
  const query = state.search.trim().toLocaleLowerCase('ar');
  return rows.filter((row) => !query || `${row.customerCode} ${row.customer} ${row.contract} ${row.project} ${row.unitCode} ${row.unit}`
    .toLocaleLowerCase('ar').includes(query));
}

function renderStatusDistribution(rows: InstallmentRow[]): string {
  const groups = [
    { key: 'paid', label: 'مسدد بالكامل', color: 'paid' },
    { key: 'partial', label: 'مسدد جزئيًا', color: 'partial' },
    { key: 'due', label: 'مستحق', color: 'due' },
    { key: 'upcoming', label: 'قادم', color: 'upcoming' },
    { key: 'overdue', label: 'متأخر', color: 'overdue' },
  ];
  const counts = groups.map((group) => ({ ...group, count: rows.filter((row) => statusOf(row).key === group.key).length }));
  const total = rows.length;
  return `<section class="installment-status-panel" aria-label="توزيع حالات الأقساط">
    <div class="installment-status-panel__heading"><strong>توزيع الحالات</strong><span>${total} قسط</span></div>
    <div class="installment-status-bar" role="img" aria-label="توزيع حالات الأقساط حسب العدد">
      ${counts.map((group) => `<span class="installment-status-bar__segment installment-status-bar__segment--${group.color}" style="width:${total ? (group.count / total * 100).toFixed(2) : '0'}%" title="${escapeHtml(group.label)}: ${group.count}"></span>`).join('')}
    </div>
    <div class="installment-status-legend">${counts.map((group) => `<span><i class="installment-status-dot installment-status-dot--${group.color}"></i>${escapeHtml(group.label)} <b>${group.count}</b><small>${total ? (group.count / total * 100).toFixed(1) : '0.0'}%</small></span>`).join('')}</div>
  </section>`;
}

function groupInfo(row: InstallmentRow, grouping: InstallmentGrouping): { id: string; title: string; subtitle: string } {
  if (grouping === 'project') return { id: row.projectId, title: row.project, subtitle: 'المشروع' };
  if (grouping === 'unit') return { id: row.unitId, title: `${row.unitCode} — ${row.unit}`, subtitle: `المشروع: ${row.project}` };
  return { id: row.customerId, title: row.customer, subtitle: `كود العميل: ${row.customerCode}` };
}

function renderInstallmentTable(rows: InstallmentRow[]): string {
  if (!rows.length) return '<tr><td colspan="9" class="empty-state">لا توجد أقساط مطابقة للفلاتر الحالية.</td></tr>';
  return rows.map((row) => {
    const status = statusOf(row);
    return `<tr class="installment-row installment-row--${status.key}" data-installment-row>
      <td class="installment-sequence">${escapeHtml(row.sequence)}</td>
      <td><strong>${escapeHtml(row.customer)}</strong><small>${escapeHtml(row.customerCode)} · ${escapeHtml(row.contract)}</small></td>
      <td>${escapeHtml(row.project)}</td>
      <td><strong>${escapeHtml(row.unitName || row.unit || '—')}</strong><small>${escapeHtml(row.unitCode || '')}</small></td>
      <td dir="ltr">${escapeHtml(row.dueDate)}</td>
      <td class="number-cell">${escapeHtml(row.amount)}</td>
      <td class="number-cell">${escapeHtml(row.paid)}</td>
      <td class="number-cell">${escapeHtml(row.remaining)}</td>
      <td><span class="installment-status-badge installment-status-badge--${status.key}">${escapeHtml(status.label)}</span></td>
    </tr>`;
  }).join('');
}

function renderGroupedRows(rows: InstallmentRow[], grouping: InstallmentGrouping): string {
  const groups = new Map<string, { info: ReturnType<typeof groupInfo>; rows: InstallmentRow[] }>();
  for (const row of rows) {
    const info = groupInfo(row, grouping);
    const group = groups.get(info.id) ?? { info, rows: [] };
    group.rows.push(row);
    groups.set(info.id, group);
  }
  if (!groups.size) return '<div class="installment-empty-state"><strong>لا توجد نتائج</strong><p>عدّل الفلاتر أو وسّع الفترة لعرض أقساط العملاء.</p></div>';
  return [...groups.values()].map(({ info, rows: groupRows }) => {
    const amount = groupRows.reduce((sum, row) => sum + installmentValue(row, 'amount'), 0n);
    const paid = groupRows.reduce((sum, row) => sum + installmentValue(row, 'paid'), 0n);
    const remaining = groupRows.reduce((sum, row) => sum + installmentValue(row, 'remaining'), 0n);
    return `<details class="installment-group" open data-installment-group-row>
      <summary><span class="installment-group__identity"><strong>${escapeHtml(info.title)}</strong><small>${escapeHtml(info.subtitle)}</small></span>
        <span class="installment-group__count">${groupRows.length} قسط</span><span class="installment-group__total">الإجمالي ${escapeHtml(formatAmount(amount))}</span>
        <span class="installment-group__total installment-group__total--paid">المسدد ${escapeHtml(formatAmount(paid))}</span><span class="installment-group__total installment-group__total--remaining">المتبقي ${escapeHtml(formatAmount(remaining))}</span></summary>
      <div class="table-scroll installment-table-scroll"><table class="installment-table"><thead><tr><th>رقم القسط</th><th>العميل / العقد</th><th>المشروع</th><th>الوحدة</th><th>الاستحقاق</th><th>قيمة القسط</th><th>المسدد فعليًا</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${renderInstallmentTable(groupRows)}</tbody></table></div>
    </details>`;
  }).join('');
}

function renderFilters(state: InstallmentReportPageState): string {
  const projectOptions = state.options.projects.map((option) => `<option value="${option.id}" ${state.filters.projectId === option.id ? 'selected' : ''}>${escapeHtml(`${option.code} — ${option.name}`)}</option>`).join('');
  const unitOptions = state.options.units.map((option) => `<option value="${option.id}" ${state.filters.unitId === option.id ? 'selected' : ''}>${escapeHtml(`${option.code} — ${option.name}`)}</option>`).join('');
  const customerOptions = state.options.customers.map((option) => `<option value="${option.id}" ${state.filters.customerId === option.id ? 'selected' : ''}>${escapeHtml(`${option.code} — ${option.name}`)}</option>`).join('');
  const statusOptions = [
    ['', 'كل الحالات'], ['paid', 'مسدد بالكامل'], ['partial', 'مسدد جزئيًا'],
    ['due-upcoming', 'مستحق أو قادم'], ['overdue', 'متأخر'],
  ].map(([value, label]) => `<option value="${value}" ${state.filters.installmentStatus === value ? 'selected' : ''}>${label}</option>`).join('');
  return `<form class="installment-filter-form" data-form="installment-report-filters">
    <label class="field installment-filter-search"><span>بحث بالعميل أو الكود</span><input type="search" name="search" data-installment-search value="${escapeHtml(state.search)}" placeholder="اسم العميل أو كوده" autocomplete="off"></label>
    <label class="field"><span>العميل</span><select name="customerId"><option value="">كل العملاء</option>${customerOptions}</select></label>
    <label class="field"><span>المشروع</span><select name="projectId"><option value="">كل المشاريع</option>${projectOptions}</select></label>
    <label class="field"><span>الوحدة</span><select name="unitId"><option value="">كل الوحدات</option>${unitOptions}</select></label>
    <label class="field"><span>حالة القسط</span><select name="installmentStatus">${statusOptions}</select></label>
    <label class="field"><span>استحقاق من</span><input type="date" name="from" value="${escapeHtml(state.filters.from)}"></label>
    <label class="field"><span>استحقاق إلى</span><input type="date" name="to" value="${escapeHtml(state.filters.to)}"></label>
    <div class="installment-filter-actions"><button class="button button--primary" type="submit" ${state.loading ? 'disabled' : ''}>${state.loading ? 'جارٍ التحديث…' : 'تطبيق الفلاتر'}</button><button class="button button--secondary" type="button" data-action="installment-report-reset">إعادة ضبط</button></div>
    <p class="form-error installment-report-error" role="alert" ${state.error ? '' : 'hidden'}>${escapeHtml(state.error)}</p>
  </form>`;
}

export function renderInstallmentReportSummary(state: InstallmentReportPageState): string {
  if (state.loading) return '<div class="installment-loading-summary" role="status"><span class="online-dot"></span>جارٍ تحديث ملخص الأقساط وحالاتها…</div>';
  const rows = reportRows(state);
  const total = rows.reduce((sum, row) => sum + installmentValue(row, 'amount'), 0n);
  const paid = rows.reduce((sum, row) => sum + installmentValue(row, 'paid'), 0n);
  const overdue = rows.filter((row) => statusOf(row).key === 'overdue').reduce((sum, row) => sum + installmentValue(row, 'remaining'), 0n);
  const remaining = rows.reduce((sum, row) => sum + installmentValue(row, 'remaining'), 0n);
  return `<section class="installment-summary-grid" aria-label="ملخص الأقساط">
    ${summaryCard('إجمالي الأقساط الظاهرة', formatAmount(total), 'total')}
    ${summaryCard('المسدد فعليًا', formatAmount(paid), 'paid')}
    ${summaryCard('المتأخرات', formatAmount(overdue), 'overdue')}
    ${summaryCard('إجمالي المتبقي', formatAmount(remaining), 'remaining')}
  </section>${renderStatusDistribution(rows)}`;
}

export function renderInstallmentReportResults(state: InstallmentReportPageState): string {
  const rows = reportRows(state);
  if (state.loading) return '<div class="installment-empty-state" role="status">جارٍ تحميل بيانات الأقساط…</div>';
  return renderGroupedRows(rows, state.grouping);
}

export function renderInstallmentReportsPage(state: InstallmentReportPageState): string {
  const groups: Array<[InstallmentGrouping, string]> = [['customer', 'العملاء'], ['project', 'المشاريع'], ['unit', 'الوحدات']];
  return `<section class="installment-report-page" data-installment-report>
    <header class="installment-report-heading"><div><p class="eyebrow">تقارير التحصيلات</p><h2>تقارير أقساط العملاء</h2><p class="muted">الأقساط من العقود المعتمدة، والتحصيل من تخصيصاته الفعلية على كل قسط.</p></div>
      <button class="button installment-exit-button" type="button" data-action="installment-report-exit">خروج</button></header>
    <div id="installment-report-summary">${renderInstallmentReportSummary(state)}</div>
    <section class="installment-controls"><div class="installment-grouping" role="group" aria-label="تجميع الأقساط">${groups.map(([key, label]) => `<button type="button" class="installment-grouping__button ${state.grouping === key ? 'is-active' : ''}" data-installment-grouping="${key}" aria-pressed="${state.grouping === key}">${label}</button>`).join('')}</div>
      <div class="installment-controls__caption"><strong data-installment-count>${reportRows(state).length}</strong> قسط مطابق · الإجماليات حسب النتائج الظاهرة</div></section>
    ${renderFilters(state)}
    <section class="installment-results" id="installment-report-results" aria-live="polite">${renderInstallmentReportResults(state)}</section>
  </section>`;
}