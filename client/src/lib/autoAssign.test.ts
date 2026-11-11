import type { BudgetCategory } from '@/api';
import { describe, expect, it } from 'vitest';
import { autoAssignTarget, planAutoAssign } from './autoAssign';

function category(overrides: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: 1,
    name: 'Groceries',
    hidden: false,
    assignedCents: 0,
    activityCents: 0,
    availableCents: 0,
    assignedLastMonthCents: 0,
    spentLastMonthCents: 0,
    averageAssignedCents: 0,
    averageSpentCents: 0,
    upcomingCents: 0,
    ...overrides,
  };
}

describe('autoAssignTarget', () => {
  it('covers overspending for Underfunded', () => {
    expect(
      autoAssignTarget(category({ assignedCents: 50_00, availableCents: -30_00 }), 'underfunded'),
    ).toBe(80_00);
    expect(autoAssignTarget(category({ availableCents: 10_00 }), 'underfunded')).toBeNull();
  });

  it('covers upcoming scheduled outflows for Underfunded, counting money already available', () => {
    expect(
      autoAssignTarget(
        category({ assignedCents: 100_00, availableCents: 100_00, upcomingCents: -1_800_00 }),
        'underfunded',
      ),
    ).toBe(1_800_00);
    expect(
      autoAssignTarget(category({ availableCents: -30_00, upcomingCents: -50_00 }), 'underfunded'),
    ).toBe(80_00);
    expect(
      autoAssignTarget(
        category({ availableCents: 2_000_00, upcomingCents: -1_800_00 }),
        'underfunded',
      ),
    ).toBeNull();
  });

  it('ignores upcoming inflows for Underfunded', () => {
    expect(
      autoAssignTarget(category({ availableCents: -30_00, upcomingCents: 500_00 }), 'underfunded'),
    ).toBe(30_00);
  });

  it('puts the amount into Assigned, ignoring money already available', () => {
    const groceries = category({ availableCents: 150_00, spentLastMonthCents: 400_00 });

    expect(autoAssignTarget(groceries, 'spentLastMonth')).toBe(400_00);
  });

  it('raises a lower Assigned but never lowers a higher one', () => {
    expect(
      autoAssignTarget(
        category({ assignedCents: 1_000_00, assignedLastMonthCents: 1_800_00 }),
        'assignedLastMonth',
      ),
    ).toBe(1_800_00);
    expect(
      autoAssignTarget(
        category({ assignedCents: 2_000_00, assignedLastMonthCents: 1_800_00 }),
        'assignedLastMonth',
      ),
    ).toBeNull();
  });

  it('uses each option’s own figure', () => {
    const groceries = category({ averageAssignedCents: 300_00, averageSpentCents: 250_00 });

    expect(autoAssignTarget(groceries, 'averageAssigned')).toBe(300_00);
    expect(autoAssignTarget(groceries, 'averageSpent')).toBe(250_00);
  });
});

describe('planAutoAssign', () => {
  it('lists only changes and totals the extra money assigned', () => {
    const plan = planAutoAssign(
      [
        category({ id: 1, assignedLastMonthCents: 100_00 }),
        category({ id: 2, assignedCents: 50_00, assignedLastMonthCents: 80_00 }),
        category({ id: 3, assignedCents: 90_00, assignedLastMonthCents: 80_00 }),
      ],
      'assignedLastMonth',
    );

    expect(plan.changes).toEqual([
      { categoryId: 1, assignedCents: 100_00 },
      { categoryId: 2, assignedCents: 80_00 },
    ]);
    expect(plan.totalCents).toBe(130_00);
  });
});
