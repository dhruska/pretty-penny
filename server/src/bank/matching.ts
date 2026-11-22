import type { PlaidTransaction } from './plaid.js';

/** As in YNAB, an import matches a transaction up to 10 days either side of it. */
export const MATCH_WINDOW_DAYS = 10;
/** As in YNAB, importing into an existing account starts 3 days before its newest reconciled one. */
export const START_OVERLAP_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Whole days from one YYYY-MM-DD date to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** A YYYY-MM-DD date moved by some days. */
export function addDays(date: string, days: number): string {
  return new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The purchase date when the bank gives one, otherwise the posted date. */
export const importDate = (transaction: Pick<PlaidTransaction, 'date' | 'authorized_date'>) =>
  transaction.authorized_date ?? transaction.date;

/** Plaid's amount in Pretty Penny's terms: negative for money out. */
export const importAmountCents = (transaction: Pick<PlaidTransaction, 'amount'>) =>
  -Math.round(transaction.amount * 100);

/** The payee an import gets: Plaid's merchant name when it has one, otherwise the bank's text. */
export function importPayee(transaction: { name: string; merchantName: string | null }): string {
  return (transaction.merchantName?.trim() || transaction.name.trim()).slice(0, 200);
}

export interface Dated {
  id: number;
  date: string;
  amountCents: number;
}

/**
 * Pairs imports with transactions you entered, as YNAB does: the same amount, dates within 10
 * days, the closest date first, then the oldest, one to one. Imports are taken oldest first.
 * Returns each matched import's id with its transaction's id.
 */
export function matchImports(imports: Dated[], candidates: Dated[]): Map<number, number> {
  const matches = new Map<number, number>();
  const used = new Set<number>();
  const ordered = [...imports].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  for (const item of ordered) {
    let best: Dated | null = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (used.has(candidate.id) || candidate.amountCents !== item.amountCents) continue;
      const distance = Math.abs(daysBetween(item.date, candidate.date));
      if (distance > MATCH_WINDOW_DAYS) continue;
      const better =
        distance < bestDistance ||
        (distance === bestDistance &&
          best !== null &&
          (candidate.date < best.date || (candidate.date === best.date && candidate.id < best.id)));
      if (better) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) {
      matches.set(item.id, best.id);
      used.add(best.id);
    }
  }
  return matches;
}

/**
 * Where importing into an existing account starts: 3 days before its newest reconciled
 * transaction, or if none, 3 days before its newest transaction up to today. An account with
 * neither starts today.
 */
export function defaultImportFrom(
  newestReconciled: string | null,
  newestEntered: string | null,
  today: string,
): string {
  const from = newestReconciled ?? newestEntered;
  return from === null ? today : addDays(from, -START_OVERLAP_DAYS);
}
