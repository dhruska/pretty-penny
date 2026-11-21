import type { Account, Budget, ClearedStatus, SearchResults, Transaction } from '@/api';
import type { InfiniteData } from '@tanstack/react-query';

/** The screen's budget after setting a category's Assigned, before the server answers. */
export function applyAssignment(budget: Budget, categoryId: number, assignedCents: number): Budget {
  let delta = 0;
  const groups = budget.groups.map((group) => ({
    ...group,
    categories: group.categories.map((category) => {
      if (category.id !== categoryId) return category;
      delta = assignedCents - category.assignedCents;
      return {
        ...category,
        assignedCents,
        availableCents: category.availableCents + delta,
      };
    }),
  }));
  return { ...budget, groups, readyToAssignCents: budget.readyToAssignCents - delta };
}

/**
 * The screen's budget after moving money, before the server answers. A move is two Assigned
 * changes; null stands for Ready to Assign, which changing a category's Assigned already updates.
 */
export function applyMove(
  budget: Budget,
  move: { fromCategoryId: number | null; toCategoryId: number | null; amountCents: number },
): Budget {
  const shift = (current: Budget, id: number | null, cents: number) => {
    if (id === null) return current;
    const category = current.groups.flatMap((group) => group.categories).find((c) => c.id === id);
    return category ? applyAssignment(current, id, category.assignedCents + cents) : current;
  };
  return shift(
    shift(budget, move.fromCategoryId, -move.amountCents),
    move.toCategoryId,
    move.amountCents,
  );
}

type Pages = InfiniteData<Transaction[], number | undefined>;

/** A register's pages with one transaction changed or, with null, removed. */
export function updateInPages(data: Pages, id: number, change: Partial<Transaction> | null): Pages {
  return {
    ...data,
    pages: data.pages.map((page) =>
      change === null
        ? page.filter((row) => row.id !== id)
        : page.map((row) => (row.id === id ? { ...row, ...change } : row)),
    ),
  };
}

/** Search results with one transaction changed or, with null, removed. */
export function updateInResults(
  data: SearchResults,
  id: number,
  change: Partial<Transaction> | null,
): SearchResults {
  return {
    ...data,
    transactions:
      change === null
        ? data.transactions.filter((row) => row.id !== id)
        : data.transactions.map((row) => (row.id === id ? { ...row, ...change } : row)),
  };
}

/** Accounts' cleared balances after a transaction's cleared status changes. */
export function applyCleared(
  accounts: Account[],
  transaction: Pick<Transaction, 'accountId' | 'amountCents' | 'cleared'>,
  cleared: ClearedStatus,
): Account[] {
  const wasCleared = transaction.cleared !== 'uncleared';
  const isCleared = cleared !== 'uncleared';
  if (wasCleared === isCleared) return accounts;
  const delta = isCleared ? transaction.amountCents : -transaction.amountCents;
  return accounts.map((account) =>
    account.id === transaction.accountId
      ? { ...account, clearedBalanceCents: account.clearedBalanceCents + delta }
      : account,
  );
}
