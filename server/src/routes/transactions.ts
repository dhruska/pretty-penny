import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { accounts, categories, transactionLines, transactions } from '../db/schema.js';
import {
  amountCents,
  categoryId,
  date,
  HttpError,
  idParams,
  memo,
  payee,
  type IdParams,
} from './schemas.js';

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

interface TransactionBody {
  date: string;
  payee?: string;
  memo?: string;
  amountCents: number;
  categoryId?: number | null;
  transferAccountId?: number | null;
}

interface AccountInfo {
  id: number;
  onBudget: boolean;
  closed: boolean;
}

const nullableId = { ...categoryId, type: ['integer', 'null'] };

const fields = {
  date,
  payee,
  memo,
  amountCents,
  categoryId: nullableId,
  transferAccountId: nullableId,
};

const columns = {
  id: transactions.id,
  accountId: transactions.accountId,
  date: transactions.date,
  payee: transactions.payee,
  memo: transactions.memo,
  amountCents: transactions.amountCents,
};

const NO_CATEGORY_MESSAGE =
  'Tracking account transactions and transfers between budget accounts don’t use a category.';

async function loadAccount(tx: Executor, id: number): Promise<AccountInfo | undefined> {
  const [account] = await tx
    .select({
      id: accounts.id,
      onBudget: accounts.onBudget,
      closed: sql<boolean>`${accounts.closedAt} is not null`,
    })
    .from(accounts)
    .where(eq(accounts.id, id));
  return account;
}

/**
 * Which side of a transaction holds its category line. Only money entering or leaving the budget
 * is categorized: regular budget transactions, and the budget side of a budget-tracking transfer.
 */
function lineHolder(account: AccountInfo, other: AccountInfo | null): 'self' | 'pair' | null {
  if (!other) return account.onBudget ? 'self' : null;
  if (account.onBudget === other.onBudget) return null;
  return account.onBudget ? 'self' : 'pair';
}

async function resolveTransferAccount(
  tx: Executor,
  account: AccountInfo,
  transferAccountId: number | null,
  existingTransferAccountId: number | null,
) {
  if (transferAccountId === null) return null;
  if (transferAccountId === account.id) {
    throw new HttpError(400, 'A transfer needs two different accounts.');
  }

  const other = await loadAccount(tx, transferAccountId);
  if (!other) throw new HttpError(400, 'Transfer account not found');
  if (other.closed && other.id !== existingTransferAccountId) {
    throw new HttpError(400, 'Reopen that account before transferring to it.');
  }
  return other;
}

async function assertCategoryExists(tx: Executor, id: number | null) {
  if (id === null) return;
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id));
  if (!category) throw new HttpError(400, 'Category not found');
}

/** Replaces the category lines for a transaction and its transfer pair. */
async function writeLines(
  tx: Executor,
  ids: { self: number; pair: number | null },
  holder: 'self' | 'pair' | null,
  categoryIdValue: number | null,
  amount: number,
) {
  const transactionIds = ids.pair === null ? [ids.self] : [ids.self, ids.pair];
  await tx.delete(transactionLines).where(inArray(transactionLines.transactionId, transactionIds));
  if (holder === null) return;

  await tx.insert(transactionLines).values({
    transactionId: holder === 'self' ? ids.self : ids.pair!,
    categoryId: categoryIdValue,
    amountCents: holder === 'self' ? amount : -amount,
  });
}

async function createPair(
  tx: Executor,
  sourceId: number,
  otherAccountId: number,
  values: { date: string; memo: string; amountCents: number },
) {
  const [pair] = await tx
    .insert(transactions)
    .values({
      accountId: otherAccountId,
      date: values.date,
      payee: '',
      memo: values.memo,
      amountCents: -values.amountCents,
      transferTransactionId: sourceId,
    })
    .returning({ id: transactions.id });
  await tx
    .update(transactions)
    .set({ transferTransactionId: pair!.id })
    .where(eq(transactions.id, sourceId));
  return pair!.id;
}

async function selectTransaction(tx: Executor, id: number) {
  const [row] = await tx.select(columns).from(transactions).where(eq(transactions.id, id));
  return row!;
}

export function registerTransactionRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: IdParams }>(
    '/api/accounts/:id/transactions',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await loadAccount(db, id))) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      const pair = alias(transactions, 'pair');
      const pairAccount = alias(accounts, 'pair_account');

      // A transaction has at most one line until split transactions are added, held either by
      // the transaction itself or by the budget side of its transfer pair.
      return db
        .select({
          ...columns,
          transferAccountId: pair.accountId,
          transferAccountName: pairAccount.name,
          hasCategoryLine: sql<boolean>`${transactionLines.id} is not null`,
          categoryId: transactionLines.categoryId,
          categoryName: categories.name,
          runningBalanceCents: sql<number>`sum(${transactions.amountCents}) over (
            order by ${transactions.date}, ${transactions.createdAt}, ${transactions.id}
          )`.mapWith(Number),
        })
        .from(transactions)
        .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
        .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
        .leftJoin(
          transactionLines,
          or(
            eq(transactionLines.transactionId, transactions.id),
            eq(transactionLines.transactionId, transactions.transferTransactionId),
          ),
        )
        .leftJoin(categories, eq(transactionLines.categoryId, categories.id))
        .where(eq(transactions.accountId, id))
        .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id));
    },
  );

  app.post<{ Params: IdParams; Body: TransactionBody }>(
    '/api/accounts/:id/transactions',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'amountCents'],
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      const { body } = request;

      const created = await db.transaction(async (tx) => {
        const account = await loadAccount(tx, request.params.id);
        if (!account) throw new HttpError(404, 'Account not found');
        if (account.closed) throw new HttpError(409, 'Reopen this account to add transactions.');

        const other = await resolveTransferAccount(
          tx,
          account,
          body.transferAccountId ?? null,
          null,
        );
        const holder = lineHolder(account, other);
        const categoryIdValue = body.categoryId ?? null;
        if (categoryIdValue !== null && holder === null)
          throw new HttpError(400, NO_CATEGORY_MESSAGE);
        await assertCategoryExists(tx, categoryIdValue);

        const memoValue = body.memo?.trim() ?? '';
        const [row] = await tx
          .insert(transactions)
          .values({
            accountId: account.id,
            date: body.date,
            payee: other ? '' : (body.payee?.trim() ?? ''),
            memo: memoValue,
            amountCents: body.amountCents,
          })
          .returning({ id: transactions.id });

        const pairId = other
          ? await createPair(tx, row!.id, other.id, {
              date: body.date,
              memo: memoValue,
              amountCents: body.amountCents,
            })
          : null;
        await writeLines(
          tx,
          { self: row!.id, pair: pairId },
          holder,
          categoryIdValue,
          body.amountCents,
        );
        return selectTransaction(tx, row!.id);
      });

      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<TransactionBody> }>(
    '/api/transactions/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { body } = request;

      return db.transaction(async (tx) => {
        const [current] = await tx
          .select({ ...columns, transferTransactionId: transactions.transferTransactionId })
          .from(transactions)
          .where(eq(transactions.id, id));
        if (!current) throw new HttpError(404, 'Transaction not found');

        const account = (await loadAccount(tx, current.accountId))!;
        const [currentPair] = current.transferTransactionId
          ? await tx
              .select({ id: transactions.id, accountId: transactions.accountId })
              .from(transactions)
              .where(eq(transactions.id, current.transferTransactionId))
          : [];
        const currentOtherId = currentPair?.accountId ?? null;
        const other = await resolveTransferAccount(
          tx,
          account,
          body.transferAccountId === undefined ? currentOtherId : body.transferAccountId,
          currentOtherId,
        );

        const holder = lineHolder(account, other);
        if (body.categoryId != null && holder === null)
          throw new HttpError(400, NO_CATEGORY_MESSAGE);
        const [currentLine] = await tx
          .select({ categoryId: transactionLines.categoryId })
          .from(transactionLines)
          .where(inArray(transactionLines.transactionId, currentPair ? [id, currentPair.id] : [id]))
          .limit(1);
        const categoryIdValue =
          holder === null
            ? null
            : body.categoryId === undefined
              ? (currentLine?.categoryId ?? null)
              : body.categoryId;
        await assertCategoryExists(tx, categoryIdValue);

        const values = {
          date: body.date ?? current.date,
          memo: body.memo?.trim() ?? current.memo,
          amountCents: body.amountCents ?? current.amountCents,
          payee: other ? '' : (body.payee?.trim() ?? current.payee),
        };

        const keepPair = currentPair !== undefined && other?.id === currentPair.accountId;
        if (currentPair && !keepPair) {
          await tx
            .update(transactions)
            .set({ transferTransactionId: null })
            .where(eq(transactions.id, id));
          await tx.delete(transactions).where(eq(transactions.id, currentPair.id));
        }

        await tx.update(transactions).set(values).where(eq(transactions.id, id));

        let pairId: number | null = null;
        if (keepPair) {
          pairId = currentPair.id;
          await tx
            .update(transactions)
            .set({ date: values.date, amountCents: -values.amountCents })
            .where(eq(transactions.id, pairId));
        } else if (other) {
          pairId = await createPair(tx, id, other.id, values);
        }

        await writeLines(
          tx,
          { self: id, pair: pairId },
          holder,
          categoryIdValue,
          values.amountCents,
        );
        return selectTransaction(tx, id);
      });
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/transactions/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      // Deleting one side of a transfer cascades to the other side.
      const deleted = await db
        .delete(transactions)
        .where(eq(transactions.id, request.params.id))
        .returning({ id: transactions.id });
      if (deleted.length === 0) return reply.code(404).send({ message: 'Transaction not found' });

      return reply.code(204).send();
    },
  );
}
