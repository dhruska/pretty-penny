import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeBudget } from '../budget.js';
import type { Db } from '../db/client.js';
import {
  accounts,
  categories,
  monthlyAssignments,
  transactionLines,
  transactions,
} from '../db/schema.js';
import { loadCategories } from './categories.js';
import { categoryId, month, startingBalanceCents } from './schemas.js';

interface BudgetQuery {
  month: string;
  currentMonth: string;
}

interface AssignmentParams {
  month: string;
  id: number;
}

export function registerBudgetRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Querystring: BudgetQuery }>(
    '/api/budget',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['month', 'currentMonth'],
          properties: { month, currentMonth: month },
        },
      },
    },
    async (request) => {
      const lineMonth = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;

      const [{ readyToAssignId, groups }, assignmentRows, activityRows, uncategorized] =
        await Promise.all([
          loadCategories(db),
          db
            .select({
              categoryId: monthlyAssignments.categoryId,
              month: monthlyAssignments.month,
              cents: monthlyAssignments.assignedCents,
            })
            .from(monthlyAssignments),
          db
            .select({
              categoryId: transactionLines.categoryId,
              month: lineMonth,
              cents: sql<number>`sum(${transactionLines.amountCents})`.mapWith(Number),
            })
            .from(transactionLines)
            .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
            .where(isNotNull(transactionLines.categoryId))
            .groupBy(transactionLines.categoryId, lineMonth),
          db
            .select({
              accountId: accounts.id,
              accountName: accounts.name,
              count: sql<number>`count(distinct ${transactions.id})`.mapWith(Number),
            })
            .from(transactionLines)
            .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
            .innerJoin(accounts, eq(transactions.accountId, accounts.id))
            .where(isNull(transactionLines.categoryId))
            .groupBy(accounts.id)
            .orderBy(asc(accounts.createdAt), asc(accounts.id)),
        ]);

      const activity = activityRows.map((row) => ({ ...row, categoryId: row.categoryId! }));
      const result = computeBudget(
        {
          categoryIds: groups.flatMap((group) => group.categories.map((category) => category.id)),
          assignments: assignmentRows,
          activity: activity.filter((row) => row.categoryId !== readyToAssignId),
          inflows: activity.filter((row) => row.categoryId === readyToAssignId),
        },
        request.query.month,
        request.query.currentMonth,
      );

      return {
        month: request.query.month,
        readyToAssignCents: result.readyToAssignCents,
        uncategorized,
        groups: groups.map((group) => ({
          ...group,
          categories: group.categories.map((category) => ({
            ...category,
            ...result.categories.get(category.id)!,
          })),
        })),
      };
    },
  );

  app.put<{ Params: AssignmentParams; Body: { assignedCents: number } }>(
    '/api/budget/:month/categories/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['month', 'id'],
          properties: { month, id: categoryId },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['assignedCents'],
          properties: { assignedCents: startingBalanceCents },
        },
      },
    },
    async (request, reply) => {
      const { month: budgetMonth, id } = request.params;
      const { assignedCents } = request.body;

      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, id), isNull(categories.systemKey)));
      if (!category) return reply.code(404).send({ message: 'Category not found' });

      if (assignedCents === 0) {
        await db
          .delete(monthlyAssignments)
          .where(
            and(eq(monthlyAssignments.categoryId, id), eq(monthlyAssignments.month, budgetMonth)),
          );
      } else {
        await db
          .insert(monthlyAssignments)
          .values({ categoryId: id, month: budgetMonth, assignedCents })
          .onConflictDoUpdate({
            target: [monthlyAssignments.categoryId, monthlyAssignments.month],
            set: { assignedCents },
          });
      }

      return { categoryId: id, month: budgetMonth, assignedCents };
    },
  );
}
