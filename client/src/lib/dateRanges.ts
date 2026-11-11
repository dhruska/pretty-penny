import { today } from './dates';
import { monthRange, shiftMonth } from './months';

export type RangePreset =
  'thisMonth' | 'last3Months' | 'last6Months' | 'thisYear' | 'lastYear' | 'allTime' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'thisMonth', label: 'This month' },
  { value: 'last3Months', label: 'Last 3 months' },
  { value: 'last6Months', label: 'Last 6 months' },
  { value: 'thisYear', label: 'This year' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'allTime', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The dates a preset covers, as YYYY-MM-DD. "Last 3 months" means this month and the two before
 * it, through today. All time has no start, so the server begins at the first transaction.
 */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = today()) {
  const month = now.slice(0, 7);
  const year = Number(now.slice(0, 4));
  switch (preset) {
    case 'thisMonth':
      return { from: `${month}-01`, to: now };
    case 'last3Months':
      return { from: `${shiftMonth(month, -2)}-01`, to: now };
    case 'last6Months':
      return { from: `${shiftMonth(month, -5)}-01`, to: now };
    case 'thisYear':
      return { from: `${year}-01-01`, to: now };
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: monthRange(`${year - 1}-12`).to };
    case 'allTime':
      return { from: undefined, to: now };
  }
}

/** Builds report query parameters, leaving out anything unset. */
export function rangeParams(
  range: { from?: string; to?: string },
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...range, ...extra })) {
    if (value) params.set(key, value);
  }
  return params;
}
