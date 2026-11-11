import { describe, expect, it } from 'vitest';
import { exportDate, exportMoney, exportMonth, toCsv } from './csv.js';
import {
  incomeVsExpense,
  monthsBetween,
  netWorth,
  spendingBreakdown,
  spendingTrends,
  type ReportLine,
} from './reports.js';

function line(overrides: Partial<ReportLine>): ReportLine {
  return {
    date: '2026-03-10',
    amountCents: -10_00,
    categoryId: 1,
    categoryName: 'Groceries',
    groupId: 10,
    groupName: 'Everyday',
    isReadyToAssign: false,
    isStartingBalance: false,
    payeeLabel: 'Corner Market',
    ...overrides,
  };
}

const dining = { categoryId: 2, categoryName: 'Dining', groupId: 10, groupName: 'Everyday' };
const rent = { categoryId: 3, categoryName: 'Rent', groupId: 20, groupName: 'Bills' };
const paycheck = {
  categoryId: 99,
  categoryName: 'Ready to Assign',
  groupId: null,
  groupName: null,
  isReadyToAssign: true,
  payeeLabel: 'Acme Payroll',
};

describe('monthsBetween', () => {
  it('lists months inclusively across a year boundary', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthsBetween('2026-03', '2026-03')).toEqual(['2026-03']);
  });
});

describe('spendingBreakdown', () => {
  const lines = [
    line({ amountCents: -100_00 }),
    line({ amountCents: 20_00 }),
    line({ ...dining, amountCents: -50_00, payeeLabel: 'Noodle House' }),
    line({ ...rent, amountCents: -1_000_00, payeeLabel: 'Landlord' }),
    line({ ...paycheck, amountCents: 3_000_00 }),
    line({
      categoryId: null,
      categoryName: null,
      groupId: null,
      groupName: null,
      amountCents: -5_00,
      payeeLabel: '',
    }),
  ];

  it('totals spending per category, net of refunds and without income, largest first', () => {
    expect(spendingBreakdown(lines, 'category')).toEqual({
      totalCents: 1_135_00,
      items: [
        { label: 'Rent', spentCents: 1_000_00 },
        { label: 'Groceries', spentCents: 80_00 },
        { label: 'Dining', spentCents: 50_00 },
        { label: 'Uncategorized', spentCents: 5_00 },
      ],
    });
  });

  it('groups by category group and by payee', () => {
    expect(spendingBreakdown(lines, 'group').items).toEqual([
      { label: 'Bills', spentCents: 1_000_00 },
      { label: 'Everyday', spentCents: 130_00 },
      { label: 'Uncategorized', spentCents: 5_00 },
    ]);
    expect(spendingBreakdown(lines, 'payee').items.map((item) => item.label)).toEqual([
      'Landlord',
      'Corner Market',
      'Noodle House',
      '(no payee)',
    ]);
  });

  it('leaves out anything refunded in full or more', () => {
    const result = spendingBreakdown(
      [line({ amountCents: -10_00 }), line({ amountCents: 15_00 })],
      'category',
    );

    expect(result).toEqual({ totalCents: 0, items: [] });
  });

  it('breaks ties alphabetically', () => {
    const result = spendingBreakdown([line({ ...dining }), line({})], 'category');

    expect(result.items.map((item) => item.label)).toEqual(['Dining', 'Groceries']);
  });
});

describe('spendingTrends', () => {
  const months = ['2026-03', '2026-04', '2026-05'];
  const lines = [
    line({ date: '2026-03-02', amountCents: -30_00 }),
    line({ date: '2026-03-20', ...rent, amountCents: -1_000_00 }),
    line({ date: '2026-05-05', amountCents: -60_00 }),
    line({ date: '2026-05-06', ...paycheck, amountCents: 2_000_00 }),
    line({ date: '2026-07-01', amountCents: -999_00 }),
  ];

  it('gives spending per month, including empty months, and the average', () => {
    expect(spendingTrends(lines, months)).toEqual({
      months: [
        { month: '2026-03', spentCents: 1_030_00 },
        { month: '2026-04', spentCents: 0 },
        { month: '2026-05', spentCents: 60_00 },
      ],
      averageCents: 363_33,
    });
  });

  it('narrows to one category or one group', () => {
    expect(
      spendingTrends(lines, months, { categoryId: 1 }).months.map((m) => m.spentCents),
    ).toEqual([30_00, 0, 60_00]);
    expect(spendingTrends(lines, months, { groupId: 20 }).averageCents).toBe(333_33);
  });

  it('averages to zero over no months', () => {
    expect(spendingTrends(lines, [])).toEqual({ months: [], averageCents: 0 });
  });
});

describe('incomeVsExpense', () => {
  const months = ['2026-03', '2026-04'];

  it('lists income by payee and expenses by group and category, month by month', () => {
    const result = incomeVsExpense(
      [
        line({ ...paycheck, date: '2026-03-01', amountCents: 3_000_00 }),
        line({ ...paycheck, date: '2026-04-01', amountCents: 3_100_00 }),
        line({
          ...paycheck,
          payeeLabel: 'Starting Balance',
          isStartingBalance: true,
          amountCents: 9_000_00,
        }),
        line({ date: '2026-03-05', amountCents: -100_00 }),
        line({ date: '2026-04-05', ...dining, amountCents: -40_00 }),
        line({ date: '2026-04-06', ...rent, amountCents: -1_000_00 }),
        line({ date: '2026-09-01', amountCents: -1_00 }),
      ],
      months,
    );

    expect(result.income).toEqual([
      { label: 'Acme Payroll', byMonth: [3_000_00, 3_100_00], totalCents: 6_100_00 },
    ]);
    expect(result.expenseGroups).toEqual([
      {
        label: 'Bills',
        byMonth: [0, -1_000_00],
        totalCents: -1_000_00,
        categories: [{ label: 'Rent', byMonth: [0, -1_000_00], totalCents: -1_000_00 }],
      },
      {
        label: 'Everyday',
        byMonth: [-100_00, -40_00],
        totalCents: -140_00,
        categories: [
          { label: 'Dining', byMonth: [0, -40_00], totalCents: -40_00 },
          { label: 'Groceries', byMonth: [-100_00, 0], totalCents: -100_00 },
        ],
      },
    ]);
    expect(result.incomeByMonth).toEqual([3_000_00, 3_100_00]);
    expect(result.expensesByMonth).toEqual([-100_00, -1_040_00]);
    expect(result.netByMonth).toEqual([2_900_00, 2_060_00]);
  });

  it('puts uncategorized spending under Uncategorized', () => {
    const result = incomeVsExpense(
      [line({ categoryId: null, categoryName: null, groupId: null, groupName: null })],
      ['2026-03'],
    );

    expect(result.expenseGroups).toMatchObject([
      { label: 'Uncategorized', categories: [{ label: 'Uncategorized' }] },
    ]);
  });
});

describe('netWorth', () => {
  it('splits month-end balances into assets and debts, carrying earlier history forward', () => {
    const result = netWorth(
      [
        { accountId: 1, month: '2026-01', cents: 1_000_00 },
        { accountId: 1, month: '2026-03', cents: -200_00 },
        { accountId: 2, month: '2026-02', cents: -300_00 },
        { accountId: 3, month: '2026-03', cents: 50_000_00 },
      ],
      ['2026-02', '2026-03'],
    );

    expect(result).toEqual([
      { month: '2026-02', assetsCents: 1_000_00, debtsCents: -300_00, netWorthCents: 700_00 },
      {
        month: '2026-03',
        assetsCents: 50_800_00,
        debtsCents: -300_00,
        netWorthCents: 50_500_00,
      },
    ]);
  });

  it('moves an account between assets and debts as its balance changes sign', () => {
    const result = netWorth(
      [
        { accountId: 1, month: '2026-01', cents: 100_00 },
        { accountId: 1, month: '2026-02', cents: -150_00 },
      ],
      ['2026-01', '2026-02'],
    );

    expect(result.map((point) => [point.assetsCents, point.debtsCents])).toEqual([
      [100_00, 0],
      [0, -50_00],
    ]);
  });
});

describe('CSV helpers', () => {
  it('quotes every field and doubles quotes inside them', () => {
    expect(
      toCsv([
        ['a', 'b, c'],
        ['He said "hi"', 3],
      ]),
    ).toBe('"a","b, c"\r\n"He said ""hi""","3"\r\n');
  });

  it('formats money, dates and months as YNAB exports them', () => {
    expect(exportMoney(1_234_56)).toBe('$1,234.56');
    expect(exportMoney(-5_00)).toBe('-$5.00');
    expect(exportMoney(0)).toBe('$0.00');
    expect(exportDate('2026-03-07')).toBe('03/07/2026');
    expect(exportMonth('2026-11')).toBe('Nov 2026');
  });
});
