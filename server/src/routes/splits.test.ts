import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

const MONTH = '2026-03';
const DATE = `${MONTH}-10`;

interface Line {
  categoryId: number | null;
  categoryName: string | null;
  amountCents: number;
  memo: string;
}

interface TransactionRow {
  id: number;
  payee: string;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  hasCategoryLine: boolean;
  lines: Line[];
  runningBalanceCents?: number;
}

interface BudgetResponse {
  uncategorized: { count: number }[];
  groups: { categories: { id: number; activityCents: number }[] }[];
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

let checkingId: number;
let groceries: number;
let household: number;

const add = (fields: object, accountId = checkingId) =>
  call('POST', `/api/accounts/${accountId}/transactions`, {
    date: DATE,
    payee: 'Target',
    ...fields,
  });

const split = (amountCents: number, lines: object[]) =>
  add({ amountCents, lines }).then((response) => {
    expect(response.statusCode, response.body).toBe(201);
    return response.json<TransactionRow>();
  });

const register = () => send<TransactionRow[]>('GET', `/api/accounts/${checkingId}/transactions`);

async function activity(categoryId: number) {
  const budget = await send<BudgetResponse>(
    'GET',
    `/api/budget?month=${MONTH}&currentMonth=${MONTH}`,
  );
  return budget.groups.flatMap((group) => group.categories).find((c) => c.id === categoryId)!
    .activityCents;
}

async function search(params: string) {
  return (await send<{ transactions: TransactionRow[] }>('GET', `/api/transactions?${params}`))
    .transactions;
}

beforeEach(async () => {
  await resetDb(db);
  checkingId = (
    await send<{ id: number }>('POST', '/api/accounts', {
      name: 'Checking',
      startingBalanceCents: 1_000_00,
      date: `${MONTH}-01`,
    })
  ).id;
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  groceries = (
    await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name: 'Groceries' })
  ).id;
  household = (
    await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name: 'Household' })
  ).id;
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('creating splits', () => {
  it('records each line and applies it to its category', async () => {
    const created = await split(-100_00, [
      { categoryId: groceries, amountCents: -60_00, memo: ' food ' },
      { categoryId: household, amountCents: -40_00 },
    ]);

    expect(created).toMatchObject({
      categoryName: 'Split',
      categoryId: null,
      hasCategoryLine: true,
      lines: [
        { categoryId: groceries, categoryName: 'Groceries', amountCents: -60_00, memo: 'food' },
        { categoryId: household, categoryName: 'Household', amountCents: -40_00, memo: '' },
      ],
    });
    expect(await activity(groceries)).toBe(-60_00);
    expect(await activity(household)).toBe(-40_00);
  });

  it('allows lines that mix money out and in', async () => {
    await split(-30_00, [
      { categoryId: groceries, amountCents: -50_00 },
      { categoryId: household, amountCents: 20_00 },
    ]);

    expect(await activity(household)).toBe(20_00);
  });

  it('keeps one register row per split with a correct running balance', async () => {
    await split(-100_00, [
      { categoryId: groceries, amountCents: -60_00 },
      { categoryId: household, amountCents: -40_00 },
    ]);

    const rows = await register();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ runningBalanceCents: 900_00 });
  });

  it('counts a split with an uncategorized line as needing a category', async () => {
    await split(-100_00, [
      { categoryId: groceries, amountCents: -60_00 },
      { categoryId: null, amountCents: -40_00 },
    ]);

    const budget = await send<BudgetResponse>(
      'GET',
      `/api/budget?month=${MONTH}&currentMonth=${MONTH}`,
    );
    expect(budget.uncategorized).toMatchObject([{ count: 1 }]);
  });

  it.each([
    ['lines that do not add up', -100_00, [-60_00, -30_00]],
    ['a single line', -100_00, [-100_00]],
    ['a zero line', -100_00, [-100_00, 0]],
  ])('rejects %s', async (_label, amountCents, amounts) => {
    const response = await add({
      amountCents,
      lines: (amounts as number[]).map((lineAmount) => ({
        categoryId: groceries,
        amountCents: lineAmount,
      })),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects too many lines, unknown categories, and a category alongside lines', async () => {
    const many = Array.from({ length: 51 }, () => ({ categoryId: groceries, amountCents: -1_00 }));
    expect((await add({ amountCents: -51_00, lines: many })).statusCode).toBe(400);
    expect(
      (
        await add({
          amountCents: -2_00,
          lines: [
            { categoryId: groceries, amountCents: -1_00 },
            { categoryId: 99_999, amountCents: -1_00 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await add({
          amountCents: -2_00,
          categoryId: groceries,
          lines: [
            { categoryId: groceries, amountCents: -1_00 },
            { categoryId: household, amountCents: -1_00 },
          ],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('rejects splits on transfers and in tracking accounts', async () => {
    const savings = await send<{ id: number }>('POST', '/api/accounts', {
      name: 'Savings',
      type: 'savings',
      startingBalanceCents: 0,
      date: DATE,
    });
    const house = await send<{ id: number }>('POST', '/api/accounts', {
      name: 'House',
      type: 'asset',
      startingBalanceCents: 0,
      date: DATE,
    });
    const lines = [
      { categoryId: groceries, amountCents: -1_00 },
      { categoryId: household, amountCents: -1_00 },
    ];

    expect(
      (await add({ amountCents: -2_00, lines, transferAccountId: savings.id })).statusCode,
    ).toBe(400);
    expect((await add({ amountCents: -2_00, lines }, house.id)).statusCode).toBe(400);
  });
});

describe('editing splits', () => {
  async function createSplit() {
    return split(-100_00, [
      { categoryId: groceries, amountCents: -60_00 },
      { categoryId: household, amountCents: -40_00 },
    ]);
  }

  it('replaces the lines', async () => {
    const created = await createSplit();

    await send('PATCH', `/api/transactions/${created.id}`, {
      amountCents: -110_00,
      lines: [
        { categoryId: groceries, amountCents: -66_00 },
        { categoryId: household, amountCents: -44_00 },
      ],
    });

    expect(await activity(groceries)).toBe(-66_00);
    expect(await activity(household)).toBe(-44_00);
  });

  it('keeps the lines when other fields change', async () => {
    const created = await createSplit();

    await send('PATCH', `/api/transactions/${created.id}`, { memo: 'receipt', payee: 'Costco' });

    expect((await register())[0]).toMatchObject({ payee: 'Costco', lines: [{}, {}] });
  });

  it('rejects a new amount without new lines', async () => {
    const created = await createSplit();

    const response = await call('PATCH', `/api/transactions/${created.id}`, {
      amountCents: -120_00,
    });

    expect(response.statusCode).toBe(400);
    expect(await activity(groceries)).toBe(-60_00);
  });

  it('turns back into a single-category transaction', async () => {
    const created = await createSplit();

    await send('PATCH', `/api/transactions/${created.id}`, { categoryId: groceries });

    expect((await register())[0]).toMatchObject({ categoryName: 'Groceries', lines: [{}] });
    expect(await activity(groceries)).toBe(-100_00);
    expect(await activity(household)).toBe(0);
  });

  it('removes every line when deleted', async () => {
    const created = await createSplit();

    await send('DELETE', `/api/transactions/${created.id}`);

    expect(await activity(groceries)).toBe(0);
    expect(await activity(household)).toBe(0);
  });
});

describe('splits elsewhere', () => {
  it('finds a split by any line’s category, memo or Uncategorized status', async () => {
    const created = await split(-100_00, [
      { categoryId: household, amountCents: -60_00, memo: 'light bulbs' },
      { categoryId: null, amountCents: -40_00 },
    ]);

    for (const params of [`categoryId=${household}`, 'categoryId=uncategorized', 'q=bulbs']) {
      expect((await search(params)).map((row) => row.id)).toEqual([created.id]);
    }
    expect(await search('q=household')).toHaveLength(1);
    expect(await search(`categoryId=${groceries}`)).toEqual([]);
  });

  it('leaves splits out of a payee’s usual category', async () => {
    await send('POST', `/api/accounts/${checkingId}/transactions`, {
      date: DATE,
      payee: 'Target',
      amountCents: -5_00,
      categoryId: groceries,
    });
    await split(-100_00, [
      { categoryId: household, amountCents: -60_00 },
      { categoryId: household, amountCents: -40_00 },
    ]);
    await split(-100_00, [
      { categoryId: household, amountCents: -60_00 },
      { categoryId: household, amountCents: -40_00 },
    ]);

    const payees = await send<{ name: string; defaultCategoryId: number | null }[]>(
      'GET',
      '/api/payees',
    );
    expect(payees.find((payee) => payee.name === 'Target')?.defaultCategoryId).toBe(groceries);
  });
});
