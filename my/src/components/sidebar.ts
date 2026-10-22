import { MODULES } from '../shared/modules.js';
import type { AccountingView, AssetView, ContractorView, DashboardView, InventoryView, ModuleKey, ProjectView, PurchaseView, SalesView, TreasuryView } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';
import type { PortfolioDashboardView } from '../pages/portfolio-dashboards.js';

const DASHBOARD_PAGES: ReadonlyArray<{ key: DashboardView; label: string }> = [
  { key: 'dashboard-new', label: 'لوحة المؤشرات الجديدة' },
  { key: 'dashboard-2', label: 'داش بورد 2' },
];

export const SALES_PAGES: ReadonlyArray<{ key: SalesView; label: string }> = [
  { key: 'sales-dashboard', label: 'داشبورد المبيعات' },
  { key: 'customers', label: 'العملاء' },
  { key: 'customer-groups', label: 'مجموعات العملاء' },
  { key: 'work-order', label: 'أوامر التشغيل' },
  { key: 'estimate', label: 'مقايسة العميل' },
  { key: 'certificate', label: 'مستخلص العميل' },
  { key: 'invoice', label: 'الفواتير' },
  { key: 'returns', label: 'مرتجعات المبيعات' },
];

export const PURCHASE_PAGES: ReadonlyArray<{ key: PurchaseView; label: string }> = [
  { key: 'purchase-dashboard', label: 'لوحة تحكم المشتريات' },
  { key: 'purchase-invoices', label: 'فواتير المشتريات' },
  { key: 'purchase-returns', label: 'مرتجع المشتريات' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'supplier-groups', label: 'مجموعات الموردين' },
];

export const INVENTORY_PAGES: ReadonlyArray<{ key: InventoryView; label: string }> = [
  { key: 'inventory-items', label: 'الأصناف' },
  { key: 'inventory-units', label: 'وحدات القياس' },
  { key: 'warehouses', label: 'المخازن' },
  { key: 'goods-receipts', label: 'إذن استلام بضاعة' },
  { key: 'stock-issues', label: 'سند صرف مخزني' },
  { key: 'stock-transfers', label: 'التحويل بين المخازن' },
];

export const ASSET_PAGES: ReadonlyArray<{ key: AssetView; label: string }> = [
  { key: 'asset-groups', label: 'مجموعات الأصول' },
  { key: 'asset-codes', label: 'تكويد الأصول' },
  { key: 'depreciation', label: 'إهلاك الأصول' },
];

export const TREASURY_PAGES: ReadonlyArray<{ key: TreasuryView; label: string }> = [
  { key: 'cash-boxes', label: 'الخزائن' },
  { key: 'banks', label: 'البنوك' },
];

export function renderSidebar(
  currentPage: ModuleKey,
  dashboardView: DashboardView,
  dashboardExpanded: boolean,
  salesView: SalesView,
  salesExpanded: boolean,
  purchaseView: PurchaseView,
  purchasesExpanded: boolean,
  inventoryView: InventoryView,
  inventoryExpanded: boolean,
  treasuryView: TreasuryView,
  treasuryExpanded: boolean,
  assetView: AssetView,
  assetsExpanded: boolean,
  portfolioView: PortfolioDashboardView,
  projectView: ProjectView,
  projectsExpanded: boolean,
  contractorView: ContractorView,
  contractorsExpanded: boolean,
  brokerageExpanded: boolean,
  accountingView: AccountingView,
  accountingExpanded: boolean,
  systemAdmin: boolean,
): string {
  const activeDashboard = currentPage === 'dashboard';
  const dashboardPages = DASHBOARD_PAGES.map(({ key, label }) => `
    <button class="nav-item nav-subitem ${dashboardView === key && activeDashboard ? 'nav-item--active' : ''}" type="button" data-dashboard-view="${key}" ${dashboardView === key && activeDashboard ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`).join('');
  const salesPages = SALES_PAGES.map(({ key, label }) => `
    <button class="nav-item nav-subitem ${salesView === key && currentPage === 'sales' ? 'nav-item--active' : ''}" type="button" data-sales-page="${key}" ${salesView === key && currentPage === 'sales' ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`).join('');
  const purchasePages = PURCHASE_PAGES.map(({ key, label }) => `
    <button class="nav-item nav-subitem ${purchaseView === key && currentPage === 'purchases' ? 'nav-item--active' : ''}" type="button" data-purchase-page="${key}" ${purchaseView === key && currentPage === 'purchases' ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`).join('');
  const inventoryPages = INVENTORY_PAGES.map(({ key, label }) => `
    <button class="nav-item nav-subitem ${inventoryView === key && currentPage === 'inventory' ? 'nav-item--active' : ''}" type="button" data-inventory-page="${key}" ${inventoryView === key && currentPage === 'inventory' ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`).join('');
  const assetPages = ASSET_PAGES.map(({ key, label }) => `
    <button class="nav-item nav-subitem ${assetView === key && currentPage === 'assets' ? 'nav-item--active' : ''}" type="button" data-asset-page="${key}" ${assetView === key && currentPage === 'assets' ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`).join('');
  const projectPages = ([
    { key: 'project-list', label: 'المشاريع' },
    { key: 'project-material-issues', label: 'صرف مواد المشاريع' },
    { key: 'work-items', label: 'بنود الأعمال' },
    { key: 'property-units', label: 'وحدات المشروع' },
    { key: 'property-contracts', label: 'عقود بيع الوحدات' },
    { key: 'property-payments', label: 'سداد مبيعات الوحدات' },
    { key: 'properties', label: 'داشبورد العقارات', dashboard: true },
    { key: 'projects', label: 'داشبورد المشاريع', dashboard: true },
  ] satisfies Array<{ key: ProjectView; label: string; dashboard?: boolean }>).map(({ key, label, dashboard }) => {
    const active = currentPage === 'projects' && (dashboard ? portfolioView === key : projectView === key);
    const dataAttribute = dashboard ? `data-portfolio-view="${key}"` : `data-project-view="${key}"`;
    return `
    <button class="nav-item nav-subitem ${active ? 'nav-item--active' : ''}" type="button" ${dataAttribute} ${active ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span>
    </button>`;
  }).join('');
  const contractorPages = ([
    { key: 'contractor-list' as ContractorView, label: 'المقاولون' },
    { key: 'contractor-contracts' as ContractorView, label: 'عقود المقاولين / المقايسات' },
    { key: 'contractor-certificates' as ContractorView, label: 'مستخلصات المقاولين' },
    { key: 'contractor-vouchers' as ContractorView, label: 'سندات المقاولين' },
    { key: 'customer-vouchers' as ModuleKey, label: 'سندات العملاء' },
    { key: 'supplier-vouchers' as ModuleKey, label: 'سندات الموردين' },
    { key: 'expenses' as ModuleKey, label: 'إدارة المصروفات' },
  ]).map(({ key, label }) => {
    const isContractorPage = key.startsWith('contractor-');
    const active = isContractorPage
      ? currentPage === 'contractors' && contractorView === key
      : currentPage === key;
    const pageAttribute = isContractorPage ? `data-contractor-view="${key}"` : `data-page="${key}"`;
    return `<button class="nav-item nav-subitem ${active ? 'nav-item--active' : ''}" type="button" ${pageAttribute} ${active ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span></button>`;
  }).join('');
  const treasuryPages = TREASURY_PAGES.map(({ key, label }) => {
    const active = currentPage === 'treasury' && treasuryView === key;
    return `<button class="nav-item nav-subitem ${active ? 'nav-item--active' : ''}" type="button" data-treasury-view="${key}" ${active ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
      <span class="nav-item__label">${escapeHtml(label)}</span></button>`;
  }).join('');
  const brokeragePage = `<button class="nav-item nav-subitem ${currentPage === 'brokerage' ? 'nav-item--active' : ''}" type="button" data-brokerage-page="broker-data" ${currentPage === 'brokerage' ? 'aria-current="page"' : ''} title="بيانات السمسرة"><span class="nav-item__label">بيانات السمسرة</span></button>`;
  const accountingPages = ([
    { key: 'chart-of-accounts' as AccountingView, label: 'الدليل المحاسبي' },
    { key: 'cost-centers' as AccountingView, label: 'مراكز التكلفة' },
    { key: 'daily-journals' as AccountingView, label: 'القيود اليومية' },
    { key: 'budgets' as AccountingView, label: 'الموازنة التقديرية' },
    ...(systemAdmin ? [{ key: 'financial-periods' as AccountingView, label: 'الفترات المحاسبية' }] : []),
  ]).map(({ key, label }) => `<button class="nav-item nav-subitem ${currentPage === 'accounts' && accountingView === key ? 'nav-item--active' : ''}" type="button" data-accounting-view="${key}" ${currentPage === 'accounts' && accountingView === key ? 'aria-current="page"' : ''} title="${escapeHtml(label)}"><span class="nav-item__label">${escapeHtml(label)}</span></button>`).join('');
  const items = MODULES
    .filter(({ key }) => key !== 'dashboard' && key !== 'sales' && key !== 'purchases' && key !== 'inventory' && key !== 'treasury'
      && key !== 'assets' && key !== 'projects' && key !== 'contractors' && key !== 'customer-vouchers'
      && key !== 'supplier-vouchers' && key !== 'expenses' && key !== 'brokerage' && key !== 'accounts'
      && key !== 'users' && key !== 'permission-groups' && key !== 'user-permissions')
    .map(({ key, label }) => `
      <button class="nav-item ${currentPage === key ? 'nav-item--active' : ''}" type="button" data-page="${key}" ${currentPage === key ? 'aria-current="page"' : ''} title="${escapeHtml(label)}">
        <span class="nav-item__label">${escapeHtml(label)}</span>
      </button>`).join('');

  return `
    <aside class="sidebar">
      <a class="brand" href="#" data-dashboard-view="dashboard-new" aria-label="Elsaad ERP الرئيسية"><span class="brand__mark">E</span><span class="brand__name">Elsaad <b>ERP</b></span></a>
      <div class="workspace-label"><span class="online-dot"></span>مساحة العمل المحلية</div>
      <nav class="side-navigation" aria-label="القائمة الرئيسية">
        <div class="nav-group">
          <button class="nav-item nav-parent ${activeDashboard ? 'nav-item--active' : ''}" type="button" data-action="dashboard-toggle" aria-expanded="${dashboardExpanded}" aria-controls="dashboard-subpages" title="لوحة المؤشرات">
            <span class="nav-item__label">لوحة المؤشرات</span>
            <svg class="nav-chevron ${dashboardExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="dashboard-subpages" ${dashboardExpanded ? '' : 'hidden'}>
            ${dashboardPages}
          </div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'sales' ? 'nav-item--active' : ''}" type="button" data-action="sales-toggle" aria-expanded="${salesExpanded}" aria-controls="sales-subpages" title="المبيعات">
            <span class="nav-item__label">المبيعات</span>
            <svg class="nav-chevron ${salesExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="sales-subpages" ${salesExpanded ? '' : 'hidden'}>
            ${salesPages}
          </div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'purchases' ? 'nav-item--active' : ''}" type="button" data-action="purchases-toggle" aria-expanded="${purchasesExpanded}" aria-controls="purchases-subpages" title="المشتريات">
            <span class="nav-item__label">المشتريات</span>
            <svg class="nav-chevron ${purchasesExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="purchases-subpages" ${purchasesExpanded ? '' : 'hidden'}>
            ${purchasePages}
          </div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'inventory' ? 'nav-item--active' : ''}" type="button" data-action="inventory-toggle" aria-expanded="${inventoryExpanded}" aria-controls="inventory-subpages" title="المخزون">
            <span class="nav-item__label">المخزون</span>
            <svg class="nav-chevron ${inventoryExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="inventory-subpages" ${inventoryExpanded ? '' : 'hidden'}>
            ${inventoryPages}
          </div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'treasury' ? 'nav-item--active' : ''}" type="button" data-action="treasury-toggle" aria-expanded="${treasuryExpanded}" aria-controls="treasury-subpages" title="الخزائن والبنوك">
            <span class="nav-item__label">الخزائن والبنوك</span><svg class="nav-chevron ${treasuryExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button><div class="nav-submenu" id="treasury-subpages" ${treasuryExpanded ? '' : 'hidden'}>${treasuryPages}</div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'assets' ? 'nav-item--active' : ''}" type="button" data-action="assets-toggle" aria-expanded="${assetsExpanded}" aria-controls="assets-subpages" title="الأصول">
            <span class="nav-item__label">الأصول</span><svg class="nav-chevron ${assetsExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button><div class="nav-submenu" id="assets-subpages" ${assetsExpanded ? '' : 'hidden'}>${assetPages}</div>
        </div>
            <div class="nav-group">
              <button class="nav-item nav-parent ${currentPage === 'projects' ? 'nav-item--active' : ''}" type="button" data-action="projects-toggle" aria-expanded="${projectsExpanded}" aria-controls="projects-subpages" title="المشاريع">
                <span class="nav-item__label">المشاريع</span>
                <svg class="nav-chevron ${projectsExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
              </button>
              <div class="nav-submenu" id="projects-subpages" ${projectsExpanded ? '' : 'hidden'}>
                ${projectPages}
              </div>
            </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'accounts' ? 'nav-item--active' : ''}" type="button" data-action="accounting-toggle" aria-expanded="${accountingExpanded}" aria-controls="accounting-subpages" title="الحسابات">
            <span class="nav-item__label">الحسابات</span><svg class="nav-chevron ${accountingExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button><div class="nav-submenu" id="accounting-subpages" ${accountingExpanded ? '' : 'hidden'}>${accountingPages}</div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'brokerage' ? 'nav-item--active' : ''}" type="button" data-action="brokerage-toggle" aria-expanded="${brokerageExpanded}" aria-controls="brokerage-subpages" title="السمسرة">
            <span class="nav-item__label">السمسرة</span>
            <svg class="nav-chevron ${brokerageExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="brokerage-subpages" ${brokerageExpanded ? '' : 'hidden'}>${brokeragePage}</div>
        </div>
        <div class="nav-group">
          <button class="nav-item nav-parent ${currentPage === 'contractors' ? 'nav-item--active' : ''}" type="button" data-action="contractors-toggle" aria-expanded="${contractorsExpanded}" aria-controls="contractors-subpages" title="المقاولون">
            <span class="nav-item__label">المقاولون</span>
            <svg class="nav-chevron ${contractorsExpanded ? 'nav-chevron--open' : ''}" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5"></path></svg>
          </button>
          <div class="nav-submenu" id="contractors-subpages" ${contractorsExpanded ? '' : 'hidden'}>${contractorPages}</div>
        </div>
            ${items}
      </nav>
      <div class="sidebar-footer"><span>Elsaad ERP</span><span>تطبيق سطح مكتب</span></div>
    </aside>
  `;
}
