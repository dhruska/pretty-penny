import type { Transaction } from '@/api';
import { formatCents } from './money';

/** The payee to show, which for a transfer is the other account. */
export function payeeLabel(transaction: Transaction): string {
  return transaction.transferAccountName
    ? `Transfer: ${transaction.transferAccountName}`
    : transaction.payee;
}

/** Whether a transaction's visible text includes the filter, ignoring case. */
export function matchesFilter(transaction: Transaction, filter: string): boolean {
  const text = filter.trim().toLowerCase();
  if (text === '') return true;

  return [
    transaction.date,
    payeeLabel(transaction),
    transaction.categoryName ?? '',
    transaction.memo,
    formatCents(Math.abs(transaction.amountCents)),
  ].some((value) => value.toLowerCase().includes(text));
}
