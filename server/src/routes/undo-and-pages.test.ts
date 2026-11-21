import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';
import { searchAmountCents } from './transactions.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db, { requireLogin: false });

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

interface Row {
  id: number;
  date: string;
  payee: string;
  amountCents: number;
  cleared: string;
  flag: string | null;
  memo: string;
  transferAccountId: number | null;
  categoryId: number | null;
  lines: { categoryId: number | null; amountCents: number; memo: string }[];
  runningBalanceCents: number;
}

const createAccount = (name: string, type = 'checking', startingBalanceCents = 1_000_00) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents,
    date: '2026-03-01',
  });

const add = (accountId: number, fields: object) =>
  send<Row>('POST', `/api/accounts/${accountId}/transactions`, {
    date: '2026-03-10',
    payee: 'Store',
    amountCents: -10_00,
    ...fields,
  });

const register = (accountId: number, query = '') =>
  send<Row[]>('GET', `/api/accounts/${accountId}/transactions${query}`);

async function createCategory(name: string) {
  const group = await send<{ id: number }>('POST', '/api/category-groups', {
    name: `${name} group`,
  });
  return send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name });
}

const remove = (id: number, query = '') =>
  send<{ undo: { snapshot: object; signature: string } }>(
    'DELETE',
    `/api/transactions/${id}${query}`,
  );

const restore = (undo: object) => call('POST', '/api/transactions/restore', undo);

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('register pages', () => {
  it('splits the register into pages with the same rows and running balances', async () => {
    const account = await createAccount('Checking');
    // Same-date entries keep their entry order, and a backdated one sorts by its date.
    for (const [date, amountCents] of [
      ['2026-03-05', -1_00],
      ['2026-03-05', -2_00],
      ['2026-03-09', 30_00],
      ['2026-03-02', -4_00],
      ['2026-03-09', -5_00],
      ['2026-03-20', -6_00],
      ['2026-03-05', -7_00],
    ] as const) {
      await add(account.id, { date, amountCents });
    }

    const all = await register(account.id);
    expect(all).toHaveLength(8);
    expect(all.at(-1)!.runningBalanceCents).toBe(1_000_00);
    expect(all[0]!.runningBalanceCents).toBe(1_005_00);

    const pages: Row[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await register(account.id, `?limit=3${before ? `&before=${before}` : ''}`);
      pages.push(...page);
      if (page.length < 3) break;
      before = page.at(-1)!.id;
    }
    expect(pages.map((row) => [row.id, row.runningBalanceCents])).toEqual(
      all.map((row) => [row.id, row.runningBalanceCents]),
    );
  });

  it('returns nothing past the end, and rejects bad page sizes', async () => {
    const account = await createAccount('Checking');
    const [only] = await register(account.id, '?limit=5');
    expect(await register(account.id, `?limit=5&before=${only!.id}`)).toEqual([]);
    expect(await register(account.id, '?limit=5&before=999999')).toEqual([]);
    expect((await call('GET', `/api/accounts/${account.id}/transactions?limit=0`)).statusCode).toBe(
      400,
    );
    expect(
      (await call('GET', `/api/accounts/${account.id}/transactions?limit=1001`)).statusCode,
    ).toBe(400);
    expect((await call('GET', '/api/accounts/999999/transactions?limit=5')).statusCode).toBe(404);
  });

  it('finds older transactions, beyond the first page, by searching the account', async () => {
    const account = await createAccount('Checking');
    await add(account.id, { date: '2026-01-02', payee: 'Old Bookshop' });
    for (let day = 10; day < 20; day += 1) await add(account.id, { date: `2026-03-${day}` });

    const firstPage = await register(account.id, '?limit=5');
    expect(firstPage.map((row) => row.payee)).not.toContain('Old Bookshop');
    const found = await send<{ transactions: Row[] }>(
      'GET',
      `/api/transactions?accountId=${account.id}&q=bookshop`,
    );
    expect(found.transactions.map((row) => row.payee)).toEqual(['Old Bookshop']);

    // Amounts and dates are found too, as the register's filter always allowed.
    await add(account.id, { date: '2026-02-14', payee: 'Florist', amountCents: -1_234_56 });
    const search = async (text: string) =>
      (
        await send<{ transactions: Row[] }>(
          'GET',
          `/api/transactions?accountId=${account.id}&q=${encodeURIComponent(text)}`,
        )
      ).transactions.map((row) => row.payee);
    expect(await search('1,234.56')).toEqual(['Florist']);
    expect(await search('$1234.56')).toEqual(['Florist']);
    expect(await search('2026-02')).toEqual(['Florist']);
    expect(await search('1,234.5')).toEqual([]);
  });

  it('reads search text as an amount only when it looks like one', () => {
    expect(searchAmountCents('1,234.56')).toBe(1_234_56);
    expect(searchAmountCents('$12')).toBe(12_00);
    expect(searchAmountCents('-5.5')).toBe(5_50);
    expect(searchAmountCents('7')).toBe(7_00);
    for (const text of ['1,23', '12.345', 'abc', '1,234,567,890,123', '1234567890123', '']) {
      expect(searchAmountCents(text), text).toBeNull();
    }
  });
});

describe('undoing a delete', () => {
  it('puts a transaction back exactly as it was', async () => {
    const account = await createAccount('Checking');
    const groceries = await createCategory('Groceries');
    const created = await add(account.id, {
      payee: 'Corner Market',
      memo: 'weekly',
      categoryId: groceries.id,
      flag: 'red',
      cleared: 'cleared',
    });
    await add(account.id, { date: '2026-03-12', payee: 'Later' });
    const before = await register(account.id);

    const { undo } = await remove(created.id);
    expect(await register(account.id)).toHaveLength(2);

    const response = await restore(undo);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ restored: [created.id] });
    expect(await register(account.id)).toEqual(before);

    // Undoing twice is refused rather than duplicating it.
    const again = await restore(undo);
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toBe('This transaction is already back.');
  });

  it('puts back both sides of a transfer, with the budget side’s category', async () => {
    const checking = await createAccount('Checking');
    const brokerage = await createAccount('Brokerage', 'asset', 0);
    const investing = await createCategory('Investing');
    await add(checking.id, {
      payee: '',
      transferAccountId: brokerage.id,
      categoryId: investing.id,
      amountCents: -200_00,
    });
    const checkingBefore = await register(checking.id);
    const brokerageBefore = await register(brokerage.id);

    // Deleting from the tracking side removes both.
    const { undo } = await remove(brokerageBefore[0]!.id);
    expect(await register(checking.id)).toHaveLength(1);

    expect((await restore(undo)).statusCode).toBe(200);
    expect(await register(checking.id)).toEqual(checkingBefore);
    expect(await register(brokerage.id)).toEqual(brokerageBefore);
  });

  it('puts back a split’s lines, and a reconciled transaction stays reconciled', async () => {
    const account = await createAccount('Checking');
    const food = await createCategory('Food');
    const home = await createCategory('Home');
    const split = await add(account.id, {
      amountCents: -30_00,
      cleared: 'cleared',
      lines: [
        { categoryId: food.id, amountCents: -20_00, memo: 'snacks' },
        { categoryId: home.id, amountCents: -10_00 },
      ],
    });
    await send('POST', `/api/accounts/${account.id}/reconcile`, {
      bankBalanceCents: 970_00,
      date: '2026-03-31',
    });
    const before = await register(account.id);
    expect(before.find((row) => row.id === split.id)!.cleared).toBe('reconciled');

    const { undo } = await remove(split.id, '?confirmReconciled=true');
    expect((await restore(undo)).statusCode).toBe(200);
    expect(await register(account.id)).toEqual(before);
  });

  it('refuses a changed snapshot, as if it had expired', async () => {
    const account = await createAccount('Checking');
    const created = await add(account.id, {});
    const { undo } = await remove(created.id);
    const tampered = JSON.parse(JSON.stringify(undo));
    tampered.snapshot.transactions[0].amountCents = 1_000_000_00;

    const response = await restore(tampered);
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe(
      'This undo has expired. Add the transaction again instead.',
    );
    expect((await restore({ snapshot: undo.snapshot, signature: 'abc' })).statusCode).toBe(400);
    expect(await register(account.id)).toHaveLength(1);
  });

  it('refuses when its category, or its account, is gone or closed', async () => {
    const account = await createAccount('Checking');
    const gifts = await createCategory('Gifts');
    const created = await add(account.id, { categoryId: gifts.id });
    const { undo } = await remove(created.id);
    await send('DELETE', `/api/categories/${gifts.id}`);
    let response = await restore(undo);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('Couldn’t undo: a category it used was deleted.');

    const other = await add(account.id, {});
    const second = (await remove(other.id)).undo;
    await send('POST', `/api/accounts/${account.id}/close`, { date: '2026-03-31' });
    response = await restore(second);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('its account is closed');

    const temporary = await createAccount('Temporary');
    const third = (await remove((await add(temporary.id, {})).id)).undo;
    await send('DELETE', `/api/accounts/${temporary.id}`);
    response = await restore(third);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('Couldn’t undo: its account was deleted.');
  });

  it('drops the link to a schedule that’s gone, keeping the transaction', async () => {
    const account = await createAccount('Checking');
    const { id: scheduleId } = await send<{ id: number }>(
      'POST',
      `/api/accounts/${account.id}/scheduled`,
      { date: '2026-03-10', payee: 'Gym', amountCents: -30_00, frequency: 'monthly' },
    );
    const posted = (await register(account.id)).find((row) => row.payee === 'Gym')!;
    const { undo } = await remove(posted.id);
    await send('DELETE', `/api/scheduled/${scheduleId}`);

    expect((await restore(undo)).statusCode).toBe(200);
    expect((await register(account.id)).map((row) => row.payee)).toContain('Gym');
  });
});
