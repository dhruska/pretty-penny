import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { transactions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

const DATE = '2026-03-10';

interface TransactionRow {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: string;
  categoryId: number | null;
}

interface AccountRow {
  id: number;
  balanceCents: number;
  clearedBalanceCents: number;
}

type Method = 'GET' | 'POST' | 'PATCH';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

const createAccount = (name: string, type = 'checking', startingBalanceCents = 0) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents,
    date: '2026-03-01',
  });

const add = (accountId: number, fields: object) =>
  send<TransactionRow>('POST', `/api/accounts/${accountId}/transactions`, {
    date: DATE,
    amountCents: -10_00,
    ...fields,
  });

const edit = (id: number, fields: object) =>
  send<TransactionRow>('PATCH', `/api/transactions/${id}`, fields);

const listPayees = () =>
  send<{ id: number; name: string; defaultCategoryId: number | null }[]>('GET', '/api/payees');

const register = (accountId: number) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);

const account = async (id: number) =>
  (await send<AccountRow[]>('GET', '/api/accounts')).find((row) => row.id === id)!;

async function search(params: Record<string, string | number>) {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  return send<{ transactions: TransactionRow[]; hasMore: boolean }>(
    'GET',
    `/api/transactions?${query}`,
  );
}

async function createCategories(...names: string[]) {
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  const ids: number[] = [];
  for (const name of names) {
    ids.push(
      (await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name })).id,
    );
  }
  return ids as [number, number];
}

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('payees', () => {
  it('reuses a payee whatever its capitalization, keeping the first spelling', async () => {
    const checking = await createAccount('Checking');
    await add(checking.id, { payee: 'Corner Market' });
    await add(checking.id, { payee: '  corner MARKET ' });

    expect(await listPayees()).toMatchObject([{ name: 'Corner Market' }]);
    expect((await register(checking.id)).map((row) => row.payee)).toEqual([
      'Corner Market',
      'Corner Market',
    ]);
  });

  it('gives transfers and blank payees no payee', async () => {
    const checking = await createAccount('Checking');
    const savings = await createAccount('Savings', 'savings');
    await add(checking.id, { payee: '   ' });
    await add(checking.id, { payee: 'Ignored', transferAccountId: savings.id });

    expect(await listPayees()).toEqual([]);
  });

  it('records starting balances under a Starting Balance payee', async () => {
    await createAccount('Checking', 'checking', 100_00);

    expect(await listPayees()).toMatchObject([{ name: 'Starting Balance' }]);
  });

  it('lists payees alphabetically with their default category', async () => {
    const checking = await createAccount('Checking');
    const [groceries, dining] = await createCategories('Groceries', 'Dining');
    await add(checking.id, { payee: 'Market', categoryId: groceries });
    await add(checking.id, { payee: 'Market', categoryId: dining });
    await add(checking.id, { payee: 'Bistro', categoryId: dining });
    await add(checking.id, { payee: 'Mystery' });

    expect(await listPayees()).toMatchObject([
      { name: 'Bistro', defaultCategoryId: dining },
      { name: 'Market', defaultCategoryId: groceries },
      { name: 'Mystery', defaultCategoryId: null },
    ]);

    await add(checking.id, { payee: 'Market', categoryId: dining });
    expect((await listPayees())[1]).toMatchObject({ defaultCategoryId: dining });
  });

  it('changes a transaction’s payee on edit', async () => {
    const checking = await createAccount('Checking');
    const created = await add(checking.id, { payee: 'Old' });

    expect(await edit(created.id, { payee: 'New' })).toMatchObject({ payee: 'New' });
    expect(await edit(created.id, { memo: 'kept payee' })).toMatchObject({ payee: 'New' });
    expect(await edit(created.id, { payee: '' })).toMatchObject({ payee: '' });
  });
});

describe('cleared status', () => {
  it('starts uncleared, except in cash accounts and for balance transactions', async () => {
    const checking = await createAccount('Checking', 'checking', 100_00);
    const wallet = await createAccount('Wallet', 'cash');

    expect((await add(checking.id, {})).cleared).toBe('uncleared');
    expect((await add(wallet.id, {})).cleared).toBe('cleared');
    expect((await register(checking.id)).at(-1)).toMatchObject({
      payee: 'Starting Balance',
      cleared: 'cleared',
    });

    await send('POST', `/api/accounts/${checking.id}/close`, { date: DATE });
    expect((await register(checking.id))[0]).toMatchObject({
      payee: 'Balance Adjustment',
      cleared: 'cleared',
    });
  });

  it('toggles cleared and reports the cleared balance', async () => {
    const checking = await createAccount('Checking', 'checking', 100_00);
    const created = await add(checking.id, { amountCents: -30_00 });

    expect(await account(checking.id)).toMatchObject({
      balanceCents: 70_00,
      clearedBalanceCents: 100_00,
    });

    await edit(created.id, { cleared: 'cleared' });
    expect(await account(checking.id)).toMatchObject({ clearedBalanceCents: 70_00 });

    expect(
      (await call('PATCH', `/api/transactions/${created.id}`, { cleared: 'maybe' })).statusCode,
    ).toBe(400);
  });

  it('keeps each side of a transfer’s status separate', async () => {
    const checking = await createAccount('Checking');
    const savings = await createAccount('Savings', 'savings');
    const cash = await createAccount('Wallet', 'cash');
    const created = await add(checking.id, { transferAccountId: savings.id });

    await edit(created.id, { cleared: 'cleared', amountCents: -20_00 });
    expect((await register(savings.id))[0]).toMatchObject({
      cleared: 'uncleared',
      amountCents: 20_00,
    });

    await edit(created.id, { transferAccountId: cash.id });
    expect((await register(cash.id))[0]).toMatchObject({ cleared: 'cleared' });
    expect((await register(checking.id))[0]).toMatchObject({ cleared: 'cleared' });
  });
});

describe('search', () => {
  async function seed() {
    const checking = await createAccount('Checking');
    const card = await createAccount('Rewards Card', 'credit_card');
    const savings = await createAccount('Savings', 'savings');
    const [groceries, dining] = await createCategories('Groceries', 'Dining');
    const market = await add(checking.id, {
      date: '2026-03-02',
      payee: 'Corner Market',
      categoryId: groceries,
      memo: 'weekly shop',
    });
    const noodles = await add(card.id, {
      date: '2026-03-15',
      payee: 'Noodle House',
      categoryId: dining,
    });
    const mystery = await add(checking.id, { date: '2026-04-01', payee: 'Mystery 50% off' });
    await add(checking.id, { date: '2026-03-20', transferAccountId: savings.id });
    return { checking, card, savings, groceries, dining, market, noodles, mystery };
  }

  const ids = (result: { transactions: TransactionRow[] }) =>
    result.transactions.map((row) => row.id);

  it('lists everything newest first with the account', async () => {
    const { mystery } = await seed();

    const result = await search({});

    expect(result.transactions).toHaveLength(5);
    expect(result.transactions[0]).toMatchObject({ id: mystery.id, accountName: 'Checking' });
    expect(result.hasMore).toBe(false);
  });

  it('matches text in the payee, category, memo, account and transfer account', async () => {
    const { market, noodles } = await seed();

    expect(ids(await search({ q: 'corner' }))).toEqual([market.id]);
    expect(ids(await search({ q: 'DINING' }))).toEqual([noodles.id]);
    expect(ids(await search({ q: 'weekly' }))).toEqual([market.id]);
    expect(ids(await search({ q: 'rewards' }))).toEqual([noodles.id]);
    expect((await search({ q: 'savings' })).transactions).toHaveLength(2);
  });

  it('treats % and _ as plain text', async () => {
    const { mystery } = await seed();

    expect(ids(await search({ q: '50%' }))).toEqual([mystery.id]);
    expect(ids(await search({ q: '_' }))).toEqual([]);
  });

  it('filters by account, category, Uncategorized, dates and cleared status', async () => {
    const { card, groceries, market, noodles, mystery } = await seed();

    expect(ids(await search({ accountId: card.id }))).toEqual([noodles.id]);
    expect(ids(await search({ categoryId: groceries }))).toEqual([market.id]);
    expect(ids(await search({ categoryId: 'uncategorized' }))).toEqual([mystery.id]);
    expect(ids(await search({ from: '2026-03-01', to: '2026-03-10' }))).toEqual([market.id]);

    await edit(market.id, { cleared: 'cleared' });
    expect(ids(await search({ cleared: 'cleared' }))).toEqual([market.id]);
    expect((await search({ cleared: 'uncleared' })).transactions).toHaveLength(4);
  });

  it('combines filters', async () => {
    const { checking, market } = await seed();

    expect(ids(await search({ accountId: checking.id, q: 'market', to: '2026-03-31' }))).toEqual([
      market.id,
    ]);
  });

  it('caps results at 500 and says there are more', async () => {
    const checking = await createAccount('Checking');
    await db.insert(transactions).values(
      Array.from({ length: 501 }, () => ({
        accountId: checking.id,
        date: DATE,
        amountCents: -1_00,
      })),
    );

    const result = await search({});

    expect(result.transactions).toHaveLength(500);
    expect(result.hasMore).toBe(true);
  });

  it('rejects invalid filters', async () => {
    expect((await call('GET', '/api/transactions?categoryId=food')).statusCode).toBe(400);
    expect((await call('GET', '/api/transactions?from=yesterday')).statusCode).toBe(400);
    expect((await call('GET', '/api/transactions?cleared=maybe')).statusCode).toBe(400);
  });
});
