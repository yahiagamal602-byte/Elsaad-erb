import type { DashboardMonth, DashboardSummary, DashboardView } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 252;
const CHART_MARGIN = { top: 18, right: 14, bottom: 43, left: 38 };

function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ar', { month: 'short' }).format(new Date(year, number - 1, 1));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ar').format(value);
}

function formatAmount(value: string | null): string {
  if (value === null) return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return '—';
  const [, sign, whole, fraction] = match;
  const grouped = new Intl.NumberFormat('ar').format(BigInt(whole));
  return `${sign}${grouped}${fraction ? `٫${fraction}` : ''}`;
}

function formatPeriod(value: string): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function compareCount(current: number, previous: number): string {
  if (current === 0 && previous === 0) return 'لا توجد حركة مسجلة في الفترتين';
  if (previous === 0) return `سُجّلت ${formatInteger(current)} حركة في الفترة الحالية`;
  const difference = current - previous;
  if (difference === 0) return 'مماثل للفترة السابقة';
  const relativeChange = Math.round((Math.abs(difference) / previous) * 100);
  return `${difference > 0 ? 'زيادة' : 'انخفاض'} ${formatInteger(Math.abs(difference))} (${formatInteger(relativeChange)}٪)`;
}

function compareAmount(current: string | null, previous: string | null): string {
  if (current === null && previous === null) return 'لا تتوفر حركة حسابات مصروفات';
  if (previous === null) return 'ظهرت حركة جديدة؛ لا توجد حركة للمقارنة في الفترة السابقة';
  if (current === null) return `لا توجد حركة حاليًا؛ السابقة ${formatAmount(previous)}`;
  const difference = Number(current) - Number(previous);
  if (difference === 0) return 'مماثل للفترة السابقة';
  const change = formatAmount(String(Math.abs(difference)));
  return `${difference > 0 ? 'زيادة' : 'انخفاض'} ${change} عن الفترة السابقة`;
}

function metricCard(label: string, value: string, detail: string, variant: string, unavailable = false): string {
  return `
    <article class="dashboard-metric dashboard-metric--${variant} ${unavailable ? 'dashboard-metric--unavailable' : ''}">
      <span class="dashboard-metric__label">${escapeHtml(label)}</span>
      <strong class="dashboard-metric__value">${escapeHtml(value)}</strong>
      <span class="dashboard-metric__detail">${escapeHtml(detail)}</span>
    </article>
  `;
}

function chartFrame(title: string, subtitle: string, chart: string, legend: string): string {
  return `
    <article class="dashboard-panel">
      <header class="dashboard-panel__header">
        <div><p class="eyebrow">تحليل من واقع السجلات</p><h3>${escapeHtml(title)}</h3><p class="dashboard-panel__subtitle">${escapeHtml(subtitle)}</p></div>
      </header>
      <div class="dashboard-chart-scroll">${chart}</div>
      <div class="dashboard-legend">${legend}</div>
    </article>
  `;
}

function groupedCountChart(months: DashboardMonth[]): string {
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxValue = Math.max(1, ...months.map(({ salesRecords, purchaseRecords }) => Math.max(salesRecords, purchaseRecords)));
  const scaleMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const slot = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.min(15, slot * 0.29);
  const gap = Math.min(4, slot * 0.08);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (scaleMax / 4) * index;
    const y = CHART_MARGIN.top + plotHeight - (value / scaleMax) * plotHeight;
    return `
      <line class="dashboard-chart__grid" x1="${CHART_MARGIN.left}" y1="${y}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${y}"></line>
      <text class="dashboard-chart__axis" x="${CHART_MARGIN.left - 8}" y="${y + 4}" text-anchor="end">${formatInteger(value)}</text>
    `;
  }).join('');
  const bars = months.map((month, index) => {
    const center = CHART_MARGIN.left + (index + 0.5) * slot;
    const heightFor = (value: number): number => value === 0 ? 0 : Math.max(2, (value / scaleMax) * plotHeight);
    const salesHeight = heightFor(month.salesRecords);
    const purchasesHeight = heightFor(month.purchaseRecords);
    const salesX = center - gap / 2 - barWidth;
    const purchasesX = center + gap / 2;
    const baseY = CHART_MARGIN.top + plotHeight;
    return `
      <rect class="dashboard-chart__bar dashboard-chart__bar--sales" x="${salesX}" y="${baseY - salesHeight}" width="${barWidth}" height="${salesHeight}" rx="3">
        <title>${escapeHtml(monthLabel(month.month))}: سجلات المبيعات ${formatInteger(month.salesRecords)}</title>
      </rect>
      <rect class="dashboard-chart__bar dashboard-chart__bar--purchases" x="${purchasesX}" y="${baseY - purchasesHeight}" width="${barWidth}" height="${purchasesHeight}" rx="3">
        <title>${escapeHtml(monthLabel(month.month))}: سجلات المشتريات ${formatInteger(month.purchaseRecords)}</title>
      </rect>
      <text class="dashboard-chart__month" x="${center}" y="${CHART_HEIGHT - 13}" text-anchor="middle">${escapeHtml(monthLabel(month.month))}</text>
    `;
  }).join('');
  return `
    <svg class="dashboard-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="مقارنة شهرية لأعداد سجلات المبيعات والمشتريات الفعلية">
      ${grid}${bars}
    </svg>
  `;
}

function expenseChart(months: DashboardMonth[]): string {
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const values = months.flatMap(({ expenseDebits, expenseCredits }) => [Number(expenseDebits), Number(expenseCredits)]);
  const maxValue = Math.max(1, ...values.filter(Number.isFinite));
  const scaleMax = maxValue * 1.12;
  const slot = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.min(15, slot * 0.29);
  const gap = Math.min(4, slot * 0.08);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (scaleMax / 4) * index;
    const y = CHART_MARGIN.top + plotHeight - (value / scaleMax) * plotHeight;
    return `
      <line class="dashboard-chart__grid" x1="${CHART_MARGIN.left}" y1="${y}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${y}"></line>
      <text class="dashboard-chart__axis" x="${CHART_MARGIN.left - 8}" y="${y + 4}" text-anchor="end">${new Intl.NumberFormat('ar', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</text>
    `;
  }).join('');
  const bars = months.map((month, index) => {
    const center = CHART_MARGIN.left + (index + 0.5) * slot;
    const debit = Number(month.expenseDebits);
    const credit = Number(month.expenseCredits);
    const debitHeight = Number.isFinite(debit) ? (debit / scaleMax) * plotHeight : 0;
    const creditHeight = Number.isFinite(credit) ? (credit / scaleMax) * plotHeight : 0;
    const debitX = center - gap / 2 - barWidth;
    const creditX = center + gap / 2;
    const baseY = CHART_MARGIN.top + plotHeight;
    return `
      <rect class="dashboard-chart__bar dashboard-chart__bar--sales" x="${debitX}" y="${baseY - debitHeight}" width="${barWidth}" height="${debitHeight}" rx="3">
        <title>${escapeHtml(monthLabel(month.month))}: مدين المصروفات ${escapeHtml(formatAmount(month.expenseDebits))}</title>
      </rect>
      <rect class="dashboard-chart__bar dashboard-chart__bar--purchases" x="${creditX}" y="${baseY - creditHeight}" width="${barWidth}" height="${creditHeight}" rx="3">
        <title>${escapeHtml(monthLabel(month.month))}: دائن المصروفات ${escapeHtml(formatAmount(month.expenseCredits))}</title>
      </rect>
      <text class="dashboard-chart__month" x="${center}" y="${CHART_HEIGHT - 13}" text-anchor="middle">${escapeHtml(monthLabel(month.month))}</text>
    `;
  }).join('');
  return `
    <svg class="dashboard-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="حركة المدين والدائن في حسابات المصروفات من القيود المرحلة">
      ${grid}${bars}
    </svg>
  `;
}

function comparisonCard(title: string, current: number, previous: number): string {
  return `
    <article class="comparison-card">
      <span class="comparison-card__title">${escapeHtml(title)}</span>
      <strong>${formatInteger(current)} <span>مقابل ${formatInteger(previous)}</span></strong>
      <span class="comparison-card__change">${escapeHtml(compareCount(current, previous))}</span>
    </article>
  `;
}

function renderComparisons(data: DashboardSummary): string {
  return `
    <section class="dashboard-panel dashboard-comparison">
      <header class="dashboard-panel__header">
        <div><p class="eyebrow">مقارنة فترات فعلية</p><h3>آخر 30 يومًا والفترة السابقة</h3></div>
        <span class="dashboard-date-range">${formatPeriod(data.comparison.currentFrom)} — ${formatPeriod(data.comparison.currentTo)}</span>
      </header>
      <div class="comparison-grid">
        ${comparisonCard('سجلات المبيعات', data.comparison.salesCurrent, data.comparison.salesPrevious)}
        ${comparisonCard('سجلات المشتريات', data.comparison.purchasesCurrent, data.comparison.purchasesPrevious)}
        <article class="comparison-card">
          <span class="comparison-card__title">حركة حسابات المصروفات</span>
          <strong>${formatAmount(data.comparison.expensesCurrent)} <span>مقابل ${formatAmount(data.comparison.expensesPrevious)}</span></strong>
          <span class="comparison-card__change">${escapeHtml(compareAmount(data.comparison.expensesCurrent, data.comparison.expensesPrevious))}</span>
        </article>
      </div>
      <p class="dashboard-footnote">تُقارن سجلات البيع والشراء بحسب تاريخ السجل، والمصروفات بحسب القيود المرحلة على حسابات نوع «مصروفات». المقارنة لا تمثل فواتير أو تحصيلات نقدية مؤكدة.</p>
    </section>
  `;
}

function renderPaymentsEmpty(): string {
  return `
    <section class="dashboard-panel payments-panel">
      <div class="payments-panel__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h17v11h-17zM3.5 10h17M7 15h3"></path><path d="M16.5 3.5v4M14.5 5.5h4"></path></svg>
      </div>
      <div><p class="eyebrow">التحصيلات</p><h3>مدفوعات العملاء</h3><p>لا تتوفر سجلات تحصيل مرتبطة بالعملاء في قاعدة البيانات الحالية، لذلك لا يُعرض مبلغ أو رسم تخميني.</p></div>
      <span class="payments-panel__status">بانتظار بيانات التحصيل</span>
    </section>
  `;
}

function renderMonthlyTable(months: DashboardMonth[]): string {
  const rows = [...months].reverse().map((month) => `
    <tr>
      <td><strong>${escapeHtml(monthLabel(month.month))}</strong><small>${month.month.slice(0, 4)}</small></td>
      <td>${formatInteger(month.salesRecords)}</td>
      <td>${formatInteger(month.purchaseRecords)}</td>
      <td>${escapeHtml(formatAmount(month.expenseDebits))}</td>
      <td>${escapeHtml(formatAmount(month.expenseCredits))}</td>
    </tr>
  `).join('');
  return `
    <section class="dashboard-panel dashboard-monthly-panel">
      <header class="dashboard-panel__header"><div><p class="eyebrow">تفصيل شهري</p><h3>السجلات والحركة الفعلية</h3><p class="dashboard-panel__subtitle">آخر 12 شهرًا — تُعرض الأشهر بلا حركة بقيمة صفر فعلية.</p></div></header>
      <div class="table-scroll"><table class="dashboard-monthly-table">
        <thead><tr><th>الشهر</th><th>سجلات البيع</th><th>سجلات الشراء</th><th>مدين المصروفات</th><th>دائن المصروفات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
  `;
}

function renderMetrics(data: DashboardSummary): string {
  return `
    <section class="dashboard-metrics" aria-label="المؤشرات الفعلية">
      ${metricCard('أطراف مسجلة في المبيعات', formatInteger(data.salesParties), 'أسماء مميزة في سجلات البيع', 'customers')}
      ${metricCard('أطراف مسجلة في المشتريات', formatInteger(data.purchaseParties), 'أسماء مميزة في سجلات الشراء', 'suppliers')}
      ${metricCard('سجلات المبيعات', formatInteger(data.salesRecords), 'لا يوجد نوع فاتورة مستقل حاليًا', 'sales')}
      ${metricCard('مصروفات مرحلة', formatAmount(data.expenseBalance), data.expenseBalance === null ? 'لا توجد حركة على حسابات المصروفات' : `من ${formatInteger(data.expenseEntries)} سطر قيد`, 'expenses', data.expenseBalance === null)}
    </section>
  `;
}

export function renderDashboard(data: DashboardSummary, view: DashboardView): string {
  const dashboardTitle = view === 'dashboard-new' ? 'لوحة المؤشرات الجديدة' : 'داش بورد 2';
  const datedRecordCount = data.monthly.reduce((total, month) => total + month.salesRecords + month.purchaseRecords, 0);
  const monthlyExpenseCount = data.monthly.some((month) => Number(month.expenseDebits) > 0 || Number(month.expenseCredits) > 0);
  const charts = `
    <section class="dashboard-charts">
      ${chartFrame(
        'نشاط البيع والشراء',
        'عدد السجلات المدخلة في كل شهر؛ هذه أعداد سجلات وليست أعداد فواتير.',
        datedRecordCount ? groupedCountChart(data.monthly) : '<div class="dashboard-chart-empty">لا توجد سجلات بيع أو شراء مؤرخة لعرضها.</div>',
        '<span class="dashboard-legend__item"><i class="dashboard-legend__dot dashboard-legend__dot--sales"></i>سجلات البيع</span><span class="dashboard-legend__item"><i class="dashboard-legend__dot dashboard-legend__dot--purchases"></i>سجلات الشراء</span>',
      )}
      ${chartFrame(
        'حركة المصروفات المرحلة',
        'مدين ودائن حسابات نوع «مصروفات»؛ لا تُضاف أي قيود تلقائيًا.',
        monthlyExpenseCount ? expenseChart(data.monthly) : '<div class="dashboard-chart-empty">لا توجد حركة على حسابات المصروفات خلال آخر 12 شهرًا.</div>',
        '<span class="dashboard-legend__item"><i class="dashboard-legend__dot dashboard-legend__dot--sales"></i>مدين المصروفات</span><span class="dashboard-legend__item"><i class="dashboard-legend__dot dashboard-legend__dot--purchases"></i>دائن المصروفات</span>',
      )}
    </section>
  `;

  return `
    <section class="dashboard-welcome">
      <div><p class="eyebrow">نظرة عامة · ${escapeHtml(dashboardTitle)}</p><h2>أعمالك كما هي مسجّلة</h2><p>المؤشرات من قاعدة البيانات المحلية والقيود المرحلة. لا تُعرض بيانات مالية غير مسجلة أو وحدات نقدية مفترضة.</p></div>
      <div class="dashboard-welcome__meta"><span class="dashboard-live-dot"></span><span>بيانات محلية فعلية</span></div>
    </section>
    ${renderMetrics(data)}
    ${view === 'dashboard-new' ? charts : renderMonthlyTable(data.monthly)}
    ${renderComparisons(data)}
    ${renderPaymentsEmpty()}
    <p class="dashboard-data-note">عدد الأطراف مستنتج من حقل الطرف في السجلات الحالية، وليس من سجل عملاء أو موردين مستقل. السجلات الحالية ليست نوع فاتورة موثقًا، ولا توجد بيانات تحصيل أو ربط بينها وبين الخزينة.</p>
    <footer class="developer-credit developer-credit--dashboard">
      <span class="developer-credit__name" lang="en" dir="ltr">Developed by Mohanda Saad</span>
      <bdi class="developer-credit__phones" dir="ltr">01014998059 / 01069670339</bdi>
    </footer>
  `;
}
