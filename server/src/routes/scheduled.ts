import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { accounts, categories, payees, scheduledTransactions } from '../db/schema.js';
import { localToday, occurrence, FREQUENCIES, type Frequency } from '../schedule.js';
import { advanceSchedule, postDueScheduled, postNextOccurrence } from '../scheduled.js';
import { resolvePayee } from './payees.js';
import { HttpError, idParams, type IdParams } from './schemas.js';
import { fields, prepareTransaction, type TransactionBody } from './transactions.js';

type ScheduleBody = Omit<TransactionBody, 'cleared' | 'confirmReconciled'> & {
  frequency: Frequency;
};

// Schedules take the same fields as transactions, except cleared status and the reconciled flag.
const scheduleFields = Object.fromEntries(
  Object.entries(fields).filter(([key]) => key !== 'cleared' && key !== 'confirmReconciled'),
);

const scheduleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'amountCents', 'frequency'],
  properties: { ...scheduleFields, frequency: { type: 'string', enum: FREQUENCIES } },
} as const;

const transferAccount = alias(accounts, 'transfer_account');

export function registerScheduledRoutes(app: FastifyInstance, db: Db, today = localToday) {
  async function findSchedule(id: number) {
    const [schedule] = await db
      .select()
      .from(scheduledTransactions)
      .where(eq(scheduledTransactions.id, id));
    if (!schedule) throw new HttpError(404, 'Scheduled transaction not found');
    return schedule;
  }

  /** Validates a schedule as if it were a transaction, and returns the values to store. */
  async function scheduleValues(accountId: number, body: ScheduleBody) {
    return db.transaction(async (tx) => {
      await prepareTransaction(tx, accountId, body);
      return {
        accountId,
        frequency: body.frequency,
        firstDate: body.date,
        nextIndex: 0,
        nextDate: occurrence(body.date, body.frequency, 0)!,
        payeeId: body.transferAccountId ? null : await resolvePayee(tx, body.payee),
        memo: body.memo?.trim() ?? '',
        amountCents: body.amountCents,
        categoryId: body.lines ? null : (body.categoryId ?? null),
        lines: body.lines?.map((line) => ({ ...line, memo: line.memo?.trim() ?? '' })) ?? null,
        transferAccountId: body.transferAccountId ?? null,
      };
    });
  }

  app.get<{ Params: IdParams }>(
    '/api/accounts/:id/scheduled',
    { schema: { params: idParams } },
    async (request) => {
      const rows = await db
        .select({
          id: scheduledTransactions.id,
          accountId: scheduledTransactions.accountId,
          frequency: scheduledTransactions.frequency,
          nextDate: scheduledTransactions.nextDate,
          payee: payees.name,
          memo: scheduledTransactions.memo,
          amountCents: scheduledTransactions.amountCents,
          categoryId: scheduledTransactions.categoryId,
          categoryName: categories.name,
          lines: scheduledTransactions.lines,
          transferAccountId: scheduledTransactions.transferAccountId,
          transferAccountName: transferAccount.name,
        })
        .from(scheduledTransactions)
        .leftJoin(payees, eq(payees.id, scheduledTransactions.payeeId))
        .leftJoin(categories, eq(categories.id, scheduledTransactions.categoryId))
        .leftJoin(transferAccount, eq(transferAccount.id, scheduledTransactions.transferAccountId))
        .where(eq(scheduledTransactions.accountId, request.params.id))
        .orderBy(asc(scheduledTransactions.nextDate), asc(scheduledTransactions.id));
      return rows.map((row) => ({ ...row, payee: row.payee ?? '' }));
    },
  );

  app.post<{ Params: IdParams; Body: ScheduleBody }>(
    '/api/accounts/:id/scheduled',
    { schema: { params: idParams, body: scheduleSchema } },
    async (request, reply) => {
      const values = await scheduleValues(request.params.id, request.body);
      const [created] = await db.insert(scheduledTransactions).values(values).returning();

      // A schedule starting today or earlier posts its due occurrences right away.
      const { posted } = await postDueScheduled(db, today(), created!.id);
      return reply.code(201).send({ id: created!.id, posted });
    },
  );

  app.put<{ Params: IdParams; Body: ScheduleBody }>(
    '/api/scheduled/:id',
    { schema: { params: idParams, body: scheduleSchema } },
    async (request) => {
      const existing = await findSchedule(request.params.id);
      const values = await scheduleValues(existing.accountId, request.body);
      await db
        .update(scheduledTransactions)
        .set(values)
        .where(eq(scheduledTransactions.id, existing.id));

      const { posted } = await postDueScheduled(db, today(), existing.id);
      return { id: existing.id, posted };
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/scheduled/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const schedule = await findSchedule(request.params.id);
      await db.delete(scheduledTransactions).where(eq(scheduledTransactions.id, schedule.id));
      return reply.code(204).send();
    },
  );

  // As in YNAB, "Enter now" posts the next occurrence early, with its scheduled date.
  app.post<{ Params: IdParams }>(
    '/api/scheduled/:id/enter-now',
    { schema: { params: idParams } },
    async (request, reply) => {
      const schedule = await findSchedule(request.params.id);
      await db.transaction((tx) => postNextOccurrence(tx, schedule));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/scheduled/:id/skip',
    { schema: { params: idParams } },
    async (request, reply) => {
      const schedule = await findSchedule(request.params.id);
      await db.transaction((tx) => advanceSchedule(tx, schedule));
      return reply.code(204).send();
    },
  );
}
