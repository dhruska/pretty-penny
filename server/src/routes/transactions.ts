import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
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
  RECONCILED_CODE,
  type IdParams,
} from './schemas.js';

type Cleared = 'uncleared' | 'cleared';

export interface LineInput {
  categoryId: number | null;
  amountCents: number;
  memo?: string;
}

export interface TransactionBody {
  date: string;
  payee?: string;
  memo?: string;
  amountCents: number;
  categoryId?: number | null;
  lines?: LineInput[];
  transferAccountId?: number | null;
  cleared?: Cleared;
  /** Required to change a reconciled transaction in a way that affects the budget. */
  confirmReconciled?: boolean;
}

interface SearchQuery {
  q?: string;
  accountId?: number;
  categoryId?: string;
  from?: string;
  to?: string;
  cleared?: Cleared | 'reconciled';
}

interface AccountInfo {
  id: number;
  type: string;
  onBudget: boolean;
  closed: boolean;
}

interface LineRow {
  categoryId: number | null;
  categoryName: string | null;
  amountCents: number;
  memo: string;
}

const SEARCH_LIMIT = 500;
const MAX_SPLIT_LINES = 50;

const nullableId = { ...categoryId, type: ['integer', 'null'] };
const cleared = { type: 'string', enum: ['uncleared', 'cleared'] } as const;

export const fields = {
  date,
  payee,
  memo,
  amountCents,
  categoryId: nullableId,
  lines: {
    type: 'array',
    minItems: 2,
    maxItems: MAX_SPLIT_LINES,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['categoryId', 'amountCents'],
      properties: { categoryId: nullableId, amountCents, memo },
    },
  },
  transferAccountId: nullableId,
  cleared,
  confirmReconciled: { type: 'boolean' },
};

const RECONCILED_MESSAGE =
  'This transaction is reconciled. Confirm to change its amount, date, account or category.';

const pair = alias(transactions, 'pair');
const pairAccount = alias(accounts, 'pair_account');

// A transaction's lines belong either to it or, for a transfer between a budget and a tracking
// account, to the budget side of the pair. Gathering them in a subquery keeps one row per
// transaction, so running balances count each transaction once.
const ownLines = sql`(l.transaction_id = ${transactions.id} or l.transaction_id = ${transactions.transferTransactionId})`;

const linesColumn = sql<LineRow[]>`coalesce((
  select json_agg(json_build_object(
    'categoryId', l.category_id,
    'categoryName', c.name,
    'amountCents', l.amount_cents,
    'memo', l.memo
  ) order by l.id)
  from transaction_lines l
  left join categories c on c.id = l.category_id
  where ${ownLines}
), '[]'::json)`;

/** Whether any of a transaction's lines meets a condition on `l` (line) or `c` (category). */
const anyLine = (condition: SQL) =>
  sql`exists (
    select 1 from transaction_lines l
    left join categories c on c.id = l.category_id
    where ${ownLines} and ${condition}
  )`;

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
  lines: linesColumn,
};

const newestFirst = [
  desc(transactions.date),
  desc(transactions.createdAt),
  desc(transactions.id),
] as const;

/** Adds the single-category fields the client shows; a split's category is "Split". */
function withCategory<T extends { lines: LineRow[] }>(row: T) {
  const [first] = row.lines;
  const isSplit = row.lines.length > 1;
  return {
    ...row,
    hasCategoryLine: row.lines.length > 0,
    categoryId: isSplit ? null : (first?.categoryId ?? null),
    categoryName: isSplit ? 'Split' : (first?.categoryName ?? null),
  };
}

/** Lists transactions with their account, payee, transfer and category details. */
async function findTransactions(db: Executor, where: SQL | undefined, limit?: number) {
  const query = db
    .select(listColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
    .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
    .where(where)
    .orderBy(...newestFirst)
    .$dynamic();
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(withCategory);
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
 * Which side of a transaction holds its category lines. Only money entering or leaving the budget
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

async function assertCategoriesExist(tx: Executor, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (wanted.length === 0) return;
  const found = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.id, wanted));
  if (found.length !== wanted.length) throw new HttpError(400, 'Category not found');
}

/** Checks split lines against the transaction they belong to. */
function assertValidSplit(lines: LineInput[], amount: number, holder: 'self' | 'pair' | null) {
  if (holder !== 'self') {
    throw new HttpError(400, 'Only regular transactions in budget accounts can be split.');
  }
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (total !== amount) {
    throw new HttpError(400, 'The split lines must add up to the transaction amount.');
  }
}

/** Replaces the category lines for a transaction and its transfer pair. */
async function writeLines(
  tx: Executor,
  ids: { self: number; pair: number | null },
  holder: 'self' | 'pair' | null,
  lines: LineInput[],
) {
  const transactionIds = ids.pair === null ? [ids.self] : [ids.self, ids.pair];
  await tx.delete(transactionLines).where(inArray(transactionLines.transactionId, transactionIds));
  if (holder === null) return;

  await tx.insert(transactionLines).values(
    lines.map((line) => ({
      transactionId: holder === 'self' ? ids.self : ids.pair!,
      categoryId: line.categoryId,
      // The pair's amount is the opposite of this side's.
      amountCents: holder === 'self' ? line.amountCents : -line.amountCents,
      memo: line.memo?.trim() ?? '',
    })),
  );
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

function assertOneCategoryChoice(body: Partial<TransactionBody>) {
  if (body.lines !== undefined && body.categoryId !== undefined) {
    throw new HttpError(400, 'Send either a category or split lines, not both.');
  }
}

/**
 * Checks a new transaction's account, transfer, category and split lines. Shared by the API and
 * scheduled transactions, so both follow exactly the same rules.
 */
export async function prepareTransaction(tx: Executor, accountId: number, body: TransactionBody) {
  assertOneCategoryChoice(body);

  const account = await loadAccount(tx, accountId);
  if (!account) throw new HttpError(404, 'Account not found');
  if (account.closed) throw new HttpError(409, 'Reopen this account to add transactions.');

  const other = await resolveTransferAccount(tx, account, body.transferAccountId ?? null, null);
  const holder = lineHolder(account, other);

  let lines: LineInput[];
  if (body.lines) {
    assertValidSplit(body.lines, body.amountCents, holder);
    lines = body.lines;
  } else {
    const categoryIdValue = body.categoryId ?? null;
    if (categoryIdValue !== null && holder === null) {
      throw new HttpError(400, NO_CATEGORY_MESSAGE);
    }
    lines = [{ categoryId: categoryIdValue, amountCents: body.amountCents }];
  }
  await assertCategoriesExist(
    tx,
    lines.map((line) => line.categoryId),
  );

  return { account, other, holder, lines };
}

/** Creates a transaction, with its transfer pair and category lines, and returns its id. */
export async function createTransaction(
  tx: Executor,
  accountId: number,
  body: TransactionBody,
  scheduledTransactionId: number | null = null,
) {
  const { account, other, holder, lines } = await prepareTransaction(tx, accountId, body);

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
      scheduledTransactionId,
    })
    .returning({ id: transactions.id });

  const pairId = other
    ? await createPair(tx, row!.id, other, {
        date: body.date,
        memo: memoValue,
        amountCents: body.amountCents,
      })
    : null;
  await writeLines(tx, { self: row!.id, pair: pairId }, holder, lines);
  return row!.id;
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

      const rows = await db
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
        .where(eq(transactions.accountId, id))
        .orderBy(...newestFirst);
      return rows.map(withCategory);
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
            cleared: { type: 'string', enum: ['uncleared', 'cleared', 'reconciled'] },
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
            ilike(transactions.memo, pattern),
            ilike(accounts.name, pattern),
            ilike(pairAccount.name, pattern),
            anyLine(sql`(c.name ilike ${pattern} or l.memo ilike ${pattern})`),
          ),
        );
      }
      if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
      if (category === 'uncategorized') {
        conditions.push(anyLine(sql`l.category_id is null`));
      } else if (category !== undefined) {
        conditions.push(anyLine(sql`l.category_id = ${Number(category)}`));
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
      const created = await db.transaction(async (tx) => {
        const id = await createTransaction(tx, request.params.id, request.body);
        return findTransaction(tx, id);
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
      assertOneCategoryChoice(body);

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
              .select({
                id: transactions.id,
                accountId: transactions.accountId,
                cleared: transactions.cleared,
              })
              .from(transactions)
              .where(eq(transactions.id, current.transferTransactionId))
          : [];
        const currentOtherId = currentPair?.accountId ?? null;
        if (current.cleared === 'reconciled' && body.cleared !== undefined) {
          throw new HttpError(
            400,
            'A reconciled transaction can’t be marked cleared or uncleared.',
          );
        }
        const other = await resolveTransferAccount(
          tx,
          account,
          body.transferAccountId === undefined ? currentOtherId : body.transferAccountId,
          currentOtherId,
        );
        const holder = lineHolder(account, other);

        const currentLines = await tx
          .select({
            categoryId: transactionLines.categoryId,
            amountCents: transactionLines.amountCents,
            memo: transactionLines.memo,
          })
          .from(transactionLines)
          .where(inArray(transactionLines.transactionId, currentPair ? [id, currentPair.id] : [id]))
          .orderBy(transactionLines.id);
        const wasSplit = currentLines.length > 1;
        const amount = body.amountCents ?? current.amountCents;

        let lines: LineInput[];
        if (body.lines) {
          assertValidSplit(body.lines, amount, holder);
          lines = body.lines;
        } else if (body.categoryId !== undefined) {
          if (body.categoryId !== null && holder === null) {
            throw new HttpError(400, NO_CATEGORY_MESSAGE);
          }
          lines = [{ categoryId: body.categoryId, amountCents: amount }];
        } else if (wasSplit && holder === 'self') {
          if (amount !== current.amountCents) {
            throw new HttpError(
              400,
              'Update the split lines too, so they add up to the new amount.',
            );
          }
          lines = currentLines;
        } else {
          // A split that becomes a transfer keeps no categories, as only one line can remain.
          const keptCategory = wasSplit ? null : (currentLines[0]?.categoryId ?? null);
          lines = [{ categoryId: holder === null ? null : keptCategory, amountCents: amount }];
        }
        await assertCategoriesExist(
          tx,
          lines.map((line) => line.categoryId),
        );

        // As in YNAB, a reconciled transaction (or a reconciled transfer partner) can still be
        // changed in ways that affect the budget, but only once the change is confirmed.
        const isLocked = current.cleared === 'reconciled' || currentPair?.cleared === 'reconciled';
        if (isLocked && body.confirmReconciled !== true) {
          // Lines held by the pair are stored with the pair's amounts, and a transaction with no
          // holder, such as a transfer between budget accounts, stores no lines at all.
          const storedLines =
            holder === null
              ? []
              : holder === 'pair'
                ? lines.map((line) => ({ ...line, amountCents: -line.amountCents }))
                : lines;
          const sameLines =
            storedLines.length === currentLines.length &&
            storedLines.every(
              (line, index) =>
                line.categoryId === currentLines[index]!.categoryId &&
                line.amountCents === currentLines[index]!.amountCents,
            );
          const affectsBudget =
            amount !== current.amountCents ||
            (body.date ?? current.date) !== current.date ||
            (other?.id ?? null) !== currentOtherId ||
            !sameLines;
          if (affectsBudget) throw new HttpError(409, RECONCILED_MESSAGE, RECONCILED_CODE);
        }

        const values = {
          date: body.date ?? current.date,
          memo: body.memo?.trim() ?? current.memo,
          amountCents: amount,
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

        await writeLines(tx, { self: id, pair: pairId }, holder, lines);
        return findTransaction(tx, id);
      });
    },
  );

  app.delete<{ Params: IdParams; Querystring: { confirmReconciled?: boolean } }>(
    '/api/transactions/:id',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { confirmReconciled: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      if (request.query.confirmReconciled !== true) {
        const [locked] = await db
          .select({ id: transactions.id })
          .from(transactions)
          .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
          .where(
            and(
              eq(transactions.id, request.params.id),
              or(eq(transactions.cleared, 'reconciled'), eq(pair.cleared, 'reconciled')),
            ),
          );
        if (locked) throw new HttpError(409, RECONCILED_MESSAGE, RECONCILED_CODE);
      }

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
