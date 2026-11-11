import { nextMonth } from './budget.js';

/** One category line of a transaction, with what the reports need to group it. */
export interface ReportLine {
  date: string;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  groupId: number | null;
  groupName: string | null;
  isReadyToAssign: boolean;
  isStartingBalance: boolean;
  /** The payee, or for a transfer the other account, shown as "Transfer: <account>". */
  payeeLabel: string;
}

export type SpendingGroupBy = 'category' | 'group' | 'payee';

const UNCATEGORIZED = 'Uncategorized';

/** Months from `first` to `last` inclusive, as YYYY-MM. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) months.push(month);
  return months;
}

/**
 * Spending, as in YNAB: categorized activity in budget accounts, including money moved out to
 * tracking accounts, but not Ready to Assign inflows. Transfers between budget accounts have no
 * category lines, so they never appear. Refunds reduce spending.
 */
const isSpending = (line: ReportLine) => !line.isReadyToAssign;

function groupKey(line: ReportLine, groupBy: SpendingGroupBy) {
  if (groupBy === 'payee')
    return { key: `payee:${line.payeeLabel}`, label: line.payeeLabel || '(no payee)' };
  if (groupBy === 'group') {
    return line.groupId === null
      ? { key: 'uncategorized', label: UNCATEGORIZED }
      : { key: `group:${line.groupId}`, label: line.groupName! };
  }
  return line.categoryId === null
    ? { key: 'uncategorized', label: UNCATEGORIZED }
    : { key: `category:${line.categoryId}`, label: line.categoryName! };
}

/** Spending per category, group or payee, largest first, leaving out anything with none. */
export function spendingBreakdown(lines: ReportLine[], groupBy: SpendingGroupBy) {
  const totals = new Map<string, { label: string; spentCents: number }>();
  for (const line of lines.filter(isSpending)) {
    const { key, label } = groupKey(line, groupBy);
    const entry = totals.get(key) ?? { label, spentCents: 0 };
    entry.spentCents -= line.amountCents;
    totals.set(key, entry);
  }

  const items = [...totals.values()]
    .filter((item) => item.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents || a.label.localeCompare(b.label));
  const totalCents = items.reduce((sum, item) => sum + item.spentCents, 0);
  return { totalCents, items };
}

/** Net spending per month, optionally for one category or group, with the monthly average. */
export function spendingTrends(
  lines: ReportLine[],
  months: string[],
  filter: { categoryId?: number; groupId?: number } = {},
) {
  const byMonth = new Map(months.map((month) => [month, 0]));
  for (const line of lines.filter(isSpending)) {
    if (filter.categoryId !== undefined && line.categoryId !== filter.categoryId) continue;
    if (filter.groupId !== undefined && line.groupId !== filter.groupId) continue;
    const month = line.date.slice(0, 7);
    if (byMonth.has(month)) byMonth.set(month, byMonth.get(month)! - line.amountCents);
  }

  const points = months.map((month) => ({ month, spentCents: byMonth.get(month)! }));
  const total = points.reduce((sum, point) => sum + point.spentCents, 0);
  return {
    months: points,
    averageCents: months.length === 0 ? 0 : Math.round(total / months.length),
  };
}

interface Row {
  label: string;
  byMonth: number[];
  totalCents: number;
}

function addTo(
  rows: Map<string, Row>,
  key: string,
  label: string,
  monthIndex: number,
  cents: number,
  monthCount: number,
) {
  const row = rows.get(key) ?? { label, byMonth: Array(monthCount).fill(0), totalCents: 0 };
  row.byMonth[monthIndex]! += cents;
  row.totalCents += cents;
  rows.set(key, row);
}

const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label);

/**
 * YNAB's Income v Expense: income by payee and expenses by category group and category, month by
 * month. As in YNAB, starting balances aren't income, and tracking accounts only count through
 * transfers that carry a category. Expenses are negative, so net income is income plus expenses.
 */
export function incomeVsExpense(lines: ReportLine[], months: string[]) {
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const count = months.length;
  const income = new Map<string, Row>();
  const groups = new Map<string, Row & { categories: Map<string, Row> }>();

  for (const line of lines) {
    const index = monthIndex.get(line.date.slice(0, 7));
    if (index === undefined) continue;

    if (line.isReadyToAssign) {
      if (line.isStartingBalance) continue;
      addTo(
        income,
        line.payeeLabel,
        line.payeeLabel || '(no payee)',
        index,
        line.amountCents,
        count,
      );
      continue;
    }

    const groupLabel = line.groupName ?? UNCATEGORIZED;
    const group = groups.get(groupLabel) ?? {
      label: groupLabel,
      byMonth: Array(count).fill(0),
      totalCents: 0,
      categories: new Map<string, Row>(),
    };
    group.byMonth[index]! += line.amountCents;
    group.totalCents += line.amountCents;
    groups.set(groupLabel, group);
    addTo(
      group.categories,
      line.categoryName ?? UNCATEGORIZED,
      line.categoryName ?? UNCATEGORIZED,
      index,
      line.amountCents,
      count,
    );
  }

  const incomeRows = [...income.values()].sort(byLabel);
  const expenseGroups = [...groups.values()].sort(byLabel).map(({ categories, ...group }) => ({
    ...group,
    categories: [...categories.values()].sort(byLabel),
  }));
  const sumRows = (rows: Row[]) =>
    months.map((_, index) => rows.reduce((sum, row) => sum + row.byMonth[index]!, 0));
  const incomeByMonth = sumRows(incomeRows);
  const expensesByMonth = sumRows(expenseGroups);

  return {
    months,
    income: incomeRows,
    expenseGroups,
    incomeByMonth,
    expensesByMonth,
    netByMonth: months.map((_, index) => incomeByMonth[index]! + expensesByMonth[index]!),
  };
}

export interface AccountMonthTotal {
  accountId: number;
  month: string;
  cents: number;
}

/**
 * Assets, debts and net worth at each month's end, across every account including tracking and
 * closed ones. An account counts as an asset or a debt by the sign of its balance at that time.
 */
export function netWorth(totals: AccountMonthTotal[], months: string[]) {
  const byAccount = new Map<number, AccountMonthTotal[]>();
  for (const total of totals) {
    const list = byAccount.get(total.accountId) ?? [];
    list.push(total);
    byAccount.set(total.accountId, list);
  }

  return months.map((month) => {
    let assetsCents = 0;
    let debtsCents = 0;
    for (const accountTotals of byAccount.values()) {
      const balance = accountTotals
        .filter((total) => total.month <= month)
        .reduce((sum, total) => sum + total.cents, 0);
      if (balance > 0) assetsCents += balance;
      else debtsCents += balance;
    }
    return { month, assetsCents, debtsCents, netWorthCents: assetsCents + debtsCents };
  });
}
