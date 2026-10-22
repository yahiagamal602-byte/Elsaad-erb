import type { PortfolioDashboard, PortfolioDashboardFilters, PortfolioProject } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

export type PortfolioDashboardView = 'properties' | 'projects';

function integer(value: number | null): string {
  return value === null ? 'لا توجد بيانات كافية' : new Intl.NumberFormat('ar').format(value);
}

function monthName(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ar', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1));
}

function filtersForm(
  view: PortfolioDashboardView,
  dashboard: PortfolioDashboard,
  filters: PortfolioDashboardFilters,
): string {
  const options = dashboard.projects.map((project) =>
    `<option value="${project.id}" ${filters.projectId === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`,
  ).join('');
  return `<form class="portfolio-filters" data-form="portfolio-filter" data-view="${view}">
    <label class="field"><span>المشروع</span><select name="projectId"><option value="">كل المشاريع</option>${options}</select></label>
    <label class="field"><span>من تاريخ</span><input name="from" type="date" value="${escapeHtml(filters.from)}"></label>
    <label class="field"><span>إلى تاريخ</span><input name="to" type="date" value="${escapeHtml(filters.to)}"></label>
    <div class="portfolio-filter-actions"><button class="button button--primary" type="submit">تطبيق الفلاتر</button>
      <button class="button button--secondary" type="button" data-action="portfolio-reset">إعادة التعيين</button>
      <button class="button button--secondary" type="button" data-action="portfolio-refresh">تحديث</button>
      <button class="button button--secondary" type="button" data-action="portfolio-print">طباعة</button></div>
  </form>`;
}

function metric(label: string, value: string, note: string, variant = ''): string {
  return `<article class="portfolio-metric ${variant ? `portfolio-metric--${variant}` : ''}">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function notice(title: string, detail: string, variant = ''): string {
  return `<div class="portfolio-notice ${variant ? `portfolio-notice--${variant}` : ''}" role="note">
    <strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function chartPanel(dashboard: PortfolioDashboard, view: PortfolioDashboardView): string {
  const projectFilter = dashboard.projectId !== null;
  const counts = dashboard.monthly.map((month) => view === 'properties'
    ? [month.approvedInvoices, month.approvedReturns]
    : [month.postedRevenueLines, month.postedExpenseLines]);
  const maximum = Math.max(1, ...counts.flat());
  const bars = dashboard.monthly.map((month, index) => {
    const first = counts[index][0];
    const second = counts[index][1];
    const firstHeight = first ? Math.max(4, first / maximum * 110) : 0;
    const secondHeight = second ? Math.max(4, second / maximum * 110) : 0;
    return `<div class="portfolio-chart-month" title="${escapeHtml(month.month)}">
      <div class="portfolio-chart-bars"><span class="portfolio-chart-bar portfolio-chart-bar--primary" style="height:${firstHeight}px" aria-label="${first}"></span>
        <span class="portfolio-chart-bar portfolio-chart-bar--secondary" style="height:${secondHeight}px" aria-label="${second}"></span></div>
      <small>${escapeHtml(monthName(month.month))}</small></div>`;
  }).join('');
  const title = view === 'properties' ? 'نشاط المبيعات والمرتجعات المعتمدة' : 'حركة القيود المعتمدة حسب الحساب';
  const caption = view === 'properties'
    ? 'عدد فواتير المبيعات والمرتجعات المعتمدة شهريًا؛ القيمة والتحصيل لا يظهران لغياب العملة والدفعات المرتبطة.'
    : 'عدد أسطر قيود الإيرادات والمصروفات المثبتة شهريًا؛ المبالغ لا تُجمع لأن رمز العملة غير محفوظ.';
  return `<article class="dashboard-panel portfolio-chart-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">بيانات فعلية</p>
      <h3>${title}</h3><p class="dashboard-panel__subtitle">${caption}</p></div></header>
      ${projectFilter ? '<div class="portfolio-empty-chart">لا توجد روابط بين المشروع المختار والفواتير أو القيود لعرضها.</div>'
        : dashboard.monthly.some((month) => month.approvedInvoices + month.approvedReturns + month.postedRevenueLines + month.postedExpenseLines > 0)
          ? `<div class="portfolio-chart-scroll"><div class="portfolio-chart" style="grid-template-columns:repeat(${dashboard.monthly.length},minmax(24px,1fr));min-width:${Math.max(460, dashboard.monthly.length * 34)}px">${bars}</div></div>`
          : '<div class="portfolio-empty-chart">لا توجد بيانات حقيقية لهذه الفترة.</div>'}
      <div class="portfolio-legend"><span><i class="portfolio-legend__dot"></i>${view === 'properties' ? 'فواتير معتمدة' : 'أسطر إيرادات مثبتة'}</span>
        <span><i class="portfolio-legend__dot portfolio-legend__dot--secondary"></i>${view === 'properties' ? 'مرتجعات معتمدة' : 'أسطر مصروفات مثبتة'}</span></div>
    </article>`;
}

function projectTable(projects: PortfolioProject[], selectedProjectId: number | null): string {
  const shown = selectedProjectId === null ? projects : projects.filter((project) => project.id === selectedProjectId);
  const statusName = (status: string): string => ({
    new: 'جديد',
    'in-progress': 'قيد المعالجة',
    'on-hold': 'متوقف',
    completed: 'مكتمل',
    cancelled: 'ملغي',
  }[status] ?? status);
  const rows = shown.map((project) => `<tr><td><strong>${escapeHtml(project.name)}</strong></td>
    <td>${escapeHtml(project.reference || '—')}</td><td>${escapeHtml(project.date || '—')}</td><td>${escapeHtml(statusName(project.status))}</td>
    <td class="portfolio-unavailable-cell">لا توجد بيانات كافية</td></tr>`).join('');
  return `<article class="dashboard-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">سجل المشاريع</p>
      <h3>المشاريع المسجلة ومؤشر اكتمال بياناتها المالية</h3><p class="dashboard-panel__subtitle">المشروعات من السجلات الحالية؛ لا توجد علاقة موثقة تربطها بفواتير البيع أو القيود.</p></div></header>
      <div class="table-scroll"><table class="portfolio-table"><thead><tr><th>المشروع</th><th>المرجع</th><th>التاريخ</th><th>الحالة</th><th>الإيرادات والتكاليف</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">لا توجد سجلات مشاريع للفترة المختارة.</td></tr>'}</tbody></table></div></article>`;
}

function propertyDashboard(dashboard: PortfolioDashboard): string {
  const noProjectFilter = dashboard.projectId === null;
  const contracts = noProjectFilter ? dashboard.approvedWorkOrderCount : null;
  return `<section class="portfolio-metrics portfolio-metrics--four">
      ${metric('إجمالي مبيعات الوحدات', 'لا توجد بيانات كافية', 'لا يوجد سجل وحدات عقارية أو عملة مبيعات محفوظة.', 'primary')}
      ${metric('عمولات السمسرة', 'لا توجد بيانات كافية', 'قسم العمولات لا يوفر سجلات مالية مرتبطة.')}
      ${metric('أوامر التشغيل المعتمدة', integer(contracts), 'مؤشر عقود بديل من مستندات المبيعات المعتمدة؛ ليس عدد عقود وحدات عقارية.')}
      ${metric('العقود المسلّمة', 'لا توجد بيانات كافية', 'لا توجد حالة تسليم أو سجل استلام عقاري.')}
    </section>
    ${notice('توزيع الوحدات غير متاح', 'لا يحتوي المخطط الحالي على سجل وحدات عقارية أو حالتي «مباع» و«متاح». لا نعرض نسبًا تقديرية.', 'warning')}
    <section class="portfolio-grid portfolio-grid--two">${chartPanel(dashboard, 'properties')}
      <article class="dashboard-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">تحصيلات وأقساط</p><h3>موقف الاستحقاقات</h3>
        <p class="dashboard-panel__subtitle">القيمة النقدية والتحصيل تتطلب سندات مرتبطة بالعقود.</p></div></header>
        <div class="portfolio-installment-grid">${metric('أقساط متأخرة', 'لا توجد بيانات كافية', 'لا توجد جداول أقساط.')}${metric('مسددة جزئيًا', 'لا توجد بيانات كافية', 'لا توجد حركات تحصيل.')}${metric('أقساط قادمة', 'لا توجد بيانات كافية', 'لا يوجد تقويم استحقاقات.')}</div>
        ${notice('التحصيل الفعلي غير متاح', 'الفواتير المعتمدة لا تعني تحصيلًا نقديًا، ولا توجد سندات قبض أو روابط دفعات في المخطط الحالي.', 'warning')}
      </article></section>
    <section class="portfolio-grid portfolio-grid--two">${projectTable(dashboard.projects, dashboard.projectId)}
      <article class="dashboard-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">متابعة</p><h3>الأقساط المتأخرة</h3>
        <p class="dashboard-panel__subtitle">تفاصيل العميل والعقد والمتبقي لا تتوفر دون سجل أقساط ودفعات.</p></div></header>
        <div class="table-scroll"><table class="portfolio-table"><thead><tr><th>العميل</th><th>المشروع</th><th>الوحدة / العقد</th><th>قيمة القسط</th><th>المدفوع</th><th>المتبقي</th><th>الاستحقاق</th><th>أيام التأخير</th></tr></thead>
        <tbody><tr><td colspan="8" class="empty-state">لا توجد بيانات كافية لعرض أقساط متأخرة.</td></tr></tbody></table></div></article></section>`;
}

function projectDashboard(dashboard: PortfolioDashboard): string {
  const projectSpecific = dashboard.projectId !== null;
  const financeNote = projectSpecific
    ? 'لا توجد علاقة مشروع مسجلة في مستندات المبيعات أو القيود، لذا لا يمكن إسناد مبالغ للمشروع المحدد.'
    : 'المبالغ غير معروضة: لا يسجل دفتر اليومية أو مستندات البيع رمز العملة، ولا يوجد تحويل موثق بين العملات.';
  return `<section class="portfolio-metrics portfolio-metrics--four">
      ${metric('الإيرادات المثبتة', 'لا توجد بيانات كافية', projectSpecific ? financeNote : 'لا يمكن تجميع مبالغ بلا عملة معلومة.', 'primary')}
      ${metric('التكاليف المثبتة', 'لا توجد بيانات كافية', 'لا توجد عملة أو تصنيف مالي موثق حسب المشروع.')}
      ${metric('الربح التشغيلي', 'لا توجد بيانات كافية', 'لا يمكن طرح مبالغ محتملة بعملات مختلفة.')}
      ${metric('هامش الربح', 'لا توجد بيانات كافية', 'يتطلب إيرادًا وتكلفة موثقين بالعملة نفسها.')}</section>
    ${notice('حدود مصدر البيانات', financeNote, 'warning')}
    ${dashboard.unpostedPurchaseInvoiceCount
      ? notice('فواتير مشتريات غير مرحلة', `يوجد ${integer(dashboard.unpostedPurchaseInvoiceCount)} فاتورة مشتريات مسودة في الفترة. لم تُحتسب تكاليف لأنها غير معتمدة.`, 'warning') : ''}
    <section class="portfolio-grid portfolio-grid--two">${chartPanel(dashboard, 'projects')}
      <article class="dashboard-panel"><header class="dashboard-panel__header"><div><p class="eyebrow">المؤشرات المرتبطة</p><h3>سجلات فعلية دون تجميع نقدي</h3>
        <p class="dashboard-panel__subtitle">الأعداد من الفواتير والقيود المثبتة؛ لا تمثل مبالغ إيرادات أو تحصيلات.</p></div></header>
        <div class="portfolio-breakdown">
          <div><span>فواتير بيع معتمدة</span><strong>${integer(projectSpecific ? null : dashboard.approvedInvoiceCount)}</strong></div>
          <div><span>مرتجعات بيع معتمدة</span><strong>${integer(projectSpecific ? null : dashboard.approvedReturnCount)}</strong></div>
          <div><span>أسطر إيراد مثبتة</span><strong>${integer(projectSpecific ? null : dashboard.postedRevenueLineCount)}</strong></div>
          <div><span>أسطر مصروف مثبتة</span><strong>${integer(projectSpecific ? null : dashboard.postedExpenseLineCount)}</strong></div>
        </div>${notice('تحصيلات ومقاولون ومواد وعمولات', 'لا توجد علاقات تحصيل أو تصنيف تكلفة/مقاول/مواد أو عمولات مرتبطة بمشروع في البيانات المتاحة.', 'warning')}
      </article></section>
    ${projectTable(dashboard.projects, dashboard.projectId)}`;
}

export function renderPortfolioDashboard(
  view: PortfolioDashboardView,
  dashboard: PortfolioDashboard,
  filters: PortfolioDashboardFilters,
): string {
  const title = view === 'properties' ? 'داشبورد العقارات' : 'داشبورد المشاريع';
  const content = view === 'properties' ? propertyDashboard(dashboard) : projectDashboard(dashboard);
  return `<section class="section-heading section-heading--page"><div><p class="eyebrow">لوحات تحليلية · بيانات SQLite الحالية</p><h2>${title}</h2>
      <p class="muted">تعرض اللوحة المؤشرات القابلة للإثبات فقط، وتوضح مصادر البيانات الناقصة.</p></div></section>
    ${filtersForm(view, dashboard, filters)}<div class="portfolio-dashboard" data-portfolio-dashboard>${content}</div>`;
}
