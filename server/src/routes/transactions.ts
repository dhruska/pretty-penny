import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { accounts, categories, transactionLines, transactions } from '../db/schema.js';
import { amountCents, categoryId, date, idParams, memo, payee, type IdParams } from './schemas.js';

interface TransactionBody {
  date: string;
  payee?: string;
  memo?: string;
  amountCents: number;
  categoryId?: number | null;
}

const columns = {
  id: transactions.id,
  accountId: transactions.accountId,
  date: transactions.date,
  payee: transactions.payee,
  memo: transactions.memo,
  amountCents: transactions.amountCents,
};

const fields = {
  date,
  payee,
  memo,
  amountCents,
  categoryId: { ...categoryId, type: ['integer', 'null'] },
};

export function registerTransactionRoutes(app: FastifyInstance, db: Db) {
  async function accountExists(id: number) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, id));
    return account !== undefined;
  }

  async function categoryIsValid(id: number | null | undefined) {
    if (id === null || id === undefined) return true;
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, id));
    return category !== undefined;
  }

  app.get<{ Params: IdParams }>(
    '/api/accounts/:id/transactions',
    { schema: { params: idParams } },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await accountExists(id))) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      // Each transaction has exactly one line until split transactions are added.
      return db
        .select({
          ...columns,
          categoryId: transactionLines.categoryId,
          categoryName: categories.name,
          runningBalanceCents: sql<number>`sum(${transactions.amountCents}) over (
            order by ${transactions.date}, ${transactions.createdAt}, ${transactions.id}
          )`.mapWith(Number),
        })
        .from(transactions)
        .leftJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
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
      const { id } = request.params;
      if (!(await accountExists(id))) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      const { body } = request;
      if (!(await categoryIsValid(body.categoryId))) {
        return reply.code(400).send({ message: 'Category not found' });
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(transactions)
          .values({
            accountId: id,
            date: body.date,
            payee: body.payee?.trim() ?? '',
            memo: body.memo?.trim() ?? '',
            amountCents: body.amountCents,
          })
          .returning(columns);
        await tx.insert(transactionLines).values({
          transactionId: row!.id,
          categoryId: body.categoryId ?? null,
          amountCents: body.amountCents,
        });
        return { ...row!, categoryId: body.categoryId ?? null };
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
    async (request, reply) => {
      const { id } = request.params;
      const { body } = request;
      if (!(await categoryIsValid(body.categoryId))) {
        return reply.code(400).send({ message: 'Category not found' });
      }

      const transactionValues = {
        date: body.date,
        payee: body.payee?.trim(),
        memo: body.memo?.trim(),
        amountCents: body.amountCents,
      };
      const lineValues = { categoryId: body.categoryId, amountCents: body.amountCents };
      const hasValues = (values: object) =>
        Object.values(values).some((value) => value !== undefined);

      const updated = await db.transaction(async (tx) => {
        const [row] = hasValues(transactionValues)
          ? await tx
              .update(transactions)
              .set(transactionValues)
              .where(eq(transactions.id, id))
              .returning(columns)
          : await tx.select(columns).from(transactions).where(eq(transactions.id, id));

        if (row && hasValues(lineValues)) {
          await tx
            .update(transactionLines)
            .set(lineValues)
            .where(eq(transactionLines.transactionId, id));
        }
        return row;
      });

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
