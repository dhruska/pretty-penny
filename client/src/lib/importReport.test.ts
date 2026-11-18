import type { ImportNotes, ImportReport } from '@/api';
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  needsAttention,
  noteLines,
  partLine,
  reportText,
  signedCents,
  skippedScheduleLine,
  ynabTypeLabel,
} from './importReport';

const quietNotes: ImportNotes = {
  paymentCategories: [],
  splitTransfers: 0,
  startingDebtCents: 0,
  uncategorized: 0,
  recategorized: 0,
  unpairedTransfers: 0,
  unapproved: 0,
  flagged: 0,
  skippedSchedules: [],
};

const report: ImportReport = {
  month: '2026-11',
  accounts: [
    {
      name: 'Checking',
      ynabBalanceCents: 100_00,
      balanceCents: 100_00,
      ynabClearedCents: 50_00,
      clearedCents: 50_00,
      matches: true,
    },
  ],
  readyToAssign: {
    ynabCents: 60_00,
    cents: 50_00,
    parts: [{ key: 'creditOverspending', cents: -10_00 }],
  },
  categoriesCompared: 4,
  categoryDifferences: [],
  counts: {
    accounts: 1,
    categoryGroups: 2,
    categories: 4,
    payees: 3,
    transactions: 10,
    scheduled: 1,
    months: 2,
  },
  notes: quietNotes,
};

describe('ynabTypeLabel', () => {
  it('turns YNAB type names into words', () => {
    expect(ynabTypeLabel('creditCard')).toBe('Credit Card');
    expect(ynabTypeLabel('otherAsset')).toBe('Asset');
    expect(ynabTypeLabel('autoLoan')).toBe('Auto Loan');
    expect(ynabTypeLabel('mortgage')).toBe('Mortgage');
  });
});

describe('formatting', () => {
  it('signs amounts and formats dates', () => {
    expect(signedCents(300_00)).toBe('+$300.00');
    expect(signedCents(-5_00)).toBe('-$5.00');
    expect(signedCents(0)).toBe('$0.00');
    expect(formatDate('2026-12-01')).toBe('Dec 1, 2026');
  });

  it('describes skipped schedules, with or without a payee', () => {
    const schedule = {
      payee: 'Rent',
      accountName: 'Checking',
      nextDate: '2026-12-01',
      reason: 'Closed.',
    };
    expect(skippedScheduleLine(schedule)).toBe('Rent in Checking, next on Dec 1, 2026: Closed.');
    expect(skippedScheduleLine({ ...schedule, payee: '' })).toMatch(/^A scheduled transaction in/);
  });

  it('explains each part of a Ready to Assign difference', () => {
    expect(partLine({ key: 'paymentCategories', cents: 300_00 })).toMatch(
      /^\+\$300\.00 assigned to credit card payment categories/,
    );
    expect(partLine({ key: 'unexplained', cents: 1_00 })).toContain('worth investigating');
  });
});

describe('noteLines', () => {
  it('always mentions what is never imported', () => {
    expect(noteLines(quietNotes)).toEqual(['Targets, notes and payee locations aren’t imported.']);
  });

  it('describes each change, in singular or plural', () => {
    const lines = noteLines({
      ...quietNotes,
      paymentCategories: [{ name: 'Visa', assignedCents: 300_00, availableCents: 0 }],
      splitTransfers: 1,
      startingDebtCents: -300_00,
      uncategorized: 2,
      recategorized: 1,
      unpairedTransfers: 2,
      unapproved: 1,
      flagged: 3,
    });
    expect(lines).toEqual([
      'Credit card payment categories aren’t imported, since Pretty Penny treats cards like cash: Visa ($300.00 assigned).',
      'Starting balances YNAB kept out of Ready to Assign, such as card debt, go to Ready to Assign: -$300.00.',
      '1 split line that is a transfer becomes a separate transfer on the same date.',
      '2 transactions or split lines have no category. Pretty Penny leaves these out of the budget until they’re categorized.',
      '1 transaction moves to Uncategorized, because its category isn’t imported.',
      '2 transfers are missing the other side in YNAB and become ordinary transactions.',
      '1 unapproved transaction is imported as usual, since Pretty Penny has no approval step.',
      'Flags on 3 transactions aren’t imported.',
      'Targets, notes and payee locations aren’t imported.',
    ]);
  });
});

describe('needsAttention', () => {
  it('is false when only expected differences remain', () => {
    expect(needsAttention(report)).toBe(false);
  });

  it('is true for a mismatched account, category or unexplained difference', () => {
    expect(
      needsAttention({ ...report, accounts: [{ ...report.accounts[0]!, matches: false }] }),
    ).toBe(true);
    expect(
      needsAttention({
        ...report,
        categoryDifferences: [
          {
            groupName: 'G',
            name: 'C',
            ynabAvailableCents: 1,
            availableCents: 0,
            firstMonth: '2026-10',
          },
        ],
      }),
    ).toBe(true);
    expect(
      needsAttention({
        ...report,
        readyToAssign: { ...report.readyToAssign, parts: [{ key: 'unexplained', cents: 1 }] },
      }),
    ).toBe(true);
  });
});

describe('reportText', () => {
  it('writes the whole comparison as plain text', () => {
    const text = reportText({
      ...report,
      notes: {
        ...quietNotes,
        skippedSchedules: [
          {
            payee: 'Rent',
            accountName: 'Old',
            nextDate: '2026-12-01',
            reason: 'Its account is closed.',
          },
        ],
      },
    });
    expect(text).toContain('OK   Checking: $100.00 / $100.00, cleared $50.00 / $50.00');
    expect(text).toContain('Budget for November 2026');
    expect(text).toContain('Ready to Assign: $50.00 here, $60.00 in YNAB');
    expect(text).toContain('-$10.00 most likely from credit card overspending');
    expect(text).toContain('All 4 categories’ Available match YNAB.');
    expect(text).toContain('1 account, 4 categories in 2 groups, 10 transactions');
    expect(text).toContain('Skipped scheduled transaction: Rent in Old, next on Dec 1, 2026');
  });

  it('lists differences when there are any', () => {
    const text = reportText({
      ...report,
      accounts: [{ ...report.accounts[0]!, matches: false }],
      categoryDifferences: [
        {
          groupName: 'Everyday',
          name: 'Groceries',
          ynabAvailableCents: 310_00,
          availableCents: 300_00,
          firstMonth: '2026-10',
        },
      ],
    });
    expect(text).toContain('DIFF Checking');
    expect(text).toContain(
      'DIFF Everyday: Groceries: $300.00 here, $310.00 in YNAB, since October 2026',
    );
  });
});
