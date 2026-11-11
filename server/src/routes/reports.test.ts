import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const TODAY = '2026-06-15';
const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db, { today: () => TODAY });

type Method = 'GET' | 'POST' | 'PUT';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (
    response.body && response.headers['content-type']?.toString().includes('json')
      ? response.json<T>()
      : response.body
  ) as T;
}

let ids: Record<'checking' | 'savings' | 'brokerage' | 'groceries' | 'rent' | 'bills', number>;

const account = (name: string, type: string, startingBalanceCents: number) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents,
    date: '2026-03-01',
  });

const add = (accountId: number, fields: object) =>
  send('POST', `/api/accounts/${accountId}/transactions`, { date: '2026-03-10', ...fields });

/**
 * Checking ($5,000) and a brokerage ($10,000, tracking), with groceries in March and April, a
 * paycheck, rent with a refund, a transfer to savings (not spending) and one to the brokerage
 * (spending, categorized).
 */
async function seed() {
  const checking = await account('Checking', 'checking', 5_000_00);
  const savings = await account('Savings', 'savings', 0);
  const brokerage = await account('Brokerage', 'asset', 10_000_00);
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  const bills = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Bills' });
  const groceries = await send<{ id: number }>('POST', '/api/categories', {
    groupId: group.id,
    name: 'Groceries',
  });
  const rent = await send<{ id: number }>('POST', '/api/categories', {
    groupId: bills.id,
    name: 'Rent',
  });
  const investing = await send<{ id: number }>('POST', '/api/categories', {
    groupId: bills.id,
    name: 'Investing',
  });
  const { readyToAssignId } = await send<{ readyToAssignId: number }>('GET', '/api/categories');

  await add(checking.id, {
    payee: 'Corner Market',
    amountCents: -100_00,
    categoryId: groceries.id,
  });
  await add(checking.id, {
    date: '2026-04-10',
    payee: 'Corner Market',
    amountCents: -60_00,
    categoryId: groceries.id,
    memo: 'Party, "big" one',
  });
  await add(checking.id, {
    payee: 'Acme Payroll',
    amountCents: 3_000_00,
    categoryId: readyToAssignId,
  });
  await add(checking.id, { payee: 'Landlord', amountCents: -1_500_00, categoryId: rent.id });
  await add(checking.id, { payee: 'Landlord', amountCents: 100_00, categoryId: rent.id });
  await add(checking.id, { amountCents: -400_00, transferAccountId: savings.id });
  await add(checking.id, {
    amountCents: -500_00,
    transferAccountId: brokerage.id,
    categoryId: investing.id,
  });
  ids = {
    checking: checking.id,
    savings: savings.id,
    brokerage: brokerage.id,
    groceries: groceries.id,
    rent: rent.id,
    bills: bills.id,
  };
}

beforeEach(async () => {
  await resetDb(db);
  await seed();
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('spending breakdown', () => {
  it('counts categorized spending and transfers to tracking, but not income or budget transfers', async () => {
    const result = await send<{ totalCents: number; items: object[] }>(
      'GET',
      '/api/reports/spending?from=2026-03-01&to=2026-06-30',
    );

    expect(result).toEqual({
      totalCents: 2_060_00,
      items: [
        { label: 'Rent', spentCents: 1_400_00 },
        { label: 'Investing', spentCents: 500_00 },
        { label: 'Groceries', spentCents: 160_00 },
      ],
    });
  });

  it('respects the date range', async () => {
    const result = await send<{ items: { label: string; spentCents: number }[] }>(
      'GET',
      '/api/reports/spending?from=2026-04-01&to=2026-04-30',
    );

    expect(result.items).toEqual([{ label: 'Groceries', spentCents: 60_00 }]);
  });

  it('groups by payee, naming transfers by their account', async () => {
    const result = await send<{ items: { label: string }[] }>(
      'GET',
      '/api/reports/spending?groupBy=payee',
    );

    expect(result.items.map((item) => item.label)).toEqual([
      'Landlord',
      'Transfer: Brokerage',
      'Corner Market',
    ]);
  });
});

describe('spending trends', () => {
  it('gives spending per month from the first transaction to today, with the average', async () => {
    const result = await send<{ months: object[]; averageCents: number }>(
      'GET',
      '/api/reports/trends',
    );

    expect(result.months).toEqual([
      { month: '2026-03', spentCents: 2_000_00 },
      { month: '2026-04', spentCents: 60_00 },
      { month: '2026-05', spentCents: 0 },
      { month: '2026-06', spentCents: 0 },
    ]);
    expect(result.averageCents).toBe(515_00);
  });

  it('narrows to a category or group', async () => {
    const byCategory = await send<{ months: { spentCents: number }[] }>(
      'GET',
      `/api/reports/trends?from=2026-03-01&to=2026-04-30&categoryId=${ids.groceries}`,
    );
    const byGroup = await send<{ averageCents: number }>(
      'GET',
      `/api/reports/trends?from=2026-03-01&to=2026-04-30&groupId=${ids.bills}`,
    );

    expect(byCategory.months.map((month) => month.spentCents)).toEqual([100_00, 60_00]);
    expect(byGroup.averageCents).toBe(950_00);
  });
});

describe('income v expense', () => {
  it('shows income without starting balances, and expenses by group', async () => {
    const result = await send<{
      months: string[];
      income: { label: string; totalCents: number }[];
      expenseGroups: { label: string; totalCents: number }[];
      netByMonth: number[];
    }>('GET', '/api/reports/income-expense?from=2026-03-01&to=2026-04-30');

    expect(result.months).toEqual(['2026-03', '2026-04']);
    expect(result.income).toMatchObject([{ label: 'Acme Payroll', totalCents: 3_000_00 }]);
    expect(result.expenseGroups).toMatchObject([
      { label: 'Bills', totalCents: -1_900_00 },
      { label: 'Everyday', totalCents: -160_00 },
    ]);
    expect(result.netByMonth).toEqual([1_000_00, -60_00]);
  });
});

describe('net worth', () => {
  it('includes tracking and closed accounts at each month-end', async () => {
    await send('POST', `/api/accounts/${ids.savings}/close`, { date: '2026-05-01' });

    const result = await send<object[]>(
      'GET',
      '/api/reports/net-worth?from=2026-03-01&to=2026-05-31',
    );

    // Checking: 5,000 - 100 + 3,000 - 1,500 + 100 - 400 - 500 = 5,600 in March, 5,540 in April.
    // Savings: 400 until closing in May moves it to Ready to Assign. Brokerage: 10,500.
    expect(result).toEqual([
      { month: '2026-03', assetsCents: 16_500_00, debtsCents: 0, netWorthCents: 16_500_00 },
      { month: '2026-04', assetsCents: 16_440_00, debtsCents: 0, netWorthCents: 16_440_00 },
      { month: '2026-05', assetsCents: 16_040_00, debtsCents: 0, netWorthCents: 16_040_00 },
    ]);
  });
});

it('rejects invalid report filters', async () => {
  for (const url of [
    '/api/reports/spending?from=2026-05-01&to=2026-04-01',
    '/api/reports/spending?groupBy=month',
    '/api/reports/trends?from=yesterday',
    '/api/reports/net-worth?to=2026-13-45',
  ]) {
    expect((await call('GET', url)).statusCode, url).toBe(400);
  }
});

describe('exports', () => {
  it('exports transactions in YNAB’s register layout as a download', async () => {
    const response = await call('GET', '/api/export/transactions.csv');

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="pretty-penny-transactions-' +
        response.headers['content-disposition']!.toString().slice(-15),
    );
    const lines = response.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
    );
    expect(lines).toContain(
      '"Checking","","03/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$5,000.00","Cleared"',
    );
    expect(lines).toContain(
      '"Checking","","04/10/2026","Corner Market","Everyday: Groceries","Everyday","Groceries","Party, ""big"" one","$60.00","$0.00","Uncleared"',
    );
    expect(lines).toContain(
      '"Checking","","03/10/2026","Transfer : Savings","","","","","$400.00","$0.00","Uncleared"',
    );
    expect(lines).toContain(
      '"Savings","","03/10/2026","Transfer : Checking","","","","","$0.00","$400.00","Uncleared"',
    );
  });

  it('exports each split line as its own row', async () => {
    await add(ids.checking, {
      payee: 'Target',
      amountCents: -30_00,
      lines: [
        { categoryId: ids.groceries, amountCents: -20_00, memo: 'food' },
        { categoryId: ids.rent, amountCents: -10_00 },
      ],
    });

    const body = await send<string>('GET', '/api/export/transactions.csv');

    expect(body).toContain(
      '"Target","Everyday: Groceries","Everyday","Groceries","Split (1/2) food","$20.00"',
    );
    expect(body).toContain('"Target","Bills: Rent","Bills","Rent","Split (2/2)","$10.00"');
  });

  it('exports the budget month by month in YNAB’s plan layout', async () => {
    await send('PUT', `/api/budget/2026-03/categories/${ids.groceries}`, { assignedCents: 200_00 });

    const lines = (await send<string>('GET', '/api/export/budget.csv')).trim().split('\r\n');

    expect(lines[0]).toBe(
      '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
    );
    expect(lines).toContain(
      '"Mar 2026","Everyday: Groceries","Everyday","Groceries","$200.00","-$100.00","$100.00"',
    );
    expect(lines).toContain(
      '"Apr 2026","Everyday: Groceries","Everyday","Groceries","$0.00","-$60.00","$40.00"',
    );
    // March through June (today's month) for each of the three categories.
    expect(lines).toHaveLength(1 + 4 * 3);
  });
});
