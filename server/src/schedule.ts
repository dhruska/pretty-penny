/** YNAB's scheduled transaction frequencies. `never` means the transaction happens once. */
export const FREQUENCIES = [
  'never',
  'daily',
  'weekly',
  'everyOtherWeek',
  'twiceAMonth',
  'every4Weeks',
  'monthly',
  'everyOtherMonth',
  'every3Months',
  'every4Months',
  'twiceAYear',
  'yearly',
  'everyOtherYear',
] as const;

export type Frequency = (typeof FREQUENCIES)[number];

const DAY_STEPS: Partial<Record<Frequency, number>> = {
  daily: 1,
  weekly: 7,
  everyOtherWeek: 14,
  every4Weeks: 28,
};

const MONTH_STEPS: Partial<Record<Frequency, number>> = {
  monthly: 1,
  everyOtherMonth: 2,
  every3Months: 3,
  every4Months: 4,
  twiceAYear: 6,
  yearly: 12,
  everyOtherYear: 24,
};

const TWICE_A_MONTH_GAP_DAYS = 15;

function parse(date: string) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)) - 1,
    day: Number(date.slice(8, 10)),
  };
}

function format(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const { year, month, day } = parse(date);
  return format(new Date(Date.UTC(year, month, day + days)));
}

/** Adds months, keeping the day of the month but clamping it to shorter months. */
function addMonths(date: string, months: number) {
  const { year, month, day } = parse(date);
  const lastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return format(new Date(Date.UTC(year, month + months, Math.min(day, lastDay))));
}

/**
 * The date of a schedule's occurrence number `index`, counting from 0 at the first date.
 *
 * Occurrences are counted from the first date rather than the previous occurrence, so a monthly
 * schedule starting on the 31st lands on the last day of shorter months and returns to the 31st.
 * Returns null when there is no such occurrence, as for a one-time schedule after its first.
 */
export function occurrence(firstDate: string, frequency: Frequency, index: number): string | null {
  if (index < 0) return null;
  if (frequency === 'never') return index === 0 ? firstDate : null;

  const daySteps = DAY_STEPS[frequency];
  if (daySteps !== undefined) return addDays(firstDate, daySteps * index);

  const monthSteps = MONTH_STEPS[frequency];
  if (monthSteps !== undefined) return addMonths(firstDate, monthSteps * index);

  // Twice a month: the first date's day, and 15 days after it, in every month.
  const monthDate = addMonths(firstDate, Math.floor(index / 2));
  return index % 2 === 0 ? monthDate : addDays(monthDate, TWICE_A_MONTH_GAP_DAYS);
}

/** Today's date in the server's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
