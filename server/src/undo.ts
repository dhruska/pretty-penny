import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import type { Executor } from './db/client.js';
import {
  accounts,
  categories,
  payees,
  scheduledTransactions,
  transactionLines,
  transactions,
} from './db/schema.js';
import { HttpError } from './routes/schemas.js';

/** Everything a delete removed: a transaction, its transfer pair if any, and their lines. */
export interface DeletedSnapshot {
  transactions: (Omit<typeof transactions.$inferSelect, 'createdAt'> & { createdAt: string })[];
  lines: (typeof transactionLines.$inferSelect)[];
}

export interface SignedSnapshot {
  snapshot: DeletedSnapshot;
  signature: string;
}

// A new key each time the server starts: undo is for the next few seconds, not after a restart.
const KEY = randomBytes(32);
const sign = (snapshot: DeletedSnapshot) =>
  createHmac('sha256', KEY).update(JSON.stringify(snapshot)).digest('hex');

/** Records a transaction, and its transfer pair, before deleting it, signed so only this server's snapshots restore. */
export async function snapshotForDelete(tx: Executor, ids: number[]): Promise<SignedSnapshot> {
  const rows = await tx
    .select()
    .from(transactions)
    .where(inArray(transactions.id, ids))
    .orderBy(transactions.id);
  const lines = await tx
    .select()
    .from(transactionLines)
    .where(inArray(transactionLines.transactionId, ids))
    .orderBy(transactionLines.id);
  const snapshot: DeletedSnapshot = {
    transactions: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    lines,
  };
  return { snapshot, signature: sign(snapshot) };
}

/** Whether a snapshot is one this server signed, unchanged. */
export function isSigned({ snapshot, signature }: SignedSnapshot): boolean {
  const expected = Buffer.from(sign(snapshot), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const idsOf = (values: (number | null)[]) => [
  ...new Set(values.filter((value): value is number => value !== null)),
];

/**
 * Puts deleted transactions back exactly as they were: same IDs, order, transfer pairing, lines,
 * status and flag. Refuses with a message if something they need was deleted since.
 */
export async function restoreSnapshot(tx: Executor, snapshot: DeletedSnapshot) {
  const ids = snapshot.transactions.map((row) => row.id);
  const existing = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(inArray(transactions.id, ids));
  if (existing.length > 0) throw new HttpError(409, 'This transaction is already back.');

  const accountIds = idsOf(snapshot.transactions.map((row) => row.accountId));
  const liveAccounts = await tx
    .select({ id: accounts.id, closed: sql<boolean>`${accounts.closedAt} is not null` })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  if (liveAccounts.length !== accountIds.length) {
    throw new HttpError(409, 'Couldn’t undo: its account was deleted.');
  }
  if (liveAccounts.some((account) => account.closed)) {
    throw new HttpError(409, 'Couldn’t undo: its account is closed. Reopen it first.');
  }

  const categoryIds = idsOf(snapshot.lines.map((line) => line.categoryId));
  if (categoryIds.length > 0) {
    const found = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, categoryIds));
    if (found.length !== categoryIds.length) {
      throw new HttpError(409, 'Couldn’t undo: a category it used was deleted.');
    }
  }

  // A payee or schedule that's gone since just isn't linked.
  const payeeIds = idsOf(snapshot.transactions.map((row) => row.payeeId));
  const livePayees = new Set(
    payeeIds.length === 0
      ? []
      : (await tx.select({ id: payees.id }).from(payees).where(inArray(payees.id, payeeIds))).map(
          (row) => row.id,
        ),
  );
  const scheduleIds = idsOf(snapshot.transactions.map((row) => row.scheduledTransactionId));
  const liveSchedules = new Set(
    scheduleIds.length === 0
      ? []
      : (
          await tx
            .select({ id: scheduledTransactions.id })
            .from(scheduledTransactions)
            .where(inArray(scheduledTransactions.id, scheduleIds))
        ).map((row) => row.id),
  );

  // IDs are kept, so the restored rows sort and pair exactly as before. Transfer pairs point at
  // each other, so both go in first and are linked after.
  for (const row of snapshot.transactions) {
    await tx.execute(sql`insert into transactions
      (id, account_id, date, payee_id, cleared, memo, flag, amount_cents, is_starting_balance,
       scheduled_transaction_id, created_at)
      overriding system value values (
        ${row.id}, ${row.accountId}, ${row.date},
        ${row.payeeId !== null && livePayees.has(row.payeeId) ? row.payeeId : null},
        ${row.cleared}, ${row.memo}, ${row.flag}, ${row.amountCents}, ${row.isStartingBalance},
        ${row.scheduledTransactionId !== null && liveSchedules.has(row.scheduledTransactionId) ? row.scheduledTransactionId : null},
        ${row.createdAt}
      )`);
  }
  for (const row of snapshot.transactions) {
    if (row.transferTransactionId === null) continue;
    await tx.execute(
      sql`update transactions set transfer_transaction_id = ${row.transferTransactionId} where id = ${row.id}`,
    );
  }
  for (const line of snapshot.lines) {
    await tx.execute(sql`insert into transaction_lines (id, transaction_id, category_id, amount_cents, memo)
      overriding system value values (${line.id}, ${line.transactionId}, ${line.categoryId}, ${line.amountCents}, ${line.memo})`);
  }
}
