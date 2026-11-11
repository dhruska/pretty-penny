/**
 * A payee's default category, given the categories of its transactions from oldest to newest.
 *
 * As in YNAB, the default starts as the first category used, and only changes when 2 of the
 * 3 most recent transactions agree on a different category.
 */
export function defaultCategory(categoryIds: number[]): number | null {
  let current: number | null = null;
  const recent: number[] = [];

  for (const categoryId of categoryIds) {
    recent.push(categoryId);
    if (recent.length > 3) recent.shift();

    if (current === null) {
      current = categoryId;
    } else if (
      categoryId !== current &&
      recent.filter((recentId) => recentId === categoryId).length >= 2
    ) {
      current = categoryId;
    }
  }
  return current;
}
