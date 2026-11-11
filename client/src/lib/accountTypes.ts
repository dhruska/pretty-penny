export const ACCOUNT_TYPE_GROUPS = [
  {
    label: 'Budget',
    onBudget: true,
    types: [
      { value: 'checking', label: 'Checking' },
      { value: 'savings', label: 'Savings' },
      { value: 'cash', label: 'Cash' },
      { value: 'credit_card', label: 'Credit Card' },
      { value: 'line_of_credit', label: 'Line of Credit' },
    ],
  },
  {
    label: 'Tracking',
    onBudget: false,
    types: [
      { value: 'asset', label: 'Asset (investments, house, car)' },
      { value: 'liability', label: 'Liability (mortgage, loan)' },
    ],
  },
];

export function accountTypeLabel(type: string): string {
  const match = ACCOUNT_TYPE_GROUPS.flatMap((group) => group.types).find(
    (option) => option.value === type,
  );
  return match?.label.replace(/ \(.*\)$/, '') ?? type;
}
