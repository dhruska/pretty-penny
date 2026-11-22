import type { Transaction } from '@/api';
import { describe, expect, it } from 'vitest';
import { payeeLabel } from './transactions';

const base: Transaction = {
  id: 1,
  accountId: 1,
  accountName: 'Checking',
  date: '2026-03-02',
  payee: 'Corner Market',
  memo: 'weekly shop',
  amountCents: -1_234_56,
  cleared: 'uncleared',
  flag: null,
  categoryId: 5,
  categoryName: 'Groceries',
  hasCategoryLine: true,
  transferAccountId: null,
  transferAccountName: null,
  lines: [{ categoryId: 5, categoryName: 'Groceries', amountCents: -1_234_56, memo: '' }],
  approved: true,
  bank: null,
};

describe('payeeLabel', () => {
  it('shows the other account for transfers', () => {
    expect(payeeLabel(base)).toBe('Corner Market');
    expect(payeeLabel({ ...base, payee: '', transferAccountName: 'Savings' })).toBe(
      'Transfer: Savings',
    );
  });
});
