import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { accounts, transactions } from '../db/schema.js';
import { amountCents, date, idParams, memo, payee, type IdParams } from './schemas.js';

interface TransactionBody {
  date: string;
  payee?: string;
  memo?: string;
  amountCents: number;
}

const columns = {
  id: transactions.id,
  accountId: transactions.accountId,
  date: transactions.date,
  payee: transactions.payee,
  memo: transactions.memo,
  amountCents: transactions.amountCents,
};

const fields = { date, payee, memo, amountCents };

export function registerTransactionRoutes(app: FastifyInstance, db: Db) {
  async function accountExists(id: number) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, id));
    return account !== undefined;
  }

  app.get<{ Params: IdParams }>(
    '/api/accounts/:id/transactions',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await accountExists(id))) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      return db
        .select({
          ...columns,
          runningBalanceCents: sql<number>`sum(${transactions.amountCents}) over (
            order by ${transactions.date}, ${transactions.createdAt}, ${transactions.id}
          )`.mapWith(Number),
        })
        .from(transactions)
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
      const { id } = request.params;
      if (!(await accountExists(id))) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      const { body } = request;
      const [created] = await db
        .insert(transactions)
        .values({
          accountId: id,
          date: body.date,
          payee: body.payee?.trim() ?? '',
          memo: body.memo?.trim() ?? '',
          amountCents: body.amountCents,
        })
        .returning(columns);

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
    async (request, reply) => {
      const { body } = request;
      const [updated] = await db
        .update(transactions)
        .set({
          date: body.date,
          payee: body.payee?.trim(),
          memo: body.memo?.trim(),
          amountCents: body.amountCents,
        })
        .where(eq(transactions.id, request.params.id))
        .returning(columns);

      if (!updated) return reply.code(404).send({ message: 'Transaction not found' });
      return updated;
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/transactions/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const deleted = await db
        .delete(transactions)
        .where(eq(transactions.id, request.params.id))
        .returning({ id: transactions.id });
      if (deleted.length === 0) return reply.code(404).send({ message: 'Transaction not found' });

      return reply.code(204).send();
    },
  );
}
