import { eq, isNull, ne, sql } from 'drizzle-orm';
import { computeBudget, nextMonth, type BudgetResult } from '../budget.js';
import type { Executor } from '../db/client.js';
import { transactionLines, transactions } from '../db/schema.js';
import { loadBudgetFacts } from '../routes/budget.js';
import type { ImportResult } from './importer.js';
import type { ImportNotes, ImportPlan, ImportPreview } from './mapping.js';
import type { YnabPlan } from './types.js';

export interface AccountComparison {
  name: string;
  ynabBalanceCents: number;
  balanceCents: number;
  ynabClearedCents: number;
  clearedCents: number;
  matches: boolean;
}

export interface CategoryDifference {
  groupName: string;
  name: string;
  ynabAvailableCents: number;
  availableCents: number;
  /** The first month the two disagreed, as YYYY-MM. */
  firstMonth: string;
}

export interface ReadyToAssignPart {
  key:
    'paymentCategories' | 'startingDebt' | 'uncategorized' | 'creditOverspending' | 'unexplained';
  cents: number;
}

export interface ImportReport {
  /** The month compared, as YYYY-MM. */
  month: string;
  accounts: AccountComparison[];
  readyToAssign: {
    ynabCents: number;
    cents: number;
    /** Ours minus YNAB's, broken into likely causes that add up to the difference. */
    parts: ReadyToAssignPart[];
  };
  categoriesCompared: number;
  categoryDifferences: CategoryDifference[];
  counts: ImportPreview['counts'];
  notes: ImportNotes;
}

const toCents = (milliunits: number) => Math.round(milliunits / 10);

/** YNAB account types where overspending becomes debt instead of coming from Ready to Assign. */
const CREDIT_TYPES = ['creditCard', 'lineOfCredit'];

/** The month to compare: the current month, or YNAB's latest month before it. */
function comparisonMonth(months: string[], currentMonth: string) {
  const eligible = months.filter((month) => month <= currentMonth).sort();
  return eligible[eligible.length - 1] ?? [...months].sort()[0] ?? currentMonth;
}

/**
 * How much YNAB took from Ready to Assign for uncategorized spending in months before `month`,
 * treating Uncategorized like a category whose overspending is covered from Ready to Assign.
 */
async function uncategorizedShortfall(db: Executor, month: string) {
  const lineMonth = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month: lineMonth,
      cents: sql<number>`sum(${transactionLines.amountCents})`.mapWith(Number),
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(isNull(transactionLines.categoryId))
    .groupBy(lineMonth)
    .orderBy(lineMonth);

  let carry = 0;
  let shortfall = 0;
  for (const row of rows) {
    if (row.month >= month) break;
    const available = carry + row.cents;
    if (available < 0) shortfall -= available;
    carry = Math.max(0, available);
  }
  return shortfall;
}

/** Compares the imported data against YNAB's own figures. */
export async function compareWithYnab(
  db: Executor,
  ynab: YnabPlan,
  plan: ImportPlan,
  result: ImportResult,
  currentMonth: string,
): Promise<ImportReport> {
  // Account balances must match exactly.
  const balanceRows = await db
    .select({
      accountId: transactions.accountId,
      balanceCents: sql<number>`sum(${transactions.amountCents})`.mapWith(Number),
      clearedCents: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${ne(
        transactions.cleared,
        'uncleared',
      )}), 0)`.mapWith(Number),
    })
    .from(transactions)
    .groupBy(transactions.accountId);
  const balances = new Map(balanceRows.map((row) => [row.accountId, row]));
  const accountComparisons = plan.accounts.map((account) => {
    const ours = balances.get(result.accountIds.get(account.ynabId)!);
    const balanceCents = ours?.balanceCents ?? 0;
    const clearedCents = ours?.clearedCents ?? 0;
    return {
      name: account.name,
      ynabBalanceCents: account.balanceCents,
      balanceCents,
      ynabClearedCents: account.clearedBalanceCents,
      clearedCents,
      matches:
        balanceCents === account.balanceCents && clearedCents === account.clearedBalanceCents,
    };
  });

  // Budget figures for the comparison month.
  const ynabMonths = ynab.months.filter((month) => !month.deleted);
  const monthKey = (date: string) => date.slice(0, 7);
  const month = comparisonMonth(
    ynabMonths.map((item) => monthKey(item.month)),
    currentMonth,
  );
  const ynabByMonth = new Map(ynabMonths.map((item) => [monthKey(item.month), item]));
  const ynabMonth = ynabByMonth.get(month);

  const { facts } = await loadBudgetFacts(db);
  const budgets = new Map<string, BudgetResult>();
  const budgetFor = (viewed: string) => {
    if (!budgets.has(viewed)) budgets.set(viewed, computeBudget(facts, viewed, month));
    return budgets.get(viewed)!;
  };
  const ours = budgetFor(month);

  const ynabAvailable = (inMonth: string, ynabCategoryId: string) => {
    const category = ynabByMonth
      .get(inMonth)
      ?.categories.find((item) => item.id === ynabCategoryId);
    return category ? toCents(category.balance) : 0;
  };

  const categoryDifferences: CategoryDifference[] = [];
  let categoriesCompared = 0;
  for (const group of plan.groups) {
    for (const category of group.categories) {
      const id = result.categoryIds.get(category.ynabId)!;
      categoriesCompared += 1;
      const availableCents = ours.categories.get(id)?.availableCents ?? 0;
      const ynabAvailableCents = ynabAvailable(month, category.ynabId);
      if (availableCents === ynabAvailableCents) continue;

      // Find where the two first disagreed, walking forward from YNAB's first month.
      let firstMonth = month;
      const firstYnabMonth = [...ynabByMonth.keys()].sort()[0] ?? month;
      for (let candidate = firstYnabMonth; candidate <= month; candidate = nextMonth(candidate)) {
        const oursThen = budgetFor(candidate).categories.get(id)?.availableCents ?? 0;
        if (oursThen !== ynabAvailable(candidate, category.ynabId)) {
          firstMonth = candidate;
          break;
        }
      }
      categoryDifferences.push({
        groupName: group.name,
        name: category.name,
        ynabAvailableCents,
        availableCents,
        firstMonth,
      });
    }
  }

  // Ready to Assign: explain the difference with the known causes, in order. YNAB's API leaves
  // money assigned in later months out of a month's figure, though YNAB's own Ready to Assign
  // (and ours) takes it out, so subtract it to match what YNAB shows.
  const assignedLater = ynabMonths
    .filter((item) => monthKey(item.month) > month)
    .flatMap((item) => item.categories)
    .filter((category) => !category.deleted)
    .reduce((sum, category) => sum + toCents(category.budgeted), 0);
  const ynabCents = (ynabMonth ? toCents(ynabMonth.to_be_budgeted) : 0) - assignedLater;
  const difference = ours.readyToAssignCents - ynabCents;
  const notes: ImportNotes = {
    ...plan.preview.notes,
    skippedSchedules: [...plan.preview.notes.skippedSchedules, ...result.skippedSchedules],
  };
  const known: ReadyToAssignPart[] = [
    {
      key: 'paymentCategories',
      cents: notes.paymentCategories.reduce((sum, category) => sum + category.assignedCents, 0),
    },
    { key: 'startingDebt', cents: notes.startingDebtCents },
    { key: 'uncategorized', cents: await uncategorizedShortfall(db, month) },
  ];
  const rest = difference - known.reduce((sum, part) => sum + part.cents, 0);
  // Credit overspending can only lower ours, and only happens in budget accounts YNAB treats as
  // credit, so anything else is unexplained.
  const hasCreditAccounts = plan.accounts.some(
    (account) => account.onBudget && CREDIT_TYPES.includes(account.ynabType),
  );
  const parts = [
    ...known,
    ...(rest !== 0
      ? [
          {
            key: rest < 0 && hasCreditAccounts ? 'creditOverspending' : 'unexplained',
            cents: rest,
          } as const,
        ]
      : []),
  ].filter((part) => part.cents !== 0);

  return {
    month,
    accounts: accountComparisons,
    readyToAssign: { ynabCents, cents: ours.readyToAssignCents, parts },
    categoriesCompared,
    categoryDifferences,
    counts: plan.preview.counts,
    notes,
  };
}
