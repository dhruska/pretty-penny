import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { autoAssignFigures, computeBudget, type BudgetFacts } from '../budget.js';
import type { Db, Executor } from '../db/client.js';
import { accounts, monthlyAssignments, transactionLines, transactions } from '../db/schema.js';
import { loadCategories } from './categories.js';
import { categoryId, HttpError, month, positiveCents, startingBalanceCents } from './schemas.js';

interface BudgetQuery {
  month: string;
  currentMonth: string;
}

interface AssignmentParams {
  month: string;
  id: number;
}

interface MoveBody {
  fromCategoryId: number | null;
  toCategoryId: number | null;
  amountCents: number;
}

interface AssignmentsBody {
  assignments: { categoryId: number; assignedCents: number }[];
}

const nullableCategoryId = { ...categoryId, type: ['integer', 'null'] };
const monthParams = { type: 'object', required: ['month'], properties: { month } } as const;

async function loadBudgetFacts(db: Executor) {
  const lineMonth = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;

  const [{ readyToAssignId, groups }, assignmentRows, activityRows] = await Promise.all([
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
  ]);

  const activity = activityRows.map((row) => ({ ...row, categoryId: row.categoryId! }));
  const facts: BudgetFacts = {
    categoryIds: groups.flatMap((group) => group.categories.map((category) => category.id)),
    assignments: assignmentRows,
    activity: activity.filter((row) => row.categoryId !== readyToAssignId),
    inflows: activity.filter((row) => row.categoryId === readyToAssignId),
  };
  return { groups, facts };
}

async function setAssignment(
  db: Executor,
  categoryIdValue: number,
  budgetMonth: string,
  assignedCents: number,
) {
  const target = and(
    eq(monthlyAssignments.categoryId, categoryIdValue),
    eq(monthlyAssignments.month, budgetMonth),
  );
  if (assignedCents === 0) {
    await db.delete(monthlyAssignments).where(target);
    return;
  }
  await db
    .insert(monthlyAssignments)
    .values({ categoryId: categoryIdValue, month: budgetMonth, assignedCents })
    .onConflictDoUpdate({
      target: [monthlyAssignments.categoryId, monthlyAssignments.month],
      set: { assignedCents },
    });
}

function assertUserCategory(facts: BudgetFacts, id: number) {
  if (!facts.categoryIds.includes(id)) throw new HttpError(400, 'Category not found');
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
      const [{ groups, facts }, uncategorized] = await Promise.all([
        loadBudgetFacts(db),
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

      const result = computeBudget(facts, request.query.month, request.query.currentMonth);
      const figures = autoAssignFigures(facts, request.query.month);

      return {
        month: request.query.month,
        readyToAssignCents: result.readyToAssignCents,
        uncategorized,
        groups: groups.map((group) => ({
          ...group,
          categories: group.categories.map((category) => ({
            ...category,
            ...result.categories.get(category.id)!,
            ...figures.get(category.id)!,
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

      const { facts } = await loadBudgetFacts(db);
      if (!facts.categoryIds.includes(id)) {
        return reply.code(404).send({ message: 'Category not found' });
      }

      await setAssignment(db, id, budgetMonth, assignedCents);
      return { categoryId: id, month: budgetMonth, assignedCents };
    },
  );

  app.post<{ Params: { month: string }; Body: MoveBody }>(
    '/api/budget/:month/move',
    {
      schema: {
        params: monthParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['fromCategoryId', 'toCategoryId', 'amountCents'],
          properties: {
            fromCategoryId: nullableCategoryId,
            toCategoryId: nullableCategoryId,
            amountCents: positiveCents,
          },
        },
      },
    },
    async (request, reply) => {
      const budgetMonth = request.params.month;
      const { fromCategoryId, toCategoryId, amountCents: amount } = request.body;
      if (fromCategoryId === toCategoryId) {
        return reply.code(400).send({ message: 'Choose two different places to move money.' });
      }

      // A move changes Assigned in both places, as in YNAB. Null means Ready to Assign.
      await db.transaction(async (tx) => {
        const { facts } = await loadBudgetFacts(tx);
        const budget = computeBudget(facts, budgetMonth, budgetMonth);
        const assignedIn = (id: number) => budget.categories.get(id)?.assignedCents ?? 0;

        if (fromCategoryId !== null) {
          assertUserCategory(facts, fromCategoryId);
          const available = budget.categories.get(fromCategoryId)!.availableCents;
          if (amount > available) {
            throw new HttpError(400, 'That category doesn’t have that much available to move.');
          }
        }
        if (toCategoryId !== null) assertUserCategory(facts, toCategoryId);

        if (fromCategoryId !== null) {
          await setAssignment(tx, fromCategoryId, budgetMonth, assignedIn(fromCategoryId) - amount);
        }
        if (toCategoryId !== null) {
          await setAssignment(tx, toCategoryId, budgetMonth, assignedIn(toCategoryId) + amount);
        }
      });

      return reply.code(204).send();
    },
  );

  app.post<{ Params: { month: string }; Body: AssignmentsBody }>(
    '/api/budget/:month/assignments',
    {
      schema: {
        params: monthParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['assignments'],
          properties: {
            assignments: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['categoryId', 'assignedCents'],
                properties: { categoryId, assignedCents: startingBalanceCents },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      await db.transaction(async (tx) => {
        const { facts } = await loadBudgetFacts(tx);
        for (const assignment of request.body.assignments) {
          assertUserCategory(facts, assignment.categoryId);
        }
        for (const assignment of request.body.assignments) {
          await setAssignment(
            tx,
            assignment.categoryId,
            request.params.month,
            assignment.assignedCents,
          );
        }
      });
      return reply.code(204).send();
    },
  );
}
