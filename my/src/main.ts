import './styles/base.css';
import './styles/app.css';
import { MODULES } from './shared/modules.js';
import { formatAmount, parseAmount } from './shared/accounting.js';
import { encodeCsv } from './shared/csv.js';
import { calculateContractAmounts, fromCents, toCents, validateScheduleTotal } from './shared/property-sales.js';
import type {
  AccountItem,
  AccountingPeriodClosure,
  AccountingView,
  Asset,
  AssetDepreciationReport,
  AssetGroup,
  AssetInput,
  AssetView,
  BankAccount,
  BackupState,
  Budget,
  CashBox,
  CompanyProfile,
  Contractor,
  ContractorContract,
  ContractorContractInput,
  ContractorInput,
  ContractorStatus,
  ContractorView,
  CostCenter,
  Customer,
  CustomerGroup,
  DashboardView,
  Expense,
  ExpenseInput,
  FinancialVoucher,
  FinancialVoucherInput,
  FinancialVoucherParty,
  GeneralSettings,
  ManagedUser,
  JournalEntryItem,
  InventoryItem,
  InventoryIssue,
  InventoryReceipt,
  InventoryStockBalance,
  InventoryTransfer,
  InventoryStatus,
  InventoryUnit,
  InventoryView,
  ModuleKey,
  PurchaseDashboardSummary,
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseReturn,
  PurchaseStatus,
  PurchaseView,
  PortfolioDashboard,
  PortfolioDashboardFilters,
  PropertyBroker,
  PropertyContract,
  PropertyInstallmentFrequency,
  PropertyContractInput,
  BrokerCommissionTreatment,
  PropertyUnit,
  Project,
  ProjectStatus,
  ProjectView,
  ProjectWorkItem,
  PermissionDefinition,
  PermissionGroup,
  RestoreCandidate,
  RecordInput,
  RecordItem,
  SalesDocument,
  SalesDocumentInput,
  SalesDocumentLineInput,
  SalesDocumentType,
  SalesReturn,
  SalesView,
  SalesDashboardSummary,
  UserPermissionState,
  Supplier,
  SupplierGroup,
  ThemeMode,
  TreasuryStatus,
  TreasuryView,
  Warehouse,
} from './shared/types.js';
import { escapeHtml } from './utils/html.js';
import { ASSET_PAGES, INVENTORY_PAGES, PURCHASE_PAGES, renderSidebar } from './components/sidebar.js';
import { renderThemeToggle } from './components/theme-toggle.js';
import {
  renderBudgetEditor,
  renderBudgetLine,
  renderBudgets,
  renderAccountingPeriods,
  renderChartOfAccounts,
  renderCostCenters,
  renderJournalDetail,
  renderJournalEditor,
  renderJournalLine,
  renderJournals,
} from './pages/accounting.js';
import { renderDashboard } from './pages/dashboard.js';
import {
  renderExpenseAllocationRow,
  renderExpenseEditor,
  renderExpensesPage,
  renderFinancialVoucherEditor,
  renderFinancialVouchersPage,
} from './pages/financial-documents.js';
import { renderRecordsPage } from './pages/records.js';
import type { SettingsView } from './pages/settings.js';
import { renderSalesEditor, renderSalesLine, renderSalesPage, renderSalesPrint } from './pages/sales-documents.js';
import { customersCsv, parseCustomersCsv, renderCustomerForm, renderCustomerGroupForm, renderCustomerGroupsPage, renderCustomersPage } from './pages/sales-masters.js';
import { renderSalesDashboard } from './pages/sales-dashboard.js';
import { renderSalesReturnEditor, renderSalesReturnPrint, renderSalesReturnsPage } from './pages/sales-returns.js';
import { renderInstallmentReportResults, renderInstallmentReportSummary, renderInstallmentReportsPage, type InstallmentGrouping, type InstallmentReportPageState } from './pages/installment-reports.js';
import { REPORT_GROUPS, defaultReportFilters, reportCsv } from './shared/reports.js';
import type { ReportLibrary, ReportResult, ReportRunFilters } from './shared/reports.js';
import { renderReportLibraryBody, renderReportPrint, renderReportsPage, renderReportWorkspace, type ReportsPageState } from './pages/reports.js';
import {
  previewPropertySchedule,
  renderPropertyCommissionDialog,
  renderPropertyContractsPage,
  renderPropertyPaymentsPage,
  renderPropertyBrokerForm,
  renderBrokerageEditor,
  renderBrokeragePage,
  renderBrokeragePrint,
  renderPropertyContractEditor,
  renderPropertyUnitForm,
  renderPropertyUnitsPage,
} from './pages/property-sales.js';
import { renderPortfolioDashboard, type PortfolioDashboardView } from './pages/portfolio-dashboards.js';
import {
  renderContractorCertificateEditor,
  renderContractorCertificateLine,
  renderContractorCertificatesPage,
  renderContractorContractEditor,
  renderContractorContractsPage,
  renderContractorEditor,
  renderContractorOpeningEntry,
  renderContractorContractLine,
  renderContractorVoucherEditor,
  renderContractorVouchersPage,
  renderContractorsPage,
} from './pages/contractors.js';
import {
  projectIssueLine,
  renderProjectForm,
  renderProjectIssueForm,
  renderProjectIssuePrint,
  renderProjectMaterialsPage,
  renderProjectsPage,
  renderWorkItemsPage,
} from './pages/project-management.js';
import { renderTreasuryForm, renderTreasuryPage } from './pages/treasury.js';
import { documentLinesForPrint, getInventoryMovementInput, getInventoryReceiptInput, renderInventoryDocumentForm, renderInventoryDocumentsPage, renderReceiptLines } from './pages/inventory-documents.js';
import {
  invoiceCsv,
  renderPurchaseDashboard,
  renderPurchaseInvoiceForm,
  renderPurchaseInvoices,
  renderPurchasePrint,
  renderPurchaseReturnEditor,
  renderPurchaseReturnPrint,
  renderPurchaseReturns,
  renderPurchaseInvoiceLine,
  renderSupplierForm,
  renderSupplierGroupForm,
  renderSupplierGroups,
  renderSuppliers,
} from './pages/purchases.js';
import {
  renderInventoryItemForm,
  renderInventoryItems,
  renderInventoryUnitForm,
  renderInventoryUnits,
  renderWarehouseForm,
  renderWarehouses,
} from './pages/inventory.js';
import { renderAssetEditor, renderAssetGroupEditor, renderAssetGroupsPage, renderAssetsPage, renderDepreciationPage, renderDepreciationRun } from './pages/assets.js';

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>('#app');
  if (!element) throw new Error('تعذر العثور على مساحة التطبيق.');
  return element;
}

const root = getAppRoot();

function isSalesView(value: string): value is SalesView {
  return value === 'sales-dashboard' || value === 'customers' || value === 'customer-groups'
    || value === 'work-order' || value === 'estimate' || value === 'certificate'
    || value === 'invoice' || value === 'returns';
}

let currentPage: ModuleKey = 'dashboard';
let authenticatedUser: ManagedUser | null = null;
let currentRecords: RecordItem[] = [];
let accounts: AccountItem[] = [];
let journalEntries: JournalEntryItem[] = [];
let currentAccountingView: AccountingView = 'chart-of-accounts';
let accountingExpanded = true;
let costCenters: CostCenter[] = [];
let budgets: Budget[] = [];
let accountingPeriodClosures: AccountingPeriodClosure[] = [];
let accountSearch = '';
let costCenterSearch = '';
let journalSearch = '';
let budgetSearch = '';
let currentTreasuryView: TreasuryView = 'cash-boxes';
let treasuryExpanded = true;
let cashBoxes: CashBox[] = [];
let bankAccounts: BankAccount[] = [];
let version = '';
let currentTheme: ThemeMode = 'light';
let currentDashboardView: DashboardView = 'dashboard-new';
let dashboardExpanded = true;
let currentSalesView: SalesView = 'sales-dashboard';
let salesExpanded = true;
let salesDocuments: SalesDocument[] = [];
let customers: Customer[] = [];
let customerGroups: CustomerGroup[] = [];
let salesReturns: SalesReturn[] = [];
let salesDashboardFilters: { from: string; to: string; customerId: number | null; status: SalesDashboardSummary['status'] } = {
  from: '',
  to: '',
  customerId: null,
  status: 'all',
};
let salesDashboardSummary: SalesDashboardSummary | null = null;
let customerGroupFilter = '';
let currentPurchaseView: PurchaseView = 'purchase-dashboard';
let purchasesExpanded = true;
let currentInventoryView: InventoryView = 'inventory-items';
let inventoryExpanded = true;
let currentAssetView: AssetView = 'asset-groups';
let assetsExpanded = true;
let assetGroups: AssetGroup[] = [];
let fixedAssets: Asset[] = [];
let assetGroupSearch = '';
let assetSearch = '';
const currentMonthRange = (): { from: string; to: string } => {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const isoDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: isoDate(from), to: isoDate(to) };
};
let assetDepreciationRange = currentMonthRange();
let assetDepreciationReport: AssetDepreciationReport | null = null;
let currentPortfolioView: PortfolioDashboardView = 'properties';
let currentProjectView: ProjectView = 'project-list';
let projectsExpanded = true;
let currentContractorView: ContractorView = 'contractor-list';
let contractorsExpanded = true;
let brokerageExpanded = true;
let brokerageSearch = '';
let brokerageNotice = '';
let contractors: Contractor[] = [];
let contractorContracts: ContractorContract[] = [];
let contractorCertificates: any[] = [];
let contractorVouchers: any[] = [];
let contractorSearch = '';
let contractorContractSearch = '';
let contractorCertificateSearch = '';
let contractorVoucherSearch = '';
let preferredContractorId: number | null = null;
let portfolioFilters: PortfolioDashboardFilters = { from: '', to: '', projectId: null };
let portfolioDashboard: PortfolioDashboard | null = null;
let projects: Project[] = [];
let projectWorkItems: ProjectWorkItem[] = [];
let projectListPage = 1;
let workItemProjectFilter: number | null = null;
let propertyProjectFilter: number | null = null;
let propertyUnits: PropertyUnit[] = [];
let propertyBrokers: PropertyBroker[] = [];
let propertyContracts: PropertyContract[] = [];
let propertyPaymentSearch = '';
let propertyPaymentContractId: number | null = null;
let pendingPropertyContract: PropertyContractInput | null = null;
let editingWorkItemId: number | null = null;
let inventoryItems: InventoryItem[] = [];
let inventoryUnits: InventoryUnit[] = [];
let warehouses: Warehouse[] = [];
let inventoryBalances: InventoryStockBalance[] = [];
let inventoryReceipts: InventoryReceipt[] = [];
let inventoryIssues: InventoryIssue[] = [];
let inventorySalesInvoices: SalesDocument[] = [];
let inventoryTransfers: InventoryTransfer[] = [];
let inventoryAccounts: AccountItem[] = [];
let suppliers: Supplier[] = [];
let supplierGroups: SupplierGroup[] = [];
let purchaseInvoices: PurchaseInvoice[] = [];
let purchaseReturns: PurchaseReturn[] = [];
let purchaseAccounts: AccountItem[] = [];
let purchaseDashboardFilters: { from: string; to: string; supplierId: number | null; status: PurchaseDashboardSummary['status']; category: string } = {
  from: '', to: '', supplierId: null, status: 'all', category: '',
};
let financialVouchers: FinancialVoucher[] = [];
let expenses: Expense[] = [];
let financialVoucherSearch = '';
let expenseSearch = '';
let purchaseDashboardSummary: PurchaseDashboardSummary | null = null;
let purchaseInvoiceStatusFilter: PurchaseStatus | '' = '';
const inventorySortDirections = new Map<string, boolean>();

const REPORT_FAVORITES_KEY = 'elsaad.reports.favorites';
const REPORT_RECENT_KEY = 'elsaad.reports.recent';
let reportLibrary: ReportLibrary | null = null;
let currentReportKey = 'trial-balance';
let reportFilters: ReportRunFilters = defaultReportFilters();
let reportResult: ReportResult | null = null;
let reportSearch = '';
let reportFavorites: string[] = readReportStorage(REPORT_FAVORITES_KEY);
let reportRecent: string[] = readReportStorage(REPORT_RECENT_KEY);
let reportExpandedGroups: string[] = REPORT_GROUPS.map(({ key }) => key);
let reportError = '';
let reportLoading = false;
let reportInitialized = false;
let reportRunToken = 0;
let installmentReportFilters: ReportRunFilters = defaultReportFilters();
let installmentReportResult: ReportResult | null = null;
let installmentReportSearch = '';
let installmentReportGrouping: InstallmentGrouping = 'customer';
let installmentReportLoading = false;
let installmentReportError = '';
let installmentReportInitialized = false;
let installmentReportRunToken = 0;
let previousPage: ModuleKey = 'dashboard';
let usersReturnPage: ModuleKey = 'dashboard';
let settingsView: SettingsView = 'general';
let settingsVersion = '';
let settingsGeneral: GeneralSettings = { theme: 'light', invoicePrefix: 'INV' };
let settingsBackup: BackupState = {
  preferences: { directory: '', automatic: false, intervalHours: 24, retentionCount: 10 },
  history: [],
};
let settingsCompany: CompanyProfile = {
  nameAr: '', nameEn: '', addressAr: '', addressEn: '', email: '', phone: '',
  commercialRegister: '', taxNumber: '', logoDataUrl: '',
};
let selectedRestoreCandidate: RestoreCandidate | null = null;
let managedUsers: ManagedUser[] = [];
let permissionGroups: PermissionGroup[] = [];
let permissionDefinitions: PermissionDefinition[] = [];
let selectedManagedUserId: number | null = null;
let creatingManagedUser = false;
let selectedPermissionGroupId: number | null = null;
let selectedUserPermissionState: UserPermissionState | null = null;

function applyTheme(theme: ThemeMode): void {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#171b18' : '#f7f8f7';
  document.querySelectorAll<HTMLButtonElement>('[data-action="theme-toggle"]').forEach((button) => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    const label = nextTheme === 'dark' ? 'التبديل إلى المظهر الداكن' : 'التبديل إلى المظهر الفاتح';
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}

function renderLogin(message = ''): void {
  root.innerHTML = `
    <main class="login-page">
      ${renderThemeToggle(currentTheme, 'theme-toggle--login')}
      <section class="login-card">
        <div class="brand brand--login"><span class="brand__mark">E</span><span class="brand__name">Elsaad <b>ERP</b></span></div>
        <p class="eyebrow">مساحة عملك، بوضوح</p>
        <h1>تسجيل الدخول</h1>
        <p class="muted">أدخل بيانات حسابك للمتابعة إلى النظام.</p>
        <form id="login-form" data-form="login" class="login-form">
          <label class="field"><span>اسم المستخدم</span><input name="username" required autocomplete="username" autofocus></label>
          <label class="field"><span>كلمة المرور</span><input name="password" type="password" required autocomplete="current-password"></label>
          <p class="form-error" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
          <button class="button button--primary button--block" type="submit">دخول إلى النظام</button>
        </form>
        <div class="login-footnote"><span class="online-dot"></span>تطبيق محلي — البيانات محفوظة على هذا الجهاز</div>
      </section>
      <footer class="developer-credit developer-credit--login">
        <span class="developer-credit__name" lang="en" dir="ltr">Developed by Mohanda Saad</span>
        <bdi class="developer-credit__phones" dir="ltr">01014998059 / 01069670339</bdi>
      </footer>
    </main>
  `;
}

function renderInitialSetup(message = ''): void {
  root.innerHTML = `
    <main class="login-page">
      ${renderThemeToggle(currentTheme, 'theme-toggle--login')}
      <section class="login-card">
        <div class="brand brand--login"><span class="brand__mark">E</span><span class="brand__name">Elsaad <b>ERP</b></span></div>
        <p class="eyebrow">إعداد آمن لمرة واحدة</p>
        <h1>إنشاء كلمة مرور المدير</h1>
        <p class="muted">قبل فتح بيانات التطبيق، عيّن كلمة مرور قوية لحساب مدير النظام. لن يمكن تخطي هذه الخطوة.</p>
        <form data-form="initial-setup" class="login-form">
          <label class="field"><span>كلمة المرور الجديدة</span><input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" autofocus></label>
          <label class="field"><span>تأكيد كلمة المرور</span><input name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
          <small class="muted">12 حرفًا على الأقل، مع حرف كبير وصغير ورقم ورمز.</small>
          <p class="form-error" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
          <button class="button button--primary button--block" type="submit">حفظ كلمة المرور وفتح التطبيق</button>
        </form>
        <div class="login-footnote"><span class="online-dot"></span>سيُنشأ حساب المدير بعد تعيين كلمة المرور فقط</div>
      </section>
    </main>
  `;
}

function renderLegacyPasswordChange(message = '', username = ''): void {
  root.innerHTML = `
    <main class="login-page">
      ${renderThemeToggle(currentTheme, 'theme-toggle--login')}
      <section class="login-card">
        <div class="brand brand--login"><span class="brand__mark">E</span><span class="brand__name">Elsaad <b>ERP</b></span></div>
        <p class="eyebrow">تحديث أمني مطلوب</p>
        <h1>غيّر كلمة المرور الافتراضية</h1>
        <p class="muted">لحماية قاعدة البيانات الموجودة، يجب استبدال كلمة مرور المدير الافتراضية قبل المتابعة.</p>
        <form data-form="legacy-password-change" class="login-form">
          <label class="field"><span>اسم المستخدم</span><input name="username" value="${escapeHtml(username)}" required autocomplete="username"></label>
          <label class="field"><span>كلمة المرور الحالية</span><input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label class="field"><span>كلمة المرور الجديدة</span><input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
          <label class="field"><span>تأكيد كلمة المرور الجديدة</span><input name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
          <small class="muted">12 حرفًا على الأقل، مع حرف كبير وصغير ورقم ورمز.</small>
          <p class="form-error" role="alert" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>
          <button class="button button--primary button--block" type="submit">تحديث كلمة المرور</button>
        </form>
      </section>
    </main>
  `;
}

function renderNoAccess(): void {
  root.innerHTML = `
    <main class="login-page">
      <section class="login-card">
        <div class="brand brand--login"><span class="brand__mark">E</span><span class="brand__name">Elsaad <b>ERP</b></span></div>
        <h1>لا توجد صلاحية للوصول</h1>
        <p class="muted">لا يملك هذا الحساب صلاحية عرض أي قسم. تواصل مع مدير النظام أو سجّل الخروج.</p>
        <button class="button button--quiet" type="button" data-action="logout">تسجيل الخروج</button>
      </section>
    </main>
  `;
}

function renderShell(content: string, heading: string): void {
  const displayName = authenticatedUser?.fullName ?? '';
  const avatar = Array.from(displayName.trim())[0] ?? '';
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(currentPage, currentDashboardView, dashboardExpanded, currentSalesView, salesExpanded, currentPurchaseView, purchasesExpanded, currentInventoryView, inventoryExpanded, currentTreasuryView, treasuryExpanded, currentAssetView, assetsExpanded, currentPortfolioView, currentProjectView, projectsExpanded, currentContractorView, contractorsExpanded, brokerageExpanded, currentAccountingView, accountingExpanded, authenticatedUser?.systemAdmin ?? false)}
      <main class="main-area ${currentPage === 'accounts' ? 'main-area--accounting' : ''}">
        <header class="topbar"><div class="breadcrumb"><span>Elsaad ERP</span><span aria-hidden="true">/</span><strong>${escapeHtml(heading)}</strong></div>
          <div class="topbar-actions">${renderThemeToggle(currentTheme)}<span class="user-chip"><span class="user-avatar">${escapeHtml(avatar)}</span>${escapeHtml(displayName)}</span><button class="button button--quiet" type="button" data-action="logout">تسجيل الخروج</button></div>
        </header>
        <div class="page-content">${content}</div>
      </main>
    </div>
  `;
}

function readReportStorage(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 40) : [];
  } catch {
    return [];
  }
}

function saveReportStorage(key: string, values: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // التخزين المحلي غير متاح: تبقى المفضلة داخل الجلسة الحالية فقط.
  }
}

function reportPageState(): ReportsPageState | null {
  if (!reportLibrary) return null;
  return {
    library: reportLibrary,
    selectedKey: currentReportKey,
    filters: reportFilters,
    result: reportResult,
    search: reportSearch,
    favorites: reportFavorites,
    recent: reportRecent,
    expandedGroups: reportExpandedGroups,
    loading: reportLoading,
    error: reportError,
  };
}

function refreshReportLibraryParts(): void {
  const state = reportPageState();
  const host = document.querySelector<HTMLElement>('#reports-library-body');
  if (state && host) host.innerHTML = renderReportLibraryBody(state);
  const stat = document.querySelector<HTMLElement>('[data-report-stat="favorites"]');
  if (stat) stat.textContent = `${reportFavorites.length} / ${reportRecent.length}`;
}

function refreshReportWorkspace(): void {
  const state = reportPageState();
  const host = document.querySelector<HTMLElement>('#reports-workspace');
  if (state && host) host.innerHTML = renderReportWorkspace(state);
}

function refreshReportParts(): void {
  refreshReportLibraryParts();
  refreshReportWorkspace();
}

function reportDefinition(key: string) {
  return reportLibrary?.definitions.find((definition) => definition.key === key);
}

function defaultFiltersForReport(key: string): ReportRunFilters {
  const filters = reportLibrary ? { ...reportLibrary.defaults } : defaultReportFilters();
  if (reportDefinition(key)?.filters.includes('asOf')) filters.from = '';
  return filters;
}

function selectReport(key: string): void {
  if (!reportDefinition(key)) return;
  currentReportKey = key;
  reportFilters = defaultFiltersForReport(key);
  reportResult = null;
  reportError = '';
  reportLoading = false;
  reportRunToken += 1;
  const group = reportDefinition(key)?.group;
  if (group && !reportExpandedGroups.includes(group)) reportExpandedGroups = [...reportExpandedGroups, group];
  refreshReportParts();
}

function toggleReportFavorite(key: string): void {
  if (!reportDefinition(key)) return;
  reportFavorites = reportFavorites.includes(key) ? reportFavorites.filter((value) => value !== key) : [key, ...reportFavorites];
  saveReportStorage(REPORT_FAVORITES_KEY, reportFavorites);
  const active = reportFavorites.includes(key);
  document.querySelectorAll<HTMLButtonElement>(`[data-report-favorite="${key}"]`).forEach((button) => {
    button.classList.toggle('is-favorite', active);
    button.setAttribute('aria-pressed', String(active));
    const label = button.querySelector<HTMLElement>('[data-favorite-label]');
    if (label) label.textContent = active ? 'في المفضلة' : 'إضافة للمفضلة';
  });
  refreshReportLibraryParts();
}

function readReportFilterForm(form: HTMLFormElement): ReportRunFilters {
  const data = new FormData(form);
  const text = (name: string): string => String(data.get(name) ?? '').trim();
  const id = (name: string): number | null => {
    const value = text(name);
    return value ? Number(value) : null;
  };
  return {
    from: text('from'),
    to: text('to'),
    customerId: id('customerId'),
    supplierId: id('supplierId'),
    accountId: id('accountId'),
    projectId: id('projectId'),
    costCenterId: id('costCenterId'),
    treasury: text('treasury'),
    status: text('status'),
    installmentStatus: text('installmentStatus'),
    itemId: id('itemId'),
    unitId: id('unitId'),
    assetGroupId: id('assetGroupId'),
  };
}

async function runSelectedReport(): Promise<void> {
  if (!reportLibrary || reportLoading) return;
  const token = ++reportRunToken;
  reportLoading = true;
  reportError = '';
  refreshReportWorkspace();
  try {
    const result = await window.elsaad.runReport(currentReportKey, reportFilters);
    if (token !== reportRunToken) return;
    reportResult = result;
    reportRecent = [currentReportKey, ...reportRecent.filter((key) => key !== currentReportKey)].slice(0, 10);
    saveReportStorage(REPORT_RECENT_KEY, reportRecent);
  } catch (error) {
    if (token !== reportRunToken) return;
    reportResult = null;
    reportError = error instanceof Error ? error.message : 'تعذر إعداد التقرير من البيانات الحالية.';
  } finally {
    if (token === reportRunToken) {
      reportLoading = false;
      refreshReportParts();
    }
  }
}

function installmentReportPageState(): InstallmentReportPageState | null {
  if (!reportLibrary) return null;
  return {
    options: reportLibrary.options,
    filters: installmentReportFilters,
    result: installmentReportResult,
    search: installmentReportSearch,
    grouping: installmentReportGrouping,
    loading: installmentReportLoading,
    error: installmentReportError,
  };
}

function refreshInstallmentReportView(): void {
  const state = installmentReportPageState();
  const host = document.querySelector<HTMLElement>('.page-content');
  if (!state || !host || currentPage !== 'installment-reports') return;
  host.innerHTML = renderInstallmentReportsPage(state);
}

function refreshInstallmentReportResults(): void {
  const state = installmentReportPageState();
  if (!state) return;
  const summary = document.querySelector<HTMLElement>('#installment-report-summary');
  if (summary) summary.innerHTML = renderInstallmentReportSummary(state);
  const results = document.querySelector<HTMLElement>('#installment-report-results');
  if (results) results.innerHTML = renderInstallmentReportResults(state);
  const count = document.querySelector<HTMLElement>('[data-installment-count]');
  if (count) count.textContent = String(state.result?.rows.filter((row) => {
    const query = installmentReportSearch.trim().toLocaleLowerCase('ar');
    return !query || `${row.customerCode} ${row.customer} ${row.contract} ${row.project} ${row.unitCode} ${row.unit}`
      .toLocaleLowerCase('ar').includes(query);
  }).length ?? 0);
}

async function runInstallmentReport(): Promise<void> {
  if (installmentReportLoading) return;
  if (!reportLibrary) reportLibrary = await window.elsaad.getReportLibrary();
  const token = ++installmentReportRunToken;
  installmentReportLoading = true;
  installmentReportError = '';
  refreshInstallmentReportView();
  try {
    const result = await window.elsaad.runReport('installments', installmentReportFilters);
    if (token !== installmentReportRunToken) return;
    installmentReportResult = result;
  } catch (error) {
    if (token !== installmentReportRunToken) return;
    installmentReportResult = null;
    installmentReportError = error instanceof Error ? error.message : 'تعذر تحميل تقرير الأقساط.';
  } finally {
    if (token === installmentReportRunToken) {
      installmentReportLoading = false;
      refreshInstallmentReportView();
    }
  }
}

function openReportPrintHost(): boolean {
  if (!reportResult || !reportLibrary) return false;
  document.querySelector('#report-print-host')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderReportPrint(reportResult, reportLibrary.entityName);
  const host = wrapper.firstElementChild;
  if (!(host instanceof HTMLElement)) return false;
  document.body.appendChild(host);
  document.body.classList.add('report-print-mode');
  return true;
}

function closeReportPrintHost(): void {
  document.body.classList.remove('report-print-mode');
  document.querySelector('#report-print-host')?.remove();
}

async function loadSettingsPage(): Promise<void> {
  try {
    const [{ renderSettings }, [nextVersion, general, backup, company]] = await Promise.all([
      import('./pages/settings.js'),
      Promise.all([
        window.elsaad.getVersion(),
        window.elsaad.getGeneralSettings(),
        window.elsaad.getBackupState(),
        window.elsaad.getCompanyProfile(),
      ]),
    ]);
    settingsVersion = nextVersion;
    settingsGeneral = general;
    settingsBackup = backup;
    settingsCompany = company;
    let content: string | undefined;
    if (settingsView === 'users') {
      try {
        [managedUsers, permissionGroups] = await Promise.all([
          window.elsaad.listManagedUsers(), window.elsaad.listPermissionGroups(),
        ]);
        if (!creatingManagedUser && !managedUsers.some(({ id }) => id === selectedManagedUserId)) selectedManagedUserId = managedUsers[0]?.id ?? null;
        const { renderUsersPage } = await import('./pages/user-admin.js');
        content = renderUsersPage(managedUsers, permissionGroups, selectedManagedUserId);
      } catch (error) {
        content = `<section class="notice-panel notice-panel--warning" role="alert"><strong>تعذر تحميل المستخدمين</strong><p>${escapeHtml(error instanceof Error ? error.message : 'حدث خطأ غير متوقع.')}</p></section>`;
      }
    } else if (settingsView === 'permission-groups') {
      try {
        [permissionGroups, permissionDefinitions] = await Promise.all([
          window.elsaad.listPermissionGroups(), window.elsaad.listPermissionDefinitions(),
        ]);
        if (!permissionGroups.some(({ id }) => id === selectedPermissionGroupId)) selectedPermissionGroupId = permissionGroups.find(({ id }) => id !== 1)?.id ?? 1;
        const { renderPermissionGroupsPage } = await import('./pages/user-admin.js');
        content = renderPermissionGroupsPage(permissionGroups, permissionDefinitions, selectedPermissionGroupId);
      } catch (error) {
        content = `<section class="notice-panel notice-panel--warning" role="alert"><strong>تعذر تحميل مجموعات الصلاحيات</strong><p>${escapeHtml(error instanceof Error ? error.message : 'حدث خطأ غير متوقع.')}</p></section>`;
      }
    } else if (settingsView === 'user-permissions') {
      try {
        [managedUsers, permissionDefinitions] = await Promise.all([
          window.elsaad.listManagedUsers(), window.elsaad.listPermissionDefinitions(),
        ]);
        if (!managedUsers.some(({ id }) => id === selectedManagedUserId)) selectedManagedUserId = managedUsers[0]?.id ?? null;
        selectedUserPermissionState = selectedManagedUserId === null
          ? null : await window.elsaad.getUserPermissionState(selectedManagedUserId);
        const { renderUserPermissionsPage } = await import('./pages/user-admin.js');
        content = renderUserPermissionsPage(managedUsers, selectedUserPermissionState, permissionDefinitions);
      } catch (error) {
        content = `<section class="notice-panel notice-panel--warning" role="alert"><strong>تعذر تحميل صلاحيات المستخدمين</strong><p>${escapeHtml(error instanceof Error ? error.message : 'حدث خطأ غير متوقع.')}</p></section>`;
      }
    }
    renderShell(renderSettings(settingsVersion, settingsView, settingsGeneral, settingsBackup, settingsCompany, selectedRestoreCandidate, content), 'الإعدادات');
  } catch (error) {
    renderShell(`<section class="notice-panel notice-panel--warning" role="alert"><strong>تعذر تحميل الإعدادات</strong><p>${escapeHtml(error instanceof Error ? error.message : 'حدث خطأ غير متوقع.')}</p></section>`, 'الإعدادات');
  }
}

async function showSettingsTab(view: SettingsView): Promise<void> {
  settingsView = view;
  if (currentPage === 'settings') await loadSettingsPage();
  else await showPage('settings');
}

function hasUnsavedSettingsChanges(): boolean {
  return [...root.querySelectorAll<HTMLFormElement>('.settings-page form')].some((form) =>
    [...form.elements].some((control) => {
      if (control instanceof HTMLInputElement) {
        if (control.type === 'checkbox' || control.type === 'radio') return control.checked !== control.defaultChecked;
        if (control.type === 'file') return Boolean(control.files?.length);
        return control.value !== control.defaultValue;
      }
      if (control instanceof HTMLTextAreaElement) return control.value !== control.defaultValue;
      if (control instanceof HTMLSelectElement) return [...control.options].some((option) => option.selected !== option.defaultSelected);
      return false;
    }),
  );
}

function confirmDiscardSettingsChanges(): boolean {
  return !hasUnsavedSettingsChanges()
    || window.confirm('لديك تغييرات غير محفوظة في هذا التبويب. هل تريد مغادرته دون حفظ؟');
}

function printCurrentReport(): void {
  if (!openReportPrintHost()) return;
  const cleanup = (): void => closeReportPrintHost();
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 60_000);
}

async function exportCurrentReportPdf(): Promise<void> {
  if (!reportResult) return;
  if (!openReportPrintHost()) {
    window.alert('لا يوجد تقرير معروض لتصديره. اعرض التقرير أولًا.');
    return;
  }
  try {
    const saved = await window.elsaad.exportReportPdf();
    if (saved) window.alert('تم تصدير التقرير إلى ملف PDF.');
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'تعذر تصدير التقرير كملف PDF.');
  } finally {
    closeReportPrintHost();
  }
}

async function exportCurrentReportExcel(): Promise<void> {
  if (!reportResult) return;
  try {
    const saved = await window.elsaad.exportReportCsv(`${reportResult.title}.csv`, reportCsv(reportResult));
    if (saved) window.alert('تم تصدير التقرير بصيغة CSV المتوافقة مع Excel.');
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'تعذر تصدير التقرير إلى Excel.');
  }
}

async function showPage(page: ModuleKey): Promise<void> {
  if (page !== currentPage) {
    if (page === 'settings' && currentPage !== 'settings') usersReturnPage = currentPage;
    previousPage = currentPage;
  }
  if (currentPage === 'installment-reports' && page !== currentPage) installmentReportRunToken += 1;
  currentPage = page;
  if (page === 'contractors' || page === 'customer-vouchers' || page === 'supplier-vouchers' || page === 'expenses') contractorsExpanded = true;
  if (page === 'treasury') treasuryExpanded = true;
  if (page === 'dashboard') {
    const summary = await window.elsaad.getDashboardSummary();
    const heading = currentDashboardView === 'dashboard-new' ? 'لوحة المؤشرات الجديدة' : 'داش بورد 2';
    renderShell(renderDashboard(summary, currentDashboardView), heading);
  } else if (page === 'sales') {
    if (currentSalesView === 'customers') {
      [customers, customerGroups, accounts] = await Promise.all([window.elsaad.listCustomers(), window.elsaad.listCustomerGroups(), window.elsaad.listAccounts()]);
      renderShell(renderCustomersPage(customers, customerGroups, customerGroupFilter, accounts), salesPageTitle(currentSalesView));
    } else if (currentSalesView === 'customer-groups') {
      customerGroups = await window.elsaad.listCustomerGroups();
      renderShell(renderCustomerGroupsPage(customerGroups), salesPageTitle(currentSalesView));
    } else if (currentSalesView === 'returns') {
      [salesDocuments, salesReturns] = await Promise.all([
        window.elsaad.listSalesDocuments('invoice'),
        window.elsaad.listSalesReturns(),
      ]);
      renderShell(renderSalesReturnsPage(salesDocuments, salesReturns), salesPageTitle(currentSalesView));
    } else if (currentSalesView === 'sales-dashboard') {
      [customers, salesDashboardSummary] = await Promise.all([
        window.elsaad.listCustomers(),
        window.elsaad.getSalesDashboard(salesDashboardFilters),
      ]);
      renderShell(renderSalesDashboard(salesDashboardSummary, customers), salesPageTitle(currentSalesView));
    } else {
      [salesDocuments, customers, inventoryItems] = await Promise.all([
        window.elsaad.listSalesDocuments(currentSalesView), window.elsaad.listCustomers(), window.elsaad.listInventoryItems(),
      ]);
      renderShell(renderSalesPage(currentSalesView, salesDocuments), salesPageTitle(currentSalesView));
    }
  } else if (page === 'purchases') {
    if (currentPurchaseView === 'purchase-dashboard') {
      [suppliers, purchaseInvoices, purchaseDashboardSummary] = await Promise.all([
        window.elsaad.listSuppliers(),
        window.elsaad.listPurchaseInvoices(),
        window.elsaad.getPurchaseDashboard(purchaseDashboardFilters),
      ]);
      const categories = [...new Set(purchaseInvoices.map((invoice) => invoice.category).filter(Boolean))].sort();
      renderShell(renderPurchaseDashboard(purchaseDashboardSummary, suppliers, categories), 'لوحة تحكم المشتريات');
    } else if (currentPurchaseView === 'supplier-groups') {
      [supplierGroups, purchaseAccounts] = await Promise.all([window.elsaad.listSupplierGroups(), window.elsaad.listAccounts()]);
      renderShell(renderSupplierGroups(supplierGroups), 'مجموعات الموردين');
    } else if (currentPurchaseView === 'suppliers') {
      [suppliers, supplierGroups, purchaseAccounts] = await Promise.all([
        window.elsaad.listSuppliers(), window.elsaad.listSupplierGroups(), window.elsaad.listAccounts(),
      ]);
      renderShell(renderSuppliers(suppliers, supplierGroups), 'الموردون');
    } else if (currentPurchaseView === 'purchase-invoices') {
      [purchaseInvoices, suppliers, inventoryItems] = await Promise.all([
        window.elsaad.listPurchaseInvoices(), window.elsaad.listSuppliers(), window.elsaad.listInventoryItems(),
      ]);
      renderShell(renderPurchaseInvoices(purchaseInvoices, suppliers), 'فواتير المشتريات');
    } else {
      [purchaseInvoices, purchaseReturns] = await Promise.all([window.elsaad.listPurchaseInvoices(), window.elsaad.listPurchaseReturns()]);
      renderShell(renderPurchaseReturns(purchaseInvoices, purchaseReturns), 'مرتجع المشتريات');
    }
  } else if (page === 'inventory') {
    if (currentInventoryView === 'inventory-items') {
      [inventoryItems, inventoryUnits, warehouses, inventoryAccounts] = await Promise.all([
        window.elsaad.listInventoryItems(), window.elsaad.listInventoryUnits(),
        window.elsaad.listWarehouses(), window.elsaad.listInventoryAccounts(),
      ]);
      renderShell(renderInventoryItems(inventoryItems), 'الأصناف');
    } else if (currentInventoryView === 'inventory-units') {
      inventoryUnits = await window.elsaad.listInventoryUnits();
      renderShell(renderInventoryUnits(inventoryUnits), 'وحدات القياس');
    } else if (currentInventoryView === 'warehouses') {
      [warehouses, inventoryAccounts] = await Promise.all([window.elsaad.listWarehouses(), window.elsaad.listInventoryAccounts()]);
      renderShell(renderWarehouses(warehouses), 'المخازن');
    } else {
      inventoryBalances = await window.elsaad.listInventoryBalances();
      if (currentInventoryView === 'goods-receipts') {
        [inventoryReceipts, purchaseInvoices, warehouses] = await Promise.all([
          window.elsaad.listInventoryReceipts(), window.elsaad.listPurchaseInvoices(), window.elsaad.listWarehouses(),
        ]);
        renderShell(renderInventoryDocumentsPage(currentInventoryView, inventoryReceipts, inventoryBalances), 'إذن استلام بضاعة');
      } else if (currentInventoryView === 'stock-issues') {
        [inventoryIssues, inventoryItems, inventoryUnits, warehouses, inventorySalesInvoices] = await Promise.all([
          window.elsaad.listInventoryIssues(), window.elsaad.listInventoryItems(), window.elsaad.listInventoryUnits(), window.elsaad.listWarehouses(),
          window.elsaad.listSalesDocuments('invoice'),
        ]);
        renderShell(renderInventoryDocumentsPage(currentInventoryView, inventoryIssues, inventoryBalances), 'سند صرف مخزني');
      } else {
        [inventoryTransfers, inventoryItems, inventoryUnits, warehouses] = await Promise.all([
          window.elsaad.listInventoryTransfers(), window.elsaad.listInventoryItems(), window.elsaad.listInventoryUnits(), window.elsaad.listWarehouses(),
        ]);
        renderShell(renderInventoryDocumentsPage(currentInventoryView, inventoryTransfers, inventoryBalances), 'التحويل بين المخازن');
      }
    }
  } else if (page === 'assets') {
    [assetGroups, accounts] = await Promise.all([window.elsaad.listAssetGroups(), window.elsaad.listAccounts()]);
    if (currentAssetView === 'asset-groups') {
      renderShell(renderAssetGroupsPage(assetGroups, accounts, assetGroupSearch), 'مجموعات الأصول');
    } else if (currentAssetView === 'asset-codes') {
      fixedAssets = await window.elsaad.listAssets();
      renderShell(renderAssetsPage(fixedAssets, assetGroups, accounts, assetSearch), 'تكويد الأصول');
    } else {
      assetDepreciationReport = await window.elsaad.getAssetDepreciationReport(assetDepreciationRange);
      renderShell(renderDepreciationPage(assetDepreciationReport, assetGroups, assetDepreciationRange), 'إهلاك الأصول');
    }
  } else if (page === 'projects') {
    if (currentProjectView === 'project-list') {
      projects = await window.elsaad.listProjects();
      renderShell(renderProjectsPage(projects), 'المشاريع');
    } else if (currentProjectView === 'work-items') {
      [projects, projectWorkItems] = await Promise.all([
        window.elsaad.listProjects(), window.elsaad.listProjectWorkItems(),
      ]);
      renderShell(renderWorkItemsPage(projects, projectWorkItems, workItemProjectFilter), 'بنود الأعمال');
    } else if (currentProjectView === 'project-material-issues') {
      [projects, projectWorkItems, inventoryIssues, inventoryItems, warehouses, inventoryBalances] = await Promise.all([
        window.elsaad.listProjects(), window.elsaad.listProjectWorkItems(), window.elsaad.listInventoryIssues(),
        window.elsaad.listInventoryItems(), window.elsaad.listWarehouses(), window.elsaad.listInventoryBalances(),
      ]);
      renderShell(renderProjectMaterialsPage(projects, inventoryIssues, projectWorkItems, inventoryItems, warehouses, inventoryBalances), 'صرف مواد المشاريع');
    } else if (currentProjectView === 'property-units') {
      [projects, propertyUnits] = await Promise.all([
        window.elsaad.listProjects(), window.elsaad.listPropertyUnits(propertyProjectFilter ?? undefined),
      ]);
      renderShell(renderPropertyUnitsPage(projects, propertyUnits, propertyProjectFilter), 'وحدات المشروع');
    } else if (currentProjectView === 'property-contracts') {
      [projects, propertyUnits, propertyBrokers, propertyContracts, customers] = await Promise.all([
        window.elsaad.listProjects(), window.elsaad.listPropertyUnits(), window.elsaad.listPropertyBrokers(),
        window.elsaad.listPropertyContracts(), window.elsaad.listCustomers(),
      ]);
      renderShell(renderPropertyContractsPage(propertyContracts, projects, propertyUnits, customers, propertyBrokers), 'عقود بيع الوحدات');
    } else if (currentProjectView === 'property-payments') {
      [propertyContracts, cashBoxes, bankAccounts, accounts] = await Promise.all([
        window.elsaad.listPropertyContractsForPayment(propertyPaymentSearch), window.elsaad.listCashBoxes(),
        window.elsaad.listBankAccounts(), window.elsaad.listAccounts(),
      ]);
      if (propertyPaymentContractId !== null && !propertyContracts.some((contract) => contract.id === propertyPaymentContractId)) {
        propertyPaymentContractId = null;
      }
      renderShell(renderPropertyPaymentsPage(propertyContracts, cashBoxes, bankAccounts, accounts, propertyPaymentSearch, propertyPaymentContractId), 'سداد مبيعات الوحدات');
    } else {
      currentPortfolioView = currentProjectView;
      portfolioDashboard = await window.elsaad.getPortfolioDashboard(portfolioFilters);
      const heading = currentPortfolioView === 'properties' ? 'داشبورد العقارات' : 'داشبورد المشاريع';
      renderShell(renderPortfolioDashboard(currentPortfolioView, portfolioDashboard, portfolioFilters), heading);
    }
  } else if (page === 'customer-vouchers' || page === 'supplier-vouchers') {
    const partyKind: FinancialVoucherParty = page === 'customer-vouchers' ? 'customer' : 'supplier';
    if (partyKind === 'customer') {
      [financialVouchers, customers, accounts, cashBoxes, bankAccounts, costCenters, projects] = await Promise.all([
        window.elsaad.listFinancialVouchers('customer', financialVoucherSearch), window.elsaad.listCustomers(), window.elsaad.listAccounts(),
        window.elsaad.listCashBoxes(), window.elsaad.listBankAccounts(), window.elsaad.listCostCenters(), window.elsaad.listProjects(),
      ]);
      renderShell(renderFinancialVouchersPage('customer', financialVouchers, customers, cashBoxes, bankAccounts, costCenters, projects, financialVoucherSearch), 'سندات العملاء');
    } else {
      [financialVouchers, suppliers, accounts, cashBoxes, bankAccounts, costCenters, projects] = await Promise.all([
        window.elsaad.listFinancialVouchers('supplier', financialVoucherSearch), window.elsaad.listSuppliers(), window.elsaad.listAccounts(),
        window.elsaad.listCashBoxes(), window.elsaad.listBankAccounts(), window.elsaad.listCostCenters(), window.elsaad.listProjects(),
      ]);
      renderShell(renderFinancialVouchersPage('supplier', financialVouchers, suppliers, cashBoxes, bankAccounts, costCenters, projects, financialVoucherSearch), 'سندات الموردين');
    }
  } else if (page === 'expenses') {
    [expenses, accounts, cashBoxes, bankAccounts, costCenters, projects] = await Promise.all([
      window.elsaad.listExpenses(expenseSearch), window.elsaad.listAccounts(), window.elsaad.listCashBoxes(),
      window.elsaad.listBankAccounts(), window.elsaad.listCostCenters(), window.elsaad.listProjects(),
    ]);
    renderShell(renderExpensesPage(expenses, expenseSearch), 'إدارة المصروفات');
  } else if (page === 'brokerage') {
    propertyBrokers = await window.elsaad.listPropertyBrokers(brokerageSearch);
    renderShell(renderBrokeragePage(propertyBrokers, brokerageSearch, brokerageNotice), 'بيانات السمسرة');
  } else if (page === 'contractors') {
    if (currentContractorView === 'contractor-list') {
      contractors = await window.elsaad.listContractors(contractorSearch);
      renderShell(renderContractorsPage(contractors), 'المقاولون');
    } else if (currentContractorView === 'contractor-certificates') {
      [contractors, projects, contractorCertificates] = await Promise.all([
        window.elsaad.listContractors(),
        window.elsaad.listProjects(),
        window.elsaad.listContractorCertificates(contractorCertificateSearch),
      ]);
      renderShell(renderContractorCertificatesPage(contractorCertificates, contractors, projects), 'مستخلصات المقاولين');
    } else if (currentContractorView === 'contractor-vouchers') {
      [contractors, projects, contractorVouchers] = await Promise.all([
        window.elsaad.listContractors(),
        window.elsaad.listProjects(),
        window.elsaad.listContractorVouchers(contractorVoucherSearch),
      ]);
      renderShell(renderContractorVouchersPage(contractorVouchers, contractors, projects), 'سندات المقاولين');
    } else {
      [contractors, projects, contractorContracts] = await Promise.all([
        window.elsaad.listContractors(), window.elsaad.listProjects(),
        window.elsaad.listContractorContracts(contractorContractSearch),
      ]);
      if (preferredContractorId !== null) {
        contractorContracts = contractorContracts.filter((contract) => contract.contractorId === preferredContractorId);
      }
      renderShell(renderContractorContractsPage(contractorContracts, contractors, projects), 'عقود المقاولين / المقايسات');
    }
  } else if (page === 'accounts') {
    const accountingHeadings: Record<AccountingView, string> = {
      'chart-of-accounts': 'الدليل المحاسبي', 'cost-centers': 'مراكز التكلفة',
      'daily-journals': 'القيود اليومية', budgets: 'الموازنة التقديرية', 'financial-periods': 'الفترات المحاسبية',
    };
    renderShell('<section class="accounting-loading" role="status" aria-live="polite"><span class="online-dot"></span>جاري تحميل البيانات المحاسبية...</section>', accountingHeadings[currentAccountingView]);
    if (currentAccountingView === 'chart-of-accounts') {
      accounts = await window.elsaad.listAccounts();
      renderShell(renderChartOfAccounts(accounts, accountSearch), 'الدليل المحاسبي');
    } else if (currentAccountingView === 'cost-centers') {
      costCenters = await window.elsaad.listCostCenters(costCenterSearch);
      renderShell(renderCostCenters(costCenters, costCenterSearch), 'مراكز التكلفة');
    } else if (currentAccountingView === 'daily-journals') {
      [accounts, costCenters, journalEntries] = await Promise.all([
        window.elsaad.listAccounts(), window.elsaad.listCostCenters(), window.elsaad.listJournalEntries(journalSearch),
      ]);
      renderShell(renderJournals(journalEntries, accounts, costCenters, journalSearch), 'القيود اليومية');
    } else if (currentAccountingView === 'budgets') {
      [accounts, costCenters, budgets] = await Promise.all([
        window.elsaad.listAccounts(), window.elsaad.listCostCenters(), window.elsaad.listBudgets(budgetSearch),
      ]);
      renderShell(renderBudgets(budgets, budgetSearch), 'الموازنة التقديرية');
    } else {
      accountingPeriodClosures = await window.elsaad.listAccountingPeriodClosures();
      renderShell(renderAccountingPeriods(accountingPeriodClosures), 'الفترات المحاسبية');
    }
  } else if (page === 'treasury') {
    [cashBoxes, bankAccounts, accounts] = await Promise.all([
      window.elsaad.listCashBoxes(), window.elsaad.listBankAccounts(), window.elsaad.listAccounts(),
    ]);
    renderShell(renderTreasuryPage(currentTreasuryView, cashBoxes, bankAccounts), 'الخزائن والبنوك');
  } else if (page === 'installment-reports') {
    try {
      if (!reportLibrary) reportLibrary = await window.elsaad.getReportLibrary();
      if (!installmentReportInitialized) {
        installmentReportFilters = { ...reportLibrary.defaults };
        installmentReportInitialized = true;
      }
      const state = installmentReportPageState();
      renderShell(state ? renderInstallmentReportsPage(state) : '', 'تقارير أقساط العملاء');
      if (!installmentReportResult) await runInstallmentReport();
    } catch (error) {
      renderShell(`<section class="installment-empty-state" role="alert">${escapeHtml(error instanceof Error ? error.message : 'تعذر تحميل تقارير الأقساط.')}</section>`, 'تقارير أقساط العملاء');
    }
  } else if (page === 'reports') {
    if (!reportLibrary) {
      renderShell('<section class="report-loading" role="status" aria-live="polite"><span class="online-dot"></span>جارٍ تحميل مكتبة التقارير من البيانات الفعلية…</section>', 'التقارير والطباعة');
      reportLibrary = await window.elsaad.getReportLibrary();
      reportFilters = defaultFiltersForReport(currentReportKey);
      reportFavorites = readReportStorage(REPORT_FAVORITES_KEY).filter((key) => reportLibrary!.definitions.some((definition) => definition.key === key));
      reportRecent = readReportStorage(REPORT_RECENT_KEY).filter((key) => reportLibrary!.definitions.some((definition) => definition.key === key));
      if (!reportLibrary.definitions.some((definition) => definition.key === currentReportKey)) {
        currentReportKey = reportLibrary.definitions[0]?.key ?? 'trial-balance';
      }
    }
    const state = reportPageState();
    renderShell(state ? renderReportsPage(state) : '', 'التقارير والطباعة');
    if (!reportInitialized) {
      reportInitialized = true;
      await runSelectedReport();
    }
  } else if (page === 'settings') {
    await loadSettingsPage();
  } else {
    const section = MODULES.find(({ key }) => key === page);
    if (!section) throw new Error('القسم المطلوب غير موجود.');
    currentRecords = await window.elsaad.listRecords(page);
    renderShell(renderRecordsPage(page, section.label, currentRecords), section.label);
  }
}

async function refreshPortfolioPage(): Promise<void> {
  currentPage = 'projects';
  try {
    await showPage('projects');
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'تعذر تحديث لوحة المؤشرات.');
  }
}

function showProjectIssueEditor(issue: InventoryIssue | null): void {
  const host = document.querySelector<HTMLElement>('#project-issue-modal-host');
  if (!host) return;
  host.innerHTML = renderProjectIssueForm(issue, projects, projectWorkItems, inventoryItems, warehouses, inventoryBalances);
  const form = host.querySelector<HTMLFormElement>('[data-form="project-issue"]');
  if (form?.dataset.readonly === 'true') {
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
      .forEach((field) => { field.disabled = true; });
  }
  updateProjectIssueTotals();
  updateProjectIssueAvailability();
}

function updateProjectIssueAvailability(): void {
  const form = document.querySelector<HTMLFormElement>('[data-form="project-issue"]');
  if (!form) return;
  const warehouseId = Number(form.querySelector<HTMLSelectElement>('[name="warehouseId"]')?.value ?? 0);
  form.querySelectorAll<HTMLTableRowElement>('[data-project-issue-line]').forEach((row) => {
    const itemSelect = row.querySelector<HTMLSelectElement>('[name="itemId"]');
    const itemId = Number(itemSelect?.value ?? 0);
    const item = inventoryItems.find((entry) => entry.id === itemId);
    const balance = inventoryBalances.find((entry) => entry.itemId === itemId && entry.warehouseId === warehouseId);
    const unitId = row.querySelector<HTMLInputElement>('[name="unitId"]');
    const unit = row.querySelector<HTMLElement>('.project-line-unit');
    const available = row.querySelector<HTMLElement>('[data-available]');
    const cost = row.querySelector<HTMLElement>('[data-unit-cost]');
    if (unitId) unitId.value = item ? String(item.baseUnitId) : '';
    if (unit) unit.textContent = item?.baseUnitName ?? '—';
    if (available) available.textContent = balance?.quantity ?? '0';
    if (cost) cost.textContent = balance?.unitCost ?? '0';
  });
  updateProjectIssueTotals();
}

function updateProjectIssueTotals(): void {
  let quantity = 0n;
  let costTotal = 0n;
  document.querySelectorAll<HTMLElement>('[data-project-issue-line]').forEach((row) => {
    const rawQuantity = row.querySelector<HTMLInputElement>('[name="quantity"]')?.value.trim() || '0';
    let lineQuantity = 0n;
    if (/^\d{1,15}(?:\.\d{1,12})?$/.test(rawQuantity)) lineQuantity = parseAmount(rawQuantity);
    const unitCost = row.querySelector<HTMLElement>('[data-unit-cost]')?.textContent?.trim() || '0';
    const scale = 10n ** 12n;
    const lineCost = (lineQuantity * parseAmount(unitCost) + scale / 2n) / scale;
    quantity += lineQuantity;
    costTotal += lineCost;
    const lineTotal = row.querySelector<HTMLElement>('[data-line-cost]');
    if (lineTotal) lineTotal.textContent = formatAmount(lineCost);
  });
  const quantityHost = document.querySelector<HTMLElement>('#project-issue-quantity');
  const totalHost = document.querySelector<HTMLElement>('#project-issue-total');
  if (quantityHost) quantityHost.textContent = formatAmount(quantity);
  if (totalHost) totalHost.textContent = formatAmount(costTotal);
}

function filterProjectTable(): void {
  const query = document.querySelector<HTMLInputElement>('#project-search')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const status = document.querySelector<HTMLSelectElement>('#project-status-filter')?.value ?? '';
  const rows = [...document.querySelectorAll<HTMLElement>('[data-project-row]')];
  const matches = rows.filter((row) => {
    const matched = row.dataset.search?.includes(query) !== false && (!status || row.dataset.status === status);
    row.dataset.filtered = String(matched);
    return matched;
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  projectListPage = Math.min(Math.max(projectListPage, 1), pageCount);
  const start = (projectListPage - 1) * pageSize;
  matches.forEach((row, index) => {
    row.hidden = index < start || index >= start + pageSize;
  });
  rows.filter((row) => row.dataset.filtered !== 'true').forEach((row) => { row.hidden = true; });
  const count = document.querySelector<HTMLElement>('#project-result-count');
  const page = document.querySelector<HTMLElement>('#project-page-label');
  if (count) count.textContent = `المعروض: ${matches.length} من ${rows.length}`;
  if (page) page.textContent = `${projectListPage} / ${pageCount}`;
}

function setWorkItemForm(item: ProjectWorkItem | null): void {
  const form = document.querySelector<HTMLFormElement>('#work-item-form');
  if (!form) return;
  form.reset();
  editingWorkItemId = item?.id ?? null;
  const id = form.querySelector<HTMLInputElement>('[name="id"]');
  const project = form.querySelector<HTMLSelectElement>('[name="projectId"]');
  const code = form.querySelector<HTMLInputElement>('[name="code"]');
  const name = form.querySelector<HTMLInputElement>('[name="name"]');
  const description = form.querySelector<HTMLTextAreaElement>('[name="description"]');
  const status = form.querySelector<HTMLSelectElement>('[name="status"]');
  const title = document.querySelector<HTMLElement>('#work-item-form-title');
  const toggle = document.querySelector<HTMLButtonElement>('[data-action="work-item-toggle"]');
  if (id) id.value = item ? String(item.id) : '';
  if (project) project.value = item ? String(item.projectId) : project.options[1]?.value ?? '';
  if (code) code.value = item?.code ?? '';
  if (name) name.value = item?.name ?? '';
  if (description) description.value = item?.description ?? '';
  if (status) status.value = item?.status ?? 'active';
  const parentHost = document.querySelector<HTMLElement>('#work-item-parent-host');
  if (parentHost && project) {
    const parentItems = projectWorkItems.filter((entry) => entry.projectId === Number(project.value) && entry.id !== item?.id && entry.status === 'active');
    parentHost.innerHTML = `<select name="parentId"><option value="">بند رئيسي</option>${parentItems.map((parent) =>
      `<option value="${parent.id}" ${item?.parentId === parent.id ? 'selected' : ''}>${escapeHtml(`${parent.code} — ${parent.name}`)}</option>`).join('')}</select>`;
  }
  if (title) title.textContent = item ? 'تعديل بيانات البند' : 'بند جديد';
  if (toggle) {
    toggle.disabled = !item;
    toggle.textContent = item?.status === 'inactive' ? 'تفعيل' : 'تعطيل';
    toggle.dataset.id = item ? String(item.id) : '';
    toggle.dataset.status = item?.status === 'inactive' ? 'active' : 'inactive';
  }
}

function renderProjectIssueForPrint(issue: InventoryIssue): void {
  const host = document.querySelector<HTMLElement>('#project-issue-print-host') ?? document.createElement('div');
  host.id = 'project-issue-print-host';
  host.innerHTML = renderProjectIssuePrint(issue);
  if (!host.isConnected) document.body.append(host);
  document.body.classList.add('project-issue-print-mode');
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove('project-issue-print-mode');
    host.replaceChildren();
  }, 500);
}

function salesPageTitle(type: SalesView): string {
  return {
    'sales-dashboard': 'داشبورد المبيعات',
    customers: 'العملاء',
    'customer-groups': 'مجموعات العملاء',
    estimate: 'مقايسة العميل',
    'work-order': 'أوامر التشغيل',
    certificate: 'مستخلص العميل',
    invoice: 'الفواتير',
    returns: 'مرتجعات المبيعات',
  }[type];
}

function showSalesEditor(salesDocument: SalesDocument | null): void {
  const host = document.querySelector<HTMLDivElement>('#sales-editor-host');
  if (!host) return;
  const type = salesDocument?.type ?? 'estimate';
  host.innerHTML = renderSalesEditor(type, salesDocument, customers, inventoryItems);
  const field = host.querySelector<HTMLSelectElement>('[name="masterClientId"]:not(:disabled)');
  field?.focus();
}

function formatSalesAmount(value: number): string {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

function updateSalesEditorTotals(): void {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('[data-sales-line]')];
  let total = 0;
  for (const row of rows) {
    const quantity = Number(row.querySelector<HTMLInputElement>('[name="quantity"]')?.value ?? 0);
    const current = Number(row.querySelector<HTMLInputElement>('[name="currentQuantity"]')?.value ?? 0);
    const unitPrice = Number(row.querySelector<HTMLInputElement>('[name="unitPrice"]')?.value ?? 0);
    const validQuantity = Number.isFinite(quantity) ? quantity : 0;
    const validCurrent = Number.isFinite(current) ? current : 0;
    const validPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
    const certificate = row.querySelector<HTMLInputElement>('[name="currentQuantity"]')?.type !== 'hidden';
    const amount = (certificate ? validCurrent : validQuantity) * validPrice;
    total += amount;
    const amountCell = row.querySelector<HTMLElement>('.sales-line__amount');
    if (amountCell) amountCell.textContent = formatSalesAmount(amount);
    if (certificate) {
      const prior = Number(row.dataset.priorQuantity ?? 0);
      const cumulative = Math.max(0, Number.isFinite(prior) ? prior : 0) + validCurrent;
      const cumulativeCell = row.querySelector<HTMLElement>('.sales-line__cumulative');
      const percentCell = row.querySelector<HTMLElement>('.sales-line__percent');
      if (cumulativeCell) cumulativeCell.textContent = formatSalesAmount(cumulative);
      if (percentCell) percentCell.textContent = `${formatSalesAmount(validQuantity > 0 ? cumulative / validQuantity * 100 : 0)}%`;
    }
  }
  const totalElement = document.querySelector<HTMLElement>('#sales-total');
  if (totalElement) totalElement.textContent = formatSalesAmount(total);
}

function showCustomerEditor(customer: Customer | null): void {
  const host = document.querySelector<HTMLDivElement>('#sales-master-modal-host');
  if (!host) return;
  host.innerHTML = renderCustomerForm(customer, customerGroups, accounts);
  host.querySelector<HTMLInputElement>('[name="code"]')?.focus();
}

function showCustomerGroupEditor(group: CustomerGroup | null): void {
  const host = document.querySelector<HTMLDivElement>('#sales-master-modal-host');
  if (!host) return;
  host.innerHTML = renderCustomerGroupForm(group);
  host.querySelector<HTMLInputElement>('[name="code"]')?.focus();
}

function showSalesReturnEditor(invoiceId: number | null, salesReturn: SalesReturn | null = null): void {
  const host = document.querySelector<HTMLDivElement>('#sales-return-editor-host');
  if (!host) return;
  host.innerHTML = renderSalesReturnEditor(salesDocuments, salesReturns, invoiceId, salesReturn);
  host.querySelector<HTMLSelectElement>('[name="invoiceId"]:not(:disabled)')?.focus();
}

function showSupplierEditor(supplier: Supplier | null): void {
  const host = document.querySelector<HTMLDivElement>('#purchase-master-host');
  if (host) host.innerHTML = renderSupplierForm(supplier, supplierGroups, purchaseAccounts);
}

function showSupplierGroupEditor(group: SupplierGroup | null): void {
  const host = document.querySelector<HTMLDivElement>('#purchase-master-host');
  if (host) host.innerHTML = renderSupplierGroupForm(group, purchaseAccounts);
}

function showPurchaseInvoiceEditor(invoice: PurchaseInvoice | null): void {
  const host = document.querySelector<HTMLDivElement>('#purchase-invoice-host');
  if (host) host.innerHTML = renderPurchaseInvoiceForm(invoice, suppliers, inventoryItems);
}

function showInventoryItemEditor(item: InventoryItem | null): void {
  const host = document.querySelector<HTMLDivElement>('#inventory-modal-host');
  if (host) {
    host.innerHTML = renderInventoryItemForm(item, inventoryUnits, warehouses, inventoryAccounts);
    host.querySelector<HTMLInputElement>('[name="code"]')?.focus();
  }
}

function showInventoryUnitEditor(unit: InventoryUnit | null): void {
  const host = document.querySelector<HTMLDivElement>('#inventory-modal-host');
  if (host) {
    host.innerHTML = renderInventoryUnitForm(unit);
    host.querySelector<HTMLInputElement>('[name="code"]')?.focus();
  }
}

function showWarehouseEditor(warehouse: Warehouse | null): void {
  const host = document.querySelector<HTMLDivElement>('#inventory-modal-host');
  if (host) {
    host.innerHTML = renderWarehouseForm(warehouse, inventoryAccounts);
    host.querySelector<HTMLInputElement>('[name="code"]')?.focus();
  }
}

function showPurchaseReturnEditor(invoiceId: number | null, current: PurchaseReturn | null = null): void {
  const host = document.querySelector<HTMLDivElement>('#purchase-return-host');
  if (!host) return;
  if (invoiceId !== null && !current && !purchaseInvoices.some((invoice) => invoice.id === invoiceId && invoice.status === 'approved')) return;
  host.innerHTML = renderPurchaseReturnEditor(purchaseInvoices, current);
}

function updatePurchaseInvoiceTotals(): void {
  let total = 0;
  for (const row of document.querySelectorAll<HTMLTableRowElement>('[data-purchase-line]')) {
    const quantity = Number(row.querySelector<HTMLInputElement>('[name="quantity"]')?.value ?? 0);
    const price = Number(row.querySelector<HTMLInputElement>('[name="unitPrice"]')?.value ?? 0);
    const amount = Number.isFinite(quantity * price) ? Math.max(0, quantity * price) : 0;
    total += amount;
    const cell = row.querySelector<HTMLElement>('.purchase-line-total');
    if (cell) cell.textContent = formatSalesAmount(amount);
  }
  const output = document.querySelector<HTMLElement>('#purchase-total');
  if (output) output.textContent = formatSalesAmount(total);
}

function updatePurchaseReturnTotals(): void {
  const form = document.querySelector<HTMLFormElement>('[data-form="purchase-return"]');
  const invoiceId = Number(form?.querySelector<HTMLSelectElement>('select[name="invoiceId"]')?.value
    ?? form?.querySelector<HTMLInputElement>('input[name="invoiceId"][type="hidden"]')?.value);
  const invoice = purchaseInvoices.find((item) => item.id === invoiceId);
  if (!invoice) return;
  let total = 0;
  for (const row of document.querySelectorAll<HTMLTableRowElement>('[data-purchase-return-line]')) {
    const line = invoice.lines.find((item) => item.id === Number(row.dataset.invoiceLineId));
    const quantity = Number(row.querySelector<HTMLInputElement>('[name="returnQuantity"]')?.value ?? 0);
    const amount = line && Number.isFinite(quantity) ? Math.max(0, quantity) * Number(line.unitPrice) : 0;
    total += amount;
    const output = row.querySelector<HTMLElement>('.purchase-return-line-total');
    if (output) output.textContent = formatSalesAmount(amount);
  }
  const output = document.querySelector<HTMLElement>('#purchase-return-total');
  if (output) output.textContent = formatSalesAmount(total);
}

function updateSalesReturnTotal(): void {
  const selectedInvoice = Number(document.querySelector<HTMLSelectElement>('[data-form="sales-return"] [name="invoiceId"]')?.value);
  const invoice = salesDocuments.find((item) => item.id === selectedInvoice);
  if (!invoice) return;
  let total = 0;
  for (const row of document.querySelectorAll<HTMLTableRowElement>('[data-return-line]')) {
    const lineId = Number(row.dataset.invoiceLineId);
    const source = invoice.lines.find((line) => line.id === lineId);
    const quantity = Number(row.querySelector<HTMLInputElement>('[name="returnQuantity"]')?.value ?? 0);
    const amount = source && Number.isFinite(quantity) ? Math.max(0, quantity) * Number(source.unitPrice) : 0;
    total += amount;
    const output = row.querySelector<HTMLElement>('.return-line-amount');
    if (output) output.textContent = formatSalesAmount(amount);
  }
  const totalElement = document.querySelector<HTMLElement>('#sales-return-total');
  if (totalElement) totalElement.textContent = formatSalesAmount(total);
}

function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filterCustomerRows(): void {
  const query = document.querySelector<HTMLInputElement>('#customer-search')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const group = document.querySelector<HTMLSelectElement>('#customer-group-filter')?.value ?? '';
  const status = document.querySelector<HTMLSelectElement>('#customer-status-filter')?.value ?? '';
  document.querySelectorAll<HTMLElement>('[data-customer-row]').forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query))
      || Boolean(group && row.dataset.group !== group)
      || Boolean(status && row.dataset.status !== status);
  });
}

async function importCustomers(file: File): Promise<void> {
  const rows = parseCustomersCsv(await file.text());
  if (rows.length < 2) throw new Error('ملف CSV لا يحتوي على صفوف عملاء.');
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ''));
  const required = ['code', 'name'];
  if (required.some((header) => !headers.includes(header))) {
    throw new Error('يجب أن يحتوي رأس ملف CSV على عمودي code وname.');
  }
  const index = (name: string): number => headers.indexOf(name);
  const groupsByCode = new Map(customerGroups.map((group) => [group.code.toLocaleLowerCase(), group.id]));
  let imported = 0;
  const errors: string[] = [];
  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const get = (name: string): string => {
      const column = index(name);
      return column < 0 ? '' : row[column] ?? '';
    };
    const groupCode = get('groupCode').trim();
    const groupId = groupCode ? groupsByCode.get(groupCode.toLocaleLowerCase()) : null;
    if (groupCode && groupId === undefined) {
      errors.push(`السطر ${rowIndex + 2}: كود المجموعة "${groupCode}" غير موجود.`);
      continue;
    }
    try {
      await window.elsaad.saveCustomer({
        code: get('code'),
        name: get('name'),
        tradeName: get('tradeName'),
        phone: get('phone'),
        email: get('email'),
        groupId: groupId ?? null,
        city: get('city'),
        country: get('country'),
        address: get('address'),
        taxNumber: get('taxNumber'),
        notes: get('notes'),
        status: 'active',
      });
      imported += 1;
    } catch (error) {
      errors.push(`السطر ${rowIndex + 2}: ${error instanceof Error ? error.message : 'تعذر حفظ العميل.'}`);
    }
  }
  await showPage('sales');
  const summary = `تم استيراد ${imported} من ${rows.length - 1} عميل.`;
  window.alert(errors.length ? `${summary}\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\nوأخطاء أخرى (${errors.length - 8}).` : ''}` : summary);
}

async function importSuppliers(file: File): Promise<void> {
  const rows = parseCustomersCsv(await file.text());
  if (rows.length < 2) throw new Error('ملف الموردين لا يحتوي على صفوف بيانات.');
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ''));
  if (!headers.includes('code') || !headers.includes('name')) throw new Error('يجب أن يحتوي ملف CSV على عمودي code وname.');
  const column = (name: string): number => headers.indexOf(name);
  const uniqueGroupNames = new Map<string, number | null>();
  for (const group of supplierGroups) {
    const key = group.nameAr.trim().toLocaleLowerCase('ar');
    uniqueGroupNames.set(key, uniqueGroupNames.has(key) ? null : group.id);
  }
  const accountsByCode = new Map(purchaseAccounts.map((account) => [account.code.toLocaleLowerCase(), account.id]));
  let imported = 0;
  const errors: string[] = [];
  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const value = (name: string): string => {
      const index = column(name);
      return index < 0 ? '' : row[index] ?? '';
    };
    const groupName = value('group').trim();
    const groupId = groupName ? uniqueGroupNames.get(groupName.toLocaleLowerCase('ar')) : null;
    if (groupName && (groupId === undefined || groupId === null)) {
      errors.push(`السطر ${rowIndex + 2}: المجموعة غير موجودة أو اسمها غير فريد.`);
      continue;
    }
    const accountCode = value('accountCode').trim();
    const accountId = accountCode ? accountsByCode.get(accountCode.toLocaleLowerCase()) : null;
    if (accountCode && !accountId) {
      errors.push(`السطر ${rowIndex + 2}: الحساب غير موجود.`);
      continue;
    }
    const status = value('status') === 'inactive' ? 'inactive' : 'active';
    try {
      await window.elsaad.saveSupplier({
        code: value('code'), name: value('name'), tradeName: value('tradeName'), phone: value('phone'),
        email: value('email'), address: value('address'), city: value('city'), country: value('country'),
        taxNumber: value('taxNumber'), commercialRegister: value('commercialRegister'),
        groupId: groupId ?? null, accountId: accountId ?? null, notes: value('notes'), status,
      });
      imported += 1;
    } catch (error) {
      errors.push(`السطر ${rowIndex + 2}: ${error instanceof Error ? error.message : 'تعذر حفظ المورد.'}`);
    }
  }
  await showPage('purchases');
  const summary = `تم استيراد ${imported} من ${rows.length - 1} مورد.`;
  window.alert(errors.length ? `${summary}\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\nوأخطاء أخرى (${errors.length - 8}).` : ''}` : summary);
}

function filterRows(inputId: string, rowSelector: string): void {
  const query = document.querySelector<HTMLInputElement>(`#${inputId}`)?.value.trim().toLocaleLowerCase('ar') ?? '';
  document.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query));
  });
}

function filterDepreciationRows(): void {
  const query = document.querySelector<HTMLInputElement>('[data-depreciation-search]')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const groupId = document.querySelector<HTMLSelectElement>('[data-depreciation-group]')?.value ?? '';
  const status = document.querySelector<HTMLSelectElement>('[data-depreciation-status]')?.value ?? 'all';
  document.querySelectorAll<HTMLElement>('[data-depreciation-row]').forEach((row) => {
    row.hidden = Boolean((query && !row.dataset.assetSearch?.includes(query)) || (groupId && row.dataset.groupId !== groupId)
      || (status === 'due' && row.dataset.posted === 'true') || (status === 'posted' && row.dataset.posted !== 'true'));
  });
}

function filterPurchaseInvoices(): void {
  const query = document.querySelector<HTMLInputElement>('#purchase-invoice-search')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const supplier = document.querySelector<HTMLSelectElement>('#purchase-invoice-supplier')?.value ?? '';
  const status = document.querySelector<HTMLSelectElement>('#purchase-invoice-status')?.value ?? '';
  const category = document.querySelector<HTMLSelectElement>('#purchase-invoice-category')?.value ?? '';
  const from = document.querySelector<HTMLInputElement>('#purchase-invoice-from')?.value ?? '';
  const to = document.querySelector<HTMLInputElement>('#purchase-invoice-to')?.value ?? '';
  document.querySelectorAll<HTMLElement>('[data-purchase-invoice-row]').forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query))
      || Boolean(supplier && row.dataset.supplier !== supplier)
      || Boolean(status && row.dataset.status !== status)
      || Boolean(category && row.dataset.category !== category)
      || Boolean(from && (row.dataset.date ?? '') < from)
      || Boolean(to && (row.dataset.date ?? '') > to);
  });
}

function filterPurchaseReturns(): void {
  const query = document.querySelector<HTMLInputElement>('#purchase-return-search')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const status = document.querySelector<HTMLSelectElement>('#purchase-return-status')?.value ?? '';
  const from = document.querySelector<HTMLInputElement>('#purchase-return-from')?.value ?? '';
  const to = document.querySelector<HTMLInputElement>('#purchase-return-to')?.value ?? '';
  document.querySelectorAll<HTMLElement>('[data-purchase-return-row]').forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query))
      || Boolean(status && row.dataset.status !== status)
      || Boolean(from && (row.dataset.date ?? '') < from)
      || Boolean(to && (row.dataset.date ?? '') > to);
  });
}

function filterSuppliers(): void {
  const query = document.querySelector<HTMLInputElement>('#supplier-search')?.value.trim().toLocaleLowerCase('ar') ?? '';
  const status = document.querySelector<HTMLSelectElement>('#supplier-status-filter')?.value ?? '';
  document.querySelectorAll<HTMLElement>('[data-supplier-row]').forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query))
      || Boolean(status && row.dataset.status !== status);
  });
}

function filterInventoryRows(searchId: string, statusId: string, selector: string): void {
  const query = document.querySelector<HTMLInputElement>(`#${searchId}`)?.value.trim().toLocaleLowerCase('ar') ?? '';
  const status = document.querySelector<HTMLSelectElement>(`#${statusId}`)?.value ?? '';
  document.querySelectorAll<HTMLElement>(selector).forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.search?.includes(query))
      || Boolean(status && row.dataset.status !== status);
  });
}

function updateInventoryDocumentTotals(): void {
  const lines = [...document.querySelectorAll<HTMLTableRowElement>('#inventory-doc-lines [data-inventory-doc-line]')];
  let quantityTotal = 0n;
  let costTotal = 0n;
  const scale = 10n ** 12n;
  for (const line of lines) {
    const quantityText = line.querySelector<HTMLInputElement>('[name="quantity"]')?.value || '0';
    const costText = line.querySelector<HTMLInputElement>('[name="unitCost"]')?.value || '0';
    if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(quantityText) || !/^\d{1,15}(?:\.\d{1,12})?$/.test(costText)) continue;
    const quantity = parseAmount(quantityText);
    const cost = parseAmount(costText);
    quantityTotal += quantity;
    costTotal += (quantity * cost + scale / 2n) / scale;
    const lineTotal = line.querySelector<HTMLElement>('.doc-total');
    if (lineTotal) lineTotal.textContent = formatAmount((quantity * cost + scale / 2n) / scale);
  }
  const quantityOutput = document.querySelector<HTMLElement>('#inventory-doc-total-quantity');
  const costOutput = document.querySelector<HTMLElement>('#inventory-doc-total-cost');
  if (quantityOutput) quantityOutput.textContent = formatAmount(quantityTotal);
  if (costOutput) costOutput.textContent = formatAmount(costTotal);
}

function sortInventoryRows(key: string): void {
  const selectors: Record<InventoryView, string> = {
    'inventory-items': '[data-inventory-item-row]',
    'inventory-units': '[data-inventory-unit-row]',
    warehouses: '[data-warehouse-row]',
    'goods-receipts': '[data-inventory-document-row]',
    'stock-issues': '[data-inventory-document-row]',
    'stock-transfers': '[data-inventory-document-row]',
  };
  const rows = [...document.querySelectorAll<HTMLTableRowElement>(selectors[currentInventoryView])];
  const selector = rows[0]?.parentElement;
  if (!selector) return;
  const directionKey = `${currentInventoryView}:${key}`;
  const ascending = !(inventorySortDirections.get(directionKey) ?? false);
  inventorySortDirections.set(directionKey, ascending);
  rows.sort((left, right) => {
    const leftValue = key === 'code' ? left.dataset.sortCode ?? '' : left.dataset.sortName ?? '';
    const rightValue = key === 'code' ? right.dataset.sortCode ?? '' : right.dataset.sortName ?? '';
    return leftValue.localeCompare(rightValue, 'ar', { numeric: true, sensitivity: 'base' }) * (ascending ? 1 : -1);
  });
  selector.append(...rows);
}

function printPurchaseList(): void {
  document.body.classList.add('purchase-print-mode');
  window.print();
  window.setTimeout(() => document.body.classList.remove('purchase-print-mode'), 500);
}

function printVisibleSalesTable(): void {
  document.body.classList.add('sales-print-mode');
  window.print();
  window.setTimeout(() => document.body.classList.remove('sales-print-mode'), 500);
}

function showError(error: unknown, targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.textContent = error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
  target.hidden = false;
}

function showGlobalError(error: unknown, context = 'تعذر تنفيذ العملية'): void {
  const message = error instanceof Error ? error.message : 'خطأ غير متوقع. أعد المحاولة؛ إن تكررت أعد تشغيل التطبيق.';
  let banner = document.querySelector<HTMLElement>('#global-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'global-error-banner';
    banner.className = 'global-error-banner';
    banner.setAttribute('role', 'alert');
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <span class="global-error-banner__context">${escapeHtml(context)}</span>
    <strong>${escapeHtml(message)}</strong>
    <button class="button button--small button--secondary" type="button" data-action="global-error-close">إغلاق</button>`;
}

function applyGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    showGlobalError(event.reason, 'خطأ غير معالج');
  });
  window.addEventListener('error', (event) => {
    if (event.error) {
      event.preventDefault();
      showGlobalError(event.error, 'خطأ غير معالج');
    }
  });
}

function formatPropertyAmount(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return value;
  const whole = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(BigInt(match[1]));
  return `${whole}.${(match[2] ?? '').padEnd(2, '0')}`;
}

function updatePropertyContractPreview(form: HTMLFormElement): void {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
  const summary = form.querySelector<HTMLElement>('#property-contract-summary');
  const error = form.querySelector<HTMLElement>('#property-contract-error');
  let feeTotal = 0n;
  const frequencyTotals = new Map<string, bigint>([['monthly', 0n], ['quarterly', 0n], ['semiannual', 0n], ['annual', 0n], ['free', 0n]]);
  let amountData: ReturnType<typeof calculateContractAmounts> | null = null;
  try {
    for (const row of form.querySelectorAll<HTMLElement>('[data-property-fee]')) {
      const amount = row.querySelector<HTMLInputElement>('[name="feeAmount"]')?.value.trim() ?? '';
      if (amount) feeTotal += toCents(amount, 'قيمة الرسم');
    }
    const feesField = form.elements.namedItem('fees');
    if (feesField instanceof HTMLInputElement) feesField.value = fromCents(feeTotal);
    amountData = calculateContractAmounts({
      originalPrice: value('originalPrice') || '0', discount: value('discount') || '0', fees: fromCents(feeTotal),
      downPayment: value('downPayment') || '0', brokerRate: value('brokerRate') || '0',
      brokerCommissionMode: (form.elements.namedItem('brokerCommissionMode') as HTMLSelectElement | null)?.value === 'fixed' ? 'fixed' : 'rate',
      brokerOnOriginalPrice: (form.elements.namedItem('brokerOnOriginalPrice') as HTMLInputElement | null)?.checked ?? false,
    });
    if (summary) {
      for (const [key, amount] of Object.entries({
        original: amountData.originalPrice, discount: amountData.discount, fees: amountData.fees,
        contract: amountData.contractValue, down: amountData.downPayment, remaining: amountData.remaining,
        commission: amountData.brokerCommission,
      })) {
        const target = summary.querySelector<HTMLElement>(`[data-money="${key}"]`);
        if (target) target.textContent = formatPropertyAmount(amount);
      }
      const discountRate = summary.querySelector<HTMLElement>('[data-discount-rate]');
      if (discountRate) discountRate.textContent = `${amountData.discountRate}%`;
    }
    for (const frequency of ['monthly', 'quarterly', 'semiannual', 'annual'] as const) {
      const amount = value(`${frequency}Amount`) || '0';
      const count = Number(value(`${frequency}Count`) || '1');
      const firstDate = value(`${frequency}FirstDate`);
      const total = form.querySelector<HTMLElement>(`[data-schedule-total="${frequency}"]`);
      if (total) total.textContent = formatPropertyAmount(amount);
      const preview = form.querySelector<HTMLTableSectionElement>(`[data-schedule-preview="${frequency}"]`);
      if (toCents(amount) > 0n && preview) {
        preview.innerHTML = previewPropertySchedule(frequency, amount, count, firstDate);
        frequencyTotals.set(frequency, toCents(amount));
      } else if (preview) {
        preview.innerHTML = '<tr><td class="empty-state" colspan="3">أدخل المبلغ والعدد لمعاينة الجدول.</td></tr>';
      }
    }
    const freeRows = [...form.querySelectorAll<HTMLElement>('[data-property-free-payment]')];
    let freeTotal = 0n;
    for (const row of freeRows) {
      const amount = row.querySelector<HTMLInputElement>('[name="freeAmount"]')?.value.trim() ?? '';
      if (amount) freeTotal += toCents(amount, 'مبلغ الدفعة الحرة');
    }
    frequencyTotals.set('free', freeTotal);
    const totalFree = form.querySelector<HTMLElement>('[data-free-total]');
    if (totalFree) totalFree.textContent = formatPropertyAmount(fromCents(freeTotal));
    const allocated = [...frequencyTotals.values()].reduce((sum, amount) => sum + amount, 0n);
    const remaining = toCents(amountData.remaining);
    const undistributed = remaining - allocated;
    if (undistributed < 0n) throw new Error(`إجمالي التخصيص يتجاوز المتبقي بمقدار ${fromCents(-undistributed)} جنيه.`);
    for (const [frequency, amount] of frequencyTotals) {
      const target = form.querySelector<HTMLElement>(`[data-total-frequency="${frequency}"]`);
      if (target) target.textContent = formatPropertyAmount(fromCents(amount));
    }
    const allocatedTarget = form.querySelector<HTMLElement>('[data-total-frequency="allocated"]');
    const undistributedTarget = form.querySelector<HTMLElement>('[data-total-frequency="undistributed"]');
    const statusTarget = form.querySelector<HTMLElement>('[data-total-frequency="status"]');
    if (allocatedTarget) allocatedTarget.textContent = formatPropertyAmount(fromCents(allocated));
    if (undistributedTarget) undistributedTarget.textContent = formatPropertyAmount(fromCents(undistributed));
    if (statusTarget) statusTarget.textContent = undistributed === 0n ? 'مكتملة' : 'غير مكتملة';
    if (error) error.hidden = true;
  } catch (caught) {
    if (error) {
      error.textContent = caught instanceof Error ? caught.message : 'تحقق من المبالغ وتواريخ الخطة.';
      error.hidden = false;
    }
  }
}

function updatePropertyReceiptTotal(form: HTMLFormElement): void {
  let total = 0n;
  const installmentHost = form.closest<HTMLElement>('.property-payment-contract') ?? document;
  for (const row of installmentHost.querySelectorAll<HTMLElement>('[data-payment-installment]')) {
    const selected = row.querySelector<HTMLInputElement>('[name="installmentSelected"]');
    const amount = row.querySelector<HTMLInputElement>('[name="allocationAmount"]');
    if (selected?.checked && amount?.value) total += toCents(amount.value, 'مبلغ التخصيص');
  }
  const target = form.elements.namedItem('receiptTotal');
  if (target instanceof HTMLInputElement) target.value = fromCents(total);
}

function updateContractorOpeningTotals(form: HTMLFormElement): void {
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const row of form.querySelectorAll<HTMLElement>('[data-contractor-opening-row]')) {
    const debitInput = row.querySelector<HTMLInputElement>('[name="openingDebit"]');
    const creditInput = row.querySelector<HTMLInputElement>('[name="openingCredit"]');
    const equivalentInput = row.querySelector<HTMLInputElement>('[name="openingEquivalent"]');
    try {
      const debit = debitInput?.value ? toCents(debitInput.value, 'المدين') : 0n;
      const credit = creditInput?.value ? toCents(creditInput.value, 'الدائن') : 0n;
      if (equivalentInput) equivalentInput.value = fromCents(debit > 0n ? debit : credit);
      if (row.querySelector<HTMLSelectElement>('[name="openingStatus"]')?.value !== 'inactive') {
        debitTotal += debit;
        creditTotal += credit;
      }
    } catch {
      if (equivalentInput) equivalentInput.value = '0.00';
    }
  }
  const debit = form.querySelector<HTMLElement>('[data-opening-total="debit"]');
  const credit = form.querySelector<HTMLElement>('[data-opening-total="credit"]');
  const net = form.querySelector<HTMLElement>('[data-opening-total="net"]');
  if (debit) debit.textContent = formatPropertyAmount(fromCents(debitTotal));
  if (credit) credit.textContent = formatPropertyAmount(fromCents(creditTotal));
  if (net) net.textContent = formatPropertyAmount(fromCents(debitTotal - creditTotal));
}

function updateContractorContractTotals(form: HTMLFormElement): void {
  let total = 0n;
  for (const row of form.querySelectorAll<HTMLElement>('[data-contractor-contract-line]')) {
    const quantityValue = row.querySelector<HTMLInputElement>('[name="lineQuantity"]')?.value.trim() ?? '';
    const priceValue = row.querySelector<HTMLInputElement>('[name="lineUnitPrice"]')?.value.trim() ?? '';
    let lineTotal = 0n;
    try {
      if (quantityValue && priceValue) {
        const quantity = parseAmount(quantityValue);
        const price = parseAmount(priceValue);
        lineTotal = (quantity * price + (10n ** 12n) / 2n) / (10n ** 12n);
      }
    } catch {
      lineTotal = 0n;
    }
    total += lineTotal;
    const target = row.querySelector<HTMLElement>('[data-contractor-line-total]');
    if (target) target.textContent = formatAmount(lineTotal);
  }
  const target = form.querySelector<HTMLElement>('#contractor-contract-total');
  if (target) target.textContent = formatAmount(total);
}

function contractorInput(form: HTMLFormElement): ContractorInput {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '');
  const openingEntries = [...form.querySelectorAll<HTMLElement>('[data-contractor-opening-row]')].map((row) => ({
    date: row.querySelector<HTMLInputElement>('[name="openingDate"]')?.value ?? '',
    debit: row.querySelector<HTMLInputElement>('[name="openingDebit"]')?.value.trim() || '0',
    credit: row.querySelector<HTMLInputElement>('[name="openingCredit"]')?.value.trim() || '0',
    status: String(row.querySelector<HTMLSelectElement>('[name="openingStatus"]')?.value ?? 'active') as 'active' | 'inactive',
  }));
  return {
    ...(id ? { id: Number(id) } : {}),
    code: String(data.get('code') ?? '').trim(),
    name: String(data.get('name') ?? '').trim(),
    phone: String(data.get('phone') ?? '').trim(),
    specialty: String(data.get('specialty') ?? '').trim(),
    country: String(data.get('country') ?? '').trim(),
    governorate: String(data.get('governorate') ?? '').trim(),
    address: String(data.get('address') ?? '').trim(),
    status: String(data.get('status') ?? 'active') as ContractorStatus,
    openingEntries,
  };
}

function contractorContractInput(form: HTMLFormElement): ContractorContractInput {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '');
  const lines: ContractorContractInput['lines'] = [...form.querySelectorAll<HTMLElement>('[data-contractor-contract-line]')].map((row) => ({
    code: row.querySelector<HTMLInputElement>('[name="lineCode"]')?.value.trim() ?? '',
    name: row.querySelector<HTMLInputElement>('[name="lineName"]')?.value.trim() ?? '',
    itemType: row.querySelector<HTMLInputElement>('[name="lineType"]')?.value.trim() ?? '',
    unit: row.querySelector<HTMLInputElement>('[name="lineUnit"]')?.value.trim() ?? '',
    quantity: row.querySelector<HTMLInputElement>('[name="lineQuantity"]')?.value.trim() ?? '',
    unitPrice: row.querySelector<HTMLInputElement>('[name="lineUnitPrice"]')?.value.trim() ?? '',
  }));
  return {
    ...(id ? { id: Number(id) } : {}),
    date: String(data.get('date') ?? ''),
    contractorId: Number(data.get('contractorId')),
    projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
    notes: String(data.get('notes') ?? '').trim(),
    lines,
  };
}

function updateContractorCertificateTotals(form: HTMLFormElement): void {
  let total = 0n;
  for (const row of form.querySelectorAll<HTMLElement>('[data-contractor-certificate-line]')) {
    const quantityValue = row.querySelector<HTMLInputElement>('[name="lineCurrentQty"]')?.value.trim() ?? '';
    const priceValue = row.querySelector<HTMLInputElement>('[name="lineUnitPrice"]')?.value.trim() ?? '';
    const discountValue = row.querySelector<HTMLInputElement>('[name="lineDiscount"]')?.value.trim() ?? '0';
    let lineTotal = 0n;
    try {
      if (quantityValue && priceValue) {
        const quantity = parseAmount(quantityValue);
        const price = parseAmount(priceValue);
        const discount = parseAmount(discountValue);
        const value = (quantity * price + (10n ** 12n) / 2n) / (10n ** 12n);
        lineTotal = value > discount ? value - discount : 0n;
      }
    } catch {
      lineTotal = 0n;
    }
    total += lineTotal;
    const target = row.querySelector<HTMLElement>('[data-contractor-certificate-line-total]');
    if (target) target.textContent = formatAmount(lineTotal);
  }
  const target = form.querySelector<HTMLElement>('#contractor-certificate-total');
  if (target) target.textContent = formatAmount(total);
}

function contractorCertificateInput(form: HTMLFormElement): any {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '');
  const lines = [...form.querySelectorAll<HTMLElement>('[data-contractor-certificate-line]')].map((row) => ({
    code: row.querySelector<HTMLInputElement>('[name="lineCode"]')?.value.trim() ?? '',
    name: row.querySelector<HTMLInputElement>('[name="lineName"]')?.value.trim() ?? '',
    unit: row.querySelector<HTMLInputElement>('[name="lineUnit"]')?.value.trim() ?? '',
    previousQuantity: row.querySelector<HTMLInputElement>('[name="linePrevQty"]')?.value.trim() || '0',
    currentQuantity: row.querySelector<HTMLInputElement>('[name="lineCurrentQty"]')?.value.trim() ?? '',
    contractQuantity: row.querySelector<HTMLInputElement>('[name="lineContractQty"]')?.value.trim() || '0',
    completionRate: row.querySelector<HTMLInputElement>('[name="lineCompletionRate"]')?.value.trim() || '0',
    unitPrice: row.querySelector<HTMLInputElement>('[name="lineUnitPrice"]')?.value.trim() ?? '',
    discount: row.querySelector<HTMLInputElement>('[name="lineDiscount"]')?.value.trim() || '0',
  }));
  return {
    ...(id ? { id: Number(id) } : {}),
    date: String(data.get('date') ?? ''),
    contractorId: Number(data.get('contractorId')),
    projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
    contractId: data.get('contractId') ? Number(data.get('contractId')) : null,
    costCenter: String(data.get('costCenter') ?? '').trim(),
    notes: String(data.get('notes') ?? '').trim(),
    lines,
  };
}

function contractorVoucherInput(form: HTMLFormElement): any {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '');
  return {
    ...(id ? { id: Number(id) } : {}),
    date: String(data.get('date') ?? ''),
    contractorId: Number(data.get('contractorId')),
    projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
    paymentMethod: String(data.get('paymentMethod') ?? 'cash'),
    cashBoxId: null,
    bankAccountId: null,
    costCenter: String(data.get('costCenter') ?? '').trim(),
    referenceNo: String(data.get('referenceNo') ?? '').trim(),
    amount: String(data.get('amount') ?? '0'),
    notes: String(data.get('notes') ?? '').trim(),
  };
}

function propertyContractInput(form: HTMLFormElement): PropertyContractInput {
  const data = new FormData(form);
  const schedules: PropertyContractInput['schedules'] = [];
  for (const frequency of ['monthly', 'quarterly', 'semiannual', 'annual'] as const) {
    const amount = String(data.get(`${frequency}Amount`) ?? '').trim();
    if (!amount || toCents(amount) === 0n) continue;
    schedules.push({
      frequency,
      amount,
      count: Number(data.get(`${frequency}Count`)),
      firstDueDate: String(data.get(`${frequency}FirstDate`) ?? ''),
      description: String(data.get(`${frequency}Description`) ?? '').trim(),
      notes: String(data.get(`${frequency}Notes`) ?? '').trim(),
    });
  }
  const freePayments: PropertyContractInput['freePayments'] = [];
  for (const row of form.querySelectorAll<HTMLElement>('[data-property-free-payment]')) {
    const amount = row.querySelector<HTMLInputElement>('[name="freeAmount"]')?.value.trim() ?? '';
    const dueDate = row.querySelector<HTMLInputElement>('[name="freeDueDate"]')?.value ?? '';
    const description = row.querySelector<HTMLInputElement>('[name="freeDescription"]')?.value.trim() ?? '';
    const notes = row.querySelector<HTMLInputElement>('[name="freeNotes"]')?.value.trim() ?? '';
    if (!amount && !dueDate && !description && !notes) continue;
    freePayments.push({ amount, dueDate, description, notes });
  }
  const id = String(data.get('id') ?? '');
  return {
    ...(id ? { id: Number(id) } : {}),
    projectId: Number(data.get('projectId')),
    unitId: Number(data.get('unitId')),
    customerId: Number(data.get('customerId')),
    contractDate: String(data.get('contractDate') ?? ''),
    downPaymentDueDate: String(data.get('downPaymentDueDate') ?? ''),
    originalPrice: String(data.get('originalPrice') ?? ''),
    discount: String(data.get('discount') ?? '0'),
    fees: String(data.get('fees') ?? '0'),
    feeItems: [...form.querySelectorAll<HTMLElement>('[data-property-fee]')].map((row) => ({
      description: row.querySelector<HTMLInputElement>('[name="feeDescription"]')?.value.trim() ?? '',
      amount: row.querySelector<HTMLInputElement>('[name="feeAmount"]')?.value.trim() ?? '',
    })),
    downPayment: String(data.get('downPayment') ?? '0'),
    brokerId: data.get('brokerId') ? Number(data.get('brokerId')) : null,
    brokerCommissionMode: String(data.get('brokerCommissionMode') ?? 'rate') as 'rate' | 'fixed',
    brokerRate: String(data.get('brokerRate') ?? '0'),
    brokerOnOriginalPrice: data.has('brokerOnOriginalPrice'),
    schedules,
    freePayments,
    notes: String(data.get('notes') ?? ''),
  };
}

function openRecordForm(record?: RecordItem): void {
  const modal = document.querySelector<HTMLDivElement>('#record-modal');
  const form = document.querySelector<HTMLFormElement>('#record-form');
  const title = document.querySelector<HTMLElement>('#record-modal-title');
  if (!modal || !form || !title) return;
  form.reset();
  const error = document.querySelector<HTMLElement>('#record-error');
  if (error) error.hidden = true;
  if (record) {
    title.textContent = 'تعديل السجل';
    for (const [key, value] of Object.entries(record)) {
      const field = form.elements.namedItem(key);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
        field.value = String(value);
      }
    }
  } else {
    title.textContent = 'إضافة سجل';
    const moduleInput = form.elements.namedItem('module');
    if (moduleInput instanceof HTMLInputElement) moduleInput.value = currentPage;
  }
  modal.hidden = false;
  const titleField = form.elements.namedItem('title');
  if (titleField instanceof HTMLInputElement) titleField.focus();
}

function openAccountForm(account?: AccountItem): void {
  const modal = document.querySelector<HTMLDivElement>('#account-modal');
  const form = document.querySelector<HTMLFormElement>('#account-form');
  const title = document.querySelector<HTMLElement>('#account-modal-title');
  if (!modal || !form || !title) return;
  form.reset();
  const error = document.querySelector<HTMLElement>('#account-error');
  if (error) error.hidden = true;
  title.textContent = account ? 'تعديل الحساب' : 'إضافة حساب';
  if (account) {
    for (const [key, value] of Object.entries(account)) {
      const field = form.elements.namedItem(key === 'parentId' ? 'parentId' : key);
      if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        field.checked = Boolean(value);
      } else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        field.value = value === null ? '' : String(value);
      }
    }
  }
  modal.hidden = false;
  const codeField = form.elements.namedItem('code');
  if (codeField instanceof HTMLInputElement) codeField.focus();
}

function openJournalForm(): void {
  const host = document.querySelector<HTMLElement>('#journal-editor-host');
  if (!host) return;
  host.innerHTML = renderJournalEditor(accounts, costCenters);
  const modal = document.querySelector<HTMLDivElement>('#journal-modal');
  const editorForm = document.querySelector<HTMLFormElement>('[data-form="journal"]');
  if (!modal || !editorForm) return;
  const requestKey = editorForm.elements.namedItem('requestKey');
  if (requestKey instanceof HTMLInputElement) requestKey.value = crypto.randomUUID();
  const dateField = editorForm.elements.namedItem('date');
  const today = new Date();
  if (dateField instanceof HTMLInputElement) {
    dateField.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }
  const error = document.querySelector<HTMLElement>('#journal-error');
  if (error) error.hidden = true;
  modal.hidden = false;
  const description = editorForm.elements.namedItem('description');
  if (description instanceof HTMLInputElement) description.focus();
  updateJournalTotals(editorForm);
}

function openCostCenterForm(center?: CostCenter): void {
  const form = document.querySelector<HTMLFormElement>('[data-form="cost-center"]');
  const modal = document.querySelector<HTMLElement>('#center-modal');
  const title = document.querySelector<HTMLElement>('#center-modal-title');
  if (!form || !modal || !title) return;
  form.reset();
  const error = document.querySelector<HTMLElement>('#center-error');
  if (error) error.hidden = true;
  title.textContent = center ? 'تعديل مركز التكلفة' : 'مركز تكلفة جديد';
  if (center) {
    for (const [key, value] of Object.entries(center)) {
      const field = form.elements.namedItem(key);
      if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value);
      else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) field.value = value === null ? '' : String(value);
    }
  }
  modal.hidden = false;
}

function updateJournalTotals(form: HTMLFormElement): void {
  let debit = 0n;
  let credit = 0n;
  for (const row of form.querySelectorAll<HTMLElement>('[data-journal-line]')) {
    try { debit += parseAmount(row.querySelector<HTMLInputElement>('[name="debit"]')?.value.trim() || '0'); } catch { }
    try { credit += parseAmount(row.querySelector<HTMLInputElement>('[name="credit"]')?.value.trim() || '0'); } catch { }
  }
  const debitText = formatAmount(debit);
  const creditText = formatAmount(credit);
  const debitTarget = form.querySelector<HTMLElement>('[data-journal-debit]');
  const creditTarget = form.querySelector<HTMLElement>('[data-journal-credit]');
  const differenceTarget = form.querySelector<HTMLElement>('[data-journal-difference]');
  if (debitTarget) debitTarget.textContent = debitText;
  if (creditTarget) creditTarget.textContent = creditText;
  if (differenceTarget) differenceTarget.textContent = formatAmount(debit >= credit ? debit - credit : credit - debit);
}

function updateExpenseTotals(form: HTMLFormElement): void {
  let allocated = 0n;
  for (const row of form.querySelectorAll<HTMLElement>('[data-expense-allocation]')) {
    try { allocated += parseAmount(row.querySelector<HTMLInputElement>('[name="amount"]')?.value.trim() || '0'); } catch { }
  }
  let total = 0n;
  let paid = 0n;
  try { total = parseAmount(form.querySelector<HTMLInputElement>('[name="totalAmount"]')?.value.trim() || '0'); } catch { }
  try { paid = parseAmount(form.querySelector<HTMLInputElement>('[name="paidAmount"]')?.value.trim() || '0'); } catch { }
  const remaining = total > paid ? total - paid : 0n;
  const allocatedTarget = form.querySelector<HTMLElement>('[data-expense-allocated]');
  const remainingTarget = form.querySelector<HTMLElement>('[data-expense-remaining-label]');
  const remainingInput = form.querySelector<HTMLInputElement>('[data-expense-remaining]');
  if (allocatedTarget) allocatedTarget.textContent = formatAmount(allocated);
  if (remainingTarget) remainingTarget.textContent = formatAmount(remaining);
  if (remainingInput) remainingInput.value = formatAmount(remaining);
}

function exportRecords(): void {
  const fields: (keyof RecordInput)[] = ['title', 'reference', 'party', 'date', 'amount', 'status', 'notes'];
  const header = ['الاسم', 'المرجع', 'الطرف', 'التاريخ', 'القيمة المدخلة', 'الحالة', 'ملاحظات'];
  const csvEscape = (value: string): string => {
    const spreadsheetSafeValue = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
  };
  const rows = currentRecords.map((record) => fields.map((field) => csvEscape(record[field])).join(','));
  const blob = new Blob(['\uFEFF', [header.map(csvEscape).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${currentPage}-records.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

root.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const settingsTabControl = target.closest<HTMLElement>('[data-settings-view]');
  const outsideSettingsNavigation = target.closest<HTMLElement>(
    '[data-page], [data-dashboard-view], [data-sales-page], [data-purchase-page], [data-inventory-page], [data-asset-page], [data-project-view], [data-portfolio-view], [data-contractor-view], [data-treasury-view], [data-accounting-view], [data-brokerage-page], [data-action="users-exit"]',
  );
  if (!settingsTabControl && currentPage === 'settings' && outsideSettingsNavigation
    && hasUnsavedSettingsChanges()
    && !window.confirm('لديك تغييرات غير محفوظة في الإعدادات. هل تريد مغادرة الصفحة دون حفظ؟')) return;
  const userAdminButton = target.closest<HTMLElement>('[data-action]');
  const adminAction = userAdminButton?.dataset.action;
  const adminId = Number(userAdminButton?.dataset.id);
  if (adminAction === 'users-new') {
    if (!confirmDiscardSettingsChanges()) return;
    selectedManagedUserId = null;
    creatingManagedUser = true;
    await showSettingsTab('users');
    return;
  }
  if (adminAction === 'users-refresh') {
    if (!confirmDiscardSettingsChanges()) return;
    await showSettingsTab('users');
    return;
  }
  if (adminAction === 'user-select' && Number.isSafeInteger(adminId)) {
    if (!confirmDiscardSettingsChanges()) return;
    selectedManagedUserId = adminId;
    creatingManagedUser = false;
    await showSettingsTab('users');
    return;
  }
  if (adminAction === 'users-open-rights' && Number.isSafeInteger(adminId)) {
    if (!confirmDiscardSettingsChanges()) return;
    selectedManagedUserId = adminId;
    await showSettingsTab('user-permissions');
    return;
  }
  if (adminAction === 'users-exit') {
    await showPage(usersReturnPage);
    return;
  }
  if (adminAction === 'user-toggle-active' && Number.isSafeInteger(adminId)) {
    const active = userAdminButton?.dataset.active === 'true';
    if (!window.confirm(active ? 'إعادة تفعيل هذا المستخدم؟' : 'إيقاف المستخدم ومنعه من تسجيل الدخول؟')) return;
    try {
      await window.elsaad.setManagedUserActive(adminId, active);
      await showSettingsTab('users');
      window.alert(active ? 'تمت إعادة تفعيل المستخدم.' : 'تم إيقاف المستخدم.');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تغيير حالة المستخدم.');
    }
    return;
  }
  if (adminAction === 'groups-new') {
    if (!confirmDiscardSettingsChanges()) return;
    selectedPermissionGroupId = null;
    await showSettingsTab('permission-groups');
    return;
  }
  if (adminAction === 'groups-refresh') {
    if (!confirmDiscardSettingsChanges()) return;
    await showSettingsTab('permission-groups');
    return;
  }
  if (adminAction === 'group-select' && Number.isSafeInteger(adminId)) {
    if (!confirmDiscardSettingsChanges()) return;
    selectedPermissionGroupId = adminId;
    await showSettingsTab('permission-groups');
    return;
  }
  if (adminAction === 'group-select-all' || adminAction === 'group-clear-all') {
    const value = adminAction === 'group-select-all';
    document.querySelectorAll<HTMLInputElement>('form[data-form="permission-group"] input[name="permission"]').forEach((input) => { input.checked = value; });
    return;
  }
  if (adminAction === 'permissions-refresh') {
    if (!confirmDiscardSettingsChanges()) return;
    await showSettingsTab('user-permissions');
    return;
  }
  if (adminAction === 'permissions-reset' && selectedManagedUserId !== null) {
    if (!confirmDiscardSettingsChanges()) return;
    if (!window.confirm('إزالة التخصيصات المباشرة واستعادة صلاحيات المجموعة الافتراضية؟')) return;
    try {
      selectedUserPermissionState = await window.elsaad.resetUserPermissions(selectedManagedUserId);
      await showSettingsTab('user-permissions');
      window.alert('تمت استعادة الصلاحيات الموروثة من المجموعة.');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذرت استعادة الصلاحيات.');
    }
    return;
  }
  if (adminAction === 'permissions-select-all' || adminAction === 'permissions-clear-all') {
    const value = adminAction === 'permissions-select-all';
    document.querySelectorAll<HTMLInputElement>('form[data-form="user-permissions"] input[name="permission"]').forEach((input) => { input.checked = value; });
    return;
  }
  if (adminAction === 'program-data-reset') {
    if (!window.confirm('سيتم حذف معاملات التشغيل المدرجة وإنشاء نسخة أمان أولًا. ستبقى الإعدادات والمستخدمون والبيانات الرئيسية والأرصدة الافتتاحية. هل تريد المتابعة؟')) return;
    const confirmation = window.prompt('للتأكيد، اكتب العبارة التالية كما هي: تفريغ بيانات التشغيل');
    if (confirmation === null) return;
    try {
      const result = await window.elsaad.resetOperationalData(confirmation);
      await loadSettingsPage();
      const total = Object.values(result.deletedRows).reduce((sum, count) => sum + count, 0);
      window.alert(`اكتمل التفريغ بعد إنشاء نسخة الأمان «${result.backupFileName}». عدد السجلات المحذوفة: ${total}.`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تفريغ بيانات البرنامج.');
    }
    return;
  }
  const settingsTab = target.closest<HTMLElement>('[data-settings-view]');
  const requestedSettingsView = settingsTab?.dataset.settingsView;
  if (requestedSettingsView === 'general' || requestedSettingsView === 'backup' || requestedSettingsView === 'company'
    || requestedSettingsView === 'users' || requestedSettingsView === 'permission-groups' || requestedSettingsView === 'user-permissions') {
    if (requestedSettingsView === settingsView) return;
    if (!confirmDiscardSettingsChanges()) return;
    await showSettingsTab(requestedSettingsView);
    return;
  }
  const installmentGroupingButton = target.closest<HTMLElement>('[data-installment-grouping]');
  const requestedInstallmentGrouping = installmentGroupingButton?.dataset.installmentGrouping;
  if (requestedInstallmentGrouping === 'customer' || requestedInstallmentGrouping === 'project' || requestedInstallmentGrouping === 'unit') {
    installmentReportGrouping = requestedInstallmentGrouping;
    document.querySelectorAll<HTMLElement>('[data-installment-grouping]').forEach((button) => {
      const active = button.dataset.installmentGrouping === requestedInstallmentGrouping;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    refreshInstallmentReportResults();
    return;
  }
  const reportGroupToggle = target.closest<HTMLElement>('[data-report-group]');
  if (reportGroupToggle?.dataset.reportGroup) {
    const group = reportGroupToggle.dataset.reportGroup;
    reportExpandedGroups = reportExpandedGroups.includes(group)
      ? reportExpandedGroups.filter((value) => value !== group)
      : [...reportExpandedGroups, group];
    refreshReportLibraryParts();
    return;
  }
  const reportFavoriteButton = target.closest<HTMLElement>('[data-report-favorite]');
  if (reportFavoriteButton?.dataset.reportFavorite) {
    toggleReportFavorite(reportFavoriteButton.dataset.reportFavorite);
    return;
  }
  const reportKeyButton = target.closest<HTMLElement>('[data-report-key]');
  if (reportKeyButton?.dataset.reportKey) {
    selectReport(reportKeyButton.dataset.reportKey);
    return;
  }
  const treasuryTab = target.closest<HTMLElement>('[data-treasury-view]');
  if (treasuryTab?.dataset.treasuryView === 'cash-boxes' || treasuryTab?.dataset.treasuryView === 'banks') {
    currentTreasuryView = treasuryTab.dataset.treasuryView;
    currentPage = 'treasury';
    await showPage('treasury');
    return;
  }
  const salesPage = target.closest<HTMLElement>('[data-sales-page]');
  if (salesPage?.dataset.salesPage) {
    const requestedView = salesPage.dataset.salesPage;
    if (isSalesView(requestedView)) {
      currentSalesView = requestedView;
      if (requestedView !== 'customers') customerGroupFilter = '';
      currentPage = 'sales';
      await showPage('sales');
    }
    return;
  }
  const purchasePage = target.closest<HTMLElement>('[data-purchase-page]');
  if (purchasePage?.dataset.purchasePage) {
    const requested = PURCHASE_PAGES.find(({ key }) => key === purchasePage.dataset.purchasePage)?.key;
    if (requested) {
      currentPurchaseView = requested;
      currentPage = 'purchases';
      await showPage('purchases');
    }
    return;
  }
  const inventoryPage = target.closest<HTMLElement>('[data-inventory-page]');
  if (inventoryPage?.dataset.inventoryPage) {
    const requested = INVENTORY_PAGES.find(({ key }) => key === inventoryPage.dataset.inventoryPage)?.key;
    if (requested) {
      currentInventoryView = requested;
      currentPage = 'inventory';
      await showPage('inventory');
    }
    return;
  }
  const assetPage = target.closest<HTMLElement>('[data-asset-page]');
  const requestedAssetView = ASSET_PAGES.find(({ key }) => key === assetPage?.dataset.assetPage)?.key;
  if (requestedAssetView) {
    currentAssetView = requestedAssetView;
    currentPage = 'assets';
    await showPage('assets');
    return;
  }
  const contractorPage = target.closest<HTMLElement>('[data-contractor-view]');
  if (contractorPage?.dataset.contractorView === 'contractor-list' || contractorPage?.dataset.contractorView === 'contractor-contracts'
    || contractorPage?.dataset.contractorView === 'contractor-certificates' || contractorPage?.dataset.contractorView === 'contractor-vouchers') {
    currentContractorView = contractorPage.dataset.contractorView;
    currentPage = 'contractors';
    if (currentContractorView === 'contractor-list') preferredContractorId = null;
    await showPage('contractors');
    return;
  }
  const accountingPage = target.closest<HTMLElement>('[data-accounting-view]');
  const requestedAccountingView = accountingPage?.dataset.accountingView;
  if (requestedAccountingView === 'chart-of-accounts' || requestedAccountingView === 'cost-centers'
    || requestedAccountingView === 'daily-journals' || requestedAccountingView === 'budgets'
    || (requestedAccountingView === 'financial-periods' && authenticatedUser?.systemAdmin)) {
    currentAccountingView = requestedAccountingView;
    currentPage = 'accounts';
    await showPage('accounts');
    return;
  }
  const brokeragePage = target.closest<HTMLElement>('[data-brokerage-page]');
  if (brokeragePage?.dataset.brokeragePage === 'broker-data') {
    currentPage = 'brokerage';
    brokerageSearch = '';
    await showPage('brokerage');
    return;
  }
  const portfolioPage = target.closest<HTMLElement>('[data-portfolio-view]');
  if (portfolioPage?.dataset.portfolioView === 'properties' || portfolioPage?.dataset.portfolioView === 'projects') {
    currentPortfolioView = portfolioPage.dataset.portfolioView;
    currentProjectView = currentPortfolioView;
    await refreshPortfolioPage();
    return;
  }
  const projectPageButton = target.closest<HTMLElement>('[data-project-view]');
  if (projectPageButton?.dataset.projectView) {
    const requested = projectPageButton.dataset.projectView;
    if (requested === 'project-list' || requested === 'project-material-issues' || requested === 'work-items'
      || requested === 'property-units' || requested === 'property-contracts' || requested === 'property-payments') {
      currentProjectView = requested;
      await showPage('projects');
    }
    return;
  }
  const dashboardPage = target.closest<HTMLElement>('[data-dashboard-view]');
  if (dashboardPage?.dataset.dashboardView) {
    event.preventDefault();
    const requestedView = dashboardPage.dataset.dashboardView;
    if (requestedView === 'dashboard-new' || requestedView === 'dashboard-2') {
      currentDashboardView = requestedView;
      currentPage = 'dashboard';
      await showPage('dashboard');
    }
    return;
  }

  const pageButton = target.closest<HTMLElement>('[data-page]');
  if (pageButton?.dataset.page) {
    const page = MODULES.find(({ key }) => key === pageButton.dataset.page)?.key;
    if (page) await showPage(page);
    return;
  }

  const actionButton = target.closest<HTMLElement>('[data-action]');
  if (!actionButton) return;
  if (actionButton.closest('.account-tree-node summary')) event.preventDefault();
  const { action, id } = actionButton.dataset;
  if (action === 'backup-choose-folder') {
    try {
      const state = await window.elsaad.chooseBackupDirectory();
      if (state) { settingsBackup = state; await loadSettingsPage(); }
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر اختيار مجلد النسخ.'); }
  } else if (action === 'backup-now') {
    try {
      settingsBackup = await window.elsaad.createBackup();
      await loadSettingsPage();
      window.alert('اكتملت النسخة الاحتياطية وتم التحقق من سلامة الملف.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر إنشاء النسخة الاحتياطية.'); }
  } else if (action === 'backup-open-folder') {
    try { await window.elsaad.openBackupDirectory(); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر فتح مجلد النسخ.'); }
  } else if (action === 'backup-refresh') {
    await loadSettingsPage();
  } else if (action === 'backup-choose-restore') {
    try {
      selectedRestoreCandidate = await window.elsaad.chooseRestoreBackup();
      await loadSettingsPage();
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر التحقق من ملف النسخة.'); }
  } else if (action === 'backup-restore') {
    if (!selectedRestoreCandidate) return;
    const confirmed = window.confirm(`سيتم استبدال بيانات هذا التثبيت بملف النسخة «${selectedRestoreCandidate.fileName}». ستُنشأ نسخة أمان من قاعدة البيانات الحالية قبل المتابعة. هل تؤكد الاستعادة؟`);
    if (!confirmed) return;
    try {
      settingsBackup = await window.elsaad.restoreBackup();
      selectedRestoreCandidate = null;
      await loadSettingsPage();
      window.alert('اكتملت الاستعادة والتحقق من قاعدة البيانات بنجاح.');
    } catch (error) {
      selectedRestoreCandidate = null;
      await loadSettingsPage();
      window.alert(error instanceof Error ? error.message : 'تعذرت استعادة النسخة.');
    }
  } else if (action === 'company-logo-choose') {
    try {
      const company = await window.elsaad.uploadCompanyLogo();
      if (!company) return;
      settingsCompany = company;
      await loadSettingsPage();
      window.alert('تم تحديث شعار الشركة.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تحديث شعار الشركة.'); }
  } else if (action === 'global-error-close') {
    document.querySelector<HTMLElement>('#global-error-banner')?.remove();
  } else if (action === 'installment-report-exit') {
    const destination = previousPage === 'installment-reports' ? 'dashboard' : previousPage;
    await showPage(destination);
  } else if (action === 'installment-report-reset') {
    installmentReportFilters = reportLibrary ? { ...reportLibrary.defaults } : defaultReportFilters();
    installmentReportSearch = '';
    installmentReportResult = null;
    installmentReportError = '';
    await runInstallmentReport();
  } else if (action === 'report-print') {
    printCurrentReport();
  } else if (action === 'report-pdf') {
    await exportCurrentReportPdf();
  } else if (action === 'report-excel') {
    await exportCurrentReportExcel();
  } else if (action === 'report-refresh') {
    await runSelectedReport();
  } else if (action === 'report-reset-form') {
    reportFilters = defaultFiltersForReport(currentReportKey);
    reportResult = null;
    reportError = '';
    refreshReportWorkspace();
  } else if (action === 'asset-group-add') {
    document.querySelector<HTMLElement>('#asset-editor-host')!.innerHTML = renderAssetGroupEditor(null, accounts);
  } else if (action === 'asset-group-edit' && id) {
    const group = assetGroups.find((entry) => entry.id === Number(id));
    if (group) document.querySelector<HTMLElement>('#asset-editor-host')!.innerHTML = renderAssetGroupEditor(group, accounts);
  } else if (action === 'asset-add') {
    document.querySelector<HTMLElement>('#asset-editor-host')!.innerHTML = renderAssetEditor(null, assetGroups, accounts);
  } else if (action === 'asset-edit' && id) {
    const asset = fixedAssets.find((entry) => entry.id === Number(id));
    if (asset) document.querySelector<HTMLElement>('#asset-editor-host')!.innerHTML = renderAssetEditor(asset, assetGroups, accounts);
  } else if (action === 'asset-editor-close') {
    document.querySelector<HTMLElement>('#asset-editor-modal')?.remove();
  } else if (action === 'asset-group-delete' && id) {
    if (!window.confirm('حذف مجموعة الأصول؟ لا يمكن حذف مجموعة مرتبطة بأصول.')) return;
    try { await window.elsaad.deleteAssetGroup(Number(id)); await showPage('assets'); }
    catch (error) { showError(error, 'asset-error'); }
  } else if (action === 'asset-delete' && id) {
    if (!window.confirm('حذف الأصل؟ لا يمكن حذف أصل له إهلاك مرحّل.')) return;
    try { await window.elsaad.deleteAsset(Number(id)); await showPage('assets'); }
    catch (error) { showError(error, 'asset-error'); }
  } else if (action === 'asset-depreciation-post') {
    if (!window.confirm(`ترحيل إهلاك الفترة ${assetDepreciationRange.from} إلى ${assetDepreciationRange.to} وإنشاء القيد المحاسبي؟`)) return;
    try {
      const run = await window.elsaad.postAssetDepreciation(assetDepreciationRange);
      window.alert(`تم ترحيل ${run.assetCount} أصل بإجمالي ${run.total}. رقم العملية ${run.number}، القيد رقم ${run.journalEntryId}.`);
      await showPage('assets');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر ترحيل الإهلاك.'); }
  } else if (action === 'asset-depreciation-run' && id) {
    const run = assetDepreciationReport?.runs.find((entry) => entry.id === Number(id));
    if (run) document.querySelector<HTMLElement>('#asset-editor-host')!.innerHTML = renderDepreciationRun(run);
  } else if (action === 'asset-depreciation-print') {
    window.print();
  } else if (action === 'asset-depreciation-pdf') {
    try {
      const saved = await window.elsaad.exportAssetDepreciationPdf();
      if (saved) window.alert('تم تصدير تقرير الإهلاك إلى PDF.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تصدير PDF.'); }
  } else if (action === 'financial-document-exit') {
    await showPage('dashboard');
  } else if (action === 'financial-voucher-refresh' || action === 'expense-refresh') {
    await showPage(currentPage);
  } else if (action === 'financial-voucher-new') {
    const kind: FinancialVoucherParty = currentPage === 'customer-vouchers' ? 'customer' : 'supplier';
    const parties = kind === 'customer' ? customers : suppliers;
    document.querySelector<HTMLElement>('#financial-voucher-editor-host')!.innerHTML =
      renderFinancialVoucherEditor(kind, null, parties, cashBoxes, bankAccounts, costCenters, projects);
  } else if (action === 'financial-voucher-edit' && id) {
    const voucher = financialVouchers.find((item) => item.id === Number(id));
    if (voucher) {
      const kind = currentPage === 'customer-vouchers' ? 'customer' : 'supplier';
      document.querySelector<HTMLElement>('#financial-voucher-editor-host')!.innerHTML =
        renderFinancialVoucherEditor(kind, voucher, kind === 'customer' ? customers : suppliers, cashBoxes, bankAccounts, costCenters, projects);
    }
  } else if (action === 'financial-voucher-cancel') {
    document.querySelector<HTMLElement>('#financial-voucher-modal')?.remove();
  } else if (action === 'financial-voucher-approve' && id) {
    const kind = actionButton.dataset.kind;
    if (kind !== 'customer' && kind !== 'supplier') return;
    if (!window.confirm('اعتماد السند وإنشاء القيد المحاسبي؟ سيتم الترحيل مرة واحدة.')) return;
    try {
      await window.elsaad.approveFinancialVoucher(Number(id), kind);
      await showPage(currentPage);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر اعتماد السند.');
    }
  } else if (action === 'financial-voucher-delete' && id) {
    const kind = actionButton.dataset.kind;
    if (kind !== 'customer' && kind !== 'supplier') return;
    if (!window.confirm('حذف مسودة السند المحدد؟ السند المرحّل لا يمكن حذفه.')) return;
    try {
      await window.elsaad.deleteFinancialVoucher(Number(id), kind);
      await showPage(currentPage);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة السند.');
    }
  } else if (action === 'financial-voucher-open' && id) {
    const voucher = financialVouchers.find((item) => item.id === Number(id));
    if (voucher?.journalEntryId) {
      try {
        const entry = await window.elsaad.getJournalEntry(voucher.journalEntryId);
        document.querySelector<HTMLElement>('#financial-voucher-detail-host')!.innerHTML = renderJournalDetail(entry);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'تعذر فتح القيد المرتبط بالسند.');
      }
    }
  } else if (action === 'expense-new') {
    document.querySelector<HTMLElement>('#expense-editor-host')!.innerHTML = renderExpenseEditor(null, accounts, cashBoxes, bankAccounts, costCenters, projects);
    const form = document.querySelector<HTMLFormElement>('[data-form="expense"]');
    if (form) updateExpenseTotals(form);
  } else if ((action === 'expense-edit' || action === 'expense-open' || action === 'expense-duplicate') && id) {
    const expense = expenses.find((item) => item.id === Number(id));
    if (expense) {
      const duplicate = action === 'expense-duplicate';
      document.querySelector<HTMLElement>('#expense-editor-host')!.innerHTML = renderExpenseEditor(expense, accounts, cashBoxes, bankAccounts, costCenters, projects, duplicate);
      const form = document.querySelector<HTMLFormElement>('[data-form="expense"]');
      if (form) updateExpenseTotals(form);
    }
  } else if (action === 'expense-cancel') {
    document.querySelector<HTMLElement>('#expense-modal')?.remove();
  } else if (action === 'expense-allocation-add') {
    document.querySelector<HTMLElement>('#expense-allocations')?.insertAdjacentHTML('beforeend', renderExpenseAllocationRow(accounts, costCenters, projects));
    const form = document.querySelector<HTMLFormElement>('[data-form="expense"]');
    if (form) updateExpenseTotals(form);
  } else if (action === 'expense-allocation-remove') {
    const rows = document.querySelectorAll('[data-expense-allocation]');
    if (rows.length > 1) actionButton.closest<HTMLElement>('[data-expense-allocation]')?.remove();
    const form = document.querySelector<HTMLFormElement>('[data-form="expense"]');
    if (form) updateExpenseTotals(form);
  } else if (action === 'expense-approve' && id) {
    if (!window.confirm('اعتماد المصروف وإنشاء القيد المحاسبي؟ سيتم الترحيل مرة واحدة.')) return;
    try {
      await window.elsaad.approveExpense(Number(id));
      await showPage('expenses');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر اعتماد المصروف.');
    }
  } else if (action === 'expense-delete' && id) {
    if (!window.confirm('حذف مسودة المصروف المحددة؟ المصروف المرحّل لا يمكن حذفه.')) return;
    try {
      await window.elsaad.deleteExpense(Number(id));
      await showPage('expenses');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة المصروف.');
    }
  } else if (action === 'accounting-toggle') {
    accountingExpanded = !accountingExpanded;
    const submenu = document.querySelector<HTMLElement>('#accounting-subpages');
    const button = actionButton as HTMLButtonElement;
    button.setAttribute('aria-expanded', String(accountingExpanded));
    submenu?.toggleAttribute('hidden', !accountingExpanded);
    button.querySelector<SVGElement>('.nav-chevron')?.classList.toggle('nav-chevron--open', accountingExpanded);
  } else if (action === 'accounting-clear-search') {
    if (currentAccountingView === 'chart-of-accounts') accountSearch = '';
    else if (currentAccountingView === 'cost-centers') costCenterSearch = '';
    else if (currentAccountingView === 'daily-journals') journalSearch = '';
    else if (currentAccountingView === 'budgets') budgetSearch = '';
    await showPage('accounts');
  } else if (action === 'accounting-periods-refresh') {
    await showPage('accounts');
  } else if (action === 'account-exit') {
    await showPage('dashboard');
  } else if (action === 'brokerage-toggle') {
    brokerageExpanded = !brokerageExpanded;
    const submenu = document.querySelector<HTMLElement>('#brokerage-subpages');
    const button = actionButton as HTMLButtonElement;
    button.setAttribute('aria-expanded', String(brokerageExpanded));
    submenu?.toggleAttribute('hidden', !brokerageExpanded);
    button.querySelector<SVGElement>('.nav-chevron')?.classList.toggle('nav-chevron--open', brokerageExpanded);
  } else if (action === 'brokerage-new') {
    document.querySelector<HTMLElement>('#brokerage-editor-host')!.innerHTML = renderBrokerageEditor(null);
  } else if (action === 'brokerage-edit' && id) {
    const broker = propertyBrokers.find((entry) => entry.id === Number(id));
    if (broker) document.querySelector<HTMLElement>('#brokerage-editor-host')!.innerHTML = renderBrokerageEditor(broker);
  } else if (action === 'brokerage-cancel') {
    document.querySelector<HTMLElement>('#brokerage-editor-modal')?.remove();
  } else if (action === 'brokerage-delete' && id) {
    if (!window.confirm('هل تريد حذف بيانات هذا السمسار؟ لن يُحذف إذا كان مرتبطًا بعقد.')) return;
    try {
      await window.elsaad.deletePropertyBroker(Number(id));
      await showPage('brokerage');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف بيانات السمسار.');
    }
  } else if (action === 'brokerage-print' && id) {
    const broker = propertyBrokers.find((entry) => entry.id === Number(id));
    const host = document.querySelector<HTMLElement>('#brokerage-print-host');
    if (broker && host) {
      host.innerHTML = renderBrokeragePrint(broker);
      document.body.classList.add('brokerage-print-mode');
      window.addEventListener('afterprint', () => document.body.classList.remove('brokerage-print-mode'), { once: true });
      window.print();
    }
  } else if (action === 'brokerage-clear-search') {
    brokerageSearch = '';
    await showPage('brokerage');
  } else if (action === 'contractors-toggle') {
    contractorsExpanded = !contractorsExpanded;
    const submenu = document.querySelector<HTMLElement>('#contractors-subpages');
    const button = actionButton as HTMLButtonElement;
    button.setAttribute('aria-expanded', String(contractorsExpanded));
    submenu?.toggleAttribute('hidden', !contractorsExpanded);
    button.querySelector<SVGElement>('.nav-chevron')?.classList.toggle('nav-chevron--open', contractorsExpanded);
  } else if (action === 'contractor-new') {
    document.querySelector<HTMLElement>('#contractor-editor-host')!.innerHTML = renderContractorEditor(null);
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor"]');
    if (form) updateContractorOpeningTotals(form);
  } else if (action === 'contractor-edit' && id) {
    const contractor = contractors.find((entry) => entry.id === Number(id));
    if (contractor) {
      document.querySelector<HTMLElement>('#contractor-editor-host')!.innerHTML = renderContractorEditor(contractor);
      const form = document.querySelector<HTMLFormElement>('[data-form="contractor"]');
      if (form) updateContractorOpeningTotals(form);
    }
  } else if (action === 'contractor-cancel') {
    document.querySelector<HTMLElement>('#contractor-editor-modal')?.remove();
  } else if (action === 'contractor-opening-add') {
    const host = document.querySelector<HTMLTableSectionElement>('#contractor-opening-entries');
    host?.querySelector('[data-empty-opening]')?.remove();
    if (host) host.insertAdjacentHTML('beforeend', renderContractorOpeningEntry());
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor"]');
    if (form) updateContractorOpeningTotals(form);
  } else if (action === 'contractor-opening-remove') {
    actionButton.closest<HTMLElement>('[data-contractor-opening-row]')?.remove();
    const host = document.querySelector<HTMLTableSectionElement>('#contractor-opening-entries');
    if (host && host.querySelectorAll('[data-contractor-opening-row]').length === 0) host.innerHTML = '<tr data-empty-opening><td colspan="6" class="empty-state">لا توجد أرصدة افتتاحية.</td></tr>';
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor"]');
    if (form) updateContractorOpeningTotals(form);
  } else if (action === 'contractor-search-focus') {
    document.querySelector<HTMLInputElement>('#contractor-search')?.focus();
  } else if (action === 'contractor-contracts-page' || action === 'contractor-list-page') {
    currentPage = 'contractors';
    currentContractorView = action === 'contractor-list-page' ? 'contractor-list' : 'contractor-contracts';
    preferredContractorId = null;
    await showPage('contractors');
  } else if (action === 'contractor-open-contracts' && id) {
    currentPage = 'contractors';
    currentContractorView = 'contractor-contracts';
    preferredContractorId = Number(id);
    await showPage('contractors');
  } else if (action === 'contractor-refresh') {
    await showPage('contractors');
  } else if (action === 'contractor-exit') {
    currentContractorView = 'contractor-list';
    await showPage('dashboard');
  } else if (action === 'contractor-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setContractorStatus(Number(id), status);
      await showPage('contractors');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة المقاول.');
    }
  } else if (action === 'contractor-contract-new') {
    document.querySelector<HTMLElement>('#contractor-contract-editor-host')!.innerHTML = renderContractorContractEditor(null, contractors, projects, preferredContractorId);
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-contract"]');
    if (form) updateContractorContractTotals(form);
  } else if (action === 'contractor-contract-edit' && id) {
    const contract = contractorContracts.find((entry) => entry.id === Number(id));
    if (contract) {
      document.querySelector<HTMLElement>('#contractor-contract-editor-host')!.innerHTML = renderContractorContractEditor(contract, contractors, projects, null);
      const form = document.querySelector<HTMLFormElement>('[data-form="contractor-contract"]');
      if (form) updateContractorContractTotals(form);
    }
  } else if (action === 'contractor-contract-cancel') {
    document.querySelector<HTMLElement>('#contractor-contract-editor-modal')?.remove();
  } else if (action === 'contractor-contract-search-focus') {
    document.querySelector<HTMLInputElement>('#contractor-contract-search')?.focus();
  } else if (action === 'contractor-contract-refresh') {
    await showPage('contractors');
  } else if (action === 'contractor-contract-delete' && id) {
    if (!window.confirm('حذف مسودة العقد وبنودها؟')) return;
    try {
      await window.elsaad.deleteContractorContract(Number(id));
      await showPage('contractors');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة العقد.');
    }
  } else if (action === 'contractor-certificate-new') {
    document.querySelector<HTMLElement>('#contractor-certificate-editor-host')!.innerHTML = renderContractorCertificateEditor(null, contractors, projects, contractorContracts, preferredContractorId);
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-certificate"]');
    if (form) updateContractorCertificateTotals(form);
  } else if (action === 'contractor-certificate-edit' && id) {
    const certificate = contractorCertificates.find((entry) => entry.id === Number(id));
    if (certificate) {
      document.querySelector<HTMLElement>('#contractor-certificate-editor-host')!.innerHTML = renderContractorCertificateEditor(certificate, contractors, projects, contractorContracts, null);
      const form = document.querySelector<HTMLFormElement>('[data-form="contractor-certificate"]');
      if (form) updateContractorCertificateTotals(form);
    }
  } else if (action === 'contractor-certificate-cancel') {
    document.querySelector<HTMLElement>('#contractor-certificate-editor-modal')?.remove();
  } else if (action === 'contractor-certificate-search-focus') {
    document.querySelector<HTMLInputElement>('#contractor-certificate-search')?.focus();
  } else if (action === 'contractor-certificate-refresh') {
    await showPage('contractors');
  } else if (action === 'contractor-certificate-delete' && id) {
    if (!window.confirm('حذف مسودة المستخلص؟')) return;
    try {
      await window.elsaad.deleteContractorCertificate(Number(id));
      await showPage('contractors');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة المستخلص.');
    }
  } else if (action === 'contractor-certificate-line-add') {
    const host = document.querySelector<HTMLTableSectionElement>('#contractor-certificate-lines');
    if (host) host.insertAdjacentHTML('beforeend', renderContractorCertificateLine(undefined, host.querySelectorAll('[data-contractor-certificate-line]').length));
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-certificate"]');
    if (form) updateContractorCertificateTotals(form);
  } else if (action === 'contractor-certificate-line-remove') {
    actionButton.closest<HTMLElement>('[data-contractor-certificate-line]')?.remove();
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-certificate"]');
    if (form) updateContractorCertificateTotals(form);
  } else if (action === 'contractor-voucher-new') {
    document.querySelector<HTMLElement>('#contractor-voucher-editor-host')!.innerHTML = renderContractorVoucherEditor(null, contractors, projects, preferredContractorId);
  } else if (action === 'contractor-voucher-edit' && id) {
    const voucher = contractorVouchers.find((entry) => entry.id === Number(id));
    if (voucher) {
      document.querySelector<HTMLElement>('#contractor-voucher-editor-host')!.innerHTML = renderContractorVoucherEditor(voucher, contractors, projects, null);
    }
  } else if (action === 'contractor-voucher-cancel') {
    document.querySelector<HTMLElement>('#contractor-voucher-editor-modal')?.remove();
  } else if (action === 'contractor-voucher-search-focus') {
    document.querySelector<HTMLInputElement>('#contractor-voucher-search')?.focus();
  } else if (action === 'contractor-voucher-refresh') {
    await showPage('contractors');
  } else if (action === 'contractor-voucher-delete' && id) {
    if (!window.confirm('حذف مسودة السند؟')) return;
    try {
      await window.elsaad.deleteContractorVoucher(Number(id));
      await showPage('contractors');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة السند.');
    }
  } else if (action === 'contractor-line-add') {
    const host = document.querySelector<HTMLTableSectionElement>('#contractor-contract-lines');
    if (host) host.insertAdjacentHTML('beforeend', renderContractorContractLine(undefined, host.querySelectorAll('[data-contractor-contract-line]').length));
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-contract"]');
    if (form) updateContractorContractTotals(form);
  } else if (action === 'contractor-line-remove') {
    actionButton.closest<HTMLElement>('[data-contractor-contract-line]')?.remove();
    const form = document.querySelector<HTMLFormElement>('[data-form="contractor-contract"]');
    if (form) updateContractorContractTotals(form);
  } else if (action === 'contractor-lines-toggle') {
    const host = document.querySelector<HTMLElement>('#contractor-lines-scroll');
    if (host) {
      host.hidden = !host.hidden;
      (actionButton as HTMLButtonElement).setAttribute('aria-expanded', String(!host.hidden));
      actionButton.textContent = host.hidden ? 'توسيع البنود' : 'طي البنود';
    }
  } else if (action === 'project-add') {
    document.querySelector<HTMLElement>('#project-modal-host')!.innerHTML = renderProjectForm(null);
  } else if (action === 'project-edit' && id) {
    const project = projects.find((item) => item.id === Number(id));
    if (project) document.querySelector<HTMLElement>('#project-modal-host')!.innerHTML = renderProjectForm(project);
  } else if (action === 'project-close') {
    actionButton.closest<HTMLElement>('#project-modal')?.remove();
  } else if (action === 'project-refresh') {
    await showPage('projects');
  } else if (action === 'project-delete' && id) {
    if (!window.confirm('حذف المشروع؟ إذا ارتبط بسند صرف أو بنود أعمال فسيُرفض الحذف لحماية السجلات.')) return;
    try {
      await window.elsaad.deleteProject(Number(id));
      await showPage('projects');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المشروع.');
    }
  } else if (action === 'project-units' && id) {
    propertyProjectFilter = Number(id);
    currentProjectView = 'property-units';
    await showPage('projects');
  } else if (action === 'property-unit-add') {
    document.querySelector<HTMLElement>('#property-unit-modal-host')!.innerHTML = renderPropertyUnitForm(projects, null, propertyProjectFilter);
  } else if (action === 'property-unit-edit' && id) {
    const unit = propertyUnits.find((entry) => entry.id === Number(id));
    if (unit) document.querySelector<HTMLElement>('#property-unit-modal-host')!.innerHTML = renderPropertyUnitForm(projects, unit, propertyProjectFilter);
  } else if (action === 'property-contract-add') {
    document.querySelector<HTMLElement>('#property-contract-modal-host')!.innerHTML = renderPropertyContractEditor(null, projects, propertyUnits, customers, propertyBrokers);
    const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-contract-edit' && id) {
    const contract = propertyContracts.find((entry) => entry.id === Number(id));
    if (contract) {
      document.querySelector<HTMLElement>('#property-contract-modal-host')!.innerHTML = renderPropertyContractEditor(contract, projects, propertyUnits, customers, propertyBrokers);
      const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
      if (form) updatePropertyContractPreview(form);
    }
  } else if (action === 'property-broker-add') {
    document.querySelector<HTMLElement>('#property-broker-modal-host')!.innerHTML = renderPropertyBrokerForm();
  } else if (action === 'property-broker-close') {
    document.querySelector<HTMLElement>('#property-broker-modal')?.remove();
  } else if (action === 'property-modal-close') {
    actionButton.closest<HTMLElement>('#property-unit-modal, #property-contract-modal')?.remove();
  } else if (action === 'property-free-add') {
    const host = document.querySelector<HTMLTableSectionElement>('#property-free-payments');
    host?.querySelector('[data-empty-free]')?.remove();
    if (host) host.insertAdjacentHTML('beforeend', '<tr data-property-free-payment><td><input name="freeAmount" type="number" min="0.01" step="0.01" aria-label="مبلغ الدفعة الحرة" required></td><td><input name="freeDueDate" type="date" aria-label="تاريخ الدفعة الحرة" required></td><td><input name="freeDescription" maxlength="240" aria-label="بيان الدفعة الحرة" placeholder="البيان" required></td><td><input name="freeNotes" maxlength="2000" aria-label="ملاحظات الدفعة الحرة" placeholder="ملاحظات"></td><td><button class="button button--tiny button--danger" type="button" data-action="property-free-remove">حذف</button></td></tr>');
    const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-free-remove') {
    actionButton.closest<HTMLElement>('[data-property-free-payment]')?.remove();
    const host = document.querySelector<HTMLTableSectionElement>('#property-free-payments');
    if (host && host.querySelectorAll('[data-property-free-payment]').length === 0) host.innerHTML = '<tr data-empty-free><td class="empty-state" colspan="5">لم تتم إضافة دفعات حرة.</td></tr>';
    const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-fee-add') {
    const host = document.querySelector<HTMLTableSectionElement>('#property-fee-items');
    host?.querySelector('[data-empty-fees]')?.remove();
    if (host) host.insertAdjacentHTML('beforeend', '<tr data-property-fee><td><input name="feeDescription" maxlength="160" required placeholder="وصف الرسم" aria-label="وصف الرسم"></td><td><input name="feeAmount" type="number" min="0.01" step="0.01" required placeholder="0.00" aria-label="قيمة الرسم"></td><td><button class="button button--tiny button--danger" type="button" data-action="property-fee-remove">حذف</button></td></tr>');
    const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-fee-remove') {
    actionButton.closest<HTMLElement>('[data-property-fee]')?.remove();
    const host = document.querySelector<HTMLTableSectionElement>('#property-fee-items');
    if (host && host.querySelectorAll('[data-property-fee]').length === 0) host.innerHTML = '<tr data-empty-fees><td colspan="3" class="empty-state">لا توجد رسوم إضافية.</td></tr>';
    const form = document.querySelector<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-schedule-generate') {
    const form = actionButton.closest<HTMLFormElement>('[data-form="property-contract"]');
    if (form) updatePropertyContractPreview(form);
  } else if (action === 'property-commission-cancel') {
    pendingPropertyContract = null;
    document.querySelector<HTMLElement>('#property-commission-modal')?.remove();
  } else if (action === 'property-payment-select' && id) {
    propertyPaymentContractId = Number(id);
    await showPage('projects');
  } else if (action === 'project-page') {
    projectListPage += Number(actionButton.dataset.step ?? 0);
    filterProjectTable();
  } else if (action === 'work-item-add') {
    setWorkItemForm(null);
  } else if (action === 'work-item-reset') {
    setWorkItemForm(null);
  } else if (action === 'work-item-edit' && id) {
    const item = projectWorkItems.find((entry) => entry.id === Number(id));
    if (item) setWorkItemForm(item);
  } else if (action === 'work-tree-node-toggle') {
    const children = actionButton.closest<HTMLElement>('[data-tree-node]')?.querySelector<HTMLElement>(':scope > [data-tree-children]');
    if (children) {
      children.hidden = !children.hidden;
      (actionButton as HTMLButtonElement).setAttribute('aria-expanded', String(!children.hidden));
      actionButton.textContent = children.hidden ? '+' : '−';
    }
  } else if (action === 'work-tree-expand' || action === 'work-tree-collapse') {
    const expand = action === 'work-tree-expand';
    document.querySelectorAll<HTMLElement>('[data-tree-children]').forEach((children) => { children.hidden = !expand; });
    document.querySelectorAll<HTMLButtonElement>('[data-action="work-tree-node-toggle"]').forEach((button) => {
      button.setAttribute('aria-expanded', String(expand));
      button.textContent = expand ? '−' : '+';
    });
  } else if (action === 'work-item-toggle' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setProjectWorkItemStatus(Number(id), status);
      await showPage('projects');
      const updated = projectWorkItems.find((item) => item.id === Number(id));
      if (updated) setWorkItemForm(updated);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة بند الأعمال.');
    }
  } else if (action === 'project-issue-add') {
    showProjectIssueEditor(null);
  } else if (action === 'project-issue-close') {
    actionButton.closest<HTMLElement>('#project-issue-modal')?.remove();
  } else if (action === 'project-issue-refresh') {
    await showPage('projects');
  } else if (action === 'project-issue-view' && id) {
    const issue = inventoryIssues.find((entry) => entry.id === Number(id));
    if (issue) showProjectIssueEditor(issue);
  } else if (action === 'project-issue-line-add') {
    const form = document.querySelector<HTMLFormElement>('[data-form="project-issue"]');
    const host = document.querySelector<HTMLTableSectionElement>('#project-issue-lines');
    if (form && host) {
      const projectId = Number(form.querySelector<HTMLSelectElement>('[name="projectId"]')?.value ?? 0);
      host.insertAdjacentHTML('beforeend', projectIssueLine(inventoryItems, projectWorkItems, projectId));
    }
  } else if (action === 'project-issue-line-delete') {
    const row = actionButton.closest<HTMLElement>('[data-project-issue-line]');
    const host = document.querySelector<HTMLTableSectionElement>('#project-issue-lines');
    if (row && host && host.rows.length > 1) row.remove();
    updateProjectIssueTotals();
  } else if (action === 'project-issue-approve' && id) {
    if (!window.confirm('اعتماد السند وخصم المواد من المخزون؟')) return;
    actionButton.setAttribute('disabled', 'true');
    try {
      await window.elsaad.approveInventoryIssue(Number(id));
      await showPage('projects');
      window.alert('تم اعتماد سند صرف مواد المشروع وتسجيل حركة المخزون.');
    } catch (error) {
      actionButton.removeAttribute('disabled');
      window.alert(error instanceof Error ? error.message : 'تعذر اعتماد سند الصرف.');
    }
  } else if (action === 'project-issue-cancel' && id) {
    if (!window.confirm('إلغاء السند؟ سيُسجّل النظام حركة عكسية آمنة إذا كان معتمدًا.')) return;
    actionButton.setAttribute('disabled', 'true');
    try {
      await window.elsaad.cancelInventoryIssue(Number(id));
      await showPage('projects');
      window.alert('تم إلغاء السند وتسجيل العكس المخزني عند الحاجة.');
    } catch (error) {
      actionButton.removeAttribute('disabled');
      window.alert(error instanceof Error ? error.message : 'تعذر إلغاء السند.');
    }
  } else if (action === 'project-issue-delete' && id) {
    if (!window.confirm('حذف مسودة سند الصرف؟')) return;
    try {
      await window.elsaad.deleteInventoryIssue(Number(id));
      await showPage('projects');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المسودة.');
    }
  } else if (action === 'project-issue-print' && id) {
    const issue = inventoryIssues.find((entry) => entry.id === Number(id));
    if (issue) renderProjectIssueForPrint(issue);
  } else if (action === 'project-issue-print-list') {
    document.body.classList.add('project-materials-print-mode');
    window.print();
    window.setTimeout(() => document.body.classList.remove('project-materials-print-mode'), 500);
  } else if (action === 'treasury-add' && (actionButton.dataset.kind === 'cash-box' || actionButton.dataset.kind === 'bank')) {
    document.querySelector<HTMLElement>('#treasury-modal-host')!.innerHTML =
      renderTreasuryForm(actionButton.dataset.kind, null, accounts);
  } else if (action === 'treasury-edit' && id && (actionButton.dataset.kind === 'cash-box' || actionButton.dataset.kind === 'bank')) {
    const record = actionButton.dataset.kind === 'cash-box'
      ? cashBoxes.find((entry) => entry.id === Number(id))
      : bankAccounts.find((entry) => entry.id === Number(id));
    if (record) document.querySelector<HTMLElement>('#treasury-modal-host')!.innerHTML =
      renderTreasuryForm(actionButton.dataset.kind, record, accounts);
  } else if (action === 'treasury-status' && id && (actionButton.dataset.kind === 'cash-box' || actionButton.dataset.kind === 'bank')) {
    const kind = actionButton.dataset.kind;
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    const noun = kind === 'cash-box' ? 'الخزينة' : 'البنك';
    if (!window.confirm(`هل تريد ${status === 'active' ? 'تفعيل' : 'تعطيل'} ${noun}؟`)) return;
    try {
      if (kind === 'cash-box') await window.elsaad.setCashBoxStatus(Number(id), status);
      else await window.elsaad.setBankAccountStatus(Number(id), status);
      await showPage('treasury');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `تعذر تحديث حالة ${noun}.`);
    }
  } else if (action === 'treasury-close') {
    document.querySelector<HTMLElement>('#treasury-modal')?.remove();
  } else if (action === 'projects-toggle') {
    projectsExpanded = !projectsExpanded;
    const submenu = document.querySelector<HTMLElement>('#projects-subpages');
    const button = actionButton as HTMLButtonElement;
    button.setAttribute('aria-expanded', String(projectsExpanded));
    submenu?.toggleAttribute('hidden', !projectsExpanded);
    button.querySelector<SVGElement>('.nav-chevron')?.classList.toggle('nav-chevron--open', projectsExpanded);
  } else if (action === 'portfolio-reset') {
    portfolioFilters = { from: '', to: '', projectId: null };
    await refreshPortfolioPage();
  } else if (action === 'portfolio-refresh') {
    await refreshPortfolioPage();
  } else if (action === 'portfolio-print') {
    document.body.classList.add('portfolio-print-mode');
    window.print();
    window.setTimeout(() => document.body.classList.remove('portfolio-print-mode'), 500);
  } else if (action === 'dashboard-toggle') {
    dashboardExpanded = !dashboardExpanded;
    const submenu = document.querySelector<HTMLElement>('#dashboard-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(dashboardExpanded));
    if (submenu) submenu.hidden = !dashboardExpanded;
    chevron?.classList.toggle('nav-chevron--open', dashboardExpanded);
  } else if (action === 'sales-toggle') {
    salesExpanded = !salesExpanded;
    const submenu = document.querySelector<HTMLElement>('#sales-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(salesExpanded));
    if (submenu) submenu.hidden = !salesExpanded;
    chevron?.classList.toggle('nav-chevron--open', salesExpanded);
  } else if (action === 'purchases-toggle') {
    purchasesExpanded = !purchasesExpanded;
    const submenu = document.querySelector<HTMLElement>('#purchases-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(purchasesExpanded));
    if (submenu) submenu.hidden = !purchasesExpanded;
    chevron?.classList.toggle('nav-chevron--open', purchasesExpanded);
  } else if (action === 'inventory-toggle') {
    inventoryExpanded = !inventoryExpanded;
    const submenu = document.querySelector<HTMLElement>('#inventory-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(inventoryExpanded));
    if (submenu) submenu.hidden = !inventoryExpanded;
    chevron?.classList.toggle('nav-chevron--open', inventoryExpanded);
  } else if (action === 'treasury-toggle') {
    treasuryExpanded = !treasuryExpanded;
    const submenu = document.querySelector<HTMLElement>('#treasury-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(treasuryExpanded));
    if (submenu) submenu.hidden = !treasuryExpanded;
    chevron?.classList.toggle('nav-chevron--open', treasuryExpanded);
  } else if (action === 'assets-toggle') {
    assetsExpanded = !assetsExpanded;
    const submenu = document.querySelector<HTMLElement>('#assets-subpages');
    const button = actionButton as HTMLButtonElement;
    const chevron = button.querySelector<SVGElement>('.nav-chevron');
    button.setAttribute('aria-expanded', String(assetsExpanded));
    if (submenu) submenu.hidden = !assetsExpanded;
    chevron?.classList.toggle('nav-chevron--open', assetsExpanded);
  } else if (action === 'inventory-document-add' && actionButton.dataset.kind) {
    const kind = actionButton.dataset.kind;
    if (kind === 'receipt' || kind === 'issue' || kind === 'transfer') {
      document.querySelector<HTMLElement>('#inventory-document-modal-host')!.innerHTML =
        renderInventoryDocumentForm(kind, null, inventoryItems, warehouses, inventoryBalances, purchaseInvoices, inventoryReceipts, inventorySalesInvoices);
      updateInventoryDocumentTotals();
    }
  } else if (action === 'inventory-document-edit' && actionButton.dataset.kind && id) {
    const kind = actionButton.dataset.kind;
    const doc = kind === 'receipt' ? inventoryReceipts.find((entry) => entry.id === Number(id))
      : kind === 'issue' ? inventoryIssues.find((entry) => entry.id === Number(id))
        : kind === 'transfer' ? inventoryTransfers.find((entry) => entry.id === Number(id)) : null;
    if (doc) {
      document.querySelector<HTMLElement>('#inventory-document-modal-host')!.innerHTML =
        renderInventoryDocumentForm(kind as 'receipt' | 'issue' | 'transfer', doc, inventoryItems, warehouses, inventoryBalances, purchaseInvoices, inventoryReceipts, inventorySalesInvoices);
      updateInventoryDocumentTotals();
    }
  } else if (action === 'inventory-document-close') {
    document.querySelector<HTMLElement>('#inventory-document-modal')?.remove();
  } else if (action === 'inventory-doc-line-add') {
    const lines = document.querySelector<HTMLTableSectionElement>('#inventory-doc-lines');
    if (lines) lines.insertAdjacentHTML('beforeend', `<tr data-inventory-doc-line>
      <td><select name="itemId" required><option value="">اختر الصنف</option>${inventoryItems.filter((item) => item.status === 'active' && item.baseUnitStatus === 'active').map((item) =>
        `<option value="${item.id}" data-unit-id="${item.baseUnitId}" data-unit-name="${escapeHtml(item.baseUnitName)}">${escapeHtml(item.code)} — ${escapeHtml(item.nameAr)}</option>`).join('')}</select></td>
      <td class="doc-unit">—</td><td class="doc-available" dir="ltr">0</td>
      <td><input name="quantity" type="number" min="0.000001" step="any" required></td>
      <td><input name="unitCost" type="number" min="0" step="any" required></td><td class="doc-total" dir="ltr">0</td>
      <td><button class="icon-button icon-button--danger" type="button" data-action="inventory-doc-line-delete">حذف</button></td></tr>`);
    updateInventoryDocumentTotals();
  } else if (action === 'inventory-doc-line-delete') {
    const row = actionButton.closest<HTMLTableRowElement>('[data-inventory-doc-line]');
    const lines = document.querySelector<HTMLTableSectionElement>('#inventory-doc-lines');
    if (row && lines && lines.rows.length > 1) row.remove();
    updateInventoryDocumentTotals();
  } else if (action === 'inventory-document-approve' && actionButton.dataset.kind && id) {
    try {
      if (actionButton.dataset.kind === 'issue') await window.elsaad.approveInventoryIssue(Number(id));
      else if (actionButton.dataset.kind === 'transfer') await window.elsaad.approveInventoryTransfer(Number(id));
      else await window.elsaad.approveInventoryReceipt(Number(id));
      await showPage('inventory');
    } catch (error) {
      showError(error, 'inventory-document-error');
      if (!document.querySelector('#inventory-document-error')) window.alert(error instanceof Error ? error.message : 'تعذر اعتماد المستند.');
    }
  } else if (action === 'inventory-document-cancel' && actionButton.dataset.kind && id) {
    if (!window.confirm('سيُنشأ عكس مخزني موثق، وقد يُرفض الإلغاء إذا استُهلك الرصيد. متابعة؟')) return;
    try {
      if (actionButton.dataset.kind === 'issue') await window.elsaad.cancelInventoryIssue(Number(id));
      else if (actionButton.dataset.kind === 'transfer') await window.elsaad.cancelInventoryTransfer(Number(id));
      else await window.elsaad.cancelInventoryReceipt(Number(id));
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر إلغاء المستند.');
    }
  } else if (action === 'inventory-document-delete' && actionButton.dataset.kind && id) {
    if (!window.confirm('حذف مسودة المستند؟ لن يؤثر الحذف في الأرصدة.')) return;
    try {
      if (actionButton.dataset.kind === 'receipt') await window.elsaad.deleteInventoryReceipt(Number(id));
      else if (actionButton.dataset.kind === 'issue') await window.elsaad.deleteInventoryIssue(Number(id));
      else await window.elsaad.deleteInventoryTransfer(Number(id));
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المسودة.');
    }
  } else if (action === 'inventory-document-print' && actionButton.dataset.kind && id) {
    const kind = actionButton.dataset.kind;
    const doc = kind === 'receipt' ? inventoryReceipts.find((entry) => entry.id === Number(id))
      : kind === 'issue' ? inventoryIssues.find((entry) => entry.id === Number(id))
        : inventoryTransfers.find((entry) => entry.id === Number(id));
    const host = document.querySelector<HTMLElement>('#inventory-document-print-host');
    if (doc && host) {
      host.innerHTML = documentLinesForPrint(doc);
      document.body.classList.add('inventory-print-mode');
      window.print();
      document.body.classList.remove('inventory-print-mode');
      host.replaceChildren();
    }
  } else if (action === 'purchase-navigate' && actionButton.dataset.view) {
    const requested = PURCHASE_PAGES.find(({ key }) => key === actionButton.dataset.view)?.key;
    if (requested) {
      currentPurchaseView = requested;
      currentPage = 'purchases';
      await showPage('purchases');
    }
  } else if (action === 'inventory-item-add') {
    showInventoryItemEditor(null);
  } else if (action === 'inventory-item-edit' && id) {
    const item = inventoryItems.find((entry) => entry.id === Number(id));
    if (item) showInventoryItemEditor(item);
  } else if (action === 'inventory-item-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setInventoryItemStatus(Number(id), status);
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة الصنف.');
    }
  } else if (action === 'inventory-item-delete' && id) {
    if (!window.confirm('حذف الصنف؟ إذا ارتبط بمستند أو رصيد افتتاحي سيُرفض الحذف ويمكن تعطيله.')) return;
    try {
      await window.elsaad.deleteInventoryItem(Number(id));
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف الصنف.');
    }
  } else if (action === 'inventory-unit-add') {
    showInventoryUnitEditor(null);
  } else if (action === 'inventory-unit-edit' && id) {
    const unit = inventoryUnits.find((entry) => entry.id === Number(id));
    if (unit) showInventoryUnitEditor(unit);
  } else if (action === 'inventory-unit-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setInventoryUnitStatus(Number(id), status);
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة الوحدة.');
    }
  } else if (action === 'inventory-unit-delete' && id) {
    if (!window.confirm('حذف وحدة القياس؟ إذا استخدمت في صنف سيُرفض الحذف.')) return;
    try {
      await window.elsaad.deleteInventoryUnit(Number(id));
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف وحدة القياس.');
    }
  } else if (action === 'warehouse-add') {
    showWarehouseEditor(null);
  } else if (action === 'warehouse-edit' && id) {
    const warehouse = warehouses.find((entry) => entry.id === Number(id));
    if (warehouse) showWarehouseEditor(warehouse);
  } else if (action === 'warehouse-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setWarehouseStatus(Number(id), status);
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة المخزن.');
    }
  } else if (action === 'warehouse-delete' && id) {
    if (!window.confirm('حذف المخزن؟ إذا ارتبط بأرصدة أو حركات سابقة سيُرفض الحذف.')) return;
    try {
      await window.elsaad.deleteWarehouse(Number(id));
      await showPage('inventory');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المخزن.');
    }
  } else if (action === 'inventory-close') {
    document.querySelector<HTMLElement>('#inventory-modal')?.remove();
  } else if (action === 'inventory-sort' && actionButton.dataset.key) {
    sortInventoryRows(actionButton.dataset.key);
  } else if (action === 'purchase-status-filter' && actionButton.dataset.status) {
    const requested = actionButton.dataset.status;
    if (requested === 'draft' || requested === 'approved' || requested === 'cancelled') {
      purchaseInvoiceStatusFilter = requested;
      currentPurchaseView = 'purchase-invoices';
      await showPage('purchases');
      filterPurchaseInvoices();
    }
  } else if (action === 'supplier-add') {
    showSupplierEditor(null);
  } else if (action === 'supplier-edit' && id) {
    const supplier = suppliers.find((item) => item.id === Number(id));
    if (supplier) showSupplierEditor(supplier);
  } else if (action === 'supplier-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setSupplierStatus(Number(id), status);
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة المورد.');
    }
  } else if (action === 'supplier-delete' && id) {
    if (!window.confirm('حذف المورد؟ إذا ارتبط بفواتير أو مرتجعات سيُرفض الحذف ويمكن تعطيله.')) return;
    try {
      await window.elsaad.deleteSupplier(Number(id));
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المورد.');
    }
  } else if (action === 'supplier-group-add') {
    showSupplierGroupEditor(null);
  } else if (action === 'supplier-group-edit' && id) {
    const group = supplierGroups.find((item) => item.id === Number(id));
    if (group) showSupplierGroupEditor(group);
  } else if (action === 'supplier-group-status' && id) {
    const status = actionButton.dataset.status;
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.setSupplierGroupStatus(Number(id), status);
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة المجموعة.');
    }
  } else if (action === 'supplier-group-delete' && id) {
    if (!window.confirm('حذف مجموعة الموردين؟ لا يمكن حذف مجموعة مستخدمة.')) return;
    try {
      await window.elsaad.deleteSupplierGroup(Number(id));
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مجموعة الموردين.');
    }
  } else if (action === 'purchase-close') {
    document.querySelector<HTMLElement>('#purchase-master-modal, #purchase-invoice-modal, #purchase-return-modal')?.remove();
  } else if (action === 'supplier-export') {
    downloadCsv('elsaad-suppliers.csv', invoiceCsv(suppliers));
  } else if (action === 'purchase-print') {
    printPurchaseList();
  } else if (action === 'purchase-invoice-add') {
    showPurchaseInvoiceEditor(null);
  } else if (action === 'purchase-line-add') {
    const lines = document.querySelector<HTMLTableSectionElement>('#purchase-lines');
    if (lines) lines.insertAdjacentHTML('beforeend', renderPurchaseInvoiceLine());
  } else if (action === 'purchase-line-delete') {
    const row = actionButton.closest<HTMLTableRowElement>('[data-purchase-line]');
    const lines = document.querySelector<HTMLTableSectionElement>('#purchase-lines');
    if (row && lines && lines.rows.length > 1) row.remove();
    updatePurchaseInvoiceTotals();
  } else if (action === 'purchase-invoice-view' && id) {
    const invoice = purchaseInvoices.find((item) => item.id === Number(id));
    if (invoice) showPurchaseInvoiceEditor(invoice);
  } else if (action === 'purchase-invoice-duplicate' && id) {
    const invoice = purchaseInvoices.find((item) => item.id === Number(id));
    if (invoice) {
      try {
        const copy = await window.elsaad.savePurchaseInvoice({
          supplierId: invoice.supplierId,
          invoiceDate: new Date().toISOString().slice(0, 10),
          dueDate: '',
          supplierInvoiceNumber: '',
          paymentLink: 'unlinked',
          category: invoice.category,
          project: invoice.project,
          costCenter: invoice.costCenter,
          notes: invoice.notes,
          lines: invoice.lines.map(({ itemId, unitId, itemCode, description, unit, quantity, unitPrice }) =>
            ({ itemId, unitId, itemCode, description, unit, quantity, unitPrice })),
        });
        await showPage('purchases');
        showPurchaseInvoiceEditor(copy);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'تعذر تكرار الفاتورة كمسودة.');
      }
    }
  } else if (action === 'purchase-invoice-delete' && id) {
    if (!window.confirm('حذف مسودة الفاتورة نهائيًا؟')) return;
    try {
      await window.elsaad.deletePurchaseInvoice(Number(id));
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة الفاتورة.');
    }
  } else if (action === 'purchase-approve' && id) {
    try {
      await window.elsaad.approvePurchaseInvoice(Number(id));
      await showPage('purchases');
    } catch (error) {
      showError(error, 'purchase-document-error');
    }
  } else if (action === 'purchase-invoice-cancel' && id) {
    if (!window.confirm('إلغاء الفاتورة المعتمدة بعكس قيدها المحاسبي؟ يجب إلغاء المرتجعات وأذون الاستلام التابعة أولًا.')) return;
    try {
      await window.elsaad.cancelPurchaseInvoice(Number(id));
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر إلغاء فاتورة المشتريات.');
    }
  } else if (action === 'purchase-invoice-print' && id) {
    const invoice = purchaseInvoices.find((item) => item.id === Number(id));
    const host = document.querySelector<HTMLElement>('#purchase-print-host');
    if (invoice && host) {
      host.innerHTML = renderPurchasePrint(invoice);
      window.print();
      host.replaceChildren();
    }
  } else if (action === 'purchase-return-add') {
    showPurchaseReturnEditor(null);
  } else if (action === 'purchase-return-edit' && id) {
    const purchaseReturn = purchaseReturns.find((item) => item.id === Number(id));
    if (purchaseReturn) showPurchaseReturnEditor(purchaseReturn.invoiceId, purchaseReturn);
  } else if (action === 'purchase-return-delete' && id) {
    if (!window.confirm('حذف مسودة مرتجع المشتريات؟')) return;
    try {
      await window.elsaad.deletePurchaseReturn(Number(id));
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المسودة.');
    }
  } else if (action === 'purchase-return-approve' && id) {
    try {
      await window.elsaad.approvePurchaseReturn(Number(id));
    } catch (error) {
      showError(error, 'purchase-return-error');
    }
  } else if (action === 'purchase-return-print' && id) {
    const item = purchaseReturns.find((entry) => entry.id === Number(id));
    const host = document.querySelector<HTMLElement>('#purchase-print-host');
    if (item && host) {
      host.innerHTML = renderPurchaseReturnPrint(item);
      window.print();
      host.replaceChildren();
    }
  } else if (action === 'purchase-return-close') {
    document.querySelector<HTMLElement>('#purchase-return-modal')?.remove();
  } else if (action === 'customer-group-customers' && id) {
    customerGroupFilter = id;
    currentSalesView = 'customers';
    await showPage('sales');
  } else if (action === 'customer-add') {
    showCustomerEditor(null);
  } else if (action === 'customer-edit' && id) {
    const customer = customers.find((item) => item.id === Number(id));
    if (customer) showCustomerEditor(customer);
  } else if (action === 'customer-status' && id) {
    const nextStatus = actionButton.dataset.status;
    if (nextStatus !== 'active' && nextStatus !== 'inactive') return;
    try {
      await window.elsaad.setCustomerStatus(Number(id), nextStatus);
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث حالة العميل.');
    }
  } else if (action === 'customer-delete' && id) {
    if (!window.confirm('حذف العميل نهائيًا؟ إذا كان مرتبطًا بمعاملات سيُرفض الحذف ويمكن تعطيله بدلًا منه.')) return;
    try {
      await window.elsaad.deleteCustomer(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف العميل.');
    }
  } else if (action === 'customer-group-add') {
    showCustomerGroupEditor(null);
  } else if (action === 'customer-group-edit' && id) {
    const group = customerGroups.find((item) => item.id === Number(id));
    if (group) showCustomerGroupEditor(group);
  } else if (action === 'customer-group-delete' && id) {
    if (!window.confirm('حذف مجموعة العملاء؟ لا يمكن حذف مجموعة مستخدمة من عملاء.')) return;
    try {
      await window.elsaad.deleteCustomerGroup(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مجموعة العملاء.');
    }
  } else if (action === 'sales-master-close') {
    document.querySelector<HTMLElement>('#sales-master-modal')?.remove();
  } else if (action === 'customers-export') {
    downloadCsv('elsaad-customers.csv', customersCsv(customers, customerGroups));
  } else if (action === 'sales-print-list') {
    printVisibleSalesTable();
  } else if (action === 'sales-return-add') {
    showSalesReturnEditor(null);
  } else if (action === 'sales-return-close') {
    document.querySelector<HTMLElement>('#sales-return-modal')?.remove();
  } else if (action === 'sales-return-edit' && id) {
    const salesReturn = salesReturns.find((item) => item.id === Number(id));
    if (salesReturn) showSalesReturnEditor(salesReturn.invoiceId, salesReturn);
  } else if (action === 'sales-return-delete' && id) {
    if (!window.confirm('حذف مسودة المرتجع نهائيًا؟')) return;
    try {
      await window.elsaad.deleteSalesReturn(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مسودة المرتجع.');
    }
  } else if (action === 'sales-return-approve' && id) {
    try {
      await window.elsaad.approveSalesReturn(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر اعتماد المرتجع.');
    }
  } else if (action === 'sales-return-cancel' && id) {
    if (!window.confirm('إلغاء المرتجع المعتمد بعكس قيده المحاسبي؟')) return;
    try {
      await window.elsaad.cancelSalesReturn(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر إلغاء المرتجع.');
    }
  } else if (action === 'sales-return-print' && id) {
    const salesReturn = salesReturns.find((item) => item.id === Number(id));
    const host = document.querySelector<HTMLElement>('#sales-return-print-host');
    if (salesReturn && host) {
      host.innerHTML = renderSalesReturnPrint(salesReturn);
      window.print();
      host.replaceChildren();
    }
  } else if (action === 'theme-toggle') {
    const previousTheme = currentTheme;
    const nextTheme: ThemeMode = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    try {
      await window.elsaad.setTheme(nextTheme);
    } catch (error) {
      applyTheme(previousTheme);
      window.alert(error instanceof Error ? error.message : 'تعذر حفظ المظهر المحدد.');
    }
  } else if (action === 'account-refresh' || action === 'center-refresh' || action === 'journal-refresh' || action === 'budget-refresh') {
    await showPage('accounts');
  } else if (action === 'account-export') {
    const rows = [['الكود', 'الاسم العربي', 'الاسم الإنجليزي', 'نوع الحساب', 'الأب', 'قابل للترحيل', 'ملاحظات'], ...accounts.map((account) => [
      account.code, account.name, account.nameEn, account.type, account.parentId ? String(account.parentId) : '', account.postable ? 'نعم' : 'لا', account.notes,
    ])];
    downloadCsv('elsaad-chart-of-accounts.csv', encodeCsv(rows));
  } else if (action === 'center-export') {
    const rows = [['الكود', 'الاسم العربي', 'الاسم الإنجليزي', 'النوع', 'الأب', 'قابل للترحيل', 'ملاحظات'], ...costCenters.map((center) => [
      center.code, center.name, center.nameEn, center.type, center.parentId ? String(center.parentId) : '', center.postable ? 'نعم' : 'لا', center.notes,
    ])];
    downloadCsv('elsaad-cost-centers.csv', encodeCsv(rows));
  } else if (action === 'account-add') {
    openAccountForm();
  } else if (action === 'account-edit' && id) {
    const account = accounts.find((item) => item.id === Number(id));
    if (account) openAccountForm(account);
  } else if (action === 'account-delete' && id && window.confirm('حذف الحساب متاح فقط إذا لم يكن مستخدمًا في قيود أو حسابات فرعية. هل تريد المتابعة؟')) {
    try {
      await window.elsaad.deleteAccount(Number(id));
      await showPage('accounts');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف الحساب.');
    }
  } else if (action === 'center-add') {
    openCostCenterForm();
  } else if (action === 'center-edit' && id) {
    const center = costCenters.find((item) => item.id === Number(id));
    if (center) openCostCenterForm(center);
  } else if (action === 'center-delete' && id) {
    if (!window.confirm('حذف مركز التكلفة المحدد؟ سيُرفض الحذف إذا كان له فروع أو ارتباطات.')) return;
    try {
      await window.elsaad.deleteCostCenter(Number(id));
      await showPage('accounts');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف مركز التكلفة.');
    }
  } else if (action === 'journal-add') {
    openJournalForm();
  } else if (action === 'journal-open' && id) {
    try {
      const entry = await window.elsaad.getJournalEntry(Number(id));
      document.querySelector<HTMLElement>('#journal-detail-host')!.innerHTML = renderJournalDetail(entry);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر فتح القيد.');
    }
  } else if (action === 'journal-detail-close') {
    document.querySelector<HTMLElement>('#journal-detail-modal')?.remove();
  } else if (action === 'journal-line-add') {
    const container = document.querySelector<HTMLDivElement>('#journal-lines');
    if (container) {
      container.insertAdjacentHTML('beforeend', renderJournalLine(accounts, costCenters));
    }
  } else if (action === 'journal-line-remove') {
    const container = document.querySelector<HTMLDivElement>('#journal-lines');
    const row = actionButton.closest<HTMLElement>('[data-journal-line]');
    if (container && row && container.querySelectorAll('[data-journal-line]').length > 2) {
      row.remove();
      const form = document.querySelector<HTMLFormElement>('[data-form="journal"]');
      if (form) updateJournalTotals(form);
    }
  } else if (action === 'close-account-modal' || action === 'close-journal-modal' || action === 'close-center-modal') {
    const modalId = action === 'close-account-modal' ? '#account-modal' : action === 'close-center-modal' ? '#center-modal' : '#journal-modal';
    const modal = document.querySelector<HTMLElement>(modalId);
    if (modal) modal.hidden = true;
  } else if (action === 'budget-add') {
    document.querySelector<HTMLElement>('#budget-editor-host')!.innerHTML = renderBudgetEditor(null, accounts, costCenters);
  } else if (action === 'budget-edit' && id) {
    const budget = budgets.find((item) => item.id === Number(id));
    if (budget) document.querySelector<HTMLElement>('#budget-editor-host')!.innerHTML = renderBudgetEditor(budget, accounts, costCenters);
  } else if (action === 'budget-cancel') {
    document.querySelector<HTMLElement>('#budget-modal')?.remove();
  } else if (action === 'budget-delete' && id) {
    if (!window.confirm('حذف الموازنة المحددة وبنودها؟ لا يؤثر الحذف في القيود أو الأرصدة.')) return;
    try {
      await window.elsaad.deleteBudget(Number(id));
      await showPage('accounts');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف الموازنة.');
    }
  } else if (action === 'budget-line-add') {
    document.querySelector<HTMLElement>('#budget-lines')?.insertAdjacentHTML('beforeend', renderBudgetLine(accounts, costCenters));
  } else if (action === 'budget-line-remove') {
    const rows = document.querySelectorAll<HTMLElement>('[data-budget-line]');
    if (rows.length > 1) actionButton.closest<HTMLElement>('[data-budget-line]')?.remove();
  } else if (action === 'logout') {
    await window.elsaad.logout();
    authenticatedUser = null;
    renderLogin();
  } else if (action === 'sales-add' && currentSalesView === 'estimate') {
    showSalesEditor(null);
  } else if (action === 'sales-close') {
    document.querySelector<HTMLElement>('#sales-document-modal')?.remove();
  } else if (action === 'sales-line-add') {
    const lines = document.querySelector<HTMLTableSectionElement>('#sales-lines');
    if (lines && currentSalesView === 'estimate') {
      lines.insertAdjacentHTML('beforeend', renderSalesLine(currentSalesView, lines.rows.length, inventoryItems));
      updateSalesEditorTotals();
    }
  } else if (action === 'sales-line-remove') {
    const lines = document.querySelector<HTMLTableSectionElement>('#sales-lines');
    const row = actionButton.closest<HTMLTableRowElement>('[data-sales-line]');
    if (lines && row && lines.rows.length > 1 && currentSalesView === 'estimate') {
      row.remove();
      updateSalesEditorTotals();
    }
  } else if (action === 'sales-edit' && id) {
    const salesDocument = salesDocuments.find((item) => item.id === Number(id));
    if (salesDocument) showSalesEditor(salesDocument);
  } else if (action === 'sales-approve' && id) {
    if (!window.confirm('اعتماد هذا المستند؟ بعد الاعتماد لا يمكن تعديل بنوده.')) return;
    try {
      await window.elsaad.approveSalesDocument(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر اعتماد المستند.');
    }
  } else if (action === 'sales-cancel' && id) {
    if (!window.confirm('إلغاء المستند المعتمد؟ سيتم منع إنشاء مستند تابع له.')) return;
    try {
      await window.elsaad.cancelSalesDocument(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر إلغاء المستند.');
    }
  } else if (action === 'sales-delete' && id) {
    if (!window.confirm('حذف هذه المسودة نهائيًا؟')) return;
    try {
      await window.elsaad.deleteSalesDocument(Number(id));
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف المسودة.');
    }
  } else if (action === 'sales-derive' && id) {
    const targetType = actionButton.dataset.targetType;
    if (targetType !== 'work-order' && targetType !== 'certificate' && targetType !== 'invoice') return;
    try {
      const created = await window.elsaad.createSalesDocumentFrom(Number(id), targetType);
      currentSalesView = targetType;
      await showPage('sales');
      showSalesEditor(created);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر إنشاء المستند المرتبط.');
    }
  } else if (action === 'sales-print' && id) {
    const salesDocument = salesDocuments.find((item) => item.id === Number(id));
    const host = document.querySelector<HTMLElement>('#sales-print-host');
    if (salesDocument && host) {
      host.innerHTML = renderSalesPrint(salesDocument);
      window.print();
      host.replaceChildren();
    }
  } else if (action === 'add') {
    openRecordForm();
  } else if (action === 'close-modal') {
    const modal = document.querySelector<HTMLElement>('#record-modal');
    if (modal) modal.hidden = true;
  } else if (action === 'export') {
    exportRecords();
  } else if (action === 'edit' && id) {
    const record = currentRecords.find((item) => item.id === Number(id));
    if (record) openRecordForm(record);
  } else if (action === 'delete' && id && window.confirm('هل تريد حذف هذا السجل نهائيًا؟')) {
    try {
      await window.elsaad.deleteRecord(Number(id), currentPage);
      await showPage(currentPage);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر حذف السجل.');
    }
  }
});

root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.dataset.form === 'initial-setup') {
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    const confirmPassword = String(data.get('confirmPassword') ?? '');
    try {
      await window.elsaad.initializeSystemAdmin({ password, confirmPassword });
      authenticatedUser = await window.elsaad.getCurrentUser();
      const landingPage = await window.elsaad.getLandingPage();
      if (landingPage) await showPage(landingPage);
      else renderNoAccess();
    } catch (error) {
      renderInitialSetup(error instanceof Error ? error.message : 'تعذر حفظ كلمة المرور.');
    }
  } else if (form.dataset.form === 'legacy-password-change') {
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    try {
      await window.elsaad.changeLegacyAdminPassword({
        username,
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
        confirmPassword: String(data.get('confirmPassword') ?? ''),
      });
      renderLogin('تم تحديث كلمة المرور. سجّل الدخول باستخدام كلمة المرور الجديدة.');
    } catch (error) {
      renderLegacyPasswordChange(error instanceof Error ? error.message : 'تعذر تحديث كلمة المرور.', username);
    }
  } else if (form.dataset.form === 'managed-user') {
    const values = new FormData(form);
    const password = String(values.get('password') ?? '');
    const confirmation = String(values.get('confirmPassword') ?? '');
    const showUserError = (message: string): void => {
      const error = form.querySelector<HTMLElement>('[data-user-error]');
      if (error) { error.textContent = message; error.hidden = false; }
    };
    if (password !== confirmation) {
      showUserError('كلمة المرور وتأكيدها غير متطابقين.');
      return;
    }
    const systemAdmin = values.get('systemAdmin') === 'true';
    if (systemAdmin && !window.confirm('هذا الحساب سيحصل على كامل صلاحيات النظام. هل تؤكد تعيينه مديرًا؟')) return;
    try {
      const saved = await window.elsaad.saveManagedUser({
        ...(String(values.get('id') ?? '') ? { id: Number(values.get('id')) } : {}),
        username: String(values.get('username') ?? '').trim(),
        fullName: String(values.get('fullName') ?? '').trim(),
        email: String(values.get('email') ?? '').trim(),
        phone: String(values.get('phone') ?? '').trim(),
        groupId: values.get('groupId') ? Number(values.get('groupId')) : null,
        active: values.get('active') === 'true',
        systemAdmin,
        ...(password ? { password } : {}),
        notes: String(values.get('notes') ?? '').trim(),
      });
      selectedManagedUserId = saved.id;
      creatingManagedUser = false;
      await showSettingsTab('users');
      window.alert('تم حفظ بيانات المستخدم.');
    } catch (error) {
      showUserError(error instanceof Error ? error.message : 'تعذر حفظ المستخدم.');
    }
    return;
  }
  if (form.dataset.form === 'permission-group') {
    const values = new FormData(form);
    const id = String(values.get('id') ?? '');
    const permissions = [...form.querySelectorAll<HTMLInputElement>('input[name="permission"]:checked')].map(({ value }) => value);
    try {
      const saved = await window.elsaad.savePermissionGroup({
        ...(id ? { id: Number(id) } : {}),
        name: String(values.get('name') ?? '').trim(),
        description: String(values.get('description') ?? '').trim(),
        active: values.get('active') === 'true',
        permissions,
      });
      selectedPermissionGroupId = saved.id;
      await showSettingsTab('permission-groups');
      window.alert('تم حفظ مجموعة الصلاحيات.');
    } catch (error) {
      const target = form.querySelector<HTMLElement>('[data-group-error]');
      if (target) { target.textContent = error instanceof Error ? error.message : 'تعذر حفظ المجموعة.'; target.hidden = false; }
    }
    return;
  }
  if (form.dataset.form === 'user-permissions') {
    const userId = Number(new FormData(form).get('userId'));
    const inherited = new Set(selectedUserPermissionState?.inherited ?? []);
    const overrides: Record<string, boolean> = {};
    form.querySelectorAll<HTMLInputElement>('input[name="permission"]').forEach((input) => {
      if (input.checked !== inherited.has(input.value)) overrides[input.value] = input.checked;
    });
    try {
      selectedUserPermissionState = await window.elsaad.saveUserPermissions({ userId, overrides });
      await showSettingsTab('user-permissions');
      window.alert('تم حفظ الصلاحيات والتحقق من تحميلها من قاعدة البيانات.');
    } catch (error) {
      const target = form.querySelector<HTMLElement>('[data-permission-error]');
      if (target) { target.textContent = error instanceof Error ? error.message : 'تعذر حفظ الصلاحيات.'; target.hidden = false; }
    }
    return;
  }
  if (form.dataset.form === 'settings-general') {
    const values = new FormData(form);
    const selectedTheme = values.get('theme');
    const invoicePrefix = values.get('invoicePrefix');
    if (selectedTheme !== 'light' && selectedTheme !== 'dark') {
      window.alert('اختيار المظهر غير صالح.');
      return;
    }
    if (typeof invoicePrefix !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(invoicePrefix.trim())) {
      window.alert('أدخل بادئة فاتورة من 1 إلى 12 حرفًا أو رقمًا، ويمكن استخدام الشرطة والشرطة السفلية.');
      return;
    }
    try {
      await window.elsaad.saveGeneralSettings({ theme: selectedTheme, invoicePrefix });
      applyTheme(selectedTheme);
      await loadSettingsPage();
      window.alert('تم حفظ الإعدادات العامة.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر حفظ الإعدادات العامة.'); }
    return;
  }
  if (form.dataset.form === 'backup-settings') {
    const values = new FormData(form);
    try {
      settingsBackup = await window.elsaad.setBackupPreferences({
        automatic: values.get('automatic') === 'true',
        intervalHours: Number(values.get('intervalHours')),
        retentionCount: Number(values.get('retentionCount')),
      });
      await loadSettingsPage();
      window.alert('تم حفظ إعدادات النسخ الاحتياطي.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر حفظ إعدادات النسخ.'); }
    return;
  }
  if (form.dataset.form === 'company-profile') {
    const values = new FormData(form);
    try {
      await window.elsaad.saveCompanyProfile({
        nameAr: String(values.get('nameAr') ?? '').trim(),
        nameEn: String(values.get('nameEn') ?? '').trim(),
        addressAr: String(values.get('addressAr') ?? '').trim(),
        addressEn: String(values.get('addressEn') ?? '').trim(),
        email: String(values.get('email') ?? '').trim(),
        phone: String(values.get('phone') ?? '').trim(),
        commercialRegister: String(values.get('commercialRegister') ?? '').trim(),
        taxNumber: String(values.get('taxNumber') ?? '').trim(),
      });
      await loadSettingsPage();
      window.alert('تم حفظ بيانات الشركة.');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر حفظ بيانات الشركة.'); }
    return;
  }
  if (form.dataset.form === 'installment-report-filters') {
    const data = new FormData(form);
    const from = String(data.get('from') ?? '').trim();
    const to = String(data.get('to') ?? '').trim();
    if (from && to && from > to) {
      installmentReportError = 'تاريخ بداية الاستحقاق لا يمكن أن يتجاوز تاريخ النهاية.';
      const error = form.querySelector<HTMLElement>('.installment-report-error');
      if (error) { error.textContent = installmentReportError; error.hidden = false; }
      return;
    }
    installmentReportSearch = String(data.get('search') ?? '').trim();
    installmentReportFilters = {
      ...installmentReportFilters,
      from,
      to,
      customerId: data.get('customerId') ? Number(data.get('customerId')) : null,
      projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
      unitId: data.get('unitId') ? Number(data.get('unitId')) : null,
      installmentStatus: String(data.get('installmentStatus') ?? ''),
    };
    await runInstallmentReport();
    return;
  }
  if (form.dataset.form === 'report-filters') {
    const next = readReportFilterForm(form);
    if (next.from && next.to && next.from > next.to) {
      reportError = 'تاريخ البداية لا يمكن أن يتجاوز تاريخ النهاية.';
      const errorHost = form.querySelector<HTMLElement>('#report-page-error');
      if (errorHost) {
        errorHost.textContent = reportError;
        errorHost.hidden = false;
      }
      return;
    }
    reportFilters = next;
    await runSelectedReport();
    return;
  }
  if (form.dataset.form === 'asset-group-search' || form.dataset.form === 'asset-search') {
    const search = String(new FormData(form).get('search') ?? '').trim();
    if (form.dataset.form === 'asset-group-search') assetGroupSearch = search;
    else assetSearch = search;
    await showPage('assets');
    return;
  }
  if (form.dataset.form === 'asset-depreciation-period') {
    const data = new FormData(form);
    assetDepreciationRange = { from: String(data.get('from') ?? ''), to: String(data.get('to') ?? '') };
    try { await showPage('assets'); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر حساب إهلاك الفترة.'); }
    return;
  }
  if (form.dataset.form === 'portfolio-filter') {
    const data = new FormData(form);
    const projectValue = String(data.get('projectId') ?? '');
    portfolioFilters = {
      from: String(data.get('from') ?? ''),
      to: String(data.get('to') ?? ''),
      projectId: projectValue ? Number(projectValue) : null,
    };
    currentPage = 'projects';
    try {
      await showPage('projects');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث لوحة المؤشرات.');
    }
    return;
  }
  if (form.dataset.form === 'financial-voucher-search' || form.dataset.form === 'expense-search') {
    const search = String(new FormData(form).get('search') ?? '').trim();
    if (form.dataset.form === 'financial-voucher-search') financialVoucherSearch = search;
    else expenseSearch = search;
    try {
      await showPage(currentPage);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ البحث المالي.');
    }
    return;
  }
  if (form.dataset.form === 'financial-voucher') {
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton?.disabled) return;
    if (submitButton) submitButton.disabled = true;
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const partyKind = String(data.get('partyKind') ?? '');
    if (partyKind !== 'customer' && partyKind !== 'supplier') {
      if (submitButton) submitButton.disabled = false;
      showError(new Error('نوع الطرف في السند غير صالح.'), 'financial-voucher-error');
      return;
    }
    const paymentMethod = String(data.get('paymentMethod') ?? 'cash') === 'bank' ? 'bank' : 'cash';
    try {
      await window.elsaad.saveFinancialVoucher({
        partyKind,
        date: String(data.get('date') ?? ''),
        partyId: Number(data.get('partyId')),
        amount: String(data.get('amount') ?? ''),
        paymentMethod,
        cashBoxId: paymentMethod === 'cash' && data.get('cashBoxId') ? Number(data.get('cashBoxId')) : null,
        bankAccountId: paymentMethod === 'bank' && data.get('bankAccountId') ? Number(data.get('bankAccountId')) : null,
        costCenterId: data.get('costCenterId') ? Number(data.get('costCenterId')) : null,
        projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
        reference: String(data.get('reference') ?? ''),
        notes: String(data.get('notes') ?? ''),
        ...(id ? { id: Number(id) } : {}),
      });
      document.querySelector<HTMLElement>('#financial-voucher-modal')?.remove();
      await showPage(currentPage);
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showError(error, 'financial-voucher-error');
    }
    return;
  }
  if (form.dataset.form === 'expense') {
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton?.disabled) return;
    if (submitButton) submitButton.disabled = true;
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const paymentMethod = String(data.get('paymentMethod') ?? 'cash') === 'bank' ? 'bank' : 'cash';
    const allocations = [...form.querySelectorAll<HTMLTableRowElement>('[data-expense-allocation]')].map((row) => ({
      expenseAccountId: Number(row.querySelector<HTMLSelectElement>('[name="expenseAccountId"]')?.value),
      projectId: row.querySelector<HTMLSelectElement>('[name="projectId"]')?.value
        ? Number(row.querySelector<HTMLSelectElement>('[name="projectId"]')?.value) : null,
      costCenterId: row.querySelector<HTMLSelectElement>('[name="costCenterId"]')?.value
        ? Number(row.querySelector<HTMLSelectElement>('[name="costCenterId"]')?.value) : null,
      amount: row.querySelector<HTMLInputElement>('[name="amount"]')?.value.trim() ?? '',
      notes: row.querySelector<HTMLInputElement>('[name="notes"]')?.value.trim() ?? '',
    }));
    try {
      await window.elsaad.saveExpense({
        date: String(data.get('date') ?? ''),
        operationType: String(data.get('operationType') ?? ''),
        description: String(data.get('description') ?? ''),
        paymentMethod,
        cashBoxId: paymentMethod === 'cash' && data.get('cashBoxId') ? Number(data.get('cashBoxId')) : null,
        bankAccountId: paymentMethod === 'bank' && data.get('bankAccountId') ? Number(data.get('bankAccountId')) : null,
        payableAccountId: data.get('payableAccountId') ? Number(data.get('payableAccountId')) : null,
        costCenterId: data.get('costCenterId') ? Number(data.get('costCenterId')) : null,
        projectId: data.get('projectId') ? Number(data.get('projectId')) : null,
        paidAmount: String(data.get('paidAmount') ?? '0'),
        totalAmount: String(data.get('totalAmount') ?? ''),
        allocations,
        notes: String(data.get('notes') ?? ''),
        ...(id ? { id: Number(id) } : {}),
      });
      document.querySelector<HTMLElement>('#expense-modal')?.remove();
      await showPage('expenses');
    } catch (error) {
      if (submitButton) submitButton.disabled = false;
      showError(error, 'expense-error');
    }
    return;
  }
  if (form.dataset.form === 'account-search' || form.dataset.form === 'center-search'
    || form.dataset.form === 'journal-search' || form.dataset.form === 'budget-search') {
    const search = String(new FormData(form).get('search') ?? '').trim();
    if (form.dataset.form === 'account-search') accountSearch = search;
    else if (form.dataset.form === 'center-search') costCenterSearch = search;
    else if (form.dataset.form === 'journal-search') journalSearch = search;
    else budgetSearch = search;
    try {
      await showPage('accounts');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ البحث.');
    }
    return;
  }
  if (form.dataset.form === 'brokerage-search') {
    brokerageSearch = String(new FormData(form).get('search') ?? '').trim();
    try {
      await showPage('brokerage');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر البحث عن بيانات السماسرة.');
    }
    return;
  }
  const contractorForm = ['contractor', 'contractor-contract', 'contractor-certificate', 'contractor-voucher'].includes(form.dataset.form ?? '');
  const contractorSubmit = contractorForm ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
  if (contractorSubmit?.disabled) return;
  if (contractorSubmit) contractorSubmit.disabled = true;
  if (form.dataset.form === 'contractor') {
    try {
      await window.elsaad.saveContractor(contractorInput(form));
      document.querySelector<HTMLElement>('#contractor-editor-modal')?.remove();
      await showPage('contractors');
    } catch (error) {
      if (contractorSubmit) contractorSubmit.disabled = false;
      showError(error, 'contractor-error');
    }
    return;
  }
  if (form.dataset.form === 'contractor-contract') {
    const submitter = (event as SubmitEvent).submitter;
    const approve = submitter instanceof HTMLButtonElement && submitter.value === 'approve';
    try {
      await window.elsaad.saveContractorContract(contractorContractInput(form), approve);
      document.querySelector<HTMLElement>('#contractor-contract-editor-modal')?.remove();
      await showPage('contractors');
    } catch (error) {
      if (contractorSubmit) contractorSubmit.disabled = false;
      showError(error, 'contractor-contract-error');
    }
    return;
  }
  if (form.dataset.form === 'contractor-certificate') {
    const submitter = (event as SubmitEvent).submitter;
    const approve = submitter instanceof HTMLButtonElement && submitter.value === 'approve';
    try {
      await window.elsaad.saveContractorCertificate(contractorCertificateInput(form), approve);
      document.querySelector<HTMLElement>('#contractor-certificate-editor-modal')?.remove();
      await showPage('contractors');
    } catch (error) {
      if (contractorSubmit) contractorSubmit.disabled = false;
      showError(error, 'contractor-certificate-error');
    }
    return;
  }
  if (form.dataset.form === 'contractor-voucher') {
    const submitter = (event as SubmitEvent).submitter;
    const approve = submitter instanceof HTMLButtonElement && submitter.value === 'approve';
    try {
      await window.elsaad.saveContractorVoucher(contractorVoucherInput(form), approve);
      document.querySelector<HTMLElement>('#contractor-voucher-editor-modal')?.remove();
      await showPage('contractors');
    } catch (error) {
      if (contractorSubmit) contractorSubmit.disabled = false;
      showError(error, 'contractor-voucher-error');
    }
    return;
  }
  const treasurySubmit = form.dataset.form === 'treasury-record'
    ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
  const projectForm = ['project', 'work-item', 'project-issue'].includes(form.dataset.form ?? '');
  const projectSubmit = projectForm ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
  if (projectSubmit?.disabled) return;
  if (projectSubmit) projectSubmit.disabled = true;
  if (treasurySubmit?.disabled) return;
  if (treasurySubmit) treasurySubmit.disabled = true;
  const inventoryDocumentForm = ['inventory-receipt', 'inventory-issue', 'inventory-transfer'].includes(form.dataset.form ?? '');
  const inventoryDocumentSubmit = inventoryDocumentForm ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
  if (inventoryDocumentSubmit?.disabled) return;
  if (inventoryDocumentSubmit) inventoryDocumentSubmit.disabled = true;
  const propertyForm = ['property-unit', 'property-broker', 'brokerage-broker', 'property-contract', 'property-commission', 'property-receipt'].includes(form.dataset.form ?? '');
  const propertySubmit = propertyForm ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
  if (propertySubmit?.disabled) return;
  if (propertySubmit) propertySubmit.disabled = true;
  if (form.dataset.form === 'property-payment-search') {
    const data = new FormData(form);
    propertyPaymentSearch = String(data.get('search') ?? '').trim();
    propertyPaymentContractId = null;
    await showPage('projects');
    return;
  }
  if (form.dataset.form === 'property-unit') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    try {
      await window.elsaad.savePropertyUnit({
        projectId: Number(data.get('projectId')), code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        floor: String(data.get('floor') ?? ''), area: String(data.get('area') ?? '0'), originalPrice: String(data.get('originalPrice') ?? ''),
        status: String(data.get('status') ?? 'available') as PropertyUnit['status'], ...(id ? { id: Number(id) } : {}),
      });
      await showPage('projects');
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'property-unit-error');
    }
    return;
  }
  if (form.dataset.form === 'property-broker') {
    const data = new FormData(form);
    try {
      const broker = await window.elsaad.savePropertyBroker({
        code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''), phone: String(data.get('phone') ?? ''),
        commissionRate: String(data.get('commissionRate') ?? '0'), status: 'active',
      });
      propertyBrokers = await window.elsaad.listPropertyBrokers();
      const brokerSelect = document.querySelector<HTMLSelectElement>('[data-form="property-contract"] [name="brokerId"]');
      if (brokerSelect) {
        brokerSelect.insertAdjacentHTML('beforeend', `<option value="${broker.id}" selected>${escapeHtml(`${broker.code} — ${broker.name}`)}</option>`);
        updatePropertyContractPreview(brokerSelect.form!);
      }
      document.querySelector<HTMLElement>('#property-broker-modal')?.remove();
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'property-broker-error');
    }
    return;
  }
  if (form.dataset.form === 'brokerage-broker') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    try {
      await window.elsaad.savePropertyBroker({
        ...(id ? { id: Number(id) } : {}),
        code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        phone: String(data.get('phone') ?? ''), commissionRate: String(data.get('commissionRate') ?? ''),
        status: String(data.get('status') ?? 'active') as PropertyBroker['status'],
      });
      brokerageNotice = id ? 'تم تعديل بيانات السمسار بنجاح.' : 'تم حفظ بيانات السمسار بنجاح.';
      await showPage('brokerage');
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'brokerage-error');
    }
    return;
  }
  if (form.dataset.form === 'property-contract') {
    try {
      const contract = propertyContractInput(form);
      updatePropertyContractPreview(form);
      const submitter = (event as SubmitEvent).submitter;
      const mode = submitter instanceof HTMLButtonElement ? submitter.value : 'draft';
      if (mode === 'approve') {
        const totals = calculateContractAmounts({
          originalPrice: contract.originalPrice, discount: contract.discount, fees: contract.fees, downPayment: contract.downPayment,
          brokerRate: contract.brokerRate, brokerCommissionMode: contract.brokerCommissionMode, brokerOnOriginalPrice: contract.brokerOnOriginalPrice,
        });
        if (toCents(totals.brokerCommission) > 0n) {
          if (contract.brokerId === null) throw new Error('اختر السمسار قبل احتساب العمولة.');
          pendingPropertyContract = contract;
          [cashBoxes, bankAccounts, accounts] = await Promise.all([
            window.elsaad.listCashBoxes(), window.elsaad.listBankAccounts(), window.elsaad.listAccounts(),
          ]);
          const brokerName = propertyBrokers.find((broker) => broker.id === contract.brokerId)?.name ?? '';
          document.querySelector<HTMLElement>('#property-commission-modal-host')!.innerHTML = renderPropertyCommissionDialog(
            totals.brokerCommission, brokerName, cashBoxes, bankAccounts, accounts,
          );
          if (propertySubmit) propertySubmit.disabled = false;
          return;
        }
        await window.elsaad.saveAndApprovePropertyContract({
          contract, commissionTreatment: null, payoutAccountId: null, expenseAccountId: null,
        });
      } else {
        await window.elsaad.savePropertyContract(contract);
      }
      pendingPropertyContract = null;
      await showPage('projects');
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'property-contract-error');
    }
    return;
  }
  if (form.dataset.form === 'property-commission') {
    const pending = pendingPropertyContract;
    const data = new FormData(form);
    const treatment = String(data.get('treatment') ?? '');
    if (!pending || !['deduct', 'cash', 'bank'].includes(treatment)) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(new Error('اختر طريقة معالجة العمولة.'), 'property-commission-error');
      return;
    }
    try {
      const payoutAccountId = treatment === 'cash' ? Number(data.get('cashBoxId'))
        : treatment === 'bank' ? Number(data.get('bankAccountId')) : null;
      await window.elsaad.saveAndApprovePropertyContract({
        contract: pending, commissionTreatment: treatment as BrokerCommissionTreatment,
        payoutAccountId: payoutAccountId || null,
        expenseAccountId: data.get('expenseAccountId') ? Number(data.get('expenseAccountId')) : null,
      });
      pendingPropertyContract = null;
      await showPage('projects');
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'property-commission-error');
    }
    return;
  }
  if (form.dataset.form === 'property-receipt') {
    const data = new FormData(form);
    const contractId = Number(form.dataset.contractId);
    const installmentHost = form.closest<HTMLElement>('.property-payment-contract') ?? document;
    const allocations = [...installmentHost.querySelectorAll<HTMLElement>('[data-payment-installment]')]
      .filter((row) => row.querySelector<HTMLInputElement>('[name="installmentSelected"]')?.checked)
      .map((row) => ({
        installmentId: Number(row.dataset.id),
        amount: row.querySelector<HTMLInputElement>('[name="allocationAmount"]')?.value ?? '0',
      }));
    try {
      await window.elsaad.collectPropertyReceipt({
        contractId, date: String(data.get('date') ?? ''), channel: String(data.get('channel') ?? 'cash') as 'cash' | 'bank',
        cashBoxId: data.get('cashBoxId') ? Number(data.get('cashBoxId')) : null,
        bankAccountId: data.get('bankAccountId') ? Number(data.get('bankAccountId')) : null,
        receivableAccountId: Number(data.get('receivableAccountId')), requestKey: crypto.randomUUID(), allocations,
        reference: String(data.get('reference') ?? ''), notes: String(data.get('notes') ?? ''),
      });
      propertyPaymentContractId = contractId;
      await showPage('projects');
    } catch (error) {
      if (propertySubmit) propertySubmit.disabled = false;
      showError(error, 'property-receipt-error');
    }
    return;
  }
  if (form.dataset.form === 'project') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? '');
    if (!['new', 'in-progress', 'on-hold', 'completed', 'cancelled'].includes(status)) {
      if (projectSubmit) projectSubmit.disabled = false;
      showError(new Error('حالة المشروع غير صالحة.'), 'project-error');
      return;
    }
    try {
      await window.elsaad.saveProject({
        code: String(data.get('code') ?? ''),
        name: String(data.get('name') ?? ''),
        startDate: String(data.get('startDate') ?? ''),
        endDate: String(data.get('endDate') ?? ''),
        costCenter: String(data.get('costCenter') ?? ''),
        status: status as ProjectStatus,
        ...(id ? { id: Number(id) } : {}),
      });
      projectListPage = 1;
      await showPage('projects');
    } catch (error) {
      if (projectSubmit) projectSubmit.disabled = false;
      showError(error, 'project-error');
    }
    return;
  } else if (form.dataset.form === 'work-item') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? '');
    if (status !== 'active' && status !== 'inactive') {
      if (projectSubmit) projectSubmit.disabled = false;
      showError(new Error('حالة البند غير صالحة.'), 'work-item-error');
      return;
    }
    try {
      const saved = await window.elsaad.saveProjectWorkItem({
        projectId: Number(data.get('projectId')),
        code: String(data.get('code') ?? ''),
        name: String(data.get('name') ?? ''),
        parentId: data.get('parentId') ? Number(data.get('parentId')) : null,
        description: String(data.get('description') ?? ''),
        status,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('projects');
      const savedItem = projectWorkItems.find((item) => item.id === saved.id);
      if (savedItem) setWorkItemForm(savedItem);
    } catch (error) {
      if (projectSubmit) projectSubmit.disabled = false;
      showError(error, 'work-item-error');
    }
    return;
  } else if (form.dataset.form === 'project-issue') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const lines = [...form.querySelectorAll<HTMLElement>('[data-project-issue-line]')].map((row) => ({
      itemId: Number(row.querySelector<HTMLSelectElement>('[name="itemId"]')?.value),
      unitId: Number(row.querySelector<HTMLInputElement>('[name="unitId"]')?.value),
      workItemId: Number(row.querySelector<HTMLSelectElement>('[name="workItemId"]')?.value),
      quantity: row.querySelector<HTMLInputElement>('[name="quantity"]')?.value.trim() ?? '',
      unitCost: row.querySelector<HTMLElement>('[data-unit-cost]')?.textContent?.trim() || '0',
    }));
    try {
      const saved = await window.elsaad.saveInventoryIssue({
        warehouseId: Number(data.get('warehouseId')),
        projectId: Number(data.get('projectId')),
        costCenter: String(data.get('costCenter') ?? ''),
        date: String(data.get('date') ?? ''),
        reason: String(data.get('reason') ?? ''),
        notes: String(data.get('notes') ?? ''),
        lines,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('projects');
      showProjectIssueEditor(saved);
      window.alert('تم حفظ سند الصرف كمسودة دون تغيير رصيد المخزون.');
    } catch (error) {
      if (projectSubmit) projectSubmit.disabled = false;
      showError(error, 'project-issue-error');
    }
    return;
  } else if (form.dataset.form === 'treasury-record') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const statusValue = String(data.get('status') ?? 'active');
    if (statusValue !== 'active' && statusValue !== 'inactive') {
      if (treasurySubmit) treasurySubmit.disabled = false;
      return;
    }
    const status: TreasuryStatus = statusValue;
    const common = {
      code: String(data.get('code') ?? ''),
      name: String(data.get('name') ?? ''),
      accountId: Number(data.get('accountId')),
      currency: String(data.get('currency') ?? ''),
      openingBalance: String(data.get('openingBalance') ?? ''),
      openingDate: String(data.get('openingDate') ?? ''),
      status,
      ...(id ? { id: Number(id) } : {}),
    };
    try {
      if (form.dataset.kind === 'cash-box') {
        await window.elsaad.saveCashBox(common);
      } else if (form.dataset.kind === 'bank') {
        await window.elsaad.saveBankAccount({
          ...common,
          bankAccountNumber: String(data.get('bankAccountNumber') ?? ''),
        });
      } else {
        throw new Error('نوع السجل المالي غير صالح.');
      }
      await showPage('treasury');
      window.alert('تم حفظ البيانات التعريفية. لم تُنشأ أي حركة مالية.');
    } catch (error) {
      showError(error, 'treasury-form-error');
      if (treasurySubmit) treasurySubmit.disabled = false;
    }
  } else if (form.dataset.form === 'inventory-item') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? 'active');
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.saveInventoryItem({
        code: String(data.get('code') ?? ''), nameAr: String(data.get('nameAr') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''), barcode: String(data.get('barcode') ?? ''),
        baseUnitId: Number(data.get('baseUnitId')), purchasePrice: String(data.get('purchasePrice') ?? ''),
        salesPrice: String(data.get('salesPrice') ?? ''), taxRate: String(data.get('taxRate') ?? ''),
        status, sellable: form.querySelector<HTMLInputElement>('[name="sellable"]')?.checked ?? false,
        purchasable: form.querySelector<HTMLInputElement>('[name="purchasable"]')?.checked ?? false,
        inventoryAccountId: data.get('inventoryAccountId') ? Number(data.get('inventoryAccountId')) : null,
        purchaseAccountId: data.get('purchaseAccountId') ? Number(data.get('purchaseAccountId')) : null,
        salesAccountId: data.get('salesAccountId') ? Number(data.get('salesAccountId')) : null,
        cogsAccountId: data.get('cogsAccountId') ? Number(data.get('cogsAccountId')) : null,
        expenseAccountId: data.get('expenseAccountId') ? Number(data.get('expenseAccountId')) : null,
        openingWarehouseId: data.get('openingWarehouseId') ? Number(data.get('openingWarehouseId')) : null,
        openingQuantity: String(data.get('openingQuantity') ?? ''),
        openingUnitCost: String(data.get('openingUnitCost') ?? ''),
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('inventory');
      window.alert('تم حفظ بيانات الصنف.');
    } catch (error) {
      showError(error, 'inventory-form-error');
    }
  } else if (form.dataset.form === 'inventory-unit') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? 'active');
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.saveInventoryUnit({
        code: String(data.get('code') ?? ''), nameAr: String(data.get('nameAr') ?? ''),
        abbreviation: String(data.get('abbreviation') ?? ''), status,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('inventory');
      window.alert('تم حفظ وحدة القياس.');
    } catch (error) {
      showError(error, 'inventory-form-error');
    }
  } else if (form.dataset.form === 'warehouse') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? 'active');
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.saveWarehouse({
        code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        accountId: data.get('accountId') ? Number(data.get('accountId')) : null, status,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('inventory');
      window.alert('تم حفظ المخزن.');
    } catch (error) {
      showError(error, 'inventory-form-error');
    }
  } else if (form.dataset.form === 'inventory-receipt') {
    try {
      await window.elsaad.saveInventoryReceipt(getInventoryReceiptInput(form));
      await showPage('inventory');
      window.alert('تم حفظ إذن الاستلام كمسودة؛ لم يتغير رصيد المخزون.');
    } catch (error) {
      showError(error, 'inventory-document-error');
      if (inventoryDocumentSubmit) inventoryDocumentSubmit.disabled = false;
    }
  } else if (form.dataset.form === 'inventory-issue' || form.dataset.form === 'inventory-transfer') {
    try {
      const input = getInventoryMovementInput(form);
      if (form.dataset.form === 'inventory-issue') {
        await window.elsaad.saveInventoryIssue(input as import('./shared/types.js').InventoryIssueInput);
      } else {
        await window.elsaad.saveInventoryTransfer(input as import('./shared/types.js').InventoryTransferInput);
      }
      await showPage('inventory');
      window.alert('تم حفظ المستند كمسودة؛ لم يتغير رصيد المخزون.');
    } catch (error) {
      showError(error, 'inventory-document-error');
      if (inventoryDocumentSubmit) inventoryDocumentSubmit.disabled = false;
    }
  } else if (form.dataset.form === 'supplier') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? 'active');
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.saveSupplier({
        code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        tradeName: String(data.get('tradeName') ?? ''), phone: String(data.get('phone') ?? ''),
        email: String(data.get('email') ?? ''), address: String(data.get('address') ?? ''),
        city: String(data.get('city') ?? ''), country: String(data.get('country') ?? ''),
        taxNumber: String(data.get('taxNumber') ?? ''), commercialRegister: String(data.get('commercialRegister') ?? ''),
        groupId: data.get('groupId') ? Number(data.get('groupId')) : null,
        accountId: data.get('accountId') ? Number(data.get('accountId')) : null,
        notes: String(data.get('notes') ?? ''), status,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('purchases');
      window.alert('تم حفظ بيانات المورد.');
    } catch (error) {
      showError(error, 'purchase-master-error');
    }
  } else if (form.dataset.form === 'supplier-group') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? 'active');
    if (status !== 'active' && status !== 'inactive') return;
    try {
      await window.elsaad.saveSupplierGroup({
        code: String(data.get('code') ?? ''), nameAr: String(data.get('nameAr') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''), accountId: data.get('accountId') ? Number(data.get('accountId')) : null,
        status, notes: String(data.get('notes') ?? ''),
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('purchases');
      window.alert('تم حفظ مجموعة الموردين.');
    } catch (error) {
      showError(error, 'purchase-master-error');
    }
  } else if (form.dataset.form === 'purchase-invoice') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const lines: PurchaseInvoiceInput['lines'] = [...form.querySelectorAll<HTMLTableRowElement>('[data-purchase-line]')].map((row) => ({
      itemId: row.querySelector<HTMLSelectElement>('[name="itemId"]')?.value
        ? Number(row.querySelector<HTMLSelectElement>('[name="itemId"]')?.value) : null,
      unitId: row.querySelector<HTMLInputElement>('[name="unitId"]')?.value
        ? Number(row.querySelector<HTMLInputElement>('[name="unitId"]')?.value) : null,
      itemCode: row.querySelector<HTMLInputElement>('[name="itemCode"]')?.value.trim() ?? '',
      description: row.querySelector<HTMLInputElement>('[name="description"]')?.value.trim() ?? '',
      unit: row.querySelector<HTMLInputElement>('[name="unit"]')?.value.trim() ?? '',
      quantity: row.querySelector<HTMLInputElement>('[name="quantity"]')?.value.trim() ?? '',
      unitPrice: row.querySelector<HTMLInputElement>('[name="unitPrice"]')?.value.trim() ?? '',
    }));
    const paymentLink = String(data.get('paymentLink') ?? 'unlinked');
    if (paymentLink !== 'unlinked' && paymentLink !== 'cash' && paymentLink !== 'bank') return;
    try {
      await window.elsaad.savePurchaseInvoice({
        supplierId: Number(data.get('supplierId')),
        invoiceDate: String(data.get('invoiceDate') ?? ''), dueDate: String(data.get('dueDate') ?? ''),
        supplierInvoiceNumber: String(data.get('supplierInvoiceNumber') ?? ''), paymentLink,
        category: String(data.get('category') ?? ''), project: String(data.get('project') ?? ''),
        costCenter: String(data.get('costCenter') ?? ''), notes: String(data.get('notes') ?? ''),
        lines, ...(id ? { id: Number(id) } : {}),
      });
      await showPage('purchases');
      window.alert('تم حفظ فاتورة المشتريات كمسودة. لم يتغير المخزون أو الحسابات أو النقدية.');
    } catch (error) {
      showError(error, 'purchase-document-error');
    }
  } else if (form.dataset.form === 'purchase-return') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const lines = [...form.querySelectorAll<HTMLTableRowElement>('[data-purchase-return-line]')].map((row) => ({
      invoiceLineId: Number(row.dataset.invoiceLineId),
      quantity: row.querySelector<HTMLInputElement>('[name="returnQuantity"]')?.value.trim() ?? '0',
    })).filter((line) => Number(line.quantity) > 0);
    try {
      await window.elsaad.savePurchaseReturn({
        invoiceId: Number(data.get('invoiceId')), date: String(data.get('date') ?? ''),
        reason: String(data.get('reason') ?? ''), notes: String(data.get('notes') ?? ''), lines,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('purchases');
      window.alert('تم حفظ مسودة المرتجع. لم يحدث أي أثر مخزني أو مالي.');
    } catch (error) {
      showError(error, 'purchase-return-error');
    }
  } else if (form.dataset.form === 'purchase-dashboard') {
    const data = new FormData(form);
    const status = String(data.get('status') ?? 'all');
    if (status !== 'all' && status !== 'draft' && status !== 'approved' && status !== 'cancelled') return;
    purchaseDashboardFilters = {
      from: String(data.get('from') ?? ''), to: String(data.get('to') ?? ''),
      supplierId: data.get('supplierId') ? Number(data.get('supplierId')) : null,
      status, category: String(data.get('category') ?? ''),
    };
    try {
      await showPage('purchases');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث لوحة المشتريات.');
    }
  } else if (form.dataset.form === 'customer') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    try {
      await window.elsaad.saveCustomer({
        code: String(data.get('code') ?? ''),
        name: String(data.get('name') ?? ''),
        tradeName: String(data.get('tradeName') ?? ''),
        phone: String(data.get('phone') ?? ''),
        email: String(data.get('email') ?? ''),
        groupId: data.get('groupId') ? Number(data.get('groupId')) : null,
        accountId: data.get('accountId') ? Number(data.get('accountId')) : null,
        city: String(data.get('city') ?? ''),
        country: String(data.get('country') ?? ''),
        address: String(data.get('address') ?? ''),
        taxNumber: String(data.get('taxNumber') ?? ''),
        notes: String(data.get('notes') ?? ''),
        status: String(data.get('status') ?? 'active') as Customer['status'],
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('sales');
      window.alert('تم حفظ بيانات العميل.');
    } catch (error) {
      showError(error, 'sales-master-error');
    }
  } else if (form.dataset.form === 'customer-group') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    try {
      await window.elsaad.saveCustomerGroup({
        code: String(data.get('code') ?? ''),
        nameAr: String(data.get('nameAr') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''),
        status: String(data.get('status') ?? 'active') as CustomerGroup['status'],
        notes: String(data.get('notes') ?? ''),
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('sales');
      window.alert('تم حفظ مجموعة العملاء.');
    } catch (error) {
      showError(error, 'sales-master-error');
    }
  } else if (form.dataset.form === 'sales-return') {
    const data = new FormData(form);
    const id = String(data.get('id') ?? '');
    const lines: Array<{ invoiceLineId: number; quantity: string }> = [...form.querySelectorAll<HTMLTableRowElement>('[data-return-line]')]
      .map((row) => ({
        invoiceLineId: Number(row.dataset.invoiceLineId),
        quantity: row.querySelector<HTMLInputElement>('[name="returnQuantity"]')?.value.trim() ?? '0',
      }))
      .filter((line) => Number(line.quantity) > 0);
    try {
      await window.elsaad.saveSalesReturn({
        invoiceId: Number(data.get('invoiceId')),
        date: String(data.get('date') ?? ''),
        reason: String(data.get('reason') ?? ''),
        notes: String(data.get('notes') ?? ''),
        lines,
        ...(id ? { id: Number(id) } : {}),
      });
      await showPage('sales');
      window.alert('تم حفظ مسودة المرتجع؛ لم يحدث أي أثر مخزني أو مالي.');
    } catch (error) {
      showError(error, 'sales-return-error');
    }
  } else if (form.dataset.form === 'sales-dashboard-filter') {
    const data = new FormData(form);
    const status = String(data.get('status') ?? 'all');
    if (status !== 'all' && status !== 'draft' && status !== 'approved' && status !== 'cancelled') return;
    salesDashboardFilters = {
      from: String(data.get('from') ?? ''),
      to: String(data.get('to') ?? ''),
      customerId: data.get('customerId') ? Number(data.get('customerId')) : null,
      status,
    };
    try {
      await showPage('sales');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر تحديث لوحة المبيعات.');
    }
  } else if (form.dataset.form === 'sales-document') {
    const value = (name: string): string => form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? '';
    const optionalNumber = (name: string): number | null => {
      const raw = value(name).trim();
      return raw ? Number(raw) : null;
    };
    const lines: SalesDocumentLineInput[] = [...form.querySelectorAll<HTMLTableRowElement>('[data-sales-line]')].map((row) => {
      const lineValue = (name: string): string => row.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';
      const lineId = (name: string): number | null => {
        const raw = lineValue(name).trim();
        return raw ? Number(raw) : null;
      };
      return {
        sourceDocumentLineId: lineId('sourceDocumentLineId'),
        sourceWorkOrderLineId: lineId('sourceWorkOrderLineId'),
        masterItemId: lineId('masterItemId'),
        description: lineValue('description'),
        unit: lineValue('unit'),
        quantity: lineValue('quantity'),
        currentQuantity: lineValue('currentQuantity') || '0',
        unitPrice: lineValue('unitPrice'),
      };
    });
    const idValue = value('id');
    const type = value('type');
    if (type !== 'estimate' && type !== 'work-order' && type !== 'certificate' && type !== 'invoice') return;
    const customerSelect = form.querySelector<HTMLSelectElement>('[name="masterClientId"]');
    const selectedCustomerName = customerSelect?.selectedOptions[0]?.dataset.customerName;
    const input: SalesDocumentInput = {
      type,
      sourceDocumentId: optionalNumber('sourceDocumentId'),
      masterClientId: optionalNumber('masterClientId'),
      clientName: selectedCustomerName ?? (customerSelect?.disabled ? value('clientName') : ''),
      date: value('date'),
      reference: value('reference'),
      notes: value('notes'),
      lines,
      ...(idValue ? { id: Number(idValue) } : {}),
    };
    try {
      await window.elsaad.saveSalesDocument(input);
      await showPage('sales');
    } catch (error) {
      showError(error, 'sales-document-error');
    }
  } else if (form.dataset.form === 'asset-group') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      await window.elsaad.saveAssetGroup({
        ...(idValue ? { id: Number(idValue) } : {}), code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''), assetAccountId: Number(data.get('assetAccountId')),
        accumulatedDepreciationAccountId: Number(data.get('accumulatedDepreciationAccountId')),
        depreciationExpenseAccountId: Number(data.get('depreciationExpenseAccountId')), notes: String(data.get('notes') ?? ''),
      });
      await showPage('assets');
    } catch (error) {
      if (submit) submit.disabled = false;
      showError(error, 'asset-error');
    }
  } else if (form.dataset.form === 'asset') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      await window.elsaad.saveAsset({
        ...(idValue ? { id: Number(idValue) } : {}), code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''), groupId: Number(data.get('groupId')),
        purchaseDate: String(data.get('purchaseDate') ?? ''), purchaseValue: String(data.get('purchaseValue') ?? ''),
        salvageValue: String(data.get('salvageValue') ?? ''), usefulLifeYears: Number(data.get('usefulLifeYears')),
        depreciationMethod: String(data.get('depreciationMethod') ?? 'straight-line') as AssetInput['depreciationMethod'],
        assetAccountId: Number(data.get('assetAccountId')), accumulatedDepreciationAccountId: Number(data.get('accumulatedDepreciationAccountId')),
        depreciationExpenseAccountId: Number(data.get('depreciationExpenseAccountId')),
        status: String(data.get('status') ?? 'active') as AssetInput['status'], notes: String(data.get('notes') ?? ''),
      });
      await showPage('assets');
    } catch (error) {
      if (submit) submit.disabled = false;
      showError(error, 'asset-error');
    }
  } else if (form.dataset.form === 'account') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    const submitText = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'جار الحفظ...'; }
    try {
      await window.elsaad.saveAccount({
        code: String(data.get('code') ?? ''),
        name: String(data.get('name') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''),
        type: String(data.get('type') ?? 'asset') as AccountItem['type'],
        parentId: data.get('parentId') ? Number(data.get('parentId')) : null,
        postable: data.get('postable') === 'on',
        notes: String(data.get('notes') ?? ''),
        ...(idValue ? { id: Number(idValue) } : {}),
      });
      await showPage('accounts');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = submitText; }
      showError(error, 'account-error');
    }
  } else if (form.dataset.form === 'cost-center') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    const submitText = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'جار الحفظ...'; }
    try {
      await window.elsaad.saveCostCenter({
        ...(idValue ? { id: Number(idValue) } : {}), code: String(data.get('code') ?? ''), name: String(data.get('name') ?? ''),
        nameEn: String(data.get('nameEn') ?? ''), parentId: data.get('parentId') ? Number(data.get('parentId')) : null,
        type: String(data.get('type') ?? ''), postable: data.get('postable') === 'on', notes: String(data.get('notes') ?? ''),
      });
      await showPage('accounts');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = submitText; }
      showError(error, 'center-error');
    }
  } else if (form.dataset.form === 'journal') {
    const data = new FormData(form);
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    const submitText = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'جار الترحيل...'; }
    const lines = [...form.querySelectorAll<HTMLElement>('[data-journal-line]')].map((row) => ({
      accountId: Number(row.querySelector<HTMLSelectElement>('[name=accountId]')?.value),
      description: row.querySelector<HTMLInputElement>('[name=description]')?.value.trim() ?? '',
      debit: row.querySelector<HTMLInputElement>('[name=debit]')?.value.trim() || '0',
      credit: row.querySelector<HTMLInputElement>('[name=credit]')?.value.trim() || '0',
      costCenterId: row.querySelector<HTMLSelectElement>('[name=costCenterId]')?.value
        ? Number(row.querySelector<HTMLSelectElement>('[name=costCenterId]')?.value) : null,
    }));
    try {
      await window.elsaad.postJournalEntry({
        requestKey: String(data.get('requestKey') ?? ''),
        reference: String(data.get('reference') ?? ''),
        date: String(data.get('date') ?? ''),
        description: String(data.get('description') ?? ''),
        lines,
      });
      await showPage('accounts');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = submitText; }
      showError(error, 'journal-error');
    }
  } else if (form.dataset.form === 'accounting-period-close') {
    const data = new FormData(form);
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    if (!window.confirm('إقفال الفترة نهائيًا؟ لن يمكن إعادة فتحها، ولن يُسمح بترحيل قيود بتاريخ يقع داخلها.')) return;
    const submitText = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'جار الإقفال...'; }
    try {
      await window.elsaad.closeAccountingPeriod({
        from: String(data.get('from') ?? ''),
        to: String(data.get('to') ?? ''),
      });
      await showPage('accounts');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = submitText; }
      showError(error, 'accounting-period-error');
    }
  } else if (form.dataset.form === 'budget') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    const submitText = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'جار الحفظ...'; }
    const lines = [...form.querySelectorAll<HTMLElement>('[data-budget-line]')].map((row) => ({
      accountId: Number(row.querySelector<HTMLSelectElement>('[name="accountId"]')?.value),
      category: String(row.querySelector<HTMLSelectElement>('[name="category"]')?.value) as Budget['lines'][number]['category'],
      costCenterId: row.querySelector<HTMLSelectElement>('[name="costCenterId"]')?.value ? Number(row.querySelector<HTMLSelectElement>('[name="costCenterId"]')?.value) : null,
      amount: row.querySelector<HTMLInputElement>('[name="amount"]')?.value.trim() ?? '',
      notes: row.querySelector<HTMLInputElement>('[name="notes"]')?.value.trim() ?? '',
    }));
    try {
      await window.elsaad.saveBudget({
        ...(idValue ? { id: Number(idValue) } : {}), from: String(data.get('from') ?? ''), to: String(data.get('to') ?? ''),
        costCenterId: data.get('costCenterId') ? Number(data.get('costCenterId')) : null,
        notes: String(data.get('notes') ?? ''), lines,
      });
      await showPage('accounts');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = submitText; }
      showError(error, 'budget-error');
    }
  } else if (form.dataset.form === 'login') {
    const data = new FormData(form);
    const result = await window.elsaad.login({
      username: String(data.get('username') ?? ''),
      password: String(data.get('password') ?? ''),
    });
    if (!result.ok) {
      if (result.requiresPasswordChange) {
        renderLegacyPasswordChange('', String(data.get('username') ?? ''));
        return;
      }
      renderLogin(result.message);
      return;
    }
    authenticatedUser = await window.elsaad.getCurrentUser();
    const landingPage = await window.elsaad.getLandingPage();
    if (landingPage) await showPage(landingPage);
    else renderNoAccess();
  } else if (form.dataset.form === 'record') {
    const data = new FormData(form);
    const idValue = String(data.get('id') ?? '');
    const record: RecordInput & { id?: number } = {
      module: String(data.get('module')) as ModuleKey,
      title: String(data.get('title') ?? ''),
      reference: String(data.get('reference') ?? ''),
      party: String(data.get('party') ?? ''),
      date: String(data.get('date') ?? ''),
      amount: String(data.get('amount') ?? ''),
      status: String(data.get('status') ?? 'new'),
      notes: String(data.get('notes') ?? ''),
      ...(idValue ? { id: Number(idValue) } : {}),
    };
    try {
      await window.elsaad.saveRecord(record);
      await showPage(currentPage);
    } catch (error) {
      showError(error, 'record-error');
      return;
    }
  }
});

root.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches('[data-user-search]')) {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-user-row]').forEach((row) => { row.hidden = Boolean(query && !row.innerText.toLocaleLowerCase('ar').includes(query)); });
    return;
  }
  if (target.matches('[data-group-search]')) {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('.group-list-item').forEach((row) => { row.hidden = Boolean(query && !row.innerText.toLocaleLowerCase('ar').includes(query)); });
    return;
  }
  if (target.matches('[data-permission-user-search]')) {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLOptionElement>('[data-permission-user] option').forEach((option) => { option.hidden = Boolean(query && !option.textContent?.toLocaleLowerCase('ar').includes(query)); });
    return;
  }
  if (target.matches('[data-installment-search]')) {
    installmentReportSearch = target.value;
    refreshInstallmentReportResults();
    return;
  }
  if (target.id === 'report-search') {
    reportSearch = target.value;
    refreshReportLibraryParts();
    return;
  }
  if (target.id === 'asset-group-search' || target.id === 'asset-search') {
    const selector = target.id === 'asset-group-search' ? '[data-asset-group-row]' : '.asset-card';
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>(selector).forEach((row) => { row.hidden = Boolean(query && !row.dataset.assetSearch?.includes(query)); });
    return;
  }
  if (target.matches('[data-depreciation-search]')) {
    filterDepreciationRows();
    return;
  }
  if (target.form?.dataset.form === 'journal') {
    updateJournalTotals(target.form);
    return;
  }
  if (target.form?.dataset.form === 'expense') {
    updateExpenseTotals(target.form);
    return;
  }
  if (target.form?.dataset.form === 'account-search' || target.form?.dataset.form === 'center-search') {
    const selector = target.form.dataset.form === 'account-search' ? '[data-account-search]' : '[data-center-search]';
    const visible = new Set<HTMLElement>();
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      if (node.dataset.accountSearch?.includes(target.value.trim().toLocaleLowerCase('ar'))
        || node.dataset.centerSearch?.includes(target.value.trim().toLocaleLowerCase('ar'))) {
        visible.add(node);
        let parent = node.parentElement?.closest<HTMLElement>(selector);
        while (parent) {
          visible.add(parent);
          parent = parent.parentElement?.closest<HTMLElement>(selector);
        }
      }
    });
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => { node.hidden = target.value.trim() !== '' && !visible.has(node); });
    return;
  }
  if (target.id === 'contractor-search' || target.id === 'contractor-contract-search') {
    const selector = target.id === 'contractor-search' ? '[data-contractor-row]' : '[data-contractor-contract-row]';
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>(selector).forEach((row) => { row.hidden = !row.dataset.search?.includes(query); });
    return;
  }
  if (target.form?.dataset.form === 'contractor') {
    updateContractorOpeningTotals(target.form);
    return;
  }
  if (target.form?.dataset.form === 'contractor-contract') {
    updateContractorContractTotals(target.form);
    return;
  }
  if (target.id === 'property-unit-search' || target.id === 'property-contract-search') {
    const selector = target.id === 'property-unit-search' ? '[data-property-unit]' : '[data-property-contract]';
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>(selector).forEach((row) => { row.hidden = !row.dataset.search?.includes(query); });
    return;
  }
  if (target.form?.dataset.form === 'property-contract') {
    updatePropertyContractPreview(target.form);
    return;
  }
  if (target.form?.dataset.form === 'property-receipt') {
    updatePropertyReceiptTotal(target.form);
    return;
  }
  if (target.name === 'allocationAmount' && target.closest('[data-payment-installment]')) {
    const receiptForm = document.querySelector<HTMLFormElement>('[data-form="property-receipt"]');
    if (receiptForm) updatePropertyReceiptTotal(receiptForm);
    return;
  }
  if (target.id === 'project-search') {
    projectListPage = 1;
    filterProjectTable();
    return;
  }
  if (target.id === 'project-issue-search') {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-project-issue-row]').forEach((row) => {
      row.hidden = !row.dataset.search?.includes(query);
    });
    return;
  }
  if (target.id === 'work-item-search') {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-work-item-row]').forEach((row) => {
      row.hidden = !row.dataset.search?.includes(query);
    });
    return;
  }
  if (target.name === 'endDate' && target.form?.dataset.form === 'project') {
    const start = target.form.querySelector<HTMLInputElement>('[name="startDate"]')?.value ?? '';
    const duration = document.querySelector<HTMLInputElement>('#project-duration');
    if (!duration) return;
    if (start && target.value && target.value >= start) {
      const days = Math.floor((Date.parse(`${target.value}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
      duration.value = `${days} يوم`;
    } else {
      duration.value = start && target.value ? 'تحقق من التواريخ' : 'أدخل تاريخ النهاية';
    }
    return;
  }
  if (target.name === 'startDate' && target.form?.dataset.form === 'project') {
    const end = target.form.querySelector<HTMLInputElement>('[name="endDate"]');
    if (end) end.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (target.closest('[data-project-issue-line]') && target.name === 'quantity') {
    updateProjectIssueTotals();
    return;
  }
  if (target.id === 'supplier-search') {
    filterSuppliers();
    return;
  }
  if (target.id === 'cash-box-search' || target.id === 'bank-search') {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-treasury-row]').forEach((row) => {
      row.hidden = !row.dataset.search?.includes(query);
    });
    return;
  }
  if (target.id === 'inventory-item-search') {
    filterInventoryRows('inventory-item-search', 'inventory-item-status', '[data-inventory-item-row]');
    return;
  }
  if (target.id === 'inventory-unit-search') {
    filterInventoryRows('inventory-unit-search', 'inventory-unit-status', '[data-inventory-unit-row]');
    return;
  }
  if (target.id === 'warehouse-search') {
    filterInventoryRows('warehouse-search', 'warehouse-status', '[data-warehouse-row]');
    return;
  }
  if (target.id === 'inventory-document-search') {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-inventory-document-row]').forEach((row) => {
      row.hidden = !row.dataset.search?.includes(query);
    });
    return;
  }
  if (target.closest('#inventory-doc-lines') && target.closest('[data-inventory-doc-line]')) {
    updateInventoryDocumentTotals();
    return;
  }
  if (target.name === 'receiptQuantity' && target.closest('[data-receipt-line]')) {
    const row = target.closest<HTMLElement>('[data-receipt-line]');
    const remaining = row?.querySelector<HTMLElement>('[data-receipt-remaining]');
    const input = target.value || '0';
    const available = row?.dataset.availableBefore ?? '0';
    if (remaining && /^\d{1,15}(?:\.\d{1,12})?$/.test(input)) {
      const difference = parseAmount(available) - parseAmount(input);
      remaining.textContent = formatAmount(difference > 0n ? difference : 0n);
    }
    return;
  }
  if (target.id === 'supplier-group-search') {
    filterRows('supplier-group-search', '[data-purchase-group-row]');
    return;
  }
  if (target.id === 'purchase-invoice-search') {
    filterPurchaseInvoices();
    return;
  }
  if (target.id === 'purchase-return-search') {
    filterPurchaseReturns();
    return;
  }
  if (target.closest('#purchase-invoice-modal') && target.closest('[data-purchase-line]')) {
    updatePurchaseInvoiceTotals();
    return;
  }
  if (target.closest('#purchase-return-modal') && target.name === 'returnQuantity') {
    updatePurchaseReturnTotals();
    return;
  }
  if (target.id === 'customer-search') {
    filterCustomerRows();
    return;
  }
  if (target.id === 'customer-group-search') {
    filterRows('customer-group-search', '[data-group-row]');
    return;
  }
  if (target.id === 'sales-return-search') {
    filterRows('sales-return-search', '[data-return-row]');
    return;
  }
  if (target.id === 'sales-search') {
    const query = target.value.trim().toLocaleLowerCase('ar');
    document.querySelectorAll<HTMLElement>('[data-sales-document]').forEach((row) => {
      row.hidden = !row.dataset.search?.includes(query);
    });
    return;
  }
  if (target.closest('#sales-document-modal') && target.name) {
    updateSalesEditorTotals();
    return;
  }
  if (target.closest('#sales-return-modal') && target.name === 'returnQuantity') {
    updateSalesReturnTotal();
    return;
  }
  if (target.id !== 'record-search') return;
  const query = target.value.trim().toLocaleLowerCase('ar');
  document.querySelectorAll<HTMLElement>('[data-record-row]').forEach((row) => {
    row.hidden = !row.dataset.search?.includes(query);
  });
});

root.addEventListener('keydown', (event) => {
  const reportSearchInput = document.querySelector<HTMLInputElement>('#report-search');
  if (reportSearchInput && (event.key === 'F1' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'))) {
    event.preventDefault();
    reportSearchInput.focus();
    reportSearchInput.select();
    return;
  }
  if (event.key !== 'F1') return;
  const searchInput = document.querySelector<HTMLInputElement>('[data-form="financial-voucher-search"] input[name="search"]')
    ?? document.querySelector<HTMLInputElement>('[data-form="expense-search"] input[name="search"]');
  if (!searchInput) return;
  event.preventDefault();
  searchInput.focus();
});

root.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target instanceof HTMLSelectElement && target.name === 'masterItemId'
    && target.closest('[data-sales-line]')) {
    const row = target.closest<HTMLTableRowElement>('[data-sales-line]');
    const selected = target.selectedOptions[0];
    const description = row?.querySelector<HTMLInputElement>('[name="description"]');
    const unit = row?.querySelector<HTMLInputElement>('[name="unit"]');
    if (description) description.value = selected?.dataset.itemName ?? '';
    if (unit) unit.value = selected?.dataset.unitName ?? '';
    return;
  }
  if (target instanceof HTMLSelectElement && target.matches('[data-permission-user]')) {
    if (!confirmDiscardSettingsChanges()) {
      target.value = String(selectedManagedUserId ?? '');
      return;
    }
    selectedManagedUserId = Number(target.value) || null;
    await showSettingsTab('user-permissions');
    return;
  }
  if (target instanceof HTMLSelectElement && target.matches('[data-depreciation-group], [data-depreciation-status]')) {
    filterDepreciationRows();
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'groupId' && target.closest('[data-form="asset"]')) {
    const group = assetGroups.find((item) => item.id === Number(target.value));
    const form = target.form;
    if (!form) return;
    const groupCode = form.querySelector<HTMLInputElement>('[data-group-code]');
    const groupName = form.querySelector<HTMLInputElement>('[data-group-name]');
    if (groupCode) groupCode.value = group?.code ?? '';
    if (groupName) groupName.value = group?.name ?? '';
    const linkedAccounts: Array<[string, number | undefined]> = [
      ['assetAccountId', group?.assetAccountId],
      ['accumulatedDepreciationAccountId', group?.accumulatedDepreciationAccountId],
      ['depreciationExpenseAccountId', group?.depreciationExpenseAccountId],
    ];
    for (const [name, accountId] of linkedAccounts) {
      const select = form.querySelector<HTMLSelectElement>(`[name="${name}"]`);
      if (select && accountId) select.value = String(accountId);
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'paymentMethod'
    && (target.form?.dataset.form === 'financial-voucher' || target.form?.dataset.form === 'expense')) {
    const form = target.form;
    if (!form) return;
    const method = target.value === 'bank' ? 'bank' : 'cash';
    form.querySelectorAll<HTMLElement>('[data-payout-cash]').forEach((node) => {
      node.hidden = method !== 'cash';
      const select = node.querySelector<HTMLSelectElement>('select');
      if (select) select.disabled = method !== 'cash';
    });
    form.querySelectorAll<HTMLElement>('[data-payout-bank]').forEach((node) => {
      node.hidden = method !== 'bank';
      const select = node.querySelector<HTMLSelectElement>('select');
      if (select) select.disabled = method !== 'bank';
    });
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'openingStatus' && target.closest('[data-form="contractor"]')) {
    if (target.form) updateContractorOpeningTotals(target.form);
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'contractorId' && target.closest('[data-form="contractor-contract"]')) {
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === 'property-unit-project-filter') {
    propertyProjectFilter = target.value ? Number(target.value) : null;
    propertyUnits = await window.elsaad.listPropertyUnits(propertyProjectFilter ?? undefined);
    renderShell(renderPropertyUnitsPage(projects, propertyUnits, propertyProjectFilter), 'وحدات المشروع');
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'projectId' && target.closest('[data-form="property-contract"]')) {
    const form = target.form;
    const unitSelect = form?.querySelector<HTMLSelectElement>('[name="unitId"]');
    if (unitSelect) {
      unitSelect.value = '';
      for (const option of unitSelect.options) {
        option.hidden = Boolean(option.value) && Number(option.dataset.projectId) !== Number(target.value);
      }
    }
    if (form) updatePropertyContractPreview(form);
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'brokerId' && target.closest('[data-form="property-contract"]')) {
    const form = target.form;
    const rateField = form?.querySelector<HTMLInputElement>('[name="brokerRate"]');
    const commissionMode = form?.querySelector<HTMLSelectElement>('[name="brokerCommissionMode"]')?.value;
    if (rateField && commissionMode === 'rate') {
      const previousDefault = target.dataset.appliedCommission ?? '0';
      if (rateField.value === previousDefault) {
        rateField.value = target.selectedOptions[0]?.dataset.commissionRate ?? '0';
      }
      target.dataset.appliedCommission = rateField.value;
    }
    if (form) updatePropertyContractPreview(form);
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'unitId' && target.closest('[data-form="property-contract"]')) {
    const selectedOption = target.selectedOptions[0];
    const price = target.form?.querySelector<HTMLInputElement>('[name="originalPrice"]');
    if (price && selectedOption?.dataset.price) price.value = selectedOption.dataset.price;
    if (target.form) updatePropertyContractPreview(target.form);
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'brokerCommissionMode' && target.closest('[data-form="property-contract"]')) {
    const form = target.form;
    const valueField = form?.querySelector<HTMLInputElement>('[name="brokerRate"]');
    const label = form?.querySelector<HTMLElement>('[data-broker-value-label]');
    const originalPriceOption = form?.querySelector<HTMLElement>('[name="brokerOnOriginalPrice"]')?.closest<HTMLElement>('.field');
    const fixed = target.value === 'fixed';
    if (valueField) {
      if (fixed) valueField.removeAttribute('max');
      else valueField.max = '100';
    }
    if (label) label.textContent = fixed ? 'قيمة العمولة بالجنيه' : 'نسبة العمولة %';
    if (originalPriceOption) originalPriceOption.hidden = fixed;
    if (form) updatePropertyContractPreview(form);
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'channel' && target.closest('[data-form="property-receipt"]')) {
    const form = target.form;
    const cashField = form?.querySelector<HTMLSelectElement>('[name="cashBoxId"]')?.closest<HTMLElement>('.field');
    const bankField = form?.querySelector<HTMLSelectElement>('[name="bankAccountId"]')?.closest<HTMLElement>('.field');
    if (cashField) cashField.hidden = target.value !== 'cash';
    if (bankField) bankField.hidden = target.value !== 'bank';
    return;
  }
  if (target instanceof HTMLInputElement && (target.name === 'installmentSelected' || target.name === 'allocationAmount')) {
    const form = target.form ?? document.querySelector<HTMLFormElement>('[data-form="property-receipt"]');
    if (form?.dataset.form === 'property-receipt') {
      const row = target.closest<HTMLElement>('[data-payment-installment]');
      const checkbox = row?.querySelector<HTMLInputElement>('[name="installmentSelected"]');
      const amount = row?.querySelector<HTMLInputElement>('[name="allocationAmount"]');
      if (checkbox && amount) {
        if (target.name === 'installmentSelected' && checkbox.checked && Number(amount.value) === 0) amount.value = row?.dataset.remaining ?? '0';
        if (target.name === 'installmentSelected' && !checkbox.checked) amount.value = '0';
        if (target.name === 'allocationAmount') checkbox.checked = Number(amount.value) > 0;
      }
      updatePropertyReceiptTotal(form);
      return;
    }
  }
  if (target instanceof HTMLSelectElement && target.id === 'project-status-filter') {
    projectListPage = 1;
    filterProjectTable();
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === 'work-item-project-filter') {
    const projectId = target.value ? Number(target.value) : null;
    document.querySelectorAll<HTMLElement>('[data-tree-node]').forEach((node) => {
      node.hidden = projectId !== null && Number(node.dataset.projectId) !== projectId;
    });
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'parentId' && target.closest('#work-item-form')) {
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'projectId' && target.closest('#work-item-form')) {
    const parentHost = document.querySelector<HTMLElement>('#work-item-parent-host');
    const editing = editingWorkItemId === null ? null : projectWorkItems.find((item) => item.id === editingWorkItemId) ?? null;
    if (parentHost) {
      const parents = projectWorkItems.filter((item) => item.projectId === Number(target.value) && item.id !== editingWorkItemId && item.status === 'active');
      parentHost.innerHTML = `<select name="parentId"><option value="">بند رئيسي</option>${parents.map((item) =>
        `<option value="${item.id}" ${editing?.parentId === item.id ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.name}`)}</option>`).join('')}</select>`;
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'projectId' && target.closest('[data-form="project-issue"]')) {
    const form = target.form;
    const selectedProject = projects.find((project) => project.id === Number(target.value));
    const costCenter = form?.querySelector<HTMLInputElement>('[name="costCenter"]');
    if (costCenter) costCenter.value = selectedProject?.costCenter ?? '';
    form?.querySelectorAll<HTMLTableRowElement>('[data-project-issue-line]').forEach((row) => {
      const selected = Number(row.querySelector<HTMLSelectElement>('[name="workItemId"]')?.value ?? 0);
      const workSelect = row.querySelector<HTMLSelectElement>('[name="workItemId"]');
      if (workSelect) {
        workSelect.innerHTML = `<option value="">اختر بند الأعمال</option>${projectWorkItems.filter((item) =>
          item.projectId === Number(target.value) && item.status === 'active').map((item) =>
          `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.name}`)}</option>`).join('')}`;
      }
    });
    return;
  }
  if (target instanceof HTMLSelectElement && (target.name === 'warehouseId' || target.name === 'itemId')
    && target.closest('[data-form="project-issue"]')) {
    updateProjectIssueAvailability();
    return;
  }
  if (target.id === 'customer-group-filter' || target.id === 'customer-status-filter') {
    filterCustomerRows();
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'masterClientId') {
    const option = target.selectedOptions[0];
    const name = option?.dataset.customerName ?? '';
    const clientName = target.form?.querySelector<HTMLInputElement>('[name="clientName"]');
    if (clientName) clientName.value = name;
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'invoiceId' && target.closest('[data-form="inventory-receipt"]')) {
    const lines = document.querySelector<HTMLTableSectionElement>('#receipt-lines');
    if (lines) lines.innerHTML = renderReceiptLines(null, purchaseInvoices, inventoryReceipts, Number(target.value));
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'itemId' && target.closest('[data-inventory-doc-line]')) {
    const row = target.closest<HTMLTableRowElement>('[data-inventory-doc-line]');
    const option = target.selectedOptions[0];
    const unit = row?.querySelector<HTMLElement>('.doc-unit');
    const warehouseId = Number(target.form?.querySelector<HTMLSelectElement>('[name="warehouseId"], [name="sourceWarehouseId"]')?.value ?? 0);
    const balance = inventoryBalances.find((entry) => entry.itemId === Number(target.value) && entry.warehouseId === warehouseId);
    if (unit) unit.textContent = option?.dataset.unitName ?? '—';
    const available = row?.querySelector<HTMLElement>('.doc-available');
    if (available) available.textContent = balance?.quantity ?? '0';
    return;
  }
  if (target instanceof HTMLSelectElement && ['warehouseId', 'sourceWarehouseId'].includes(target.name) && target.closest('.inventory-document-form')) {
    const warehouseId = Number(target.value);
    target.form?.querySelectorAll<HTMLTableRowElement>('[data-inventory-doc-line]').forEach((row) => {
      const itemId = Number(row.querySelector<HTMLSelectElement>('[name="itemId"]')?.value ?? 0);
      const balance = inventoryBalances.find((entry) => entry.itemId === itemId && entry.warehouseId === warehouseId);
      const available = row.querySelector<HTMLElement>('.doc-available');
      if (available) available.textContent = balance?.quantity ?? '0';
    });
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'invoiceId') {
    const invoiceId = target.value ? Number(target.value) : null;
    showSalesReturnEditor(invoiceId);
    updateSalesReturnTotal();
    return;
  }
  if (target instanceof HTMLInputElement && target.id === 'customers-import') {
    const file = target.files?.[0];
    if (!file) return;
    try {
      await importCustomers(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر استيراد ملف العملاء.');
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.id === 'supplier-import') {
    const file = target.files?.[0];
    if (!file) return;
    try {
      await importSuppliers(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'تعذر استيراد ملف الموردين.');
    }
    return;
  }
  if (target instanceof HTMLInputElement && ['purchase-invoice-from', 'purchase-invoice-to', 'purchase-return-from', 'purchase-return-to'].includes(target.id)) {
    if (target.id.startsWith('purchase-invoice')) filterPurchaseInvoices();
    else filterPurchaseReturns();
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === 'purchase-return-status') {
    filterPurchaseReturns();
    return;
  }
  if (target instanceof HTMLSelectElement && ['supplier-status-filter', 'purchase-invoice-supplier', 'purchase-invoice-status', 'purchase-invoice-category'].includes(target.id)) {
    if (target.id === 'supplier-status-filter') filterSuppliers();
    else {
      if (target.id === 'purchase-invoice-status') {
        const selected = target.value;
        purchaseInvoiceStatusFilter = selected === 'draft' || selected === 'approved' || selected === 'cancelled' ? selected : '';
      }
      filterPurchaseInvoices();
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'invoiceId' && target.form?.dataset.form === 'purchase-return') {
    showPurchaseReturnEditor(target.value ? Number(target.value) : null);
    return;
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === 'inventory-item-status') {
    filterInventoryRows('inventory-item-search', 'inventory-item-status', '[data-inventory-item-row]');
  } else if (target.id === 'inventory-unit-status') {
    filterInventoryRows('inventory-unit-search', 'inventory-unit-status', '[data-inventory-unit-row]');
  } else if (target.id === 'warehouse-status') {
    filterInventoryRows('warehouse-search', 'warehouse-status', '[data-warehouse-row]');
  } else if (target.name === 'itemId' && target.closest('[data-purchase-line]')) {
    const row = target.closest<HTMLTableRowElement>('[data-purchase-line]');
    const item = inventoryItems.find((entry) => entry.id === Number(target.value));
    if (row && item) {
      const code = row.querySelector<HTMLInputElement>('[name="itemCode"]');
      const description = row.querySelector<HTMLInputElement>('[name="description"]');
      const unit = row.querySelector<HTMLInputElement>('[name="unit"]');
      const unitId = row.querySelector<HTMLInputElement>('[name="unitId"]');
      const price = row.querySelector<HTMLInputElement>('[name="unitPrice"]');
      if (code) code.value = item.code;
      if (description) description.value = item.nameAr;
      if (unit) unit.value = item.baseUnitName;
      if (unitId) unitId.value = String(item.baseUnitId);
      if (price) price.value = item.purchasePrice;
      updatePurchaseInvoiceTotals();
    } else if (row) {
      const unitId = row.querySelector<HTMLInputElement>('[name="unitId"]');
      if (unitId) unitId.value = '';
    }
  }
});

applyGlobalErrorHandlers();

async function start(): Promise<void> {
  applyTheme(await window.elsaad.getTheme());
  if (await window.elsaad.isInitialSetupRequired()) {
    renderInitialSetup();
    return;
  }
  renderLogin();
  if (await window.elsaad.hasSession()) {
    authenticatedUser = await window.elsaad.getCurrentUser();
    const landingPage = await window.elsaad.getLandingPage();
    if (landingPage) await showPage(landingPage);
    else renderNoAccess();
  }
}

void start().catch((error: unknown) => {
  root.innerHTML = `<main class="fatal-error"><h1>تعذر تحميل التطبيق</h1><p>${escapeHtml(error instanceof Error ? error.message : 'خطأ غير متوقع.')}</p></main>`;
});
