import type { Customer, SalesDashboardSummary } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

function display(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount) : value;
}

export function renderSalesDashboard(summary: SalesDashboardSummary, customers: Customer[]): string {
  const customerOptions = customers.map((customer) =>
    `<option value="${customer.id}" ${summary.customerId === customer.id ? 'selected' : ''}>${escapeHtml(customer.code)} — ${escapeHtml(customer.name)}</option>`).join('');
  const chartMaximum = summary.monthly.reduce((maximum, item) =>
    Math.max(maximum, Number(item.sales), Number(item.returns)), 0);
  const monthLabels = summary.monthly.map((item) => {
    const [year, month] = item.month.split('-').map(Number);
    const label = new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(new Date(year, month - 1, 1));
    const salesHeight = chartMaximum ? Number(item.sales) / chartMaximum * 100 : 0;
    const returnHeight = chartMaximum ? Number(item.returns) / chartMaximum * 100 : 0;
    return `<div class="sales-chart-month" title="${escapeHtml(item.month)}">
      <div class="sales-chart-bars"><span class="sales-chart-bar sales-chart-bar--sales" style="height:${salesHeight.toFixed(2)}%" title="مبيعات ${display(item.sales)}"></span>
        <span class="sales-chart-bar sales-chart-bar--returns" style="height:${returnHeight.toFixed(2)}%" title="مرتجعات ${display(item.returns)}"></span></div>
      <small>${escapeHtml(label)}</small>
    </div>`;
  }).join('');
  const topCustomers = summary.topCustomers.map((customer, index) => `
    <tr><td>${index + 1}</td><td>${escapeHtml(customer.name)}</td><td dir="ltr" class="sales-amount">${display(customer.total)}</td></tr>
  `).join('');
  const netNote = summary.returns === 0
    ? 'لا توجد مرتجعات معتمدة ضمن النتائج؛ المسودات لا تُخصم من المبيعات الصافية.'
    : 'الصافي = إجمالي الفواتير المعتمدة ناقص المرتجعات المعتمدة؛ القيمة الأساسية وفق البنود المسجلة.';
  return `
    <section class="section-heading section-heading--page"><div><p class="eyebrow">المبيعات · متابعة الأداء</p><h2>داشبورد المبيعات</h2><p class="muted">مؤشرات من المستندات والعملاء المسجلين فعليًا فقط.</p></div></section>
    <form data-form="sales-dashboard-filter" class="sales-dashboard-filters">
      <label class="field"><span>من تاريخ</span><input type="date" name="from" value="${escapeHtml(summary.from)}"></label>
      <label class="field"><span>إلى تاريخ</span><input type="date" name="to" value="${escapeHtml(summary.to)}"></label>
      <label class="field"><span>العميل المرتبط</span><select name="customerId"><option value="">كل العملاء</option>${customerOptions}</select></label>
      <label class="field"><span>حالة المستند</span><select name="status"><option value="all" ${summary.status === 'all' ? 'selected' : ''}>كل الحالات</option><option value="draft" ${summary.status === 'draft' ? 'selected' : ''}>مسودة</option><option value="approved" ${summary.status === 'approved' ? 'selected' : ''}>معتمد</option><option value="cancelled" ${summary.status === 'cancelled' ? 'selected' : ''}>ملغي</option></select></label>
      <button class="button button--primary" type="submit">تحديث المؤشرات</button>
    </form>
    <div class="sales-dashboard-metrics">
      <article class="sales-dashboard-metric"><span>العملاء المسجلون</span><strong>${summary.customers}</strong><small>يشمل النشط والمعطّل</small></article>
      <article class="sales-dashboard-metric"><span>فواتير البيع</span><strong>${summary.invoices}</strong><small>حسب الحالة والفلاتر المحددة</small></article>
      <article class="sales-dashboard-metric"><span>مرتجعات المبيعات</span><strong>${summary.returns}</strong><small>المسودات لا تؤثر في الصافي</small></article>
      <article class="sales-dashboard-metric sales-dashboard-metric--total"><span>صافي المبيعات المعتمدة</span><strong>${display(summary.netSales)}</strong><small>قيمة أساسية دون ضرائب أو قيود مالية</small></article>
    </div>
    <section class="sales-dashboard-panels">
      <article class="dashboard-panel sales-dashboard-chart-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">آخر 12 شهرًا</p><h3>المبيعات والمرتجعات</h3></div><div class="sales-chart-legend"><span><i class="sales-chart-dot sales-chart-dot--sales"></i>مبيعات معتمدة</span><span><i class="sales-chart-dot sales-chart-dot--returns"></i>مرتجعات معتمدة</span></div></header>
        <div class="sales-chart-grid" role="img" aria-label="رسم بياني شهري للقيم المسجلة">${monthLabels}</div>
        <p class="dashboard-data-note">${escapeHtml(netNote)} ${summary.customerId ? 'يُعرض فقط ما يرتبط بهذا العميل بمعرّف صريح؛ السجلات القديمة غير المرتبطة لا تُطابق بالاسم تلقائيًا.' : ''}</p>
      </article>
      <article class="dashboard-panel sales-top-customers"><header class="dashboard-panel__header"><div><p class="eyebrow">حسب الفلاتر</p><h3>أعلى العملاء</h3></div></header>
        <div class="table-scroll"><table><thead><tr><th>#</th><th>العميل</th><th>إجمالي الفواتير المعتمدة</th></tr></thead><tbody>${topCustomers || '<tr><td colspan="3" class="empty-state">لا توجد فواتير معتمدة بهذه الفلاتر.</td></tr>'}</tbody></table></div>
      </article>
    </section>
    <p class="sales-dependency">لوحة المؤشرات تعرض فقط فواتير ومرتجعات معتمدة في إجماليات المبيعات. لا تُنشأ قيم افتراضية ولا تُرحّل قيود مالية.</p>
  `;
}
