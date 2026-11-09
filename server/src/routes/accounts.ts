import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { accounts, transactions } from '../db/schema.js';
import {
  accountName,
  date,
  idParams,
  startingBalanceCents,
  STARTING_BALANCE_PAYEE,
  type IdParams,
} from './schemas.js';

interface CreateAccountBody {
  name: string;
  startingBalanceCents: number;
  date: string;
}

interface RenameAccountBody {
  name: string;
}

export function registerAccountRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/accounts', async () => {
    return db
      .select({
        id: accounts.id,
        name: accounts.name,
        balanceCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(Number),
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
          properties: { name: accountName, startingBalanceCents, date },
        },
      },
    },
    async (request, reply) => {
      const { startingBalanceCents: balanceCents, date: startingDate } = request.body;
      const name = request.body.name.trim();

      const account = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(accounts)
          .values({ name })
          .returning({ id: accounts.id, name: accounts.name });
        if (balanceCents !== 0) {
          await tx.insert(transactions).values({
            accountId: created!.id,
            date: startingDate,
            payee: STARTING_BALANCE_PAYEE,
            amountCents: balanceCents,
          });
        }
        return created!;
      });

      return reply.code(201).send({ ...account, balanceCents });
    },
  );

  app.patch<{ Params: IdParams; Body: RenameAccountBody }>(
    '/api/accounts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: accountName },
        },
      },
    },
    async (request, reply) => {
      const [updated] = await db
        .update(accounts)
        .set({ name: request.body.name.trim() })
        .where(eq(accounts.id, request.params.id))
        .returning({ id: accounts.id, name: accounts.name });

      if (!updated) return reply.code(404).send({ message: 'Account not found' });
      return updated;
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
        .where(and(eq(transactions.accountId, id), ne(transactions.payee, STARTING_BALANCE_PAYEE)))
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
