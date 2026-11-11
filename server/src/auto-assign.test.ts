import { describe, expect, it } from 'vitest';
import { autoAssignFigures, previousMonth, type BudgetFacts } from './budget.js';

const FOOD = 1;

function figures(overrides: Partial<BudgetFacts>, viewedMonth = '2026-06') {
  const facts: BudgetFacts = {
    categoryIds: [FOOD],
    assignments: [],
    activity: [],
    inflows: [],
    ...overrides,
  };
  return autoAssignFigures(facts, viewedMonth).get(FOOD);
}

const food = (month: string, cents: number) => ({ categoryId: FOOD, month, cents });

describe('previousMonth', () => {
  it('steps back within a year and across a year boundary', () => {
    expect(previousMonth('2026-06')).toBe('2026-05');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
});

describe('autoAssignFigures', () => {
  it('is all zeros with no history', () => {
    expect(figures({})).toEqual({
      assignedLastMonthCents: 0,
      spentLastMonthCents: 0,
      averageAssignedCents: 0,
      averageSpentCents: 0,
    });
  });

  it('reports last month’s assigned and spent amounts', () => {
    const result = figures({
      assignments: [food('2026-05', 100_00)],
      activity: [food('2026-05', -40_00)],
    });

    expect(result).toMatchObject({ assignedLastMonthCents: 100_00, spentLastMonthCents: 40_00 });
  });

  it('nets refunds against spending and never reports negative spending', () => {
    expect(figures({ activity: [food('2026-05', 20_00)] })?.spentLastMonthCents).toBe(0);
    expect(
      figures({ activity: [food('2026-05', -50_00), food('2026-05', 20_00)] })?.spentLastMonthCents,
    ).toBe(30_00);
  });

  it('averages from the first month with data when there is less than a year of history', () => {
    const result = figures({
      assignments: [food('2026-03', 300_00)],
      activity: [food('2026-04', -90_00)],
    });

    // March, April and May.
    expect(result).toMatchObject({ averageAssignedCents: 100_00, averageSpentCents: 30_00 });
  });

  it('counts months with no activity once the window has started', () => {
    expect(figures({ assignments: [food('2026-01', 100_00)] })?.averageAssignedCents).toBe(20_00);
  });

  it('only looks at the 12 months before the viewed month', () => {
    const result = figures({
      assignments: [food('2025-05', 999_00), food('2025-06', 120_00), food('2026-06', 500_00)],
    });

    // June 2025 through May 2026; May 2025 is too old and June 2026 is the viewed month.
    expect(result?.averageAssignedCents).toBe(10_00);
    expect(result?.assignedLastMonthCents).toBe(0);
  });

  it('rounds averages to the cent', () => {
    expect(figures({ assignments: [food('2026-03', 100_00)] })?.averageAssignedCents).toBe(3333);
  });
});
