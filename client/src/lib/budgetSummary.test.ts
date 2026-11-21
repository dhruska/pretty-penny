import type { Budget } from '@/api';
import { describe, expect, it } from 'vitest';
import { monthSummary } from './budgetSummary';

const budget = (activity: number[], assigned: number[]) =>
  ({
    groups: [
      {
        categories: activity.map((activityCents, index) => ({
          activityCents,
          assignedCents: assigned[index],
        })),
      },
      { categories: [] },
    ],
  }) as unknown as Budget;

describe('monthSummary', () => {
  it('totals what was assigned and spent, net of refunds', () => {
    expect(monthSummary(budget([-100_00, -50_00, 20_00], [200_00, 0, 30_00]))).toEqual({
      assignedCents: 230_00,
      spentCents: 130_00,
    });
  });

  it('counts a month with more refunded than spent as nothing spent', () => {
    expect(monthSummary(budget([40_00], [0])).spentCents).toBe(0);
  });
});
