import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

interface AccountRow {
  id: number;
  name: string;
  balanceCents: number;
}

interface TransactionRow {
  id: number;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  runningBalanceCents: number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function createAccount(name = 'Checking', startingBalanceCents = 100_000) {
  const response = await call('POST', '/api/accounts', {
    name,
    startingBalanceCents,
    date: '2026-01-01',
  });
  expect(response.statusCode).toBe(201);
  return response.json<AccountRow>();
}

async function addTransaction(
  accountId: number,
  amountCents: number,
  date = '2026-01-10',
  payee = 'Store',
) {
  const response = await call('POST', `/api/accounts/${accountId}/transactions`, {
    date,
    payee,
    amountCents,
  });
  expect(response.statusCode).toBe(201);
  return response.json<TransactionRow>();
}

async function listTransactions(accountId: number) {
  const response = await call('GET', `/api/accounts/${accountId}/transactions`);
  expect(response.statusCode).toBe(200);
  return response.json<TransactionRow[]>();
}

async function balanceOf(accountId: number) {
  const response = await call('GET', '/api/accounts');
  return response.json<AccountRow[]>().find((account) => account.id === accountId)?.balanceCents;
}

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('accounts', () => {
  it('creates an account with a starting balance transaction', async () => {
    const account = await createAccount(' Checking ', 123_45);

    expect(account).toMatchObject({ name: 'Checking', balanceCents: 123_45 });
    expect(await listTransactions(account.id)).toMatchObject([
      { payee: 'Starting Balance', date: '2026-01-01', amountCents: 123_45 },
    ]);
  });

  it('allows a negative starting balance', async () => {
    const account = await createAccount('Card', -500_00);

    expect(await balanceOf(account.id)).toBe(-500_00);
  });

  it('adds no transaction for a $0 starting balance', async () => {
    const account = await createAccount('Empty', 0);

    expect(await balanceOf(account.id)).toBe(0);
    expect(await listTransactions(account.id)).toEqual([]);
  });

  it('lists accounts in creation order', async () => {
    await createAccount('First');
    await createAccount('Second');

    const accounts = (await call('GET', '/api/accounts')).json<AccountRow[]>();

    expect(accounts.map((account) => account.name)).toEqual(['First', 'Second']);
  });

  it('renames an account', async () => {
    const account = await createAccount();

    const response = await call('PATCH', `/api/accounts/${account.id}`, { name: 'Bills' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: account.id, name: 'Bills' });
  });

  it('deletes an account that only has a starting balance', async () => {
    const account = await createAccount();

    const response = await call('DELETE', `/api/accounts/${account.id}`);

    expect(response.statusCode).toBe(204);
    expect((await call('GET', '/api/accounts')).json()).toEqual([]);
  });

  it('refuses to delete an account with other transactions', async () => {
    const account = await createAccount();
    await addTransaction(account.id, -5_00);

    const response = await call('DELETE', `/api/accounts/${account.id}`);

    expect(response.statusCode).toBe(409);
    expect(await balanceOf(account.id)).toBe(995_00);
  });

  it('returns 404 for an account that does not exist', async () => {
    expect((await call('PATCH', '/api/accounts/999', { name: 'X' })).statusCode).toBe(404);
    expect((await call('DELETE', '/api/accounts/999')).statusCode).toBe(404);
    expect((await call('GET', '/api/accounts/999/transactions')).statusCode).toBe(404);
  });
});

describe('transactions', () => {
  it('creates a transaction and updates the balance', async () => {
    const account = await createAccount();

    const created = await addTransaction(account.id, -25_50);

    expect(created).toMatchObject({ payee: 'Store', amountCents: -25_50, date: '2026-01-10' });
    expect(await balanceOf(account.id)).toBe(974_50);
  });

  it('edits only the fields provided', async () => {
    const account = await createAccount();
    const created = await addTransaction(account.id, -25_50);

    const response = await call('PATCH', `/api/transactions/${created.id}`, {
      amountCents: -30_00,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ payee: 'Store', amountCents: -30_00 });
    expect(await balanceOf(account.id)).toBe(970_00);
  });

  it('deletes a transaction and updates the balance', async () => {
    const account = await createAccount();
    const created = await addTransaction(account.id, -25_50);

    const response = await call('DELETE', `/api/transactions/${created.id}`);

    expect(response.statusCode).toBe(204);
    expect(await balanceOf(account.id)).toBe(1000_00);
  });

  it('returns 404 for a transaction that does not exist', async () => {
    expect((await call('PATCH', '/api/transactions/999', { memo: 'x' })).statusCode).toBe(404);
    expect((await call('DELETE', '/api/transactions/999')).statusCode).toBe(404);
  });

  it('keeps balances separate between accounts', async () => {
    const first = await createAccount('First', 100_00);
    const second = await createAccount('Second', 200_00);
    await addTransaction(first.id, -10_00);

    expect(await balanceOf(first.id)).toBe(90_00);
    expect(await balanceOf(second.id)).toBe(200_00);
  });
});

describe('running balances', () => {
  it('lists newest first with a running balance on each row', async () => {
    const account = await createAccount('Checking', 100_00);
    await addTransaction(account.id, -10_00, '2026-01-05', 'A');
    await addTransaction(account.id, -20_00, '2026-01-06', 'B');

    const rows = await listTransactions(account.id);

    expect(rows.map((row) => [row.payee, row.runningBalanceCents])).toEqual([
      ['B', 70_00],
      ['A', 90_00],
      ['Starting Balance', 100_00],
    ]);
  });

  it('orders same-date transactions by when they were entered', async () => {
    const account = await createAccount('Checking', 100_00);
    await addTransaction(account.id, -1_00, '2026-01-05', 'First');
    await addTransaction(account.id, -2_00, '2026-01-05', 'Second');
    await addTransaction(account.id, -3_00, '2026-01-05', 'Third');

    const rows = await listTransactions(account.id);

    expect(rows.map((row) => [row.payee, row.runningBalanceCents])).toEqual([
      ['Third', 94_00],
      ['Second', 97_00],
      ['First', 99_00],
      ['Starting Balance', 100_00],
    ]);
  });

  it('places backdated entries by date and recalculates later rows', async () => {
    const account = await createAccount('Checking', 100_00);
    await addTransaction(account.id, -10_00, '2026-01-20', 'Later');
    await addTransaction(account.id, -5_00, '2026-01-10', 'Backdated');

    const rows = await listTransactions(account.id);

    expect(rows.map((row) => [row.payee, row.runningBalanceCents])).toEqual([
      ['Later', 85_00],
      ['Backdated', 95_00],
      ['Starting Balance', 100_00],
    ]);
  });
});

describe('invalid input', () => {
  it.each([
    ['missing name', { startingBalanceCents: 0, date: '2026-01-01' }],
    ['blank name', { name: '   ', startingBalanceCents: 0, date: '2026-01-01' }],
    ['fractional balance', { name: 'A', startingBalanceCents: 1.5, date: '2026-01-01' }],
    ['missing date', { name: 'A', startingBalanceCents: 0 }],
  ])('rejects an account with %s', async (_label, body) => {
    expect((await call('POST', '/api/accounts', body)).statusCode).toBe(400);
  });

  it.each([
    ['zero amount', { date: '2026-01-01', amountCents: 0 }],
    ['fractional amount', { date: '2026-01-01', amountCents: 10.5 }],
    ['too large an amount', { date: '2026-01-01', amountCents: 1_000_000_000_000 }],
    ['missing amount', { date: '2026-01-01' }],
    ['missing date', { amountCents: 100 }],
    ['malformed date', { date: 'January 1', amountCents: 100 }],
    ['impossible date', { date: '2026-02-31', amountCents: 100 }],
  ])('rejects a transaction with %s', async (_label, body) => {
    const account = await createAccount();

    const response = await call('POST', `/api/accounts/${account.id}/transactions`, body);

    expect(response.statusCode).toBe(400);
  });

  it('rejects an edit that sets the amount to zero or changes nothing', async () => {
    const account = await createAccount();
    const created = await addTransaction(account.id, -5_00);

    expect(
      (await call('PATCH', `/api/transactions/${created.id}`, { amountCents: 0 })).statusCode,
    ).toBe(400);
    expect((await call('PATCH', `/api/transactions/${created.id}`, {})).statusCode).toBe(400);
  });

  it.each(['abc', '0', '99999999999'])('rejects the account id %s', async (id) => {
    expect((await call('GET', `/api/accounts/${id}/transactions`)).statusCode).toBe(400);
  });
});
