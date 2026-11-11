import type { Transaction } from '@/api';
import { describe, expect, it } from 'vitest';
import { matchesFilter, payeeLabel } from './transactions';

const base: Transaction = {
  id: 1,
  accountId: 1,
  accountName: 'Checking',
  date: '2026-03-02',
  payee: 'Corner Market',
  memo: 'weekly shop',
  amountCents: -1_234_56,
  cleared: 'uncleared',
  categoryId: 5,
  categoryName: 'Groceries',
  hasCategoryLine: true,
  transferAccountId: null,
  transferAccountName: null,
  lines: [{ categoryId: 5, categoryName: 'Groceries', amountCents: -1_234_56, memo: '' }],
};

describe('payeeLabel', () => {
  it('shows the other account for transfers', () => {
    expect(payeeLabel(base)).toBe('Corner Market');
    expect(payeeLabel({ ...base, payee: '', transferAccountName: 'Savings' })).toBe(
      'Transfer: Savings',
    );
  });
});

describe('matchesFilter', () => {
  it.each(['', 'corner', 'GROCERIES', 'weekly', '2026-03', '1,234.56', '$1,234'])(
    'matches "%s"',
    (filter) => {
      expect(matchesFilter(base, filter)).toBe(true);
    },
  );

  it('matches a transfer by the other account', () => {
    expect(matchesFilter({ ...base, transferAccountName: 'Savings' }, 'savings')).toBe(true);
  });

  it('matches a split by any line’s category or memo', () => {
    const split: Transaction = {
      ...base,
      categoryName: 'Split',
      lines: [
        { categoryId: 5, categoryName: 'Groceries', amountCents: -1_000_00, memo: '' },
        { categoryId: 6, categoryName: 'Household', amountCents: -234_56, memo: 'light bulbs' },
      ],
    };

    expect(matchesFilter(split, 'household')).toBe(true);
    expect(matchesFilter(split, 'bulbs')).toBe(true);
  });

  it('rejects text that appears nowhere', () => {
    expect(matchesFilter(base, 'noodles')).toBe(false);
  });
});
