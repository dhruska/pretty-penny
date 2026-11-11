export const BUDGET_ACCOUNT_TYPES = [
  'checking',
  'savings',
  'cash',
  'credit_card',
  'line_of_credit',
] as const;
export const TRACKING_ACCOUNT_TYPES = ['asset', 'liability'] as const;
export const ACCOUNT_TYPES = [...BUDGET_ACCOUNT_TYPES, ...TRACKING_ACCOUNT_TYPES];

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function isBudgetType(type: string): boolean {
  return (BUDGET_ACCOUNT_TYPES as readonly string[]).includes(type);
}
