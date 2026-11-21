import type { Transaction } from '@/api';

/** The payee to show, which for a transfer is the other account. */
export function payeeLabel(transaction: Transaction): string {
  return transaction.transferAccountName
    ? `Transfer: ${transaction.transferAccountName}`
    : transaction.payee;
}
