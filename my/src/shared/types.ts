import type { ReportLibrary, ReportResult, ReportRunFilters } from './reports.js';

export type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'treasury'
  | 'projects'
  | 'contractors'
  | 'brokerage'
  | 'customer-vouchers'
  | 'supplier-vouchers'
  | 'expenses'
  | 'accounts'
  | 'assets'
  | 'hr'
  | 'reports'
  | 'installment-reports'
  | 'settings'
  | 'users'
  | 'permission-groups'
  | 'user-permissions';

export type DashboardView = 'dashboard-new' | 'dashboard-2';
export type ThemeMode = 'light' | 'dark';

export interface GeneralSettings {
  theme: ThemeMode;
  invoicePrefix: string;
}

export type PermissionOperation = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';
export interface PermissionDefinition { key: string; module: ModuleKey; moduleLabel: string; operation: PermissionOperation; label: string }
export interface PermissionGroup { id: number; name: string; description: string; active: boolean; permissions: string[] }
export interface ManagedUser {
  id: number; username: string; fullName: string; email: string; phone: string; groupId: number | null;
  groupName: string; active: boolean; systemAdmin: boolean; lastLoginAt: string; notes: string;
}
export interface UserPermissionState {
  user: ManagedUser;
  inherited: string[];
  overrides: Record<string, boolean>;
  effective: string[];
}
export interface UserInput {
  id?: number; username: string; fullName: string; email: string; phone: string; groupId: number | null;
  active: boolean; systemAdmin: boolean; password?: string; notes: string;
}
export interface PermissionGroupInput { id?: number; name: string; description: string; active: boolean; permissions: string[] }
export interface UserPermissionInput { userId: number; overrides: Record<string, boolean> }
export interface DataResetResult { backupFileName: string; deletedRows: Record<string, number> }
export type SalesDocumentType = 'estimate' | 'work-order' | 'certificate' | 'invoice';
export type SalesDocumentStatus = 'draft' | 'approved' | 'cancelled';
export type SalesView = SalesDocumentType | 'customers' | 'customer-groups' | 'returns' | 'sales-dashboard';
export type PurchaseView = 'purchase-dashboard' | 'purchase-invoices' | 'purchase-returns' | 'suppliers' | 'supplier-groups';
export type InventoryView = 'inventory-items' | 'inventory-units' | 'warehouses' | 'goods-receipts' | 'stock-issues' | 'stock-transfers';
export type ProjectView = 'project-list' | 'project-material-issues' | 'work-items' | 'properties' | 'projects'
  | 'property-units' | 'property-contracts' | 'property-payments';
export type ProjectStatus = 'new' | 'in-progress' | 'on-hold' | 'completed' | 'cancelled';
export type ContractorView = 'contractor-list' | 'contractor-contracts' | 'contractor-certificates' | 'contractor-vouchers';
export type AccountingView = 'chart-of-accounts' | 'cost-centers' | 'daily-journals' | 'budgets' | 'financial-periods';

export interface AccountingPeriodClosure {
  id: number;
  from: string;
  to: string;
  closedByUserId: number;
  closedAt: string;
}
export type AssetView = 'asset-groups' | 'asset-codes' | 'depreciation';
export type ContractorStatus = 'active' | 'inactive';
export type ContractorContractStatus = 'draft' | 'approved' | 'cancelled';
export type ContractorDocumentStatus = 'draft' | 'approved' | 'cancelled';
export type ContractorPaymentMethod = 'cash' | 'bank';
export type PurchaseStatus = 'draft' | 'approved' | 'cancelled';
export type SupplierStatus = 'active' | 'inactive';
export type InventoryStatus = 'active' | 'inactive';
export type FinancialVoucherParty = 'customer' | 'supplier';
export type FinancialVoucherStatus = 'draft' | 'posted';
export type FinancialPaymentMethod = 'cash' | 'bank';
export type ExpenseSettlementStatus = 'unpaid' | 'partial' | 'paid';

export interface FinancialVoucherInput {
  id?: number;
  partyKind: FinancialVoucherParty;
  date: string;
  partyId: number;
  amount: string;
  paymentMethod: FinancialPaymentMethod;
  cashBoxId: number | null;
  bankAccountId: number | null;
  costCenterId: number | null;
  projectId: number | null;
  reference: string;
  notes: string;
}

export interface FinancialVoucher extends FinancialVoucherInput {
  id: number;
  number: string;
  partyCode: string;
  partyName: string;
  partyAccountId: number;
  payoutAccountName: string;
  payoutCurrency: string;
  status: FinancialVoucherStatus;
  journalEntryId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseAllocationInput {
  id?: number;
  expenseAccountId: number;
  projectId: number | null;
  costCenterId: number | null;
  amount: string;
  notes: string;
}

export interface ExpenseInput {
  id?: number;
  date: string;
  operationType: string;
  description: string;
  paymentMethod: FinancialPaymentMethod;
  cashBoxId: number | null;
  bankAccountId: number | null;
  payableAccountId: number | null;
  costCenterId: number | null;
  projectId: number | null;
  paidAmount: string;
  totalAmount: string;
  allocations: ExpenseAllocationInput[];
  notes: string;
}

export interface Expense extends ExpenseInput {
  id: number;
  number: string;
  currency: string;
  total: string;
  remaining: string;
  settlementStatus: ExpenseSettlementStatus;
  status: FinancialVoucherStatus;
  journalEntryId: number | null;
  createdAt: string;
  updatedAt: string;
  allocations: Array<ExpenseAllocationInput & { id: number; expenseAccountName: string; costCenterName: string; projectName: string }>;
}

export interface InventoryUnitInput {
  id?: number;
  code: string;
  nameAr: string;
  abbreviation: string;
  status: InventoryStatus;
}

export interface InventoryUnit extends InventoryUnitInput {
  id: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseInput {
  id?: number;
  code: string;
  name: string;
  accountId: number | null;
  status: InventoryStatus;
}

export interface Warehouse extends WarehouseInput {
  id: number;
  accountCode: string;
  accountName: string;
  openingItemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryOpeningBalance {
  warehouseId: number;
  warehouseName: string;
  quantity: string;
  unitCost: string;
}

export interface InventoryItemInput {
  id?: number;
  code: string;
  nameAr: string;
  nameEn: string;
  barcode: string;
  baseUnitId: number;
  purchasePrice: string;
  salesPrice: string;
  taxRate: string;
  status: InventoryStatus;
  sellable: boolean;
  purchasable: boolean;
  inventoryAccountId: number | null;
  purchaseAccountId: number | null;
  salesAccountId: number | null;
  cogsAccountId: number | null;
  expenseAccountId: number | null;
  openingWarehouseId: number | null;
  openingQuantity: string;
  openingUnitCost: string;
}

export interface InventoryItem extends Omit<InventoryItemInput, 'openingWarehouseId' | 'openingQuantity' | 'openingUnitCost'> {
  id: number;
  baseUnitCode: string;
  baseUnitName: string;
  baseUnitStatus: InventoryStatus;
  inventoryAccountCode: string;
  inventoryAccountName: string;
  purchaseAccountCode: string;
  purchaseAccountName: string;
  salesAccountCode: string;
  salesAccountName: string;
  cogsAccountCode: string;
  cogsAccountName: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  openingBalances: InventoryOpeningBalance[];
  createdAt: string;
  updatedAt: string;
}

export type InventoryDocumentStatus = 'draft' | 'approved' | 'cancelled';

export interface InventoryStockBalance {
  itemId: number;
  itemCode: string;
  itemName: string;
  unitId: number;
  unitName: string;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
}

export interface InventoryReceiptLineInput {
  invoiceLineId: number;
  quantity: string;
}

export interface InventoryReceiptLine extends InventoryReceiptLineInput {
  id: number;
  itemId: number;
  unitId: number;
  itemCode: string;
  description: string;
  unit: string;
  orderedQuantity: string;
  previouslyReceived: string;
  remainingQuantity: string;
  unitCost: string;
}

export interface InventoryReceiptInput {
  id?: number;
  invoiceId: number;
  warehouseId: number;
  date: string;
  notes: string;
  lines: InventoryReceiptLineInput[];
}

export interface InventoryReceipt extends InventoryReceiptInput {
  id: number;
  number: string;
  invoiceNumber: string;
  supplierName: string;
  warehouseName: string;
  status: InventoryDocumentStatus;
  createdAt: string;
  approvedAt: string;
  cancelledAt: string;
  lines: InventoryReceiptLine[];
}

export interface InventoryMovementLineInput {
  itemId: number;
  unitId: number;
  quantity: string;
  unitCost: string;
  workItemId?: number | null;
}

export interface InventoryDocumentLine extends InventoryMovementLineInput {
  id: number;
  itemCode: string;
  itemName: string;
  unitName: string;
  workItemCode: string;
  workItemName: string;
  availableQuantity: string;
  totalCost: string;
}

export interface InventoryIssueInput {
  id?: number;
  warehouseId: number;
  date: string;
  reason: string;
  notes: string;
  projectId?: number | null;
  salesInvoiceId?: number | null;
  costCenter?: string;
  lines: InventoryMovementLineInput[];
}

export interface InventoryIssue extends InventoryIssueInput {
  id: number;
  number: string;
  warehouseName: string;
  status: InventoryDocumentStatus;
  createdAt: string;
  approvedAt: string;
  cancelledAt: string;
  totalQuantity: string;
  totalCost: string;
  issueType: 'internal' | 'project';
  projectCode: string;
  projectName: string;
  salesInvoiceNumber: string;
  costCenter: string;
  lines: InventoryDocumentLine[];
}

export interface ProjectInput {
  id?: number;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  costCenter: string;
  status: ProjectStatus;
}

export interface Project extends ProjectInput {
  id: number;
  durationDays: number | null;
  workItemCount: number;
  issueCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkItemInput {
  id?: number;
  projectId: number;
  code: string;
  name: string;
  parentId: number | null;
  description: string;
  status: 'active' | 'inactive';
}

export interface ProjectWorkItem extends ProjectWorkItemInput {
  id: number;
  projectName: string;
  parentCode: string;
  parentName: string;
  childCount: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractorOpeningEntryInput {
  date: string;
  debit: string;
  credit: string;
  status: 'active' | 'inactive';
}

export interface ContractorOpeningEntry extends ContractorOpeningEntryInput {
  id: number;
  baseEquivalent: string;
}

export interface ContractorInput {
  id?: number;
  code: string;
  name: string;
  phone: string;
  specialty: string;
  country: string;
  governorate: string;
  address: string;
  status: ContractorStatus;
  openingEntries: ContractorOpeningEntryInput[];
}

export interface Contractor extends Omit<ContractorInput, 'openingEntries'> {
  id: number;
  totalDebit: string;
  totalCredit: string;
  netBalance: string;
  openingEntries: ContractorOpeningEntry[];
  contractCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractorContractLineInput {
  id?: number;
  code: string;
  name: string;
  itemType: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

export interface ContractorContractLine extends ContractorContractLineInput {
  id: number;
  total: string;
}

export interface ContractorContractInput {
  id?: number;
  date: string;
  contractorId: number;
  projectId: number | null;
  notes: string;
  lines: ContractorContractLineInput[];
}

export interface ContractorContract extends ContractorContractInput {
  id: number;
  number: string;
  contractorName: string;
  contractorCode: string;
  projectName: string;
  status: ContractorContractStatus;
  total: string;
  lines: ContractorContractLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractorCertificateLineInput {
  id?: number;
  code: string;
  name: string;
  unit: string;
  previousQuantity: string;
  currentQuantity: string;
  contractQuantity: string;
  completionRate: string;
  unitPrice: string;
  discount: string;
}

export interface ContractorCertificateLine extends ContractorCertificateLineInput {
  id: number;
  total: string;
}

export interface ContractorCertificateInput {
  id?: number;
  date: string;
  contractorId: number;
  projectId: number | null;
  contractId: number | null;
  costCenter: string;
  notes: string;
  lines: ContractorCertificateLineInput[];
}

export interface ContractorCertificate extends ContractorCertificateInput {
  id: number;
  number: string;
  contractorName: string;
  contractorCode: string;
  projectName: string;
  contractNumber: string;
  status: ContractorDocumentStatus;
  total: string;
  lines: ContractorCertificateLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractorVoucherInput {
  id?: number;
  date: string;
  contractorId: number;
  projectId: number | null;
  paymentMethod: ContractorPaymentMethod;
  cashBoxId: number | null;
  bankAccountId: number | null;
  costCenter: string;
  referenceNo: string;
  amount: string;
  notes: string;
}

export interface ContractorVoucher extends ContractorVoucherInput {
  id: number;
  number: string;
  contractorName: string;
  contractorCode: string;
  projectName: string;
  status: ContractorDocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export type PropertyUnitStatus = 'available' | 'reserved' | 'sold';
export type PropertyInstallmentFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'free' | 'down-payment';
export type BrokerCommissionTreatment = 'deduct' | 'cash' | 'bank';

export interface PropertyUnitInput {
  id?: number;
  projectId: number;
  code: string;
  name: string;
  floor: string;
  area: string;
  originalPrice: string;
  status: PropertyUnitStatus;
}

export interface PropertyUnit extends PropertyUnitInput {
  id: number;
  projectName: string;
  pricePerMeter: string;
  contractNumber: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyBrokerInput {
  id?: number;
  code: string;
  name: string;
  phone: string;
  commissionRate: string;
  status: 'active' | 'inactive';
}

export interface PropertyBroker extends PropertyBrokerInput {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyScheduleInput {
  frequency: Exclude<PropertyInstallmentFrequency, 'free' | 'down-payment'>;
  amount: string;
  count: number;
  firstDueDate: string;
  description: string;
  notes: string;
}

export interface PropertyFeeInput {
  description: string;
  amount: string;
}

export interface PropertyFreePaymentInput {
  amount: string;
  dueDate: string;
  description: string;
  notes: string;
}

export interface PropertyContractInput {
  id?: number;
  projectId: number;
  unitId: number;
  customerId: number;
  contractDate: string;
  downPaymentDueDate: string;
  originalPrice: string;
  discount: string;
  fees: string;
  feeItems: PropertyFeeInput[];
  downPayment: string;
  brokerId: number | null;
  brokerCommissionMode: 'rate' | 'fixed';
  brokerRate: string;
  brokerOnOriginalPrice: boolean;
  schedules: PropertyScheduleInput[];
  freePayments: PropertyFreePaymentInput[];
  notes: string;
}

export interface PropertyInstallment {
  id: number;
  contractId: number;
  frequency: PropertyInstallmentFrequency;
  sequence: number;
  dueDate: string;
  description: string;
  notes: string;
  amount: string;
  paid: string;
  adjusted: string;
  remaining: string;
  status: 'unpaid' | 'partial' | 'paid';
  timeStatus: 'upcoming' | 'due' | 'overdue';
}

export interface PropertyContract extends PropertyContractInput {
  id: number;
  number: string;
  projectName: string;
  unitCode: string;
  unitName: string;
  customerName: string;
  brokerName: string;
  contractValue: string;
  remainingToSchedule: string;
  brokerCommission: string;
  commissionTreatment: BrokerCommissionTreatment | null;
  commissionJournalId: number | null;
  status: 'draft' | 'approved' | 'cancelled';
  collected: string;
  outstanding: string;
  installments: PropertyInstallment[];
  receipts: PropertyReceiptSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface PropertyReceiptSummary {
  id: number;
  date: string;
  channel: 'cash' | 'bank';
  accountName: string;
  reference: string;
  notes: string;
  amount: string;
  journalEntryId: number;
}

export interface PropertyReceiptAllocationInput {
  installmentId: number;
  amount: string;
}

export interface PropertyReceiptInput {
  contractId: number;
  date: string;
  channel: 'cash' | 'bank';
  cashBoxId: number | null;
  bankAccountId: number | null;
  receivableAccountId: number;
  requestKey: string;
  reference: string;
  notes: string;
  allocations: PropertyReceiptAllocationInput[];
}

export interface InventoryTransferInput {
  id?: number;
  sourceWarehouseId: number;
  destinationWarehouseId: number;
  date: string;
  notes: string;
  lines: InventoryMovementLineInput[];
}

export interface InventoryTransfer extends InventoryTransferInput {
  id: number;
  number: string;
  sourceWarehouseName: string;
  destinationWarehouseName: string;
  status: InventoryDocumentStatus;
  createdAt: string;
  approvedAt: string;
  cancelledAt: string;
  totalQuantity: string;
  totalCost: string;
  lines: InventoryDocumentLine[];
}

export interface SupplierGroupInput {
  id?: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountId: number | null;
  status: SupplierStatus;
  notes: string;
}

export interface SupplierGroup extends SupplierGroupInput {
  id: number;
  supplierCount: number;
  accountCode: string;
  accountName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  id?: number;
  code: string;
  name: string;
  tradeName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  taxNumber: string;
  commercialRegister: string;
  groupId: number | null;
  accountId: number | null;
  notes: string;
  status: SupplierStatus;
}

export interface Supplier extends SupplierInput {
  id: number;
  accountCode: string;
  accountName: string;
  groupName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseInvoiceLineInput {
  id?: number;
  itemId?: number | null;
  unitId?: number | null;
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

export interface PurchaseInvoiceLine extends PurchaseInvoiceLineInput {
  id: number;
  itemId: number | null;
  unitId: number | null;
  amount: string;
  previouslyReturned: string;
  remainingQuantity: string;
}

export interface PurchaseInvoiceInput {
  id?: number;
  supplierId: number;
  invoiceDate: string;
  dueDate: string;
  supplierInvoiceNumber: string;
  paymentLink: 'unlinked' | 'cash' | 'bank';
  category: string;
  project: string;
  costCenter: string;
  notes: string;
  lines: PurchaseInvoiceLineInput[];
}

export interface PurchaseInvoice extends PurchaseInvoiceInput {
  id: number;
  number: string;
  status: PurchaseStatus;
  supplierName: string;
  supplierCode: string;
  supplierTaxNumber: string;
  total: string;
  paidAmount: string | null;
  dueAmount: string | null;
  paymentStatus: 'unavailable' | 'unpaid' | 'partial' | 'paid';
  createdAt: string;
  lines: PurchaseInvoiceLine[];
}

export interface PurchaseReturnLineInput {
  invoiceLineId: number;
  quantity: string;
}

export interface PurchaseReturn {
  id: number;
  number: string;
  invoiceId: number;
  invoiceNumber: string;
  supplierName: string;
  date: string;
  reason: string;
  notes: string;
  status: PurchaseStatus;
  total: string;
  createdAt: string;
  lines: Array<PurchaseReturnLineInput & {
    id: number;
    itemCode: string;
    description: string;
    unit: string;
    unitPrice: string;
    soldQuantity: string;
    previouslyReturned: string;
    remainingQuantity: string;
    amount: string;
  }>;
}

export interface PurchaseDashboardSummary {
  from: string;
  to: string;
  supplierId: number | null;
  status: 'all' | PurchaseStatus;
  category: string;
  invoiceCount: number;
  returnCount: number;
  grossPurchases: string;
  returnsTotal: string;
  netPurchases: string;
  paidAmount: string | null;
  dueAmount: string | null;
  monthly: Array<{ month: string; purchases: string; returns: string }>;
  statuses: Array<{ status: PurchaseStatus; count: number }>;
  topSuppliers: Array<{ supplierId: number; name: string; total: string }>;
  topItems: Array<{ code: string; name: string; total: string }>;
}

export type CustomerGroupStatus = 'active' | 'inactive';

export interface CustomerGroupInput {
  id?: number;
  code: string;
  nameAr: string;
  nameEn: string;
  status: CustomerGroupStatus;
  notes: string;
}

export interface CustomerGroup extends CustomerGroupInput {
  id: number;
  customerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  id?: number;
  code: string;
  name: string;
  tradeName: string;
  phone: string;
  email: string;
  groupId: number | null;
  accountId?: number | null;
  city: string;
  country: string;
  address: string;
  taxNumber: string;
  notes: string;
  status: 'active' | 'inactive';
}

export interface Customer extends CustomerInput {
  id: number;
  accountId: number | null;
  accountCode: string;
  accountName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesReturnLineInput {
  invoiceLineId: number;
  quantity: string;
}

export interface SalesReturnLine extends SalesReturnLineInput {
  id: number;
  description: string;
  unit: string;
  soldQuantity: string;
  previouslyReturned: string;
  remainingQuantity: string;
  unitPrice: string;
  amount: string;
}

export interface SalesReturn {
  id: number;
  number: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: number | null;
  customerName: string;
  date: string;
  reason: string;
  notes: string;
  status: 'draft' | 'approved' | 'cancelled';
  total: string;
  createdAt: string;
  lines: SalesReturnLine[];
}

export interface SalesDashboardSummary {
  from: string;
  to: string;
  customerId: number | null;
  status: 'all' | 'draft' | 'approved' | 'cancelled';
  customers: number;
  invoices: number;
  returns: number;
  grossSales: string;
  approvedReturns: string;
  netSales: string;
  monthly: Array<{ month: string; sales: string; returns: string }>;
  topCustomers: Array<{ customerId: number | null; name: string; total: string }>;
}

export interface SalesDocumentLineInput {
  id?: number;
  sourceDocumentLineId: number | null;
  sourceWorkOrderLineId: number | null;
  masterItemId: number | null;
  description: string;
  unit: string;
  quantity: string;
  currentQuantity: string;
  unitPrice: string;
}

export interface SalesDocumentLine extends SalesDocumentLineInput {
  id: number;
  amount: string;
  previousQuantity: string;
  cumulativeQuantity: string;
  completionPercent: string;
}

export interface SalesDocumentInput {
  id?: number;
  type: SalesDocumentType;
  sourceDocumentId: number | null;
  masterClientId: number | null;
  clientName: string;
  date: string;
  reference: string;
  notes: string;
  lines: SalesDocumentLineInput[];
}

export interface SalesDocument extends SalesDocumentInput {
  id: number;
  number: string;
  status: SalesDocumentStatus;
  sourceNumber: string;
  inventorySyncStatus: 'not-applicable' | 'pending-integration' | 'reversal-pending-integration';
  accountingSyncStatus: 'not-applicable' | 'pending-rules' | 'posted' | 'reversed';
  journalEntryId: number | null;
  reversalJournalEntryId: number | null;
  total: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string;
  cancelledAt: string;
  lines: SalesDocumentLine[];
}

export interface RecordInput {
  module: ModuleKey;
  title: string;
  reference: string;
  party: string;
  date: string;
  amount: string;
  status: string;
  notes: string;
}

export interface RecordItem extends RecordInput {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export type RecordStats = Record<ModuleKey, number>;

export interface DashboardMonth {
  month: string;
  salesRecords: number;
  purchaseRecords: number;
  expenseDebits: string;
  expenseCredits: string;
}

export interface DashboardSummary {
  salesParties: number;
  purchaseParties: number;
  salesRecords: number;
  purchaseRecords: number;
  expenseEntries: number;
  expenseBalance: string | null;
  comparison: {
    currentFrom: string;
    currentTo: string;
    previousFrom: string;
    previousTo: string;
    salesCurrent: number;
    salesPrevious: number;
    purchasesCurrent: number;
    purchasesPrevious: number;
    expensesCurrent: string | null;
    expensesPrevious: string | null;
  };
  monthly: DashboardMonth[];
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountInput {
  id?: number;
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  parentId: number | null;
  postable: boolean;
  notes: string;
}

export interface AccountItem extends AccountInput {
  id: number;
  createdAt: string;
}

export interface AssetGroupInput {
  id?: number;
  code: string;
  name: string;
  nameEn: string;
  assetAccountId: number;
  accumulatedDepreciationAccountId: number;
  depreciationExpenseAccountId: number;
  notes: string;
}

export interface AssetGroup extends AssetGroupInput {
  id: number;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetInput {
  id?: number;
  code: string;
  name: string;
  nameEn: string;
  groupId: number;
  purchaseDate: string;
  purchaseValue: string;
  salvageValue: string;
  usefulLifeYears: number;
  depreciationMethod: 'straight-line';
  assetAccountId: number;
  accumulatedDepreciationAccountId: number;
  depreciationExpenseAccountId: number;
  status: 'active' | 'inactive';
  notes: string;
}

export interface Asset extends AssetInput {
  id: number;
  groupCode: string;
  groupName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDepreciationLine {
  assetId: number;
  assetCode: string;
  assetName: string;
  groupId: number;
  groupCode: string;
  groupName: string;
  purchaseValue: string;
  salvageValue: string;
  amount: string;
  posted: boolean;
}

export interface AssetDepreciationRun {
  id: number;
  number: string;
  from: string;
  to: string;
  assetCount: number;
  total: string;
  journalEntryId: number;
  postedAt: string;
  lines: AssetDepreciationLine[];
}

export interface AssetDepreciationReport {
  from: string;
  to: string;
  lines: AssetDepreciationLine[];
  runs: AssetDepreciationRun[];
  total: string;
  postedTotal: string;
  dueCount: number;
}

export interface CostCenterInput {
  id?: number;
  code: string;
  name: string;
  nameEn: string;
  parentId: number | null;
  type: string;
  postable: boolean;
  notes: string;
}

export interface CostCenter extends CostCenterInput {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export type BudgetCategory = 'sales' | 'cash-purchases' | 'cash-expenses';

export interface BudgetLineInput {
  id?: number;
  accountId: number;
  costCenterId: number | null;
  category: BudgetCategory;
  amount: string;
  notes: string;
}

export interface BudgetInput {
  id?: number;
  from: string;
  to: string;
  costCenterId: number | null;
  notes: string;
  lines: BudgetLineInput[];
}

export interface Budget extends Omit<BudgetInput, 'lines'> {
  id: number;
  number: string;
  sales: string;
  cashPurchases: string;
  cashExpenses: string;
  net: string;
  lines: BudgetLineInput[];
  createdAt: string;
  updatedAt: string;
}

export type TreasuryStatus = 'active' | 'inactive';
export type TreasuryView = 'cash-boxes' | 'banks';

export interface PortfolioProject {
  id: number;
  name: string;
  date: string;
  reference: string;
  status: string;
}

export interface PortfolioDashboardMonth {
  month: string;
  approvedInvoices: number;
  approvedReturns: number;
  postedRevenueLines: number;
  postedExpenseLines: number;
}

export interface PortfolioDashboard {
  from: string;
  to: string;
  projectId: number | null;
  projects: PortfolioProject[];
  approvedInvoiceCount: number | null;
  approvedReturnCount: number | null;
  approvedWorkOrderCount: number | null;
  approvedInvoiceValue: null;
  brokerageCommissions: null;
  deliveredContracts: null;
  soldUnits: null;
  availableUnits: null;
  overdueInstallments: null;
  partiallyPaidInstallments: null;
  upcomingInstallments: null;
  collections: null;
  ledgerRevenue: null;
  ledgerCosts: null;
  operatingProfit: null;
  profitMargin: null;
  postedRevenueLineCount: number | null;
  postedExpenseLineCount: number | null;
  unpostedPurchaseInvoiceCount: number | null;
  monthly: PortfolioDashboardMonth[];
}

export interface PortfolioDashboardFilters {
  from: string;
  to: string;
  projectId: number | null;
}

export interface CashBoxInput {
  id?: number;
  code: string;
  name: string;
  accountId: number;
  currency: string;
  openingBalance: string;
  openingDate: string;
  status: TreasuryStatus;
}

export interface CashBox extends CashBoxInput {
  id: number;
  accountCode: string;
  accountName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountInput extends CashBoxInput {
  bankAccountNumber: string;
}

export interface BankAccount extends BankAccountInput {
  id: number;
  accountCode: string;
  accountName: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLineInput {
  accountId: number;
  description: string;
  debit: string;
  credit: string;
  costCenterId: number | null;
}

export interface JournalEntryInput {
  requestKey?: string;
  reference: string;
  date: string;
  description: string;
  lines: JournalLineInput[];
}

export interface JournalEntryItem {
  id: number;
  reference: string;
  date: string;
  description: string;
  lineCount: number;
  postedAt: string;
}

export interface JournalEntryDetail extends JournalEntryItem {
  lines: Array<JournalLineInput & { id: number; accountCode: string; accountName: string; costCenterCode: string; costCenterName: string }>;
  totalDebit: string;
  totalCredit: string;
  status: 'posted';
}

export interface CompanyProfile {
  nameAr: string;
  nameEn: string;
  addressAr: string;
  addressEn: string;
  email: string;
  phone: string;
  commercialRegister: string;
  taxNumber: string;
  logoDataUrl: string;
}

export interface BackupPreferences {
  directory: string;
  automatic: boolean;
  intervalHours: number;
  retentionCount: number;
}

export interface BackupRecord {
  fileName: string;
  date: string;
  size: number;
  kind: 'automatic' | 'manual' | 'pre-restore' | 'restore';
  status: 'success' | 'failed';
  message: string;
}

export interface BackupState {
  preferences: BackupPreferences;
  history: BackupRecord[];
}

export interface RestoreCandidate {
  fileName: string;
  size: number;
  createdAt: string;
}

export interface ElsaadApi {
  login(credentials: { username: string; password: string }): Promise<{ ok: boolean; message: string; requiresPasswordChange?: boolean }>;
  isInitialSetupRequired(): Promise<boolean>;
  initializeSystemAdmin(input: { password: string; confirmPassword: string }): Promise<{ ok: boolean; message: string }>;
  changeLegacyAdminPassword(input: { username: string; currentPassword: string; newPassword: string; confirmPassword: string }): Promise<boolean>;
  getCurrentUser(): Promise<ManagedUser>;
  getLandingPage(): Promise<ModuleKey | null>;
  hasSession(): Promise<boolean>;
  logout(): Promise<void>;
  listManagedUsers(search?: string): Promise<ManagedUser[]>;
  saveManagedUser(user: UserInput): Promise<ManagedUser>;
  setManagedUserActive(id: number, active: boolean): Promise<ManagedUser>;
  listPermissionDefinitions(): Promise<PermissionDefinition[]>;
  listPermissionGroups(search?: string): Promise<PermissionGroup[]>;
  savePermissionGroup(group: PermissionGroupInput): Promise<PermissionGroup>;
  getUserPermissionState(id: number): Promise<UserPermissionState>;
  saveUserPermissions(input: UserPermissionInput): Promise<UserPermissionState>;
  resetUserPermissions(id: number): Promise<UserPermissionState>;
  resetOperationalData(confirmation: string): Promise<DataResetResult>;
  listRecords(module: ModuleKey): Promise<RecordItem[]>;
  getRecordStats(): Promise<RecordStats>;
  getDashboardSummary(): Promise<DashboardSummary>;
  getPortfolioDashboard(filters: PortfolioDashboardFilters): Promise<PortfolioDashboard>;
  listContractors(search?: string): Promise<Contractor[]>;
  saveContractor(contractor: ContractorInput): Promise<Contractor>;
  setContractorStatus(id: number, status: ContractorStatus): Promise<Contractor>;
  listContractorContracts(search?: string): Promise<ContractorContract[]>;
  saveContractorContract(contract: ContractorContractInput, approve?: boolean): Promise<ContractorContract>;
  deleteContractorContract(id: number): Promise<boolean>;
  listContractorCertificates(search?: string): Promise<ContractorCertificate[]>;
  saveContractorCertificate(certificate: ContractorCertificateInput, approve?: boolean): Promise<ContractorCertificate>;
  deleteContractorCertificate(id: number): Promise<boolean>;
  listContractorVouchers(search?: string): Promise<ContractorVoucher[]>;
  saveContractorVoucher(voucher: ContractorVoucherInput, approve?: boolean): Promise<ContractorVoucher>;
  deleteContractorVoucher(id: number): Promise<boolean>;
  listProjects(): Promise<Project[]>;
  saveProject(project: ProjectInput): Promise<Project>;
  deleteProject(id: number): Promise<boolean>;
  listProjectWorkItems(projectId?: number): Promise<ProjectWorkItem[]>;
  saveProjectWorkItem(item: ProjectWorkItemInput): Promise<ProjectWorkItem>;
  setProjectWorkItemStatus(id: number, status: 'active' | 'inactive'): Promise<ProjectWorkItem>;
  listPropertyUnits(projectId?: number): Promise<PropertyUnit[]>;
  savePropertyUnit(unit: PropertyUnitInput): Promise<PropertyUnit>;
  listPropertyBrokers(search?: string): Promise<PropertyBroker[]>;
  savePropertyBroker(broker: PropertyBrokerInput): Promise<PropertyBroker>;
  deletePropertyBroker(id: number): Promise<boolean>;
  listPropertyContracts(): Promise<PropertyContract[]>;
  getPropertyContract(id: number): Promise<PropertyContract>;
  savePropertyContract(contract: PropertyContractInput): Promise<PropertyContract>;
  approvePropertyContract(value: { id: number; commissionTreatment: BrokerCommissionTreatment | null; payoutAccountId: number | null; expenseAccountId: number | null }): Promise<PropertyContract>;
  saveAndApprovePropertyContract(value: { contract: PropertyContractInput; commissionTreatment: BrokerCommissionTreatment | null; payoutAccountId: number | null; expenseAccountId: number | null }): Promise<PropertyContract>;
  listPropertyContractsForPayment(search: string): Promise<PropertyContract[]>;
  collectPropertyReceipt(receipt: PropertyReceiptInput): Promise<PropertyContract>;
  saveRecord(record: RecordInput & { id?: number }): Promise<RecordItem>;
  deleteRecord(id: number, module: ModuleKey): Promise<boolean>;
  listAccounts(): Promise<AccountItem[]>;
  listAssetGroups(search?: string): Promise<AssetGroup[]>;
  saveAssetGroup(group: AssetGroupInput): Promise<AssetGroup>;
  deleteAssetGroup(id: number): Promise<boolean>;
  listAssets(search?: string): Promise<Asset[]>;
  saveAsset(asset: AssetInput): Promise<Asset>;
  deleteAsset(id: number): Promise<boolean>;
  getAssetDepreciationReport(range: { from: string; to: string }): Promise<AssetDepreciationReport>;
  postAssetDepreciation(range: { from: string; to: string }): Promise<AssetDepreciationRun>;
  exportAssetDepreciationPdf(): Promise<boolean>;
  saveAccount(account: AccountInput & { id?: number }): Promise<AccountItem>;
  deleteAccount(id: number): Promise<boolean>;
  listFinancialVouchers(partyKind: FinancialVoucherParty, search?: string): Promise<FinancialVoucher[]>;
  saveFinancialVoucher(voucher: FinancialVoucherInput): Promise<FinancialVoucher>;
  approveFinancialVoucher(id: number, partyKind: FinancialVoucherParty): Promise<FinancialVoucher>;
  deleteFinancialVoucher(id: number, partyKind: FinancialVoucherParty): Promise<boolean>;
  listExpenses(search?: string): Promise<Expense[]>;
  saveExpense(expense: ExpenseInput): Promise<Expense>;
  approveExpense(id: number): Promise<Expense>;
  deleteExpense(id: number): Promise<boolean>;
  listCostCenters(search?: string): Promise<CostCenter[]>;
  saveCostCenter(center: CostCenterInput): Promise<CostCenter>;
  deleteCostCenter(id: number): Promise<boolean>;
  listBudgets(search?: string): Promise<Budget[]>;
  getBudget(id: number): Promise<Budget>;
  saveBudget(budget: BudgetInput): Promise<Budget>;
  deleteBudget(id: number): Promise<boolean>;
  listCashBoxes(): Promise<CashBox[]>;
  saveCashBox(cashBox: CashBoxInput): Promise<CashBox>;
  setCashBoxStatus(id: number, status: TreasuryStatus): Promise<CashBox>;
  listBankAccounts(): Promise<BankAccount[]>;
  saveBankAccount(bank: BankAccountInput): Promise<BankAccount>;
  setBankAccountStatus(id: number, status: TreasuryStatus): Promise<BankAccount>;
  listJournalEntries(search?: string): Promise<JournalEntryItem[]>;
  getJournalEntry(id: number): Promise<JournalEntryDetail>;
  postJournalEntry(entry: JournalEntryInput): Promise<JournalEntryDetail>;
  listAccountingPeriodClosures(): Promise<AccountingPeriodClosure[]>;
  closeAccountingPeriod(period: { from: string; to: string }): Promise<AccountingPeriodClosure>;
  getReportLibrary(): Promise<ReportLibrary>;
  runReport(key: string, filters: ReportRunFilters): Promise<ReportResult>;
  exportReportPdf(): Promise<boolean>;
  exportReportCsv(fileName: string, content: string): Promise<boolean>;
  getTheme(): Promise<ThemeMode>;
  setTheme(theme: ThemeMode): Promise<void>;
  getGeneralSettings(): Promise<GeneralSettings>;
  saveGeneralSettings(settings: GeneralSettings): Promise<void>;
  getCompanyProfile(): Promise<CompanyProfile>;
  saveCompanyProfile(profile: Omit<CompanyProfile, 'logoDataUrl'>): Promise<void>;
  uploadCompanyLogo(): Promise<CompanyProfile | null>;
  getBackupState(): Promise<BackupState>;
  setBackupPreferences(preferences: Omit<BackupPreferences, 'directory'>): Promise<BackupState>;
  chooseBackupDirectory(): Promise<BackupState | null>;
  createBackup(): Promise<BackupState>;
  openBackupDirectory(): Promise<void>;
  chooseRestoreBackup(): Promise<RestoreCandidate | null>;
  restoreBackup(): Promise<BackupState>;
  listSalesDocuments(type: SalesDocumentType): Promise<SalesDocument[]>;
  saveSalesDocument(document: SalesDocumentInput): Promise<SalesDocument>;
  createSalesDocumentFrom(sourceDocumentId: number, type: SalesDocumentType): Promise<SalesDocument>;
  approveSalesDocument(id: number): Promise<SalesDocument>;
  cancelSalesDocument(id: number): Promise<SalesDocument>;
  deleteSalesDocument(id: number): Promise<boolean>;
  listCustomerGroups(): Promise<CustomerGroup[]>;
  saveCustomerGroup(group: CustomerGroupInput): Promise<CustomerGroup>;
  deleteCustomerGroup(id: number): Promise<boolean>;
  listCustomers(): Promise<Customer[]>;
  saveCustomer(customer: CustomerInput): Promise<Customer>;
  setCustomerStatus(id: number, status: Customer['status']): Promise<Customer>;
  deleteCustomer(id: number): Promise<boolean>;
  listSalesReturns(): Promise<SalesReturn[]>;
  saveSalesReturn(value: { id?: number; invoiceId: number; date: string; reason: string; notes: string; lines: SalesReturnLineInput[] }): Promise<SalesReturn>;
  approveSalesReturn(id: number): Promise<SalesReturn>;
  cancelSalesReturn(id: number): Promise<SalesReturn>;
  deleteSalesReturn(id: number): Promise<boolean>;
  getSalesDashboard(filters: { from: string; to: string; customerId: number | null; status: SalesDashboardSummary['status'] }): Promise<SalesDashboardSummary>;
  listSupplierGroups(): Promise<SupplierGroup[]>;
  saveSupplierGroup(group: SupplierGroupInput): Promise<SupplierGroup>;
  setSupplierGroupStatus(id: number, status: SupplierStatus): Promise<SupplierGroup>;
  deleteSupplierGroup(id: number): Promise<boolean>;
  listSuppliers(): Promise<Supplier[]>;
  saveSupplier(supplier: SupplierInput): Promise<Supplier>;
  setSupplierStatus(id: number, status: SupplierStatus): Promise<Supplier>;
  deleteSupplier(id: number): Promise<boolean>;
  listPurchaseInvoices(): Promise<PurchaseInvoice[]>;
  savePurchaseInvoice(invoice: PurchaseInvoiceInput): Promise<PurchaseInvoice>;
  approvePurchaseInvoice(id: number): Promise<PurchaseInvoice>;
  cancelPurchaseInvoice(id: number): Promise<PurchaseInvoice>;
  deletePurchaseInvoice(id: number): Promise<boolean>;
  listPurchaseReturns(): Promise<PurchaseReturn[]>;
  savePurchaseReturn(value: { id?: number; invoiceId: number; date: string; reason: string; notes: string; lines: PurchaseReturnLineInput[] }): Promise<PurchaseReturn>;
  approvePurchaseReturn(id: number): Promise<PurchaseReturn>;
  deletePurchaseReturn(id: number): Promise<boolean>;
  getPurchaseDashboard(filters: { from: string; to: string; supplierId: number | null; status: 'all' | PurchaseStatus; category: string }): Promise<PurchaseDashboardSummary>;
  listInventoryItems(): Promise<InventoryItem[]>;
  saveInventoryItem(item: InventoryItemInput): Promise<InventoryItem>;
  setInventoryItemStatus(id: number, status: InventoryStatus): Promise<InventoryItem>;
  deleteInventoryItem(id: number): Promise<boolean>;
  listInventoryUnits(): Promise<InventoryUnit[]>;
  saveInventoryUnit(unit: InventoryUnitInput): Promise<InventoryUnit>;
  setInventoryUnitStatus(id: number, status: InventoryStatus): Promise<InventoryUnit>;
  deleteInventoryUnit(id: number): Promise<boolean>;
  listWarehouses(): Promise<Warehouse[]>;
  saveWarehouse(warehouse: WarehouseInput): Promise<Warehouse>;
  setWarehouseStatus(id: number, status: InventoryStatus): Promise<Warehouse>;
  deleteWarehouse(id: number): Promise<boolean>;
  listInventoryAccounts(): Promise<AccountItem[]>;
  listInventoryBalances(): Promise<InventoryStockBalance[]>;
  listInventoryReceipts(): Promise<InventoryReceipt[]>;
  saveInventoryReceipt(receipt: InventoryReceiptInput): Promise<InventoryReceipt>;
  approveInventoryReceipt(id: number): Promise<InventoryReceipt>;
  cancelInventoryReceipt(id: number): Promise<InventoryReceipt>;
  deleteInventoryReceipt(id: number): Promise<boolean>;
  listInventoryIssues(): Promise<InventoryIssue[]>;
  saveInventoryIssue(issue: InventoryIssueInput): Promise<InventoryIssue>;
  approveInventoryIssue(id: number): Promise<InventoryIssue>;
  cancelInventoryIssue(id: number): Promise<InventoryIssue>;
  deleteInventoryIssue(id: number): Promise<boolean>;
  listInventoryTransfers(): Promise<InventoryTransfer[]>;
  saveInventoryTransfer(transfer: InventoryTransferInput): Promise<InventoryTransfer>;
  approveInventoryTransfer(id: number): Promise<InventoryTransfer>;
  cancelInventoryTransfer(id: number): Promise<InventoryTransfer>;
  deleteInventoryTransfer(id: number): Promise<boolean>;
  getVersion(): Promise<string>;
}
