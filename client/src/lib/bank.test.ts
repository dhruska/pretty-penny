import { describe, expect, it } from 'vitest';
import type { Account, AccountBank } from '@/api';
import { bankAccountLabel, bankDifference, linkableAccounts, updatedAgo } from './bank';

const bank = (changes: Partial<AccountBank> = {}): AccountBank => ({
  bankAccountId: 1,
  connectionId: 1,
  importFrom: null,
  institutionName: 'Northwind Bank',
  mask: '1234',
  balanceCents: 10000,
  status: 'ok',
  problem: null,
  updatedAt: null,
  ...changes,
});

const account = (id: number, changes: Partial<Account> = {}): Account => ({
  id,
  name: `Account ${id}`,
  type: 'checking',
  onBudget: true,
  closed: false,
  balanceCents: 0,
  clearedBalanceCents: 0,
  lastReconciledAt: null,
  unapprovedCount: 0,
  bank: null,
  ...changes,
});

describe('bank account labels', () => {
  it('add the last four digits when the bank gives them', () => {
    expect(bankAccountLabel({ name: 'Everyday Checking', mask: '1234' })).toBe(
      'Everyday Checking ••1234',
    );
    expect(bankAccountLabel({ name: 'Everyday Checking', mask: null })).toBe('Everyday Checking');
  });
});

describe('when balances were updated', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it('says how long ago, in words', () => {
    expect(updatedAgo(null, now)).toBe('Not updated yet');
    expect(updatedAgo(ago(0.5), now)).toBe('Updated just now');
    expect(updatedAgo(ago(1), now)).toBe('Updated 1 minute ago');
    expect(updatedAgo(ago(59), now)).toBe('Updated 59 minutes ago');
    expect(updatedAgo(ago(60), now)).toBe('Updated 1 hour ago');
    expect(updatedAgo(ago(23 * 60), now)).toBe('Updated 23 hours ago');
    expect(updatedAgo(ago(48 * 60), now)).toBe(
      `Updated ${new Date(ago(48 * 60)).toLocaleDateString()}`,
    );
  });
});

describe('the bank’s balance against the cleared balance', () => {
  it('gives the difference, or null when they agree or the bank gives none', () => {
    expect(bankDifference({ bank: bank(), clearedBalanceCents: 9000 })).toBe(1000);
    expect(bankDifference({ bank: bank(), clearedBalanceCents: 12000 })).toBe(-2000);
    expect(bankDifference({ bank: bank(), clearedBalanceCents: 10000 })).toBeNull();
    expect(
      bankDifference({ bank: bank({ balanceCents: null }), clearedBalanceCents: 0 }),
    ).toBeNull();
    expect(bankDifference({ bank: null, clearedBalanceCents: 0 })).toBeNull();
  });
});

describe('accounts a bank account can link to', () => {
  it('leaves out closed accounts and ones linked to another bank account', () => {
    const accounts = [
      account(1),
      account(2, { closed: true }),
      account(3, { bank: bank({ bankAccountId: 7 }) }),
      account(4, { bank: bank({ bankAccountId: 8 }) }),
    ];
    expect(linkableAccounts(accounts, 7).map((found) => found.id)).toEqual([1, 3]);
  });
});
