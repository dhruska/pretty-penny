/**
 * Spreads a remaining amount across split lines in proportion to their sizes, as YNAB does for
 * things like sales tax. Any cent left over from rounding goes to the largest line. If every
 * line is zero, the whole remainder goes to the first line.
 */
export function spreadRemainder(amounts: number[], remainingCents: number): number[] {
  if (remainingCents === 0 || amounts.length === 0) return amounts;

  const weights = amounts.map((amount) => Math.abs(amount));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    return amounts.map((amount, index) => (index === 0 ? amount + remainingCents : amount));
  }

  const shares = weights.map((weight) => Math.trunc((remainingCents * weight) / totalWeight));
  const leftover = remainingCents - shares.reduce((sum, share) => sum + share, 0);
  const largest = weights.indexOf(Math.max(...weights));
  shares[largest]! += leftover;

  return amounts.map((amount, index) => amount + shares[index]!);
}
