import type { Account, BankAccount } from '@/api';

/** A bank account as banks show it: its name and the last four digits. */
export const bankAccountLabel = (account: Pick<BankAccount, 'name' | 'mask'>) =>
  account.mask ? `${account.name} ••${account.mask}` : account.name;

/** When the bank's balances were fetched: "just now", "5 minutes ago", "3 hours ago" or a date. */
export function updatedAgo(updatedAt: string | null, now = new Date()): string {
  if (!updatedAt) return 'Not updated yet';
  const minutes = Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Updated ${new Date(updatedAt).toLocaleDateString()}`;
}

/**
 * How far the bank's balance is from Pretty Penny's cleared balance, or null when they agree
 * or the bank gives no balance. A difference usually means something to clear or reconcile.
 */
export function bankDifference(account: Pick<Account, 'bank' | 'clearedBalanceCents'>) {
  const bankBalance = account.bank?.balanceCents;
  if (bankBalance === null || bankBalance === undefined) return null;
  const difference = bankBalance - account.clearedBalanceCents;
  return difference === 0 ? null : difference;
}

/** Accounts a bank account can link to: open ones not linked to a different bank account. */
export function linkableAccounts(accounts: Account[], bankAccountId: number) {
  return accounts.filter(
    (account) =>
      !account.closed && (account.bank === null || account.bank.bankAccountId === bankAccountId),
  );
}
