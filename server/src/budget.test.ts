import { describe, expect, it } from 'vitest';
import { computeBudget, nextMonth, type BudgetFacts } from './budget.js';

const FOOD = 1;
const RENT = 2;

function facts(overrides: Partial<BudgetFacts>): BudgetFacts {
  return { categoryIds: [FOOD, RENT], assignments: [], activity: [], inflows: [], ...overrides };
}

function food(input: BudgetFacts, month: string, currentMonth = month) {
  return computeBudget(input, month, currentMonth).categories.get(FOOD);
}

function amount(categoryId: number, month: string, cents: number) {
  return { categoryId, month, cents };
}

describe('nextMonth', () => {
  it('advances within a year and across a year boundary', () => {
    expect(nextMonth('2026-01')).toBe('2026-02');
    expect(nextMonth('2026-09')).toBe('2026-10');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('computeBudget', () => {
  it('returns zeros when there is no data', () => {
    const result = computeBudget(facts({}), '2026-03', '2026-03');

    expect(result.readyToAssignCents).toBe(0);
    expect(result.categories.get(FOOD)).toEqual({
      assignedCents: 0,
      activityCents: 0,
      availableCents: 0,
    });
  });

  it('combines assignments and activity within a month', () => {
    const input = facts({
      assignments: [amount(FOOD, '2026-01', 100_00)],
      activity: [amount(FOOD, '2026-01', -30_00)],
    });

    expect(food(input, '2026-01')).toEqual({
      assignedCents: 100_00,
      activityCents: -30_00,
      availableCents: 70_00,
    });
  });

  it('rolls unspent money into later months', () => {
    const input = facts({
      assignments: [amount(FOOD, '2026-01', 100_00), amount(FOOD, '2026-02', 50_00)],
      activity: [amount(FOOD, '2026-01', -30_00), amount(FOOD, '2026-02', -10_00)],
    });

    expect(food(input, '2026-02')?.availableCents).toBe(110_00);
    expect(food(input, '2026-03', '2026-02')).toEqual({
      assignedCents: 0,
      activityCents: 0,
      availableCents: 110_00,
    });
  });

  it('rolls across a year boundary and through months with no activity', () => {
    const input = facts({ assignments: [amount(FOOD, '2025-11', 40_00)] });

    expect(food(input, '2026-02', '2026-02')?.availableCents).toBe(40_00);
  });

  it('shows historic figures when viewing a past month', () => {
    const input = facts({
      assignments: [amount(FOOD, '2026-01', 100_00), amount(FOOD, '2026-03', 25_00)],
      activity: [amount(FOOD, '2026-02', -20_00)],
    });

    expect(food(input, '2026-02', '2026-04')).toEqual({
      assignedCents: 0,
      activityCents: -20_00,
      availableCents: 80_00,
    });
  });

  it('counts refunds as positive activity', () => {
    const input = facts({
      assignments: [amount(FOOD, '2026-01', 10_00)],
      activity: [amount(FOOD, '2026-01', 5_00)],
    });

    expect(food(input, '2026-01')?.availableCents).toBe(15_00);
  });

  it('keeps categories separate', () => {
    const input = facts({
      assignments: [amount(FOOD, '2026-01', 10_00), amount(RENT, '2026-01', 20_00)],
    });
    const result = computeBudget(input, '2026-01', '2026-01');

    expect(result.categories.get(FOOD)?.availableCents).toBe(10_00);
    expect(result.categories.get(RENT)?.availableCents).toBe(20_00);
  });

  describe('Ready to Assign', () => {
    it('is inflows minus assignments', () => {
      const input = facts({
        inflows: [{ month: '2026-01', cents: 1000_00 }],
        assignments: [amount(FOOD, '2026-01', 300_00)],
      });

      expect(computeBudget(input, '2026-01', '2026-01').readyToAssignCents).toBe(700_00);
    });

    it('is the same whichever month is viewed', () => {
      const input = facts({
        inflows: [{ month: '2026-01', cents: 1000_00 }],
        assignments: [amount(FOOD, '2026-01', 300_00)],
      });

      for (const month of ['2025-12', '2026-01', '2026-02']) {
        expect(computeBudget(input, month, '2026-01').readyToAssignCents).toBe(700_00);
      }
    });

    it('subtracts future assignments now, but they only fund their own month', () => {
      const input = facts({
        inflows: [{ month: '2026-01', cents: 1000_00 }],
        assignments: [amount(FOOD, '2026-03', 200_00)],
      });

      expect(computeBudget(input, '2026-01', '2026-01').readyToAssignCents).toBe(800_00);
      expect(food(input, '2026-02', '2026-01')?.availableCents).toBe(0);
      expect(food(input, '2026-03', '2026-01')?.availableCents).toBe(200_00);
    });

    it('ignores inflows dated after the current month until that month arrives', () => {
      const input = facts({ inflows: [{ month: '2026-02', cents: 500_00 }] });

      expect(computeBudget(input, '2026-01', '2026-01').readyToAssignCents).toBe(0);
      expect(computeBudget(input, '2026-02', '2026-02').readyToAssignCents).toBe(500_00);
    });

    it('treats a negative assignment as returning money', () => {
      const input = facts({
        inflows: [{ month: '2026-01', cents: 100_00 }],
        assignments: [amount(FOOD, '2026-01', -25_00)],
      });

      expect(computeBudget(input, '2026-01', '2026-01').readyToAssignCents).toBe(125_00);
      expect(food(input, '2026-01')?.availableCents).toBe(-25_00);
    });
  });

  describe('overspending', () => {
    const overspent = facts({
      inflows: [{ month: '2026-01', cents: 100_00 }],
      assignments: [amount(FOOD, '2026-01', 50_00)],
      activity: [amount(FOOD, '2026-01', -80_00)],
    });

    it('shows a negative Available in the overspent month', () => {
      expect(food(overspent, '2026-01')?.availableCents).toBe(-30_00);
    });

    it('does not reduce Ready to Assign while the month is still open', () => {
      expect(computeBudget(overspent, '2026-01', '2026-01').readyToAssignCents).toBe(50_00);
    });

    it('resets the category and reduces Ready to Assign once the month closes', () => {
      const result = computeBudget(overspent, '2026-02', '2026-02');

      expect(result.categories.get(FOOD)?.availableCents).toBe(0);
      expect(result.readyToAssignCents).toBe(20_00);
    });

    it('counts each closed month separately', () => {
      const input = facts({
        activity: [amount(FOOD, '2026-01', -10_00), amount(FOOD, '2026-02', -15_00)],
      });

      expect(computeBudget(input, '2026-03', '2026-03').readyToAssignCents).toBe(-25_00);
    });

    it('still shows the past shortfall when viewing that month later', () => {
      expect(food(overspent, '2026-01', '2026-03')?.availableCents).toBe(-30_00);
    });

    it('does not take a future overspend from Ready to Assign', () => {
      const input = facts({ activity: [amount(FOOD, '2026-03', -40_00)] });

      expect(computeBudget(input, '2026-04', '2026-01').readyToAssignCents).toBe(0);
    });
  });

  it('keeps Ready to Assign plus Available equal to the total of all money', () => {
    const inflows = [
      { month: '2026-01', cents: 2000_00 },
      { month: '2026-02', cents: 1500_00 },
      { month: '2026-03', cents: 1500_00 },
    ];
    const activity = [
      amount(FOOD, '2026-01', -350_00),
      amount(RENT, '2026-01', -900_00),
      amount(FOOD, '2026-02', -600_00),
      amount(RENT, '2026-02', -900_00),
      amount(FOOD, '2026-03', 20_00),
      amount(RENT, '2026-03', -1100_00),
    ];
    const input = facts({
      inflows,
      activity,
      assignments: [
        amount(FOOD, '2026-01', 400_00),
        amount(RENT, '2026-01', 900_00),
        amount(FOOD, '2026-02', 400_00),
        amount(RENT, '2026-02', 900_00),
        amount(FOOD, '2026-03', 400_00),
        amount(RENT, '2026-03', 900_00),
      ],
    });
    const totalMoney = [...inflows, ...activity].reduce((sum, { cents }) => sum + cents, 0);

    const result = computeBudget(input, '2026-03', '2026-03');
    const available = [...result.categories.values()].reduce(
      (sum, category) => sum + category.availableCents,
      0,
    );

    expect(result.readyToAssignCents + available).toBe(totalMoney);
  });
});
