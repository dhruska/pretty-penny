import type {
  YnabAccount,
  YnabCategory,
  YnabCleared,
  YnabMonth,
  YnabPlan,
  YnabScheduledSubtransaction,
  YnabScheduledTransaction,
  YnabSubtransaction,
  YnabTransaction,
} from '../ynab/types.js';

/**
 * A made-up YNAB plan in the shape YNAB's API returns, used by the import tests. Its figures
 * (balances, Available, Ready to Assign) are what YNAB would report for these transactions.
 *
 * Pretty Penny's Ready to Assign for November should come out $10.00 below YNAB's $3,660.00:
 *   +$300.00 assigned to the Visa payment category, which isn't imported
 *   −$300.00 Visa starting debt, which Pretty Penny takes from Ready to Assign
 *   +$40.00  October's uncategorized spending, which YNAB took from Ready to Assign
 *   −$50.00  September's credit overspending on groceries, which YNAB added to the Visa balance
 */

const $ = (dollars: number) => Math.round(dollars * 1000);

function account(
  id: string,
  name: string,
  type: string,
  onBudget: boolean,
  balance: number,
  cleared: number,
  extra: Partial<YnabAccount> = {},
): YnabAccount {
  return {
    id,
    name,
    type,
    on_budget: onBudget,
    closed: false,
    balance: $(balance),
    cleared_balance: $(cleared),
    last_reconciled_at: null,
    deleted: false,
    ...extra,
  };
}

function transaction(
  id: string,
  accountId: string,
  date: string,
  amount: number,
  fields: Partial<YnabTransaction> & { cleared?: YnabCleared } = {},
): YnabTransaction {
  return {
    id,
    account_id: accountId,
    date,
    amount: $(amount),
    memo: null,
    cleared: 'uncleared',
    approved: true,
    flag_color: null,
    payee_id: null,
    category_id: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    deleted: false,
    ...fields,
  };
}

/** Both sides of a transfer, pointing at each other as YNAB's are. */
function transfer(
  ids: [string, string],
  from: string,
  to: string,
  date: string,
  amount: number,
  fields: [Partial<YnabTransaction>, Partial<YnabTransaction>] = [{}, {}],
) {
  return [
    transaction(ids[0], from, date, -amount, {
      payee_id: `payee-transfer-${to}`,
      transfer_account_id: to,
      transfer_transaction_id: ids[1],
      ...fields[0],
    }),
    transaction(ids[1], to, date, amount, {
      payee_id: `payee-transfer-${from}`,
      transfer_account_id: from,
      transfer_transaction_id: ids[0],
      ...fields[1],
    }),
  ];
}

const CATEGORY_GROUPS: Record<string, string> = {
  'cat-rta': 'group-internal',
  'cat-uncategorized': 'group-internal',
  'cat-visa-payment': 'group-cc',
  'cat-rent': 'group-bills',
  'cat-mortgage': 'group-bills',
  'cat-groceries': 'group-everyday',
  'cat-fun': 'group-everyday',
  'cat-retired': 'group-everyday',
  'cat-old': 'group-old',
};

const CATEGORY_NAMES: Record<string, string> = {
  'cat-rta': 'Inflow: Ready to Assign',
  'cat-uncategorized': 'Uncategorized',
  'cat-visa-payment': 'Visa',
  'cat-rent': 'Rent',
  'cat-mortgage': 'Mortgage',
  'cat-groceries': 'Groceries',
  'cat-fun': 'Fun Money',
  'cat-retired': 'Retired',
  'cat-old': 'Old Category',
};

function category(id: string, budgeted = 0, balance = 0): YnabCategory {
  return {
    id,
    category_group_id: CATEGORY_GROUPS[id]!,
    name: CATEGORY_NAMES[id]!,
    hidden: id === 'cat-fun',
    deleted: id === 'cat-retired',
    budgeted: $(budgeted),
    activity: 0,
    balance: $(balance),
  };
}

/** One month of YNAB's budget: [budgeted, available] for each category that has either. */
function month(
  date: string,
  readyToAssign: number,
  figures: Record<string, [number, number]>,
): YnabMonth {
  return {
    month: date,
    to_be_budgeted: $(readyToAssign),
    deleted: false,
    categories: Object.keys(CATEGORY_NAMES).map((id) =>
      category(id, figures[id]?.[0] ?? 0, figures[id]?.[1] ?? 0),
    ),
  };
}

function scheduled(
  id: string,
  accountId: string,
  frequency: string,
  dates: [string, string],
  amount: number,
  fields: Partial<YnabScheduledTransaction> = {},
): YnabScheduledTransaction {
  return {
    id,
    account_id: accountId,
    frequency,
    date_first: dates[0],
    date_next: dates[1],
    amount: $(amount),
    memo: null,
    payee_id: null,
    category_id: null,
    transfer_account_id: null,
    deleted: false,
    ...fields,
  };
}

export function sampleYnabPlan(): YnabPlan {
  const subtransactions: YnabSubtransaction[] = [
    {
      id: 'sub-food',
      transaction_id: 't-bigbox',
      amount: $(-100),
      memo: 'food',
      category_id: 'cat-groceries',
      deleted: false,
    },
    {
      id: 'sub-games',
      transaction_id: 't-bigbox',
      amount: $(-50),
      memo: 'games',
      category_id: 'cat-fun',
      deleted: false,
    },
    {
      // A split line that is a transfer, which Pretty Penny imports as a separate transfer.
      id: 'sub-save',
      transaction_id: 't-bigbox',
      amount: $(-30),
      memo: 'save',
      category_id: 'cat-fun',
      transfer_account_id: 'acct-emergency',
      transfer_transaction_id: 't-emergency-save',
      deleted: false,
    },
  ];

  const scheduledSubtransactions: YnabScheduledSubtransaction[] = [
    {
      id: 'ssub-food',
      scheduled_transaction_id: 'st-bigbox',
      amount: $(-60),
      memo: 'food',
      category_id: 'cat-groceries',
      deleted: false,
    },
    {
      id: 'ssub-fun',
      scheduled_transaction_id: 'st-bigbox',
      amount: $(-40),
      memo: null,
      category_id: 'cat-fun',
      deleted: false,
    },
  ];

  return {
    id: 'plan-sample',
    name: 'Sample Plan',
    currency_format: { iso_code: 'USD', decimal_digits: 2 },
    accounts: [
      account('acct-checking', 'Checking', 'checking', true, 7880, 6680, {
        last_reconciled_at: '2026-10-01T15:00:00.000Z',
      }),
      account('acct-visa', 'Visa', 'creditCard', true, -50, -250),
      account('acct-old-savings', 'Old Savings', 'savings', true, 0, 0, { closed: true }),
      account('acct-house', 'House', 'otherAsset', false, 400_000, 400_000),
      account('acct-mortgage', 'Mortgage', 'mortgage', false, -299_000, -299_500),
      account('acct-emergency', 'Emergency Fund', 'savings', false, 1030, 1000),
      account('acct-deleted', 'Deleted Account', 'checking', true, 0, 0, { deleted: true }),
    ],
    payees: [
      { id: 'payee-start', name: 'Starting Balance', deleted: false },
      { id: 'payee-payroll', name: 'Acme Payroll', deleted: false },
      { id: 'payee-landlord', name: 'Landlord', deleted: false },
      { id: 'payee-market', name: 'Corner Market', deleted: false },
      { id: 'payee-bigbox', name: 'Big Box', deleted: false },
      { id: 'payee-mystery', name: 'Mystery Shop', deleted: false },
      { id: 'payee-interest', name: 'Interest Charge', deleted: false },
      { id: 'payee-allowance', name: 'Allowance', deleted: false },
      ...['acct-checking', 'acct-visa', 'acct-old-savings', 'acct-mortgage', 'acct-emergency'].map(
        (id) => ({
          id: `payee-transfer-${id}`,
          name: `Transfer : ${id}`,
          transfer_account_id: id,
          deleted: false,
        }),
      ),
    ],
    category_groups: [
      { id: 'group-internal', name: 'Internal Master Category', hidden: false, deleted: false },
      { id: 'group-cc', name: 'Credit Card Payments', hidden: false, deleted: false },
      { id: 'group-bills', name: 'Bills', hidden: false, deleted: false },
      { id: 'group-everyday', name: 'Everyday', hidden: false, deleted: false },
      { id: 'group-old', name: 'Old Stuff', hidden: true, deleted: false },
    ],
    // YNAB's category list carries the current month's figures.
    categories: [
      category('cat-rta'),
      category('cat-uncategorized'),
      category('cat-visa-payment', 0, 0),
      category('cat-rent', 1200, 1200),
      category('cat-mortgage', 1500, 1500),
      category('cat-groceries', 300, 300),
      category('cat-fun', 0, 20),
      category('cat-retired'),
      category('cat-old'),
    ],
    months: [
      month('2026-09-01', 5000, {
        'cat-rent': [1200, 0],
        'cat-mortgage': [1500, 0],
        'cat-groceries': [200, -50],
        'cat-visa-payment': [300, 200],
      }),
      month('2026-10-01', 3700, {
        'cat-rent': [1200, 0],
        'cat-mortgage': [1500, 0],
        'cat-groceries': [300, 80],
        'cat-fun': [100, 20],
      }),
      month('2026-11-01', 3660, {
        'cat-rent': [1200, 1200],
        'cat-mortgage': [1500, 1500],
        'cat-groceries': [300, 300],
        'cat-fun': [0, 20],
      }),
      month('2026-12-01', 3660, {
        'cat-rent': [1200, 2400],
        'cat-mortgage': [0, 1500],
        'cat-groceries': [0, 300],
        'cat-fun': [0, 20],
      }),
    ],
    transactions: [
      // September
      transaction('t-start-checking', 'acct-checking', '2026-09-01', 5000, {
        payee_id: 'payee-start',
        category_id: 'cat-rta',
        cleared: 'reconciled',
      }),
      transaction('t-start-visa', 'acct-visa', '2026-09-01', -300, {
        payee_id: 'payee-start',
        cleared: 'cleared',
      }),
      transaction('t-start-old', 'acct-old-savings', '2026-09-01', 200, {
        payee_id: 'payee-start',
        category_id: 'cat-rta',
        cleared: 'reconciled',
      }),
      transaction('t-start-house', 'acct-house', '2026-09-01', 400_000, {
        payee_id: 'payee-start',
        cleared: 'cleared',
      }),
      transaction('t-start-mortgage', 'acct-mortgage', '2026-09-01', -300_000, {
        payee_id: 'payee-start',
        cleared: 'cleared',
      }),
      transaction('t-start-emergency', 'acct-emergency', '2026-09-01', 1000, {
        payee_id: 'payee-start',
        cleared: 'cleared',
      }),
      transaction('t-rent-sep', 'acct-checking', '2026-09-01', -1200, {
        payee_id: 'payee-landlord',
        category_id: 'cat-rent',
        cleared: 'reconciled',
      }),
      transaction('t-pay-sep', 'acct-checking', '2026-09-02', 3000, {
        payee_id: 'payee-payroll',
        category_id: 'cat-rta',
        cleared: 'reconciled',
      }),
      ...transfer(
        ['t-visa-pay-sep', 't-visa-pay-sep-in'],
        'acct-checking',
        'acct-visa',
        '2026-09-03',
        300,
        [
          { cleared: 'cleared', memo: 'Sept payment' },
          { cleared: 'cleared', memo: 'Thanks' },
        ],
      ),
      ...transfer(
        ['t-mortgage-sep', 't-mortgage-sep-in'],
        'acct-checking',
        'acct-mortgage',
        '2026-09-05',
        1500,
        [{ cleared: 'cleared', category_id: 'cat-mortgage' }, { cleared: 'cleared' }],
      ),
      transaction('t-interest-sep', 'acct-mortgage', '2026-09-06', -1000, {
        payee_id: 'payee-interest',
        cleared: 'cleared',
      }),
      transaction('t-market-sep', 'acct-visa', '2026-09-10', -250, {
        payee_id: 'payee-market',
        category_id: 'cat-groceries',
        cleared: 'cleared',
      }),
      ...transfer(
        ['t-close-old', 't-close-old-in'],
        'acct-old-savings',
        'acct-checking',
        '2026-09-20',
        200,
        [{ cleared: 'reconciled' }, { cleared: 'reconciled' }],
      ),
      // October
      transaction('t-rent-oct', 'acct-checking', '2026-10-01', -1200, {
        payee_id: 'payee-landlord',
        category_id: 'cat-rent',
        cleared: 'cleared',
      }),
      transaction('t-pay-oct', 'acct-checking', '2026-10-02', 3000, {
        payee_id: 'payee-payroll',
        category_id: 'cat-rta',
        cleared: 'cleared',
      }),
      ...transfer(
        ['t-mortgage-oct', 't-mortgage-oct-in'],
        'acct-checking',
        'acct-mortgage',
        '2026-10-05',
        1500,
        [{ category_id: 'cat-mortgage' }, {}],
      ),
      transaction('t-interest-oct', 'acct-mortgage', '2026-10-06', -1000, {
        payee_id: 'payee-interest',
      }),
      transaction('t-bigbox', 'acct-checking', '2026-10-08', -180, {
        payee_id: 'payee-bigbox',
        memo: 'Weekly run',
      }),
      transaction('t-emergency-save', 'acct-emergency', '2026-10-08', 30, {
        payee_id: 'payee-transfer-acct-checking',
        transfer_account_id: 'acct-checking',
        transfer_transaction_id: 'sub-save',
        memo: 'save',
      }),
      transaction('t-market-oct', 'acct-visa', '2026-10-12', -120, {
        payee_id: 'payee-market',
        category_id: 'cat-groceries',
        approved: false,
        flag_color: 'red',
      }),
      ...transfer(
        ['t-visa-pay-oct', 't-visa-pay-oct-in'],
        'acct-checking',
        'acct-visa',
        '2026-10-15',
        320,
        [{ cleared: 'cleared' }, {}],
      ),
      transaction('t-mystery', 'acct-checking', '2026-10-20', -40, {
        payee_id: 'payee-mystery',
        category_id: 'cat-uncategorized',
      }),
      // November
      transaction('t-pay-nov', 'acct-checking', '2026-11-02', 3000, {
        payee_id: 'payee-payroll',
        category_id: 'cat-rta',
      }),
      transaction('t-market-nov', 'acct-checking', '2026-11-03', -80, {
        payee_id: 'payee-market',
        category_id: 'cat-groceries',
      }),
      transaction('t-deleted', 'acct-checking', '2026-11-04', -999, {
        payee_id: 'payee-market',
        category_id: 'cat-groceries',
        deleted: true,
      }),
    ],
    subtransactions,
    scheduled_transactions: [
      // Counting monthly from the 31st reaches November 30th, so the first date is kept.
      scheduled('st-rent', 'acct-checking', 'monthly', ['2026-01-31', '2026-11-30'], -1200, {
        payee_id: 'payee-landlord',
        category_id: 'cat-rent',
      }),
      scheduled('st-bigbox', 'acct-visa', 'monthly', ['2026-12-05', '2026-12-05'], -100, {
        payee_id: 'payee-bigbox',
      }),
      scheduled('st-mortgage', 'acct-checking', 'monthly', ['2026-12-05', '2026-12-05'], -1500, {
        payee_id: 'payee-transfer-acct-mortgage',
        category_id: 'cat-mortgage',
        transfer_account_id: 'acct-mortgage',
      }),
      scheduled('st-old', 'acct-old-savings', 'weekly', ['2026-12-01', '2026-12-01'], -5, {
        payee_id: 'payee-market',
      }),
      // YNAB's twice-a-month dates don't match ours, so this one restarts from its next date.
      scheduled('st-allowance', 'acct-checking', 'twiceAMonth', ['2026-11-01', '2026-11-20'], -10, {
        payee_id: 'payee-allowance',
        category_id: 'cat-fun',
      }),
    ],
    scheduled_subtransactions: scheduledSubtransactions,
  };
}
