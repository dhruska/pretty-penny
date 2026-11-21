import type { Account, Budget, BudgetCategory, Transaction } from '@/api';
import { describe, expect, it } from 'vitest';
import {
  applyAssignment,
  applyCleared,
  applyMove,
  updateInPages,
  updateInResults,
} from './optimistic';

function category(id: number, assignedCents: number, availableCents: number): BudgetCategory {
  return {
    id,
    name: `Category ${id}`,
    hidden: false,
    assignedCents,
    activityCents: availableCents - assignedCents,
    availableCents,
    assignedLastMonthCents: 0,
    spentLastMonthCents: 0,
    averageAssignedCents: 0,
    averageSpentCents: 0,
    upcomingCents: 0,
  };
}

const budget: Budget = {
  month: '2026-11',
  readyToAssignCents: 500_00,
  uncategorized: [],
  groups: [
    {
      id: 1,
      name: 'Everyday',
      hidden: false,
      categories: [category(10, 100_00, 40_00), category(11, 0, -5_00)],
    },
  ],
};
const find = (result: Budget, id: number) =>
  result.groups.flatMap((group) => group.categories).find((c) => c.id === id)!;

describe('assigning instantly', () => {
  it('moves Available and Ready to Assign by the change in Assigned', () => {
    const result = applyAssignment(budget, 10, 150_00);
    expect(find(result, 10)).toMatchObject({ assignedCents: 150_00, availableCents: 90_00 });
    expect(result.readyToAssignCents).toBe(450_00);
    // Lowering Assigned gives money back.
    expect(applyAssignment(budget, 10, 60_00).readyToAssignCents).toBe(540_00);
    // The original isn't changed, so it can be put back.
    expect(find(budget, 10).assignedCents).toBe(100_00);
  });

  it('leaves the budget alone for a category it doesn’t have', () => {
    expect(applyAssignment(budget, 99, 10_00)).toEqual(budget);
  });
});

describe('moving money instantly', () => {
  it('moves between categories without changing Ready to Assign', () => {
    const result = applyMove(budget, { fromCategoryId: 10, toCategoryId: 11, amountCents: 5_00 });
    expect(find(result, 10).availableCents).toBe(35_00);
    expect(find(result, 11).availableCents).toBe(0);
    expect(result.readyToAssignCents).toBe(500_00);
  });

  it('moves to and from Ready to Assign', () => {
    const covered = applyMove(budget, {
      fromCategoryId: null,
      toCategoryId: 11,
      amountCents: 5_00,
    });
    expect(find(covered, 11).availableCents).toBe(0);
    expect(covered.readyToAssignCents).toBe(495_00);
    const returned = applyMove(budget, {
      fromCategoryId: 10,
      toCategoryId: null,
      amountCents: 40_00,
    });
    expect(find(returned, 10).availableCents).toBe(0);
    expect(returned.readyToAssignCents).toBe(540_00);
  });
});

const row = (id: number, fields: Partial<Transaction> = {}) => ({ id, ...fields }) as Transaction;

describe('changing transactions instantly', () => {
  const pages = { pages: [[row(3), row(2)], [row(1)]], pageParams: [undefined, 2] };

  it('changes or removes a transaction in a register’s pages', () => {
    expect(updateInPages(pages, 1, { flag: 'red' }).pages[1]![0]!.flag).toBe('red');
    expect(updateInPages(pages, 2, null).pages.map((page) => page.map((r) => r.id))).toEqual([
      [3],
      [1],
    ]);
    expect(updateInPages(pages, 99, { flag: 'red' })).toEqual(pages);
  });

  it('changes or removes a transaction in search results', () => {
    const results = { transactions: [row(1), row(2)], hasMore: false };
    expect(updateInResults(results, 2, { cleared: 'cleared' }).transactions[1]!.cleared).toBe(
      'cleared',
    );
    expect(updateInResults(results, 1, null).transactions.map((r) => r.id)).toEqual([2]);
  });

  it('moves the cleared balance when cleared status changes', () => {
    const accounts = [
      { id: 1, clearedBalanceCents: 100_00 },
      { id: 2, clearedBalanceCents: 0 },
    ] as Account[];
    const spending = { accountId: 1, amountCents: -20_00, cleared: 'uncleared' as const };
    expect(applyCleared(accounts, spending, 'cleared')[0]!.clearedBalanceCents).toBe(80_00);
    expect(
      applyCleared(accounts, { ...spending, cleared: 'cleared' }, 'uncleared')[0]!
        .clearedBalanceCents,
    ).toBe(120_00);
    // Reconciled counts as cleared, and the other account is untouched.
    expect(applyCleared(accounts, { ...spending, cleared: 'reconciled' }, 'cleared')).toBe(
      accounts,
    );
    expect(applyCleared(accounts, spending, 'cleared')[1]).toBe(accounts[1]);
  });
});
