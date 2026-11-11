import { and, asc, eq, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Executor } from './db/client.js';
import { accounts, payees, scheduledTransactions } from './db/schema.js';
import { createTransaction, type TransactionBody } from './routes/transactions.js';
import { occurrence, type Frequency } from './schedule.js';

/** Stops a single run from posting without end, such as a daily schedule left for decades. */
const MAX_OCCURRENCES_PER_RUN = 1000;

type Schedule = typeof scheduledTransactions.$inferSelect;

/** The transaction a schedule's next occurrence becomes. */
export async function occurrenceBody(tx: Executor, schedule: Schedule): Promise<TransactionBody> {
  const [payee] = schedule.payeeId
    ? await tx.select({ name: payees.name }).from(payees).where(eq(payees.id, schedule.payeeId))
    : [];
  return {
    date: schedule.nextDate,
    payee: payee?.name ?? '',
    memo: schedule.memo,
    amountCents: schedule.amountCents,
    transferAccountId: schedule.transferAccountId,
    ...(schedule.lines
      ? { lines: schedule.lines.map((line) => ({ ...line, memo: line.memo ?? '' })) }
      : { categoryId: schedule.categoryId }),
  };
}

/** Moves a schedule to its next occurrence, or removes it if there isn't one. */
export async function advanceSchedule(tx: Executor, schedule: Schedule): Promise<Schedule | null> {
  const nextIndex = schedule.nextIndex + 1;
  const nextDate = occurrence(schedule.firstDate, schedule.frequency as Frequency, nextIndex);
  if (nextDate === null) {
    await tx.delete(scheduledTransactions).where(eq(scheduledTransactions.id, schedule.id));
    return null;
  }

  const [updated] = await tx
    .update(scheduledTransactions)
    .set({ nextIndex, nextDate })
    .where(eq(scheduledTransactions.id, schedule.id))
    .returning();
  return updated!;
}

/** Posts a schedule's next occurrence as a real transaction and advances the schedule. */
export async function postNextOccurrence(tx: Executor, schedule: Schedule) {
  await createTransaction(tx, schedule.accountId, await occurrenceBody(tx, schedule), schedule.id);
  return advanceSchedule(tx, schedule);
}

/**
 * Each category's scheduled money still to come in a month: occurrences from each schedule's next
 * date through the end of the month. Negative for outflows. Only money entering or leaving the
 * budget counts, using the same rule as transactions for which side holds the category.
 */
export async function upcomingByCategory(db: Executor, month: string) {
  const transferAccount = alias(accounts, 'transfer_account');
  const schedules = await db
    .select({
      schedule: scheduledTransactions,
      onBudget: accounts.onBudget,
      transferOnBudget: transferAccount.onBudget,
    })
    .from(scheduledTransactions)
    .innerJoin(accounts, eq(accounts.id, scheduledTransactions.accountId))
    .leftJoin(transferAccount, eq(transferAccount.id, scheduledTransactions.transferAccountId));

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const upcoming = new Map<number, number>();

  for (const { schedule, onBudget, transferOnBudget } of schedules) {
    const isTransfer = schedule.transferAccountId !== null;
    // The budget side holds the category: this account, or the other side of a transfer.
    const sign = !isTransfer
      ? onBudget
        ? 1
        : 0
      : onBudget === transferOnBudget
        ? 0
        : onBudget
          ? 1
          : -1;
    if (sign === 0) continue;

    const lines = schedule.lines ?? [
      { categoryId: schedule.categoryId, amountCents: schedule.amountCents },
    ];
    for (let index = schedule.nextIndex; index < schedule.nextIndex + 400; index += 1) {
      const date = occurrence(schedule.firstDate, schedule.frequency as Frequency, index);
      if (date === null || date > monthEnd) break;
      if (date < monthStart) continue;
      for (const line of lines) {
        if (line.categoryId === null) continue;
        upcoming.set(
          line.categoryId,
          (upcoming.get(line.categoryId) ?? 0) + sign * line.amountCents,
        );
      }
    }
  }
  return upcoming;
}

export interface PostingResult {
  posted: number;
  failed: { scheduleId: number; message: string }[];
}

/**
 * Posts every occurrence that has come due by `today`, as YNAB does on the scheduled date.
 * Missed occurrences each post with their own date. A schedule that can't post, for example
 * because its account was closed, is left for later and reported instead of stopping the others.
 */
export async function postDueScheduled(
  db: Db,
  today: string,
  onlyScheduleId?: number,
): Promise<PostingResult> {
  const due = await db
    .select()
    .from(scheduledTransactions)
    .where(
      and(
        lte(scheduledTransactions.nextDate, today),
        onlyScheduleId === undefined ? undefined : eq(scheduledTransactions.id, onlyScheduleId),
      ),
    )
    .orderBy(asc(scheduledTransactions.nextDate), asc(scheduledTransactions.id));

  const result: PostingResult = { posted: 0, failed: [] };
  for (const schedule of due) {
    try {
      const posted = await db.transaction(async (tx) => {
        let current: Schedule | null = schedule;
        let count = 0;
        while (current && current.nextDate <= today && count < MAX_OCCURRENCES_PER_RUN) {
          current = await postNextOccurrence(tx, current);
          count += 1;
        }
        return count;
      });
      result.posted += posted;
    } catch (error) {
      result.failed.push({
        scheduleId: schedule.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
