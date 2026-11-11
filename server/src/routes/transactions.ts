import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Db, Executor } from '../db/client.js';
import { accounts, categories, payees, transactionLines, transactions } from '../db/schema.js';
import { resolvePayee } from './payees.js';
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

type Cleared = 'uncleared' | 'cleared';

interface TransactionBody {
  date: string;
  payee?: string;
  memo?: string;
  amountCents: number;
  categoryId?: number | null;
  transferAccountId?: number | null;
  cleared?: Cleared;
}

interface SearchQuery {
  q?: string;
  accountId?: number;
  categoryId?: string;
  from?: string;
  to?: string;
  cleared?: Cleared;
}

interface AccountInfo {
  id: number;
  type: string;
  onBudget: boolean;
  closed: boolean;
}

const SEARCH_LIMIT = 500;

const nullableId = { ...categoryId, type: ['integer', 'null'] };
const cleared = { type: 'string', enum: ['uncleared', 'cleared'] } as const;

const fields = {
  date,
  payee,
  memo,
  amountCents,
  categoryId: nullableId,
  transferAccountId: nullableId,
  cleared,
};

const pair = alias(transactions, 'pair');
const pairAccount = alias(accounts, 'pair_account');

// A transaction has at most one line until split transactions are added, held either by the
// transaction itself or by the budget side of its transfer pair.
const listColumns = {
  id: transactions.id,
  accountId: transactions.accountId,
  accountName: accounts.name,
  date: transactions.date,
  payee: sql<string>`coalesce(${payees.name}, '')`,
  memo: transactions.memo,
  amountCents: transactions.amountCents,
  cleared: transactions.cleared,
  transferAccountId: pair.accountId,
  transferAccountName: pairAccount.name,
  hasCategoryLine: sql<boolean>`${transactionLines.id} is not null`,
  categoryId: transactionLines.categoryId,
  categoryName: categories.name,
};

const lineJoin = or(
  eq(transactionLines.transactionId, transactions.id),
  eq(transactionLines.transactionId, transactions.transferTransactionId),
);

const newestFirst = [
  desc(transactions.date),
  desc(transactions.createdAt),
  desc(transactions.id),
] as const;

/** Lists transactions with their account, payee, transfer and category details. */
function findTransactions(db: Executor, where: SQL | undefined, limit?: number) {
  const query = db
    .select(listColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
    .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
    .leftJoin(transactionLines, lineJoin)
    .leftJoin(categories, eq(transactionLines.categoryId, categories.id))
    .where(where)
    .orderBy(...newestFirst)
    .$dynamic();
  return limit === undefined ? query : query.limit(limit);
}

async function findTransaction(db: Executor, id: number) {
  const [row] = await findTransactions(db, eq(transactions.id, id));
  return row!;
}

const NO_CATEGORY_MESSAGE =
  'Tracking account transactions and transfers between budget accounts don’t use a category.';

/** As in YNAB, transactions entered in cash accounts start out cleared. */
const defaultCleared = (account: AccountInfo): Cleared =>
  account.type === 'cash' ? 'cleared' : 'uncleared';

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

async function loadAccount(tx: Executor, id: number): Promise<AccountInfo | undefined> {
  const [account] = await tx
    .select({
      id: accounts.id,
      type: accounts.type,
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
  other: AccountInfo,
  values: { date: string; memo: string; amountCents: number },
) {
  const [created] = await tx
    .insert(transactions)
    .values({
      accountId: other.id,
      date: values.date,
      memo: values.memo,
      amountCents: -values.amountCents,
      cleared: defaultCleared(other),
      transferTransactionId: sourceId,
    })
    .returning({ id: transactions.id });
  await tx
    .update(transactions)
    .set({ transferTransactionId: created!.id })
    .where(eq(transactions.id, sourceId));
  return created!.id;
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

      return db
        .select({
          ...listColumns,
          runningBalanceCents: sql<number>`sum(${transactions.amountCents}) over (
            order by ${transactions.date}, ${transactions.createdAt}, ${transactions.id}
          )`.mapWith(Number),
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .leftJoin(payees, eq(payees.id, transactions.payeeId))
        .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
        .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
        .leftJoin(transactionLines, lineJoin)
        .leftJoin(categories, eq(transactionLines.categoryId, categories.id))
        .where(eq(transactions.accountId, id))
        .orderBy(...newestFirst);
    },
  );

  app.get<{ Querystring: SearchQuery }>(
    '/api/transactions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 200 },
            accountId: categoryId,
            categoryId: { type: 'string', pattern: '^([0-9]{1,10}|uncategorized)$' },
            from: date,
            to: date,
            cleared,
          },
        },
      },
    },
    async (request) => {
      const { q, accountId, categoryId: category, from, to, cleared: status } = request.query;
      const conditions: (SQL | undefined)[] = [];

      const text = q?.trim();
      if (text) {
        const pattern = `%${escapeLike(text)}%`;
        conditions.push(
          or(
            ilike(payees.name, pattern),
            ilike(categories.name, pattern),
            ilike(transactions.memo, pattern),
            ilike(accounts.name, pattern),
            ilike(pairAccount.name, pattern),
          ),
        );
      }
      if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
      if (category === 'uncategorized') {
        conditions.push(and(isNotNull(transactionLines.id), isNull(transactionLines.categoryId)));
      } else if (category !== undefined) {
        conditions.push(eq(transactionLines.categoryId, Number(category)));
      }
      if (from) conditions.push(gte(transactions.date, from));
      if (to) conditions.push(lte(transactions.date, to));
      if (status) conditions.push(eq(transactions.cleared, status));

      const rows = await findTransactions(db, and(...conditions), SEARCH_LIMIT + 1);
      return { transactions: rows.slice(0, SEARCH_LIMIT), hasMore: rows.length > SEARCH_LIMIT };
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
        if (categoryIdValue !== null && holder === null) {
          throw new HttpError(400, NO_CATEGORY_MESSAGE);
        }
        await assertCategoryExists(tx, categoryIdValue);

        const memoValue = body.memo?.trim() ?? '';
        const [row] = await tx
          .insert(transactions)
          .values({
            accountId: account.id,
            date: body.date,
            payeeId: other ? null : await resolvePayee(tx, body.payee),
            memo: memoValue,
            amountCents: body.amountCents,
            cleared: body.cleared ?? defaultCleared(account),
          })
          .returning({ id: transactions.id });

        const pairId = other
          ? await createPair(tx, row!.id, other, {
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
        return findTransaction(tx, row!.id);
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
          .select({
            accountId: transactions.accountId,
            date: transactions.date,
            memo: transactions.memo,
            amountCents: transactions.amountCents,
            payeeId: transactions.payeeId,
            cleared: transactions.cleared,
            transferTransactionId: transactions.transferTransactionId,
          })
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
        if (body.categoryId != null && holder === null) {
          throw new HttpError(400, NO_CATEGORY_MESSAGE);
        }
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
          cleared: body.cleared ?? current.cleared,
          payeeId: other
            ? null
            : body.payee === undefined
              ? current.payeeId
              : await resolvePayee(tx, body.payee),
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
          // The other side keeps its own cleared status, as in YNAB.
          pairId = currentPair.id;
          await tx
            .update(transactions)
            .set({ date: values.date, amountCents: -values.amountCents })
            .where(eq(transactions.id, pairId));
        } else if (other) {
          pairId = await createPair(tx, id, other, values);
        }

        await writeLines(
          tx,
          { self: id, pair: pairId },
          holder,
          categoryIdValue,
          values.amountCents,
        );
        return findTransaction(tx, id);
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
