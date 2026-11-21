import type { Budget } from '@/api';

/** A month's totals across every category, hidden ones included: assigned and spent. */
export function monthSummary(budget: Budget) {
  const categories = budget.groups.flatMap((group) => group.categories);
  const assignedCents = categories.reduce((sum, category) => sum + category.assignedCents, 0);
  const activityCents = categories.reduce((sum, category) => sum + category.activityCents, 0);
  // Spending is money out, net of refunds; a month with more coming in than out spent nothing.
  return { assignedCents, spentCents: Math.max(0, -activityCents) };
}
