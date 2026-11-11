import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

const MONTH = '2026-03';
const DATE = `${MONTH}-10`;

interface AccountRow {
  id: number;
  balanceCents: number;
  clearedBalanceCents: number;
  lastReconciledAt: string | null;
}

interface TransactionRow {
  id: number;
  payee: string;
  amountCents: number;
  cleared: string;
  hasCategoryLine: boolean;
  categoryName: string | null;
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

const createAccount = (name: string, type = 'checking', startingBalanceCents = 1_000_00) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents,
    date: `${MONTH}-01`,
  });

const add = (accountId: number, fields: object) =>
  send<TransactionRow>('POST', `/api/accounts/${accountId}/transactions`, {
    date: DATE,
    payee: 'Store',
    amountCents: -10_00,
    ...fields,
  });

const reconcile = (accountId: number, bankBalanceCents: number) =>
  call('POST', `/api/accounts/${accountId}/reconcile`, { bankBalanceCents, date: DATE });

const account = async (id: number) =>
  (await send<AccountRow[]>('GET', '/api/accounts')).find((row) => row.id === id)!;

const register = (accountId: number) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);

const readyToAssign = async () =>
  (
    await send<{ readyToAssignCents: number }>(
      'GET',
      `/api/budget?month=${MONTH}&currentMonth=${MONTH}`,
    )
  ).readyToAssignCents;

async function createCategory(name: string) {
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  return (await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name })).id;
}

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('reconciling', () => {
  it('locks cleared transactions when the balance matches, leaving uncleared ones alone', async () => {
    const checking = await createAccount('Checking');
    await add(checking.id, { payee: 'Cleared', cleared: 'cleared', amountCents: -30_00 });
    await add(checking.id, { payee: 'Pending', amountCents: -5_00 });

    const response = await reconcile(checking.id, 970_00);

    expect(response.json()).toEqual({ adjustmentCents: 0 });
    const statuses = Object.fromEntries(
      (await register(checking.id)).map((row) => [row.payee, row.cleared]),
    );
    expect(statuses).toEqual({
      'Starting Balance': 'reconciled',
      Cleared: 'reconciled',
      Pending: 'uncleared',
    });
    expect((await account(checking.id)).lastReconciledAt).toEqual(expect.any(String));
  });

  it('adds a cleared, reconciled adjustment into Ready to Assign for a difference', async () => {
    const checking = await createAccount('Checking');

    expect((await reconcile(checking.id, 990_00)).json()).toEqual({ adjustmentCents: -10_00 });

    expect((await register(checking.id))[0]).toMatchObject({
      payee: 'Reconciliation Balance Adjustment',
      amountCents: -10_00,
      cleared: 'reconciled',
      categoryName: 'Ready to Assign',
    });
    expect(await account(checking.id)).toMatchObject({
      balanceCents: 990_00,
      clearedBalanceCents: 990_00,
    });
    expect(await readyToAssign()).toBe(990_00);
  });

  it('handles a bank balance higher than the cleared balance', async () => {
    const checking = await createAccount('Checking');

    expect((await reconcile(checking.id, 1_025_00)).json()).toEqual({ adjustmentCents: 25_00 });
    expect(await readyToAssign()).toBe(1_025_00);
  });

  it('adjusts a tracking account without touching the budget', async () => {
    const house = await createAccount('House', 'asset', 300_000_00);

    await reconcile(house.id, 310_000_00);

    expect((await register(house.id))[0]).toMatchObject({
      amountCents: 10_000_00,
      hasCategoryLine: false,
    });
    expect(await readyToAssign()).toBe(0);
  });

  it('refuses closed accounts and invalid input', async () => {
    const checking = await createAccount('Checking', 'checking', 0);
    await send('POST', `/api/accounts/${checking.id}/close`, { date: DATE });

    expect((await reconcile(checking.id, 0)).statusCode).toBe(409);
    expect((await reconcile(99_999, 0)).statusCode).toBe(404);
    expect(
      (await call('POST', `/api/accounts/${checking.id}/reconcile`, { bankBalanceCents: 1.5 }))
        .statusCode,
    ).toBe(400);
  });
});

describe('locked transactions', () => {
  async function lockedTransaction() {
    const checking = await createAccount('Checking');
    const groceries = await createCategory('Groceries');
    const created = await add(checking.id, { cleared: 'cleared' });
    await reconcile(checking.id, 990_00);
    return { checking, groceries, created };
  }

  const edit = (id: number, fields: object) => call('PATCH', `/api/transactions/${id}`, fields);

  it.each([
    ['amount', { amountCents: -12_00 }],
    ['date', { date: '2026-03-11' }],
    ['category', { categoryId: 'GROCERIES' }],
  ])('asks for confirmation before changing the %s', async (_label, fields) => {
    const { groceries, created } = await lockedTransaction();
    const change = JSON.parse(JSON.stringify(fields).replace('"GROCERIES"', String(groceries)));

    const refused = await edit(created.id, change);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'RECONCILED' });

    const confirmed = await edit(created.id, { ...change, confirmReconciled: true });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ cleared: 'reconciled' });
  });

  it('asks before turning it into a transfer', async () => {
    const { created } = await lockedTransaction();
    const savings = await createAccount('Savings', 'savings', 0);

    expect((await edit(created.id, { transferAccountId: savings.id })).statusCode).toBe(409);
  });

  it('changes the payee and memo freely', async () => {
    const { created } = await lockedTransaction();

    const response = await edit(created.id, { payee: 'Corner Market', memo: 'receipt' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ payee: 'Corner Market', cleared: 'reconciled' });
  });

  it('can’t be marked cleared or uncleared again', async () => {
    const { created } = await lockedTransaction();

    expect((await edit(created.id, { cleared: 'uncleared' })).statusCode).toBe(400);
    expect((await edit(created.id, { cleared: 'cleared' })).statusCode).toBe(400);
  });

  it('asks before deleting', async () => {
    const { checking, created } = await lockedTransaction();

    expect((await call('DELETE', `/api/transactions/${created.id}`)).statusCode).toBe(409);
    expect(
      (await call('DELETE', `/api/transactions/${created.id}?confirmReconciled=true`)).statusCode,
    ).toBe(204);
    expect((await account(checking.id)).balanceCents).toBe(1_000_00);
  });

  it('protects a reconciled transfer partner from the other side', async () => {
    const checking = await createAccount('Checking');
    const savings = await createAccount('Savings', 'savings', 0);
    const created = await add(checking.id, { transferAccountId: savings.id, amountCents: -50_00 });
    const [savingsSide] = await register(savings.id);
    await send('PATCH', `/api/transactions/${savingsSide!.id}`, { cleared: 'cleared' });
    await reconcile(savings.id, 50_00);

    expect((await edit(created.id, { amountCents: -60_00 })).statusCode).toBe(409);
    expect((await call('DELETE', `/api/transactions/${created.id}`)).statusCode).toBe(409);
    expect((await edit(created.id, { memo: 'moving money' })).statusCode).toBe(200);
  });

  it('can be found with the Reconciled filter', async () => {
    await lockedTransaction();

    const result = await send<{ transactions: TransactionRow[] }>(
      'GET',
      '/api/transactions?cleared=reconciled',
    );

    // The starting balance and the cleared purchase; the balance matched, so no adjustment.
    expect(result.transactions).toHaveLength(2);
  });
});
