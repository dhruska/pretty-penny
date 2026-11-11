import type { Frequency } from '@/api';

/** YNAB's frequencies in the order YNAB lists them, with their labels. */
export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'never', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'everyOtherWeek', label: 'Every other week' },
  { value: 'twiceAMonth', label: 'Twice a month' },
  { value: 'every4Weeks', label: 'Every 4 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'everyOtherMonth', label: 'Every other month' },
  { value: 'every3Months', label: 'Every 3 months' },
  { value: 'every4Months', label: 'Every 4 months' },
  { value: 'twiceAYear', label: 'Twice a year' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'everyOtherYear', label: 'Every other year' },
];

export function frequencyLabel(frequency: Frequency): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency;
}
