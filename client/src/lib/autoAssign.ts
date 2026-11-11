import type { AssignmentInput, BudgetCategory } from '@/api';

export type AutoAssignOption =
  'underfunded' | 'assignedLastMonth' | 'spentLastMonth' | 'averageAssigned' | 'averageSpent';

export const AUTO_ASSIGN_OPTIONS: { value: AutoAssignOption; label: string }[] = [
  { value: 'underfunded', label: 'Underfunded' },
  { value: 'assignedLastMonth', label: 'Assigned last month' },
  { value: 'spentLastMonth', label: 'Spent last month' },
  { value: 'averageAssigned', label: 'Average assigned' },
  { value: 'averageSpent', label: 'Average spent' },
];

const FIGURES: Record<Exclude<AutoAssignOption, 'underfunded'>, keyof BudgetCategory> = {
  assignedLastMonth: 'assignedLastMonthCents',
  spentLastMonth: 'spentLastMonthCents',
  averageAssigned: 'averageAssignedCents',
  averageSpent: 'averageSpentCents',
};

/**
 * The Assigned amount an option would set, or null if it wouldn't change the category.
 * Underfunded covers overspending and upcoming scheduled outflows. The others put their amount into Assigned, as in YNAB, but
 * never lower an amount that's already higher.
 */
export function autoAssignTarget(category: BudgetCategory, option: AutoAssignOption) {
  if (option === 'underfunded') {
    // As in YNAB, cover overspending plus scheduled money still to go out this month.
    const shortfall = -(category.availableCents + Math.min(0, category.upcomingCents));
    return shortfall > 0 ? category.assignedCents + shortfall : null;
  }
  const amount = category[FIGURES[option]] as number;
  return amount > category.assignedCents ? amount : null;
}

export function planAutoAssign(categories: BudgetCategory[], option: AutoAssignOption) {
  const changes: AssignmentInput[] = [];
  let totalCents = 0;
  for (const category of categories) {
    const target = autoAssignTarget(category, option);
    if (target === null) continue;
    changes.push({ categoryId: category.id, assignedCents: target });
    totalCents += target - category.assignedCents;
  }
  return { changes, totalCents };
}
