export type InstallmentFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface ContractAmountsInput {
  originalPrice: string;
  discount: string;
  fees: string;
  downPayment: string;
  brokerRate: string;
  brokerCommissionMode?: 'rate' | 'fixed';
  brokerOnOriginalPrice: boolean;
}

export interface ContractAmounts {
  originalPrice: string;
  discount: string;
  discountRate: string;
  fees: string;
  contractValue: string;
  downPayment: string;
  remaining: string;
  brokerCommission: string;
}

export interface InstallmentDraft {
  amount: string;
  dueDate: string;
  description: string;
  frequency: InstallmentFrequency | 'free';
  sequence: number;
}

export interface ScheduleAllocation {
  frequency: InstallmentFrequency;
  amount: string;
  count: number;
  firstDueDate: string;
}

const CENTS = 100n;
const FREQUENCY_MONTHS: Record<InstallmentFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export function toCents(value: string, label = 'المبلغ'): bigint {
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`${label} يجب أن يكون رقمًا غير سالب وبحد أقصى منزلتين عشريتين.`);
  return BigInt(match[1]) * CENTS + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}

export function fromCents(value: bigint): string {
  if (value < 0n) throw new Error('لا يمكن أن يكون المبلغ سالبًا.');
  return `${value / CENTS}.${(value % CENTS).toString().padStart(2, '0')}`;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function calculateContractAmounts(input: ContractAmountsInput): ContractAmounts {
  const original = toCents(input.originalPrice, 'سعر الوحدة');
  const discount = toCents(input.discount, 'الخصم');
  const fees = toCents(input.fees, 'الرسوم');
  const downPayment = toCents(input.downPayment, 'المقدم');
  if (original === 0n) throw new Error('سعر الوحدة الأصلي يجب أن يكون أكبر من صفر.');
  const commissionMode = input.brokerCommissionMode ?? 'rate';
  const rate = toCents(input.brokerRate, commissionMode === 'rate' ? 'نسبة عمولة السمسار' : 'قيمة عمولة السمسار');
  if (commissionMode === 'rate' && rate > 10000n) throw new Error('نسبة عمولة السمسار يجب أن تكون بين 0 و100.');
  if (discount > original) throw new Error('الخصم لا يمكن أن يتجاوز سعر الوحدة الأصلي.');
  const contractValue = original - discount + fees;
  if (downPayment > contractValue) throw new Error('المقدم لا يمكن أن يتجاوز القيمة النهائية للعقد.');
  const commissionBase = input.brokerOnOriginalPrice ? original : contractValue;
  const commission = commissionMode === 'fixed'
    ? rate
    : (commissionBase * rate) / 10000n;
  const discountRate = fromCents((discount * 10000n + original / 2n) / original);
  return {
    originalPrice: fromCents(original),
    discount: fromCents(discount),
    discountRate,
    fees: fromCents(fees),
    contractValue: fromCents(contractValue),
    downPayment: fromCents(downPayment),
    remaining: fromCents(contractValue - downPayment),
    brokerCommission: fromCents(commission),
  };
}

export function generateInstallments(allocation: ScheduleAllocation): InstallmentDraft[] {
  const amount = toCents(allocation.amount, 'المبلغ المخصص');
  if (!Number.isSafeInteger(allocation.count) || allocation.count < 1 || allocation.count > 1200) {
    throw new Error('عدد الأقساط يجب أن يكون بين 1 و1200.');
  }
  if (amount < BigInt(allocation.count)) throw new Error('المبلغ المخصص لا يكفي لإنتاج أقساط موجبة لكل العدد المحدد.');
  if (!validDate(allocation.firstDueDate)) throw new Error('تاريخ أول استحقاق غير صالح.');
  const firstDate = new Date(`${allocation.firstDueDate}T00:00:00.000Z`);
  const dayOfMonth = firstDate.getUTCDate();
  const interval = FREQUENCY_MONTHS[allocation.frequency];
  const regularAmount = amount / BigInt(allocation.count);
  let assigned = 0n;
  return Array.from({ length: allocation.count }, (_, index) => {
    const installmentAmount = index === allocation.count - 1 ? amount - assigned : regularAmount;
    assigned += installmentAmount;
    const monthIndex = firstDate.getUTCFullYear() * 12 + firstDate.getUTCMonth() + interval * index;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const dueDate = new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay)));
    return {
      amount: fromCents(installmentAmount),
      dueDate: dueDate.toISOString().slice(0, 10),
      description: `قسط ${index + 1}`,
      frequency: allocation.frequency,
      sequence: index + 1,
    };
  });
}

export function validateScheduleTotal(remaining: string, installments: InstallmentDraft[]): { allocated: string; undistributed: string } {
  const available = toCents(remaining, 'المبلغ المتبقي');
  const allocated = installments.reduce((total, installment) => total + toCents(installment.amount, 'قيمة الاستحقاق'), 0n);
  if (allocated > available) throw new Error(`إجمالي التخصيص يتجاوز المبلغ المتاح بمقدار ${fromCents(allocated - available)} جنيه.`);
  return { allocated: fromCents(allocated), undistributed: fromCents(available - allocated) };
}