import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { isDatabaseEmpty, runImport } from './ynab/importer.js';
import { planImport } from './ynab/mapping.js';
import { sampleYnabPlan } from './ynab/sample-plan.js';
import type { YnabPlan } from './ynab/types.js';

/** The month the sample plan's figures describe; the demo moves it to the current month. */
const SAMPLE_MONTH = '2026-11';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Moves a date (or a timestamp starting with one) by whole months, keeping the day where it
 * can: January 31 moved a month becomes February's last day. A month's last day stays the last
 * day, so schedules anchored to month end, such as rent on the 31st, keep their pattern.
 */
export function shiftDate(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const index = year! * 12 + (month! - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = index - newYear * 12 + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const wasLastDay = day === new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const newDay = wasLastDay ? lastDay : Math.min(day!, lastDay);
  return `${newYear}-${pad(newMonth)}-${pad(newDay)}${date.slice(10)}`;
}

/** Whole months from one YYYY-MM month to another. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
}

/** The made-up sample plan, moved so its latest activity falls in the given month. */
export function demoPlan(currentMonth: string): YnabPlan {
  const plan = sampleYnabPlan();
  const shift = monthsBetween(SAMPLE_MONTH, currentMonth);
  plan.name = 'Demo budget';
  for (const account of plan.accounts) {
    if (account.last_reconciled_at) {
      account.last_reconciled_at = shiftDate(account.last_reconciled_at, shift);
    }
  }
  for (const month of plan.months) month.month = shiftDate(month.month, shift);
  for (const transaction of plan.transactions) {
    transaction.date = shiftDate(transaction.date, shift);
  }
  for (const scheduled of plan.scheduled_transactions) {
    scheduled.date_first = shiftDate(scheduled.date_first, shift);
    scheduled.date_next = shiftDate(scheduled.date_next, shift);
  }
  return plan;
}

/**
 * Fills an empty database with the made-up demo budget, through the same importer YNAB plans
 * use. Returns what was added, or null if the database already has data, which is left alone.
 */
export async function addDemoData(db: Db, currentMonth: string) {
  const plan = planImport(demoPlan(currentMonth));
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table accounts in exclusive mode`);
    if (!(await isDatabaseEmpty(tx))) return null;
    await runImport(tx, plan);
    return plan.preview.counts;
  });
}
