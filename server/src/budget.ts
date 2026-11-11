export interface CategoryMonthAmount {
  categoryId: number;
  month: string;
  cents: number;
}

export interface BudgetFacts {
  categoryIds: number[];
  assignments: CategoryMonthAmount[];
  activity: CategoryMonthAmount[];
  inflows: { month: string; cents: number }[];
}

export interface CategoryFigures {
  assignedCents: number;
  activityCents: number;
  availableCents: number;
}

export interface BudgetResult {
  readyToAssignCents: number;
  categories: Map<number, CategoryFigures>;
}

export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber === 12
    ? `${String(year + 1).padStart(4, '0')}-01`
    : `${month.slice(0, 5)}${String(monthNumber + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber === 1
    ? `${String(year - 1).padStart(4, '0')}-12`
    : `${month.slice(0, 5)}${String(monthNumber - 1).padStart(2, '0')}`;
}

function totalsByMonth(rows: CategoryMonthAmount[]) {
  const totals = new Map<string, Map<number, number>>();
  for (const { categoryId, month, cents } of rows) {
    const forMonth = totals.get(month) ?? new Map<number, number>();
    forMonth.set(categoryId, (forMonth.get(categoryId) ?? 0) + cents);
    totals.set(month, forMonth);
  }
  return totals;
}

/**
 * Calculates one month of the budget by rolling every category forward from its earliest data.
 *
 * Unspent money carries into the next month. A negative month-end balance resets to zero, and once
 * that month has closed the shortfall comes out of Ready to Assign.
 */
export function computeBudget(
  facts: BudgetFacts,
  viewedMonth: string,
  currentMonth: string,
): BudgetResult {
  const assignments = totalsByMonth(facts.assignments);
  const activity = totalsByMonth(facts.activity);
  const months = [...assignments.keys(), ...activity.keys()];
  const firstMonth = months.length > 0 ? months.reduce((a, b) => (a < b ? a : b)) : viewedMonth;
  const lastMonth = viewedMonth > currentMonth ? viewedMonth : currentMonth;

  const carryover = new Map<number, number>();
  const figures = new Map<number, CategoryFigures>();
  let shortfallCents = 0;

  for (let month = firstMonth; month <= lastMonth; month = nextMonth(month)) {
    for (const categoryId of facts.categoryIds) {
      const assignedCents = assignments.get(month)?.get(categoryId) ?? 0;
      const activityCents = activity.get(month)?.get(categoryId) ?? 0;
      const availableCents = (carryover.get(categoryId) ?? 0) + assignedCents + activityCents;

      if (month === viewedMonth) {
        figures.set(categoryId, { assignedCents, activityCents, availableCents });
      }
      if (month < currentMonth && availableCents < 0) shortfallCents -= availableCents;
      carryover.set(categoryId, Math.max(0, availableCents));
    }
  }

  for (const categoryId of facts.categoryIds) {
    if (!figures.has(categoryId)) {
      figures.set(categoryId, { assignedCents: 0, activityCents: 0, availableCents: 0 });
    }
  }

  const inflowCents = facts.inflows
    .filter(({ month }) => month <= currentMonth)
    .reduce((sum, { cents }) => sum + cents, 0);
  const assignedCents = facts.assignments.reduce((sum, { cents }) => sum + cents, 0);

  return {
    readyToAssignCents: inflowCents - assignedCents - shortfallCents,
    categories: figures,
  };
}

export interface AutoAssignFigures {
  assignedLastMonthCents: number;
  spentLastMonthCents: number;
  averageAssignedCents: number;
  averageSpentCents: number;
}

const AVERAGE_WINDOW_MONTHS = 12;

/**
 * Calculates the amounts YNAB's auto-assign options use for a month. Averages cover up to the
 * 12 months before it, starting from the category's first month in that window with money
 * assigned or spent. Spending is net outflow and never below zero.
 */
export function autoAssignFigures(
  facts: BudgetFacts,
  viewedMonth: string,
): Map<number, AutoAssignFigures> {
  const assignments = totalsByMonth(facts.assignments);
  const activity = totalsByMonth(facts.activity);

  const window: string[] = [];
  for (let month = previousMonth(viewedMonth); window.length < AVERAGE_WINDOW_MONTHS;) {
    window.unshift(month);
    month = previousMonth(month);
  }
  const lastMonth = window[window.length - 1]!;

  const result = new Map<number, AutoAssignFigures>();
  for (const categoryId of facts.categoryIds) {
    const assignedIn = (month: string) => assignments.get(month)?.get(categoryId) ?? 0;
    const activityIn = (month: string) => activity.get(month)?.get(categoryId) ?? 0;

    const start = window.findIndex((month) => assignedIn(month) !== 0 || activityIn(month) !== 0);
    const months = start === -1 ? [] : window.slice(start);
    const average = (total: number) =>
      months.length === 0 ? 0 : Math.round(total / months.length);
    const totalAssigned = months.reduce((sum, month) => sum + assignedIn(month), 0);
    const totalActivity = months.reduce((sum, month) => sum + activityIn(month), 0);

    result.set(categoryId, {
      assignedLastMonthCents: assignedIn(lastMonth),
      spentLastMonthCents: Math.max(0, -activityIn(lastMonth)),
      averageAssignedCents: average(totalAssigned),
      averageSpentCents: Math.max(0, average(-totalActivity)),
    });
  }
  return result;
}
