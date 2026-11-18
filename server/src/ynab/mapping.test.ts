import { describe, expect, it } from 'vitest';
import { sampleYnabPlan } from '../test/ynab-plan.js';
import { mapAccountType, planImport, READY_TO_ASSIGN, scheduleStart } from './mapping.js';

describe('mapAccountType', () => {
  it('keeps types that exist on the same side', () => {
    expect(mapAccountType('checking', true)).toBe('checking');
    expect(mapAccountType('savings', true)).toBe('savings');
    expect(mapAccountType('cash', true)).toBe('cash');
    expect(mapAccountType('creditCard', true)).toBe('credit_card');
    expect(mapAccountType('lineOfCredit', true)).toBe('line_of_credit');
    expect(mapAccountType('otherAsset', false)).toBe('asset');
  });

  it('turns loans and other debt into liabilities', () => {
    for (const type of ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt']) {
      expect(mapAccountType(type, false)).toBe('liability');
    }
    expect(mapAccountType('otherLiability', false)).toBe('liability');
  });

  it('picks the closest type when YNAB has an account on the other side', () => {
    expect(mapAccountType('mortgage', true)).toBe('line_of_credit');
    expect(mapAccountType('otherAsset', true)).toBe('savings');
    expect(mapAccountType('checking', false)).toBe('asset');
    expect(mapAccountType('creditCard', false)).toBe('liability');
    expect(mapAccountType('lineOfCredit', false)).toBe('liability');
  });

  it('guesses unknown types from the balance', () => {
    expect(mapAccountType('somethingNew', false, 100)).toBe('asset');
    expect(mapAccountType('somethingNew', false, -100)).toBe('liability');
    expect(mapAccountType('somethingNew', true, -100)).toBe('line_of_credit');
  });
});

describe('scheduleStart', () => {
  it('keeps the first date when counting from it reaches the next date', () => {
    expect(scheduleStart('2026-01-31', 'monthly', '2026-11-30')).toEqual({
      firstDate: '2026-01-31',
      nextIndex: 10,
    });
    expect(scheduleStart('2026-11-01', 'twiceAMonth', '2026-11-16')).toEqual({
      firstDate: '2026-11-01',
      nextIndex: 1,
    });
    expect(scheduleStart('2026-12-05', 'never', '2026-12-05')).toEqual({
      firstDate: '2026-12-05',
      nextIndex: 0,
    });
  });

  it('restarts from the next date when counting never lands on it', () => {
    expect(scheduleStart('2026-11-01', 'twiceAMonth', '2026-11-20')).toEqual({
      firstDate: '2026-11-20',
      nextIndex: 0,
    });
    expect(scheduleStart('2026-11-01', 'never', '2026-12-01')).toEqual({
      firstDate: '2026-12-01',
      nextIndex: 0,
    });
  });
});

describe('planImport', () => {
  it('maps accounts, leaving out deleted ones', () => {
    const { accounts } = planImport(sampleYnabPlan());
    expect(
      accounts.map(({ name, type, onBudget, closed }) => ({ name, type, onBudget, closed })),
    ).toEqual([
      { name: 'Checking', type: 'checking', onBudget: true, closed: false },
      { name: 'Visa', type: 'credit_card', onBudget: true, closed: false },
      { name: 'Old Savings', type: 'savings', onBudget: true, closed: true },
      { name: 'House', type: 'asset', onBudget: false, closed: false },
      { name: 'Mortgage', type: 'liability', onBudget: false, closed: false },
      { name: 'Emergency Fund', type: 'asset', onBudget: false, closed: false },
    ]);
    expect(accounts[0]).toMatchObject({
      balanceCents: 7880_00,
      clearedBalanceCents: 6680_00,
      lastReconciledAt: '2026-10-01T15:00:00.000Z',
    });
  });

  it('keeps user categories in order with hidden flags, dropping internal and payment ones', () => {
    const { groups } = planImport(sampleYnabPlan());
    expect(groups).toEqual([
      {
        name: 'Bills',
        hidden: false,
        categories: [
          { ynabId: 'cat-rent', name: 'Rent', hidden: false },
          { ynabId: 'cat-mortgage', name: 'Mortgage', hidden: false },
        ],
      },
      {
        name: 'Everyday',
        hidden: false,
        categories: [
          { ynabId: 'cat-groceries', name: 'Groceries', hidden: false },
          { ynabId: 'cat-fun', name: 'Fun Money', hidden: true },
        ],
      },
      {
        name: 'Old Stuff',
        hidden: true,
        categories: [{ ynabId: 'cat-old', name: 'Old Category', hidden: false }],
      },
    ]);
  });

  it('keeps every nonzero assignment except to payment categories', () => {
    const { assignments } = planImport(sampleYnabPlan());
    expect(assignments).toContainEqual({
      ynabCategoryId: 'cat-rent',
      month: '2026-12',
      cents: 1200_00,
    });
    expect(assignments.filter((item) => item.month === '2026-09')).toHaveLength(3);
    expect(assignments.some((item) => item.ynabCategoryId === 'cat-visa-payment')).toBe(false);
  });

  it('turns splits, transfers and starting balances into what Pretty Penny records', () => {
    const { transactions } = planImport(sampleYnabPlan());

    expect(transactions.find((item) => item.payee === 'Big Box')).toMatchObject({
      amountCents: -150_00,
      memo: 'Weekly run',
      lines: [
        { category: 'cat-groceries', amountCents: -100_00, memo: 'food' },
        { category: 'cat-fun', amountCents: -50_00, memo: 'games' },
      ],
    });
    // The split line that was a transfer becomes its own transfer, keeping its category.
    expect(
      transactions.find((item) => item.transfer?.accountYnabId === 'acct-emergency'),
    ).toMatchObject({
      amountCents: -30_00,
      memo: 'save',
      category: 'cat-fun',
      cleared: 'uncleared',
    });

    // Each transfer is created once, from whichever side comes first.
    const visaPayments = transactions.filter(
      (item) => item.transfer?.accountYnabId === 'acct-visa',
    );
    expect(visaPayments.map((item) => item.amountCents)).toEqual([-300_00, -320_00]);
    expect(visaPayments[0]).toMatchObject({
      memo: 'Sept payment',
      cleared: 'cleared',
      category: null,
      transfer: { cleared: 'cleared', memo: 'Thanks' },
    });
    expect(
      transactions.find((item) => item.transfer?.accountYnabId === 'acct-mortgage'),
    ).toMatchObject({ category: 'cat-mortgage' });

    const starts = transactions.filter((item) => item.isStartingBalance);
    expect(starts).toHaveLength(6);
    expect(starts.find((item) => item.accountYnabId === 'acct-visa')!.category).toBe(
      READY_TO_ASSIGN,
    );
    expect(starts.find((item) => item.accountYnabId === 'acct-house')!.category).toBeNull();

    expect(transactions.some((item) => item.amountCents === -999_00)).toBe(false);
    expect(transactions.map((item) => item.date)).toEqual(
      [...transactions.map((item) => item.date)].sort(),
    );
  });

  it('plans schedules, skipping ones on closed accounts', () => {
    const { schedules, preview } = planImport(sampleYnabPlan());
    expect(schedules.map((item) => item.payee)).toEqual(['Landlord', 'Big Box', '', 'Allowance']);
    expect(schedules[0]).toMatchObject({
      firstDate: '2026-01-31',
      nextIndex: 10,
      nextDate: '2026-11-30',
    });
    expect(schedules[1]!.lines).toEqual([
      { category: 'cat-groceries', amountCents: -60_00, memo: 'food' },
      { category: 'cat-fun', amountCents: -40_00, memo: '' },
    ]);
    expect(schedules[2]).toMatchObject({
      transferAccountYnabId: 'acct-mortgage',
      category: 'cat-mortgage',
    });
    expect(schedules[3]).toMatchObject({ firstDate: '2026-11-20', nextIndex: 0 });
    expect(preview.notes.skippedSchedules).toEqual([
      {
        payee: 'Corner Market',
        accountName: 'Old Savings',
        nextDate: '2026-12-01',
        reason: 'Its account is closed.',
      },
    ]);
  });

  it('summarizes the plan and what changes', () => {
    const { preview } = planImport(sampleYnabPlan());
    expect(preview).toMatchObject({
      planName: 'Sample Plan',
      currency: 'USD',
      problems: [],
      fractionalAmounts: [],
      counts: {
        accounts: 6,
        categoryGroups: 3,
        categories: 5,
        payees: 8,
        transactions: 30,
        scheduled: 4,
        months: 4,
      },
      notes: {
        paymentCategories: [{ name: 'Visa', assignedCents: 300_00, availableCents: 0 }],
        splitTransfers: 1,
        startingDebtCents: -300_00,
        uncategorized: 1,
        recategorized: 0,
        unpairedTransfers: 0,
        unapproved: 1,
        flagged: 1,
      },
    });
  });

  it('refuses currencies without cents and amounts with fractions of a cent', () => {
    const plan = sampleYnabPlan();
    plan.currency_format = { iso_code: 'JPY', decimal_digits: 0 };
    plan.transactions[0]!.amount = 5_000_005;
    expect(planImport(plan).preview.problems).toEqual([
      expect.stringContaining('uses 0'),
      'This amount has a fraction of a cent, which Pretty Penny can’t store. Change it to whole cents in YNAB, then connect again.',
    ]);
  });

  it('lists each amount with a fraction of a cent that can be fixed in YNAB', () => {
    const plan = sampleYnabPlan();
    const find = (id: string) => plan.transactions.find((item) => item.id === id)!;
    // Both sides of a transfer change together in YNAB, so it's listed once.
    find('t-mortgage-sep').amount = -1_500_005;
    find('t-mortgage-sep-in').amount = 1_500_005;
    plan.subtransactions.find((sub) => sub.id === 'sub-games')!.amount -= 3;
    plan.scheduled_transactions.find((item) => item.id === 'st-rent')!.amount = -1_200_001;
    plan.scheduled_subtransactions.find((sub) => sub.id === 'ssub-fun')!.amount -= 7;
    plan.months[1]!.categories.find((item) => item.id === 'cat-groceries')!.budgeted = 300_009;
    // Left out: deleted items, categories that aren't imported, and balances.
    plan.months[1]!.categories.find((item) => item.id === 'cat-fun')!.deleted = true;
    plan.months[1]!.categories.find((item) => item.id === 'cat-fun')!.budgeted = 100_001;
    plan.transactions.find((item) => item.deleted)!.amount = 1;
    plan.accounts[0]!.balance += 1;
    plan.categories.find((item) => item.id === 'cat-rent')!.balance += 1;

    const { preview } = planImport(plan);
    expect(preview.problems).toEqual([
      'These amounts have a fraction of a cent, which Pretty Penny can’t store. Change them to whole cents in YNAB, then connect again.',
    ]);
    expect(preview.fractionalAmounts).toEqual([
      {
        kind: 'transaction',
        date: '2026-09-05',
        accountName: 'Checking',
        name: 'Transfer : Mortgage',
        milliunits: -1_500_005,
      },
      {
        kind: 'assigned',
        date: '2026-10',
        accountName: null,
        name: 'Groceries',
        milliunits: 300_009,
      },
      expect.objectContaining({ kind: 'transaction', name: 'Big Box' }),
      expect.objectContaining({ kind: 'scheduled', date: '2026-11-30', name: 'Landlord' }),
      expect.objectContaining({ kind: 'scheduled', name: 'Big Box' }),
    ]);
    expect(preview.fractionalAmounts[2]!.milliunits % 10).not.toBe(0);
  });

  it('moves transactions in categories that aren’t imported to Uncategorized', () => {
    const plan = sampleYnabPlan();
    plan.transactions.find((item) => item.id === 't-market-nov')!.category_id = 'cat-visa-payment';
    plan.transactions.find((item) => item.id === 't-pay-nov')!.category_id = 'cat-gone';
    const { transactions, preview } = planImport(plan);
    expect(preview.notes.recategorized).toBe(2);
    expect(preview.notes.uncategorized).toBe(3);
    expect(transactions.find((item) => item.amountCents === -80_00)!.category).toBeNull();
  });

  it('imports a transfer whose other side is missing as an ordinary transaction', () => {
    const plan = sampleYnabPlan();
    plan.transactions = plan.transactions.filter((item) => item.id !== 't-visa-pay-oct-in');
    plan.transactions.find((item) => item.id === 't-visa-pay-oct')!.transfer_transaction_id = null;
    const { transactions, preview } = planImport(plan);
    expect(preview.notes.unpairedTransfers).toBe(1);
    expect(transactions.find((item) => item.amountCents === -320_00)).toMatchObject({
      transfer: null,
      category: null,
    });
  });

  it('collapses splits that can’t stay splits', () => {
    const plan = sampleYnabPlan();
    // A split in a tracking account, and a split left with one line once its transfer is removed.
    plan.transactions.push({
      ...plan.transactions.find((item) => item.id === 't-interest-oct')!,
      id: 't-tracking-split',
      memo: null,
    });
    plan.subtransactions.push(
      {
        id: 'ts-1',
        transaction_id: 't-tracking-split',
        amount: -400_000,
        memo: 'a',
        deleted: false,
      },
      {
        id: 'ts-2',
        transaction_id: 't-tracking-split',
        amount: -600_000,
        memo: 'b',
        deleted: false,
      },
    );
    plan.subtransactions = plan.subtransactions.filter((sub) => sub.id !== 'sub-games');
    plan.subtransactions.find((sub) => sub.id === 'sub-food')!.amount = -150_000;
    plan.transactions.find((item) => item.id === 't-bigbox')!.memo = null;

    const { transactions } = planImport(plan);
    expect(transactions.find((item) => item.payee === 'Big Box')).toMatchObject({
      lines: null,
      category: 'cat-groceries',
      amountCents: -150_00,
      memo: 'food',
    });
    expect(
      transactions.filter(
        (item) => item.accountYnabId === 'acct-mortgage' && item.date === '2026-10-06',
      ),
    ).toEqual([
      expect.objectContaining({ amountCents: -1000_00, lines: null, category: null }),
      expect.objectContaining({ amountCents: -1000_00, lines: null, category: null }),
    ]);
  });

  it('handles the other side of a split line transfer listed before its split', () => {
    const plan = sampleYnabPlan();
    const index = plan.transactions.findIndex((item) => item.id === 't-emergency-save');
    const [partner] = plan.transactions.splice(index, 1);
    plan.transactions.unshift(partner!);

    const { transactions } = planImport(plan);
    expect(transactions.filter((item) => item.accountYnabId === 'acct-emergency')).toHaveLength(1);
    expect(
      transactions.filter((item) => item.transfer?.accountYnabId === 'acct-emergency'),
    ).toHaveLength(1);
  });

  it('skips schedules it can’t represent', () => {
    const plan = sampleYnabPlan();
    const base = plan.scheduled_transactions[0]!;
    plan.scheduled_transactions = [
      { ...base, id: 'odd', frequency: 'everyFullMoon' },
      { ...base, id: 'gone', transfer_account_id: 'acct-nowhere' },
      { ...base, id: 'split-transfer' },
      { ...base, id: 'deleted', deleted: true },
    ];
    plan.scheduled_subtransactions = [
      {
        id: 'x',
        scheduled_transaction_id: 'split-transfer',
        amount: -1_000_000,
        transfer_account_id: 'acct-visa',
        deleted: false,
      },
    ];
    const { schedules, preview } = planImport(plan);
    expect(schedules).toEqual([]);
    expect(preview.notes.skippedSchedules.map((item) => item.reason)).toEqual([
      'It repeats on a schedule Pretty Penny doesn’t support.',
      'The account it transfers to no longer exists.',
      'One of its split lines is a transfer, which Pretty Penny doesn’t support yet.',
    ]);
  });
});
