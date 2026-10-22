import type { ModuleKey } from './types.js';

export const MODULES: ReadonlyArray<{ key: ModuleKey; label: string; description: string }> = [
  { key: 'dashboard', label: 'لوحة المؤشرات', description: 'نظرة عامة على السجلات الفعلية' },
  { key: 'sales', label: 'المبيعات', description: 'سجلات المبيعات' },
  { key: 'customer-vouchers', label: 'سندات العملاء', description: 'سندات قبض العملاء' },
  { key: 'purchases', label: 'المشتريات', description: 'سجلات المشتريات' },
  { key: 'supplier-vouchers', label: 'سندات الموردين', description: 'سندات سداد الموردين' },
  { key: 'expenses', label: 'إدارة المصروفات', description: 'المصروفات والتوزيعات' },
  { key: 'inventory', label: 'المخزون', description: 'سجلات الأصناف والحركة' },
  { key: 'treasury', label: 'الخزائن والبنوك', description: 'سجلات الخزائن والبنوك' },
  { key: 'projects', label: 'المشاريع', description: 'سجلات المشاريع' },
  { key: 'contractors', label: 'المقاولون', description: 'سجلات المقاولين' },
  { key: 'brokerage', label: 'السمسرة', description: 'سجلات السمسرة' },
  { key: 'accounts', label: 'الحسابات', description: 'سجلات الحسابات' },
  { key: 'assets', label: 'الأصول', description: 'سجلات الأصول' },
  { key: 'hr', label: 'الموارد البشرية', description: 'سجلات الموارد البشرية' },
  { key: 'reports', label: 'التقارير', description: 'سجلات التقارير' },
  { key: 'installment-reports', label: 'تقارير الأقساط', description: 'سجلات تقارير الأقساط' },
  { key: 'settings', label: 'الإعدادات', description: 'إعدادات التطبيق المحلي' },
  { key: 'users', label: 'المستخدمون', description: 'إدارة حسابات الدخول المحلية' },
  { key: 'permission-groups', label: 'مجموعات الصلاحيات', description: 'إدارة المجموعات التشغيلية' },
  { key: 'user-permissions', label: 'صلاحيات المستخدمين', description: 'تخصيص الصلاحيات الفعلية للمستخدمين' },
];

export const RECORD_STATUSES = [
  { value: 'new', label: 'جديد' },
  { value: 'in-progress', label: 'قيد المعالجة' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغي' },
] as const;

const moduleKeys = new Set<string>(MODULES.map(({ key }) => key));

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && moduleKeys.has(value);
}
