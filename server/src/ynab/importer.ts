import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import {
  accounts,
  categories,
  categoryGroups,
  flagNames,
  monthlyAssignments,
  READY_TO_ASSIGN_KEY,
  scheduledTransactions,
} from '../db/schema.js';
import { resolvePayee } from '../routes/payees.js';
import { HttpError } from '../routes/schemas.js';
import {
  createTransaction,
  prepareTransaction,
  type TransactionBody,
} from '../routes/transactions.js';
import {
  READY_TO_ASSIGN,
  type CategoryRef,
  type ImportPlan,
  type PlannedLine,
  type SkippedSchedule,
} from './mapping.js';

const INSERT_CHUNK = 1000;

/** Whether the database holds nothing but the seeded Ready to Assign category. */
export async function isDatabaseEmpty(db: Executor) {
  const [row] = await db.execute<{ has_data: boolean }>(sql`select
    exists (select 1 from accounts)
    or exists (select 1 from payees)
    or exists (select 1 from scheduled_transactions)
    or exists (select 1 from monthly_assignments)
    or exists (select 1 from category_groups)
    or exists (select 1 from categories where system_key is null) as has_data`);
  return !row!.has_data;
}

export interface ImportResult {
  accountIds: Map<string, number>;
  categoryIds: Map<string, number>;
  skippedSchedules: SkippedSchedule[];
}

/**
 * Why a step failed, in words. A database error is wrapped in one that only shows the query, so
 * use the database's own message, such as a missing column, when there is one.
 */
export function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? error.cause.message : error.message;
}

/** Noon local time on a date, so the stored timestamp shows that date in any nearby time zone. */
const noonOn = (date: string) => new Date(`${date}T12:00:00`);

/**
 * Creates everything in an import plan. Runs inside the caller's database transaction, so a
 * failure part way leaves nothing behind.
 */
export async function runImport(tx: Executor, plan: ImportPlan): Promise<ImportResult> {
  const [readyToAssign] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.systemKey, READY_TO_ASSIGN_KEY));

  // Category groups and categories, in YNAB's order.
  const categoryIds = new Map<string, number>();
  for (const [groupIndex, group] of plan.groups.entries()) {
    const [createdGroup] = await tx
      .insert(categoryGroups)
      .values({ name: group.name, hidden: group.hidden, sortOrder: groupIndex })
      .returning({ id: categoryGroups.id });
    for (const [index, category] of group.categories.entries()) {
      const [created] = await tx
        .insert(categories)
        .values({
          groupId: createdGroup!.id,
          name: category.name,
          hidden: category.hidden,
          sortOrder: index,
        })
        .returning({ id: categories.id });
      categoryIds.set(category.ynabId, created!.id);
    }
  }
  const categoryId = (ref: CategoryRef) =>
    ref === null
      ? null
      : ref === READY_TO_ASSIGN
        ? readyToAssign!.id
        : (categoryIds.get(ref) ?? null);
  const lineInputs = (lines: PlannedLine[]) =>
    lines.map((line) => ({
      categoryId: categoryId(line.category),
      amountCents: line.amountCents,
      memo: line.memo,
    }));

  for (const { color, name } of plan.preview.notes.flagNames) {
    await tx
      .insert(flagNames)
      .values({ color, name })
      .onConflictDoUpdate({ target: flagNames.color, set: { name } });
  }

  // Accounts start open, so their transactions can be added, and closed at the end.
  const accountIds = new Map<string, number>();
  for (const account of plan.accounts) {
    const [created] = await tx
      .insert(accounts)
      .values({
        name: account.name,
        type: account.type,
        onBudget: account.onBudget,
        lastReconciledAt: account.lastReconciledAt ? new Date(account.lastReconciledAt) : null,
      })
      .returning({ id: accounts.id });
    accountIds.set(account.ynabId, created!.id);
  }

  const assignmentRows = plan.assignments.map((assignment) => ({
    categoryId: categoryIds.get(assignment.ynabCategoryId)!,
    month: assignment.month,
    assignedCents: assignment.cents,
  }));
  for (let start = 0; start < assignmentRows.length; start += INSERT_CHUNK) {
    await tx.insert(monthlyAssignments).values(assignmentRows.slice(start, start + INSERT_CHUNK));
  }

  const lastDate = new Map<string, string>();
  const noteDate = (accountYnabId: string, date: string) => {
    if ((lastDate.get(accountYnabId) ?? '') < date) lastDate.set(accountYnabId, date);
  };

  for (const planned of plan.transactions) {
    const body: TransactionBody = {
      date: planned.date,
      payee: planned.payee,
      memo: planned.memo,
      amountCents: planned.amountCents,
      flag: planned.flag,
      transferAccountId: planned.transfer ? accountIds.get(planned.transfer.accountYnabId)! : null,
      ...(planned.lines
        ? { lines: lineInputs(planned.lines) }
        : { categoryId: categoryId(planned.category) }),
    };
    try {
      await createTransaction(tx, accountIds.get(planned.accountYnabId)!, body, {
        cleared: planned.cleared,
        // Unapproved in YNAB means needing review here too.
        approved: planned.approved,
        isStartingBalance: planned.isStartingBalance,
        ...(planned.transfer && {
          pair: {
            cleared: planned.transfer.cleared,
            approved: planned.transfer.approved,
            memo: planned.transfer.memo,
            flag: planned.transfer.flag,
          },
        }),
      });
    } catch (error) {
      const account = plan.accounts.find((item) => item.ynabId === planned.accountYnabId)!;
      const reason = failureReason(error);
      throw new HttpError(
        422,
        `Couldn’t import the ${planned.date} transaction in ${account.name}: ${reason}`,
      );
    }
    noteDate(planned.accountYnabId, planned.date);
    if (planned.transfer) noteDate(planned.transfer.accountYnabId, planned.date);
  }

  for (const account of plan.accounts) {
    if (!account.closed) continue;
    // YNAB doesn't record when an account was closed, so use its last transaction's date.
    const date = lastDate.get(account.ynabId);
    await tx
      .update(accounts)
      .set({ closedAt: date ? noonOn(date) : new Date() })
      .where(eq(accounts.id, accountIds.get(account.ynabId)!));
  }

  // Schedules go through the same checks as new transactions; any that fail are reported.
  const skippedSchedules: SkippedSchedule[] = [];
  for (const schedule of plan.schedules) {
    const accountId = accountIds.get(schedule.accountYnabId)!;
    const body: TransactionBody = {
      date: schedule.nextDate,
      payee: schedule.payee,
      memo: schedule.memo,
      amountCents: schedule.amountCents,
      transferAccountId: schedule.transferAccountYnabId
        ? accountIds.get(schedule.transferAccountYnabId)!
        : null,
      ...(schedule.lines
        ? { lines: lineInputs(schedule.lines) }
        : { categoryId: categoryId(schedule.category) }),
    };
    try {
      await prepareTransaction(tx, accountId, body);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      skippedSchedules.push({
        payee: schedule.payee,
        accountName: plan.accounts.find((item) => item.ynabId === schedule.accountYnabId)!.name,
        nextDate: schedule.nextDate,
        reason: error.message,
      });
      continue;
    }
    await tx.insert(scheduledTransactions).values({
      accountId,
      frequency: schedule.frequency,
      firstDate: schedule.firstDate,
      nextIndex: schedule.nextIndex,
      nextDate: schedule.nextDate,
      payeeId: body.transferAccountId ? null : await resolvePayee(tx, schedule.payee),
      memo: schedule.memo.trim(),
      flag: schedule.flag,
      amountCents: schedule.amountCents,
      categoryId: body.lines ? null : (body.categoryId ?? null),
      lines: body.lines?.map((line) => ({ ...line, memo: line.memo?.trim() ?? '' })) ?? null,
      transferAccountId: body.transferAccountId ?? null,
    });
  }

  return { accountIds, categoryIds, skippedSchedules };
}
