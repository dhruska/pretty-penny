import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { computeBudget } from '../budget.js';
import { exportDate, exportMoney, exportMonth, toCsv } from '../csv.js';
import type { Db } from '../db/client.js';
import {
  accounts,
  categories,
  categoryGroups,
  payees,
  READY_TO_ASSIGN_KEY,
  transactionLines,
  transactions,
} from '../db/schema.js';
import {
  incomeVsExpense,
  monthsBetween,
  netWorth,
  spendingBreakdown,
  spendingTrends,
  type ReportLine,
  type SpendingGroupBy,
} from '../reports.js';
import { localToday } from '../schedule.js';
import { loadBudgetFacts } from './budget.js';
import { categoryId, date, HttpError } from './schemas.js';

interface RangeQuery {
  from?: string;
  to?: string;
}

const rangeProperties = { from: date, to: date };

const pair = alias(transactions, 'pair');
const pairAccount = alias(accounts, 'pair_account');

const CLEARED_LABELS: Record<string, string> = {
  uncleared: 'Uncleared',
  cleared: 'Cleared',
  reconciled: 'Reconciled',
};

function attachment(reply: { header: (name: string, value: string) => unknown }, name: string) {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header(
    'content-disposition',
    `attachment; filename="pretty-penny-${name}-${localToday()}.csv"`,
  );
}

export function registerReportRoutes(app: FastifyInstance, db: Db, today = localToday) {
  /** Category lines in a date range, with their category, group and payee. */
  async function loadLines({ from, to }: RangeQuery): Promise<ReportLine[]> {
    const conditions: SQL[] = [];
    if (from) conditions.push(gte(transactions.date, from));
    if (to) conditions.push(lte(transactions.date, to));

    const rows = await db
      .select({
        date: transactions.date,
        amountCents: transactionLines.amountCents,
        categoryId: categories.id,
        categoryName: categories.name,
        groupId: categoryGroups.id,
        groupName: categoryGroups.name,
        systemKey: categories.systemKey,
        isStartingBalance: transactions.isStartingBalance,
        payee: payees.name,
        transferAccountName: pairAccount.name,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
      .leftJoin(categories, eq(categories.id, transactionLines.categoryId))
      .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .leftJoin(payees, eq(payees.id, transactions.payeeId))
      .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
      .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
      .where(and(...conditions));

    return rows.map((row) => ({
      date: row.date,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      groupId: row.groupId,
      groupName: row.groupName,
      isReadyToAssign: row.systemKey === READY_TO_ASSIGN_KEY,
      isStartingBalance: row.isStartingBalance,
      payeeLabel: row.transferAccountName
        ? `Transfer: ${row.transferAccountName}`
        : (row.payee ?? ''),
    }));
  }

  /** The months a range covers. Without a start, it begins at the earliest transaction. */
  async function rangeMonths({ from, to }: RangeQuery) {
    if (from && to && from > to)
      throw new HttpError(400, 'The start date must be before the end date.');
    const last = (to ?? today()).slice(0, 7);
    let first = from?.slice(0, 7);
    if (!first) {
      const [row] = await db
        .select({ earliest: sql<string | null>`min(${transactions.date})` })
        .from(transactions);
      first = (row?.earliest ?? today()).slice(0, 7);
    }
    return monthsBetween(first, last);
  }

  app.get<{ Querystring: RangeQuery & { groupBy?: SpendingGroupBy } }>(
    '/api/reports/spending',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...rangeProperties,
            groupBy: { type: 'string', enum: ['category', 'group', 'payee'] },
          },
        },
      },
    },
    async (request) => {
      await rangeMonths(request.query);
      return spendingBreakdown(await loadLines(request.query), request.query.groupBy ?? 'category');
    },
  );

  app.get<{ Querystring: RangeQuery & { categoryId?: number; groupId?: number } }>(
    '/api/reports/trends',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { ...rangeProperties, categoryId, groupId: categoryId },
        },
      },
    },
    async (request) => {
      const { categoryId: category, groupId } = request.query;
      return spendingTrends(await loadLines(request.query), await rangeMonths(request.query), {
        categoryId: category,
        groupId,
      });
    },
  );

  app.get<{ Querystring: RangeQuery }>(
    '/api/reports/income-expense',
    {
      schema: {
        querystring: { type: 'object', additionalProperties: false, properties: rangeProperties },
      },
    },
    async (request) =>
      incomeVsExpense(await loadLines(request.query), await rangeMonths(request.query)),
  );

  app.get<{ Querystring: RangeQuery }>(
    '/api/reports/net-worth',
    {
      schema: {
        querystring: { type: 'object', additionalProperties: false, properties: rangeProperties },
      },
    },
    async (request) => {
      const months = await rangeMonths(request.query);
      const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
      // Every transaction up to the end of the range counts toward balances, however old.
      const totals = await db
        .select({
          accountId: transactions.accountId,
          month,
          cents: sql<number>`sum(${transactions.amountCents})`.mapWith(Number),
        })
        .from(transactions)
        .where(request.query.to ? lte(transactions.date, request.query.to) : undefined)
        .groupBy(transactions.accountId, month);
      return netWorth(totals, months);
    },
  );

  app.get('/api/export/transactions.csv', async (_request, reply) => {
    const rows = await db
      .select({
        id: transactions.id,
        accountName: accounts.name,
        date: transactions.date,
        payee: payees.name,
        transferAccountName: pairAccount.name,
        memo: transactions.memo,
        amountCents: transactions.amountCents,
        cleared: transactions.cleared,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(payees, eq(payees.id, transactions.payeeId))
      .leftJoin(pair, eq(pair.id, transactions.transferTransactionId))
      .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
      .orderBy(
        asc(accounts.createdAt),
        asc(accounts.id),
        asc(transactions.date),
        asc(transactions.createdAt),
        asc(transactions.id),
      );

    const lineRows = await db
      .select({
        transactionId: transactionLines.transactionId,
        amountCents: transactionLines.amountCents,
        memo: transactionLines.memo,
        categoryName: categories.name,
        groupName: categoryGroups.name,
        systemKey: categories.systemKey,
      })
      .from(transactionLines)
      .leftJoin(categories, eq(categories.id, transactionLines.categoryId))
      .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .orderBy(asc(transactionLines.id));
    const linesByTransaction = new Map<number, typeof lineRows>();
    for (const line of lineRows) {
      const list = linesByTransaction.get(line.transactionId) ?? [];
      list.push(line);
      linesByTransaction.set(line.transactionId, list);
    }

    const csv: (string | number)[][] = [
      [
        'Account',
        'Flag',
        'Date',
        'Payee',
        'Category Group/Category',
        'Category Group',
        'Category',
        'Memo',
        'Outflow',
        'Inflow',
        'Cleared',
      ],
    ];
    for (const row of rows) {
      // As in YNAB, transfers name the other account and splits get one row per line.
      const payee = row.transferAccountName
        ? `Transfer : ${row.transferAccountName}`
        : (row.payee ?? '');
      const lines = linesByTransaction.get(row.id) ?? [];
      const parts =
        lines.length === 0
          ? [
              {
                amountCents: row.amountCents,
                memo: row.memo,
                categoryName: null,
                groupName: null,
                systemKey: null,
              },
            ]
          : lines.map((line, index) => ({
              ...line,
              memo:
                lines.length > 1
                  ? `Split (${index + 1}/${lines.length}) ${line.memo || row.memo}`.trim()
                  : row.memo,
            }));

      for (const part of parts) {
        const isReadyToAssign = part.systemKey === READY_TO_ASSIGN_KEY;
        const group = isReadyToAssign ? 'Inflow' : (part.groupName ?? '');
        const category = isReadyToAssign ? 'Ready to Assign' : (part.categoryName ?? '');
        csv.push([
          row.accountName,
          '',
          exportDate(row.date),
          payee,
          group && category ? `${group}: ${category}` : '',
          group,
          category,
          part.memo,
          exportMoney(part.amountCents < 0 ? -part.amountCents : 0),
          exportMoney(part.amountCents > 0 ? part.amountCents : 0),
          CLEARED_LABELS[row.cleared] ?? row.cleared,
        ]);
      }
    }

    attachment(reply, 'transactions');
    return toCsv(csv);
  });

  app.get('/api/export/budget.csv', async (_request, reply) => {
    const { groups, facts } = await loadBudgetFacts(db);
    const currentMonth = today().slice(0, 7);
    const dataMonths = [...facts.assignments, ...facts.activity].map((row) => row.month);
    const first =
      dataMonths.length > 0 ? dataMonths.reduce((a, b) => (a < b ? a : b)) : currentMonth;
    const last = dataMonths.reduce((a, b) => (a > b ? a : b), currentMonth);

    const csv: (string | number)[][] = [
      [
        'Month',
        'Category Group/Category',
        'Category Group',
        'Category',
        'Assigned',
        'Activity',
        'Available',
      ],
    ];
    for (const month of monthsBetween(first, last)) {
      const budget = computeBudget(facts, month, currentMonth);
      for (const group of groups) {
        for (const category of group.categories) {
          const figures = budget.categories.get(category.id)!;
          csv.push([
            exportMonth(month),
            `${group.name}: ${category.name}`,
            group.name,
            category.name,
            exportMoney(figures.assignedCents),
            exportMoney(figures.activityCents),
            exportMoney(figures.availableCents),
          ]);
        }
      }
    }

    attachment(reply, 'budget');
    return toCsv(csv);
  });
}
