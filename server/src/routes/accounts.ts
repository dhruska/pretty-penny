import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { isBudgetType, type AccountType } from '../account-types.js';
import type { Db, Executor } from '../db/client.js';
import {
  accounts,
  categories,
  READY_TO_ASSIGN_KEY,
  transactionLines,
  transactions,
} from '../db/schema.js';
import {
  accountName,
  accountType,
  BALANCE_ADJUSTMENT_PAYEE,
  date,
  idParams,
  RECONCILIATION_ADJUSTMENT_PAYEE,
  startingBalanceCents,
  STARTING_BALANCE_PAYEE,
  type IdParams,
} from './schemas.js';
import { resolvePayee } from './payees.js';

interface CreateAccountBody {
  name: string;
  type?: AccountType;
  startingBalanceCents: number;
  date: string;
}

interface UpdateAccountBody {
  name?: string;
  type?: AccountType;
}

const accountColumns = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  onBudget: accounts.onBudget,
  closed: sql<boolean>`${accounts.closedAt} is not null`,
  lastReconciledAt: accounts.lastReconciledAt,
};

/** Records a balance-changing transaction, categorized to Ready to Assign for budget accounts. */
async function addBalanceTransaction(
  tx: Executor,
  account: { id: number; onBudget: boolean },
  values: { date: string; payee: string; amountCents: number; isStartingBalance: boolean },
) {
  const { payee, ...rest } = values;
  const [created] = await tx
    .insert(transactions)
    .values({
      accountId: account.id,
      ...rest,
      payeeId: await resolvePayee(tx, payee),
      cleared: 'cleared',
    })
    .returning({ id: transactions.id });
  if (!account.onBudget) return;

  const [readyToAssign] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.systemKey, READY_TO_ASSIGN_KEY));
  await tx.insert(transactionLines).values({
    transactionId: created!.id,
    categoryId: readyToAssign!.id,
    amountCents: values.amountCents,
  });
}

export function registerAccountRoutes(app: FastifyInstance, db: Db) {
  async function findAccount(id: number) {
    const [account] = await db.select(accountColumns).from(accounts).where(eq(accounts.id, id));
    return account;
  }

  app.get('/api/accounts', async () => {
    return db
      .select({
        ...accountColumns,
        balanceCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(Number),
        clearedBalanceCents: sql<number>`coalesce(
          sum(${transactions.amountCents}) filter (where ${transactions.cleared} <> 'uncleared'),
          0
        )`.mapWith(Number),
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .groupBy(accounts.id)
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
  });

  app.post<{ Body: CreateAccountBody }>(
    '/api/accounts',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'startingBalanceCents', 'date'],
          properties: { name: accountName, type: accountType, startingBalanceCents, date },
        },
      },
    },
    async (request, reply) => {
      const { startingBalanceCents: balanceCents, date: startingDate } = request.body;
      const type = request.body.type ?? 'checking';

      const account = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(accounts)
          .values({ name: request.body.name.trim(), type, onBudget: isBudgetType(type) })
          .returning(accountColumns);
        if (balanceCents !== 0) {
          await addBalanceTransaction(tx, created!, {
            date: startingDate,
            payee: STARTING_BALANCE_PAYEE,
            amountCents: balanceCents,
            isStartingBalance: true,
          });
        }
        return created!;
      });

      return reply.code(201).send({ ...account, balanceCents });
    },
  );

  app.patch<{ Params: IdParams; Body: UpdateAccountBody }>(
    '/api/accounts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { name: accountName, type: accountType },
        },
      },
    },
    async (request, reply) => {
      const { name, type } = request.body;
      if (name === undefined && type === undefined) {
        return reply.code(400).send({ message: 'Nothing to update' });
      }

      const account = await findAccount(request.params.id);
      if (!account) return reply.code(404).send({ message: 'Account not found' });
      if (type !== undefined && isBudgetType(type) !== account.onBudget) {
        return reply.code(400).send({
          message: account.onBudget
            ? 'A budget account can only change to another budget account type.'
            : 'A tracking account can only change to another tracking account type.',
        });
      }

      const [updated] = await db
        .update(accounts)
        .set({ name: name?.trim(), type })
        .where(eq(accounts.id, account.id))
        .returning(accountColumns);
      return updated;
    },
  );

  app.post<{ Params: IdParams; Body: { date: string } }>(
    '/api/accounts/:id/close',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['date'],
          properties: { date },
        },
      },
    },
    async (request, reply) => {
      const account = await findAccount(request.params.id);
      if (!account) return reply.code(404).send({ message: 'Account not found' });
      if (account.closed)
        return reply.code(409).send({ message: 'This account is already closed.' });

      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            balanceCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(
              Number,
            ),
          })
          .from(transactions)
          .where(eq(transactions.accountId, account.id));
        const balanceCents = row?.balanceCents ?? 0;

        // As in YNAB, closing zeroes any remaining balance with an adjustment.
        if (balanceCents !== 0) {
          await addBalanceTransaction(tx, account, {
            date: request.body.date,
            payee: BALANCE_ADJUSTMENT_PAYEE,
            amountCents: -balanceCents,
            isStartingBalance: false,
          });
        }
        await tx.update(accounts).set({ closedAt: new Date() }).where(eq(accounts.id, account.id));
      });

      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams; Body: { bankBalanceCents: number; date: string } }>(
    '/api/accounts/:id/reconcile',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['bankBalanceCents', 'date'],
          properties: { bankBalanceCents: startingBalanceCents, date },
        },
      },
    },
    async (request, reply) => {
      const account = await findAccount(request.params.id);
      if (!account) return reply.code(404).send({ message: 'Account not found' });
      if (account.closed) {
        return reply.code(409).send({ message: 'Reopen this account before reconciling it.' });
      }

      const adjustmentCents = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            clearedCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(
              Number,
            ),
          })
          .from(transactions)
          .where(
            and(eq(transactions.accountId, account.id), ne(transactions.cleared, 'uncleared')),
          );
        const difference = request.body.bankBalanceCents - (row?.clearedCents ?? 0);

        // As in YNAB, any difference becomes an adjustment to the cleared balance.
        if (difference !== 0) {
          await addBalanceTransaction(tx, account, {
            date: request.body.date,
            payee: RECONCILIATION_ADJUSTMENT_PAYEE,
            amountCents: difference,
            isStartingBalance: false,
          });
        }
        await tx
          .update(transactions)
          .set({ cleared: 'reconciled' })
          .where(and(eq(transactions.accountId, account.id), eq(transactions.cleared, 'cleared')));
        await tx
          .update(accounts)
          .set({ lastReconciledAt: new Date() })
          .where(eq(accounts.id, account.id));
        return difference;
      });

      return { adjustmentCents };
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/accounts/:id/reopen',
    { schema: { params: idParams } },
    async (request, reply) => {
      const [updated] = await db
        .update(accounts)
        .set({ closedAt: null })
        .where(eq(accounts.id, request.params.id))
        .returning({ id: accounts.id });
      if (!updated) return reply.code(404).send({ message: 'Account not found' });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/accounts/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;

      const [recorded] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.accountId, id), eq(transactions.isStartingBalance, false)))
        .limit(1);
      if (recorded) {
        return reply
          .code(409)
          .send({ message: 'Delete this account’s transactions before deleting the account.' });
      }

      const deleted = await db
        .delete(accounts)
        .where(eq(accounts.id, id))
        .returning({ id: accounts.id });
      if (deleted.length === 0) return reply.code(404).send({ message: 'Account not found' });

      return reply.code(204).send();
    },
  );
}
