import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, notExists, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import {
  accounts,
  bankAccounts,
  bankTransactions,
  scheduledTransactions,
  transactionLines,
  transactions,
} from '../db/schema.js';
import { resolvePayee, usualCategory } from '../routes/payees.js';
import { createTransaction } from '../routes/transactions.js';
import { advanceSchedule, occurrenceBody } from '../scheduled.js';
import {
  addDays,
  daysBetween,
  defaultImportFrom,
  importAmountCents,
  importDate,
  importPayee,
  MATCH_WINDOW_DAYS,
  matchImports,
} from './matching.js';
import type { PlaidTransaction } from './plaid.js';

type BankAccount = typeof bankAccounts.$inferSelect;
type BankTransaction = typeof bankTransactions.$inferSelect;

/** What one sync brought: Plaid's added, changed and removed transactions. */
export interface SyncChanges {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  /** Whether this was Plaid's whole history, read from the start, rather than changes. */
  fullRead: boolean;
}

/** The state a stored bank transaction starts in, before importing. */
const initialState = (amountCents: number, pending: boolean) =>
  amountCents === 0 ? 'skipped' : pending ? 'pending' : 'waiting';

/** Whether an imported transaction still follows the bank: needing review, and not a match. */
async function followsBank(tx: Executor, row: BankTransaction) {
  if (row.state !== 'imported' || row.transactionId === null || row.matchedCleared !== null) {
    return null;
  }
  const [transaction] = await tx
    .select({ id: transactions.id, approved: transactions.approved, cleared: transactions.cleared })
    .from(transactions)
    .where(eq(transactions.id, row.transactionId));
  return transaction && !transaction.approved && transaction.cleared !== 'reconciled'
    ? transaction
    : null;
}

/** Deletes a transaction that only existed because of an import still needing review. */
async function dropImported(tx: Executor, transactionId: number) {
  await tx.delete(transactions).where(eq(transactions.id, transactionId));
}

/** Applies one changed bank transaction to its stored copy, and to its import if it still follows. */
async function applyChange(tx: Executor, row: BankTransaction, incoming: PlaidTransaction) {
  const values = {
    date: importDate(incoming),
    amountCents: importAmountCents(incoming),
    name: incoming.name,
    merchantName: incoming.merchant_name,
    pending: incoming.pending,
  };
  let state = row.state;
  if (state === 'pending' && !incoming.pending) state = initialState(values.amountCents, false);

  const following = await followsBank(tx, row);
  if (following) {
    if (values.amountCents === 0) {
      await dropImported(tx, following.id);
      state = 'skipped';
    } else {
      await tx
        .update(transactions)
        .set({
          date: values.date,
          amountCents: values.amountCents,
          payeeId: await resolvePayee(tx, importPayee(values)),
        })
        .where(eq(transactions.id, following.id));
      // An import needing review has one line, which follows its amount.
      await tx
        .update(transactionLines)
        .set({ amountCents: values.amountCents })
        .where(eq(transactionLines.transactionId, following.id));
    }
  }
  await tx
    .update(bankTransactions)
    .set({ ...values, state, ...(state === 'skipped' && { transactionId: null }) })
    .where(eq(bankTransactions.id, row.id));
}

/**
 * Applies a sync's changes to the stored bank transactions of a connection's linked accounts,
 * then imports what's ready. Returns the bank accounts whose transactions changed.
 */
export async function applySync(
  tx: Executor,
  connectionId: number,
  changes: SyncChanges,
  today: string,
) {
  const connectionAccounts = await tx
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.connectionId, connectionId));
  const byPlaidId = new Map(connectionAccounts.map((account) => [account.plaidAccountId, account]));
  const connectionAccountIds = connectionAccounts.map((account) => account.id);

  // Removed: a transaction still needing review goes with it; your work stays.
  if (changes.removed.length > 0) {
    const removed = await tx
      .select()
      .from(bankTransactions)
      .where(inArray(bankTransactions.plaidTransactionId, changes.removed));
    for (const row of removed) {
      const following = await followsBank(tx, row);
      if (following) await dropImported(tx, following.id);
      await tx.delete(bankTransactions).where(eq(bankTransactions.id, row.id));
    }
  }

  // Added and changed: Plaid's latest version of each, with changes after additions.
  const latest = new Map<string, PlaidTransaction>();
  for (const transaction of [...changes.added, ...changes.modified]) {
    latest.set(transaction.transaction_id, transaction);
  }
  const ids = [...latest.keys()];
  const stored = new Map<string, BankTransaction>();
  for (let start = 0; start < ids.length; start += 1000) {
    const rows = await tx
      .select()
      .from(bankTransactions)
      .where(inArray(bankTransactions.plaidTransactionId, ids.slice(start, start + 1000)));
    for (const row of rows) stored.set(row.plaidTransactionId, row);
  }

  for (const incoming of latest.values()) {
    const existing = stored.get(incoming.transaction_id);
    if (existing) {
      await applyChange(tx, existing, incoming);
      continue;
    }
    // Only linked accounts' transactions are kept.
    const bankAccount = byPlaidId.get(incoming.account_id);
    if (!bankAccount || bankAccount.accountId === null) continue;
    const amountCents = importAmountCents(incoming);
    await tx.insert(bankTransactions).values({
      bankAccountId: bankAccount.id,
      plaidTransactionId: incoming.transaction_id,
      date: importDate(incoming),
      amountCents,
      name: incoming.name,
      merchantName: incoming.merchant_name,
      pending: incoming.pending,
      state: initialState(amountCents, incoming.pending),
    });
  }

  // Reading the whole history again, anything pending or waiting that's no longer there was
  // dropped by the bank.
  if (changes.fullRead && connectionAccountIds.length > 0) {
    const stale = await tx
      .select({ id: bankTransactions.id, plaidId: bankTransactions.plaidTransactionId })
      .from(bankTransactions)
      .where(
        and(
          inArray(bankTransactions.bankAccountId, connectionAccountIds),
          inArray(bankTransactions.state, ['pending', 'waiting']),
        ),
      );
    const gone = stale.filter((row) => !latest.has(row.plaidId)).map((row) => row.id);
    if (gone.length > 0)
      await tx.delete(bankTransactions).where(inArray(bankTransactions.id, gone));
  }

  for (const bankAccount of connectionAccounts) {
    if (bankAccount.accountId !== null) await importWaiting(tx, bankAccount, today);
  }
}

/** Where importing into a linked account starts, for an account that has no start date yet. */
export async function suggestedImportFrom(tx: Executor, accountId: number, today: string) {
  const newest = async (condition: ReturnType<typeof eq>) => {
    const [row] = await tx
      .select({ date: transactions.date })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), condition))
      .orderBy(desc(transactions.date))
      .limit(1);
    return row?.date ?? null;
  };
  return defaultImportFrom(
    await newest(eq(transactions.cleared, 'reconciled')),
    await newest(and(eq(transactions.isStartingBalance, false), lte(transactions.date, today))!),
    today,
  );
}

/**
 * Imports a linked account's waiting bank transactions from its start date on: matching what
 * you entered or scheduled, and otherwise adding them as transactions needing review. With
 * `alsoBefore`, those bank transactions import even if they're before the start date.
 */
export async function importWaiting(
  tx: Executor,
  bankAccount: BankAccount,
  today: string,
  alsoBefore: number[] = [],
) {
  if (bankAccount.accountId === null) return;
  const [account] = await tx
    .select({ id: accounts.id, onBudget: accounts.onBudget, closedAt: accounts.closedAt })
    .from(accounts)
    .where(eq(accounts.id, bankAccount.accountId));
  // A closed account takes nothing new; its bank transactions wait until it's reopened.
  if (!account || account.closedAt) return;

  let importFrom = bankAccount.importFrom;
  if (importFrom === null) {
    importFrom = await suggestedImportFrom(tx, account.id, today);
    await tx.update(bankAccounts).set({ importFrom }).where(eq(bankAccounts.id, bankAccount.id));
  }

  const rows = await tx
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.bankAccountId, bankAccount.id),
        eq(bankTransactions.state, 'waiting'),
      ),
    )
    .orderBy(asc(bankTransactions.date), asc(bankTransactions.id));
  const ready = rows.filter((row) => row.date >= importFrom || alsoBefore.includes(row.id));
  if (ready.length === 0) return;

  const imported = (row: BankTransaction, transactionId: number, matchedCleared: string | null) =>
    tx
      .update(bankTransactions)
      .set({ state: 'imported', transactionId, matchedCleared, noMatch: false })
      .where(eq(bankTransactions.id, row.id));

  // Transactions you entered nearby, in this account, that no bank transaction came from.
  const dates = ready.map((row) => row.date).sort();
  const candidates = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      cleared: transactions.cleared,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, account.id),
        eq(transactions.isStartingBalance, false),
        gte(transactions.date, addDays(dates[0]!, -MATCH_WINDOW_DAYS)),
        lte(transactions.date, addDays(dates.at(-1)!, MATCH_WINDOW_DAYS)),
        notExists(
          tx
            .select({ id: bankTransactions.id })
            .from(bankTransactions)
            .where(eq(bankTransactions.transactionId, transactions.id)),
        ),
      ),
    );
  const matchable = ready.filter((row) => !row.noMatch);
  const matches = matchImports(matchable, candidates);
  const clearedById = new Map(candidates.map((candidate) => [candidate.id, candidate.cleared]));

  const schedules = await tx
    .select()
    .from(scheduledTransactions)
    .where(eq(scheduledTransactions.accountId, account.id));
  const usedSchedules = new Set<number>();

  for (const row of ready) {
    const matchId = matches.get(row.id);
    if (matchId !== undefined) {
      // As in YNAB, a match keeps what you entered, and becomes cleared.
      const previous = clearedById.get(matchId)!;
      await tx
        .update(transactions)
        .set({ cleared: previous === 'uncleared' ? 'cleared' : previous, approved: true })
        .where(eq(transactions.id, matchId));
      await imported(row, matchId, previous);
      continue;
    }

    if (!row.noMatch) {
      const schedule = closestSchedule(row, schedules, usedSchedules);
      if (schedule) {
        // A savepoint, so a schedule that can't post, such as one whose category was deleted,
        // leaves the import to arrive as usual.
        const posted = await tx
          .transaction(async (savepoint) => {
            const body = { ...(await occurrenceBody(savepoint, schedule)), date: row.date };
            const id = await createTransaction(savepoint, account.id, body, {
              scheduledTransactionId: schedule.id,
              cleared: 'cleared',
            });
            await advanceSchedule(savepoint, schedule);
            return id;
          })
          .catch(() => null);
        if (posted !== null) {
          usedSchedules.add(schedule.id);
          await imported(row, posted, 'uncleared');
          continue;
        }
      }
    }

    const payee = importPayee(row);
    const id = await createTransaction(
      tx,
      account.id,
      {
        date: row.date,
        payee,
        amountCents: row.amountCents,
        // A payee you've used before gets its usual category, as in YNAB.
        categoryId: account.onBudget ? await usualCategory(tx, payee) : null,
      },
      { cleared: 'cleared', approved: false },
    );
    await imported(row, id, null);
  }
}

/** The schedule whose next occurrence an import matches: same amount, within 10 days, closest. */
function closestSchedule(
  row: BankTransaction,
  schedules: (typeof scheduledTransactions.$inferSelect)[],
  used: Set<number>,
) {
  let best: (typeof schedules)[number] | null = null;
  let bestDistance = Infinity;
  for (const schedule of schedules) {
    if (used.has(schedule.id) || schedule.amountCents !== row.amountCents) continue;
    const distance = Math.abs(daysBetween(row.date, schedule.nextDate));
    if (distance <= MATCH_WINDOW_DAYS && distance < bestDistance) {
      best = schedule;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Marks the bank transactions that deleted transactions came from as rejected, so the bank
 * never brings them back. Undo links them again.
 */
export async function rejectImports(tx: Executor, transactionIds: number[]) {
  await tx
    .update(bankTransactions)
    .set({ state: 'rejected', transactionId: null })
    .where(inArray(bankTransactions.transactionId, transactionIds));
}

/**
 * Lets the bank transactions of transactions about to be deleted import again, such as the old
 * side of a transfer that moved to another account. Returns their bank accounts.
 */
export async function releaseImports(tx: Executor, transactionIds: number[]) {
  const released = await tx
    .update(bankTransactions)
    .set({ state: 'waiting', transactionId: null, matchedCleared: null })
    .where(inArray(bankTransactions.transactionId, transactionIds))
    .returning({ bankAccountId: bankTransactions.bankAccountId, id: bankTransactions.id });
  return released;
}

/** Imports released bank transactions again, whatever their dates. */
export async function reimport(
  tx: Executor,
  released: { bankAccountId: number; id: number }[],
  today: string,
) {
  const accountIds = [...new Set(released.map((row) => row.bankAccountId))];
  for (const bankAccountId of accountIds) {
    const [bankAccount] = await tx
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId));
    if (bankAccount) {
      await importWaiting(
        tx,
        bankAccount,
        today,
        released.filter((row) => row.bankAccountId === bankAccountId).map((row) => row.id),
      );
    }
  }
}

/**
 * When an import is approved as a transfer to another linked account, the other account's
 * matching import needing review becomes the transfer's other side, rather than a duplicate.
 */
export async function absorbOtherSide(tx: Executor, pairId: number) {
  const [side] = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(eq(transactions.id, pairId));
  if (!side) return;

  const candidates = await tx
    .select({
      bankId: bankTransactions.id,
      transactionId: sql<number>`${transactions.id}`,
      date: transactions.date,
    })
    .from(bankTransactions)
    .innerJoin(transactions, eq(transactions.id, bankTransactions.transactionId))
    .where(
      and(
        eq(transactions.accountId, side.accountId),
        eq(transactions.approved, false),
        eq(transactions.amountCents, side.amountCents),
        ne(transactions.id, side.id),
        isNotNull(bankTransactions.transactionId),
        eq(bankTransactions.state, 'imported'),
        sql`${bankTransactions.matchedCleared} is null`,
        sql`${transactions.transferTransactionId} is null`,
      ),
    );
  const closest = candidates
    .filter((candidate) => Math.abs(daysBetween(candidate.date, side.date)) <= MATCH_WINDOW_DAYS)
    .sort(
      (a, b) =>
        Math.abs(daysBetween(a.date, side.date)) - Math.abs(daysBetween(b.date, side.date)) ||
        a.transactionId - b.transactionId,
    )[0];
  if (!closest) return;

  await dropImported(tx, closest.transactionId);
  await tx
    .update(bankTransactions)
    .set({ state: 'imported', transactionId: side.id, matchedCleared: 'uncleared' })
    .where(eq(bankTransactions.id, closest.bankId));
  await tx.update(transactions).set({ cleared: 'cleared' }).where(eq(transactions.id, side.id));
}
