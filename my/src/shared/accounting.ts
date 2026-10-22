import type { AccountType } from './types.js';

export const ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: 'asset', label: 'أصول' },
  { value: 'liability', label: 'التزامات' },
  { value: 'equity', label: 'حقوق ملكية' },
  { value: 'revenue', label: 'إيرادات' },
  { value: 'expense', label: 'مصروفات' },
];

const AMOUNT_SCALE = 12n;
const SCALE_FACTOR = 10n ** AMOUNT_SCALE;

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && ACCOUNT_TYPES.some((type) => type.value === value);
}

export function parseAmount(value: string): bigint {
  const match = /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(value.trim());
  if (!match) throw new Error('أدخل مبلغًا موجبًا بدقة لا تتجاوز 12 منزلة عشرية.');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(Number(AMOUNT_SCALE), '0') || '0');
  return whole * SCALE_FACTOR + fraction;
}

export function formatAmount(units: bigint): string {
  const whole = units / SCALE_FACTOR;
  const fraction = (units % SCALE_FACTOR).toString().padStart(Number(AMOUNT_SCALE), '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function normalizeAmount(value: string): string {
  return formatAmount(parseAmount(value));
}
