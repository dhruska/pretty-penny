import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db, { requireLogin: false, today: () => '2026-03-20' });

const DATE = '2026-03-10';

interface TransactionRow {
  id: number;
  payee: string;
  cleared: string;
  flag: string | null;
  transferAccountId: number | null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

const createAccount = (name: string) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type: 'checking',
    startingBalanceCents: 1_000_00,
    date: '2026-03-01',
  });

const add = (accountId: number, fields: object = {}) =>
  send<TransactionRow>('POST', `/api/accounts/${accountId}/transactions`, {
    date: DATE,
    payee: 'Store',
    amountCents: -10_00,
    ...fields,
  });

const edit = (id: number, fields: object) =>
  send<TransactionRow>('PATCH', `/api/transactions/${id}`, fields);

const register = (accountId: number) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);

const search = async (query: string) =>
  (await send<{ transactions: TransactionRow[] }>('GET', `/api/transactions?${query}`))
    .transactions;

let checking: number;
let savings: number;

beforeEach(async () => {
  await resetDb(db);
  checking = (await createAccount('Checking')).id;
  savings = (await createAccount('Savings')).id;
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('flags', () => {
  it('sets, changes and clears a transaction’s flag', async () => {
    const created = await add(checking, { flag: 'red' });
    expect(created.flag).toBe('red');
    expect((await add(checking)).flag).toBeNull();

    expect((await edit(created.id, { flag: 'purple' })).flag).toBe('purple');
    // Other edits leave the flag alone.
    expect((await edit(created.id, { memo: 'note' })).flag).toBe('purple');
    expect((await edit(created.id, { flag: null })).flag).toBeNull();
  });

  it('rejects colors YNAB doesn’t have', async () => {
    const created = await add(checking);
    expect(
      (await call('PATCH', `/api/transactions/${created.id}`, { flag: 'pink' })).statusCode,
    ).toBe(400);
    expect((await call('GET', '/api/transactions?flag=pink')).statusCode).toBe(400);
  });

  it('keeps a separate flag on each side of a transfer', async () => {
    const sent = await add(checking, { transferAccountId: savings, flag: 'blue' });
    const received = (await register(savings)).find((row) => row.transferAccountId === checking)!;
    expect(received.flag).toBeNull();

    await edit(received.id, { flag: 'green' });
    await edit(sent.id, { amountCents: -20_00 });
    expect((await register(checking)).find((row) => row.id === sent.id)!.flag).toBe('blue');
    expect((await register(savings)).find((row) => row.id === received.id)!.flag).toBe('green');
  });

  it('flags a reconciled transaction without asking for confirmation', async () => {
    const created = await add(checking, { cleared: 'cleared' });
    await send('POST', `/api/accounts/${checking}/reconcile`, {
      bankBalanceCents: 990_00,
      date: DATE,
    });

    const flagged = await edit(created.id, { flag: 'yellow' });
    expect(flagged).toMatchObject({ cleared: 'reconciled', flag: 'yellow' });
  });

  it('carries a schedule’s flag to the transactions it posts', async () => {
    const { posted } = await send<{ id: number; posted: number }>(
      'POST',
      `/api/accounts/${checking}/scheduled`,
      { date: DATE, payee: 'Gym', amountCents: -30_00, frequency: 'monthly', flag: 'orange' },
    );
    expect(posted).toBe(1);
    expect((await register(checking)).find((row) => row.payee === 'Gym')!.flag).toBe('orange');

    const [schedule] = await send<{ flag: string | null }[]>(
      'GET',
      `/api/accounts/${checking}/scheduled`,
    );
    expect(schedule!.flag).toBe('orange');
  });

  it('filters by one color or any flag', async () => {
    await add(checking, { payee: 'Red one', flag: 'red' });
    await add(checking, { payee: 'Blue one', flag: 'blue' });
    await add(checking, { payee: 'Plain' });

    expect((await search('flag=red')).map((row) => row.payee)).toEqual(['Red one']);
    expect((await search('flag=any')).map((row) => row.payee).sort()).toEqual([
      'Blue one',
      'Red one',
    ]);
  });

  it('names flag colors, and clears a name when it’s blank', async () => {
    const all = await send<{ color: string; name: string | null }[]>('GET', '/api/flags');
    expect(all.map((flag) => flag.color)).toEqual([
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
    ]);
    expect(all.every((flag) => flag.name === null)).toBe(true);

    let flags = await send<{ color: string; name: string | null }[]>('PUT', '/api/flags/blue', {
      name: '  Reimbursable ',
    });
    expect(flags.find((flag) => flag.color === 'blue')!.name).toBe('Reimbursable');
    flags = await send('PUT', '/api/flags/blue', { name: 'Work' });
    expect(flags.find((flag) => flag.color === 'blue')!.name).toBe('Work');
    flags = await send('PUT', '/api/flags/blue', { name: ' ' });
    expect(flags.find((flag) => flag.color === 'blue')!.name).toBeNull();

    expect((await call('PUT', '/api/flags/pink', { name: 'No' })).statusCode).toBe(400);
    expect((await call('PUT', '/api/flags/red', { name: 'x'.repeat(51) })).statusCode).toBe(400);
  });

  it('exports each flag’s name, or its color when unnamed', async () => {
    await add(checking, { payee: 'Named', flag: 'blue' });
    await add(checking, { payee: 'Unnamed', flag: 'red' });
    await send('PUT', '/api/flags/blue', { name: 'Reimbursable' });

    const body = (await call('GET', '/api/export/transactions.csv')).body;
    expect(body).toContain('"Checking","Reimbursable","03/10/2026","Named"');
    expect(body).toContain('"Checking","Red","03/10/2026","Unnamed"');
    expect(body).toContain('"Checking","","03/01/2026","Starting Balance"');
  });
});
