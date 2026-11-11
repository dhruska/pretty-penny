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
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  balanceCents: number;
}

interface TransactionRow {
  id: number;
  date: string;
  payee: string;
  amountCents: number;
  transferAccountId: number | null;
  transferAccountName: string | null;
  hasCategoryLine: boolean;
  categoryId: number | null;
}

interface BudgetResponse {
  readyToAssignCents: number;
  uncategorized: { accountId: number; count: number }[];
  groups: { categories: { id: number; activityCents: number; availableCents: number }[] }[];
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

const createAccount = (name: string, type: string, startingBalanceCents = 0) =>
  send<AccountRow>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents,
    date: `${MONTH}-01`,
  });

const listAccounts = () => send<AccountRow[]>('GET', '/api/accounts');
const balanceOf = async (id: number) =>
  (await listAccounts()).find((account) => account.id === id)?.balanceCents;
const listTransactions = (accountId: number) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);
const getBudget = (currentMonth = MONTH) =>
  send<BudgetResponse>('GET', `/api/budget?month=${MONTH}&currentMonth=${currentMonth}`);

function transfer(fromId: number, toId: number, amountCents: number, extra: object = {}) {
  return call('POST', `/api/accounts/${fromId}/transactions`, {
    date: DATE,
    amountCents,
    transferAccountId: toId,
    ...extra,
  });
}

async function createCategory() {
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  return (
    await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name: 'Food' })
  ).id;
}

async function findCategory(id: number) {
  return (await getBudget()).groups.flatMap((group) => group.categories).find((c) => c.id === id);
}

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('account types', () => {
  it('defaults to a checking account on the budget', async () => {
    const response = await send<AccountRow>('POST', '/api/accounts', {
      name: 'Main',
      startingBalanceCents: 0,
      date: `${MONTH}-01`,
    });

    expect(response).toMatchObject({ type: 'checking', onBudget: true, closed: false });
  });

  it('puts asset and liability accounts off budget', async () => {
    expect(await createAccount('House', 'asset')).toMatchObject({ onBudget: false });
    expect(await createAccount('Mortgage', 'liability')).toMatchObject({ onBudget: false });
    expect(await createAccount('Card', 'credit_card')).toMatchObject({ onBudget: true });
  });

  it('keeps tracking starting balances out of Ready to Assign', async () => {
    const house = await createAccount('House', 'asset', 300_000_00);

    expect((await getBudget()).readyToAssignCents).toBe(0);
    expect(await balanceOf(house.id)).toBe(300_000_00);
    expect(await listTransactions(house.id)).toMatchObject([{ hasCategoryLine: false }]);
  });

  it('changes type only within the same side', async () => {
    const checking = await createAccount('Main', 'checking');
    const house = await createAccount('House', 'asset');

    expect(
      (await call('PATCH', `/api/accounts/${checking.id}`, { type: 'savings' })).json(),
    ).toMatchObject({ type: 'savings', onBudget: true });
    expect(
      (await call('PATCH', `/api/accounts/${checking.id}`, { type: 'asset' })).statusCode,
    ).toBe(400);
    expect((await call('PATCH', `/api/accounts/${house.id}`, { type: 'cash' })).statusCode).toBe(
      400,
    );
    expect((await call('PATCH', `/api/accounts/${checking.id}`, { type: 'boat' })).statusCode).toBe(
      400,
    );
  });

  it('uses the starting balance marker rather than the payee when deleting', async () => {
    const account = await createAccount('Main', 'checking', 100_00);
    await send('POST', `/api/accounts/${account.id}/transactions`, {
      date: DATE,
      payee: 'Starting Balance',
      amountCents: -5_00,
    });

    expect((await call('DELETE', `/api/accounts/${account.id}`)).statusCode).toBe(409);
  });
});

describe('closing accounts', () => {
  it('closes an account with a zero balance without adding a transaction', async () => {
    const account = await createAccount('Old', 'savings');

    expect(
      (await call('POST', `/api/accounts/${account.id}/close`, { date: DATE })).statusCode,
    ).toBe(204);
    expect((await listAccounts())[0]).toMatchObject({ closed: true, balanceCents: 0 });
    expect(await listTransactions(account.id)).toEqual([]);
  });

  it('zeroes a remaining balance with an adjustment into Ready to Assign', async () => {
    const account = await createAccount('Old', 'savings', 250_00);

    await send('POST', `/api/accounts/${account.id}/close`, { date: DATE });

    expect(await balanceOf(account.id)).toBe(0);
    expect((await listTransactions(account.id))[0]).toMatchObject({
      payee: 'Balance Adjustment',
      amountCents: -250_00,
      hasCategoryLine: true,
    });
    expect((await getBudget()).readyToAssignCents).toBe(0);
  });

  it('adjusts a tracking account without touching the budget', async () => {
    const car = await createAccount('Car', 'asset', 8_000_00);

    await send('POST', `/api/accounts/${car.id}/close`, { date: DATE });

    expect(await balanceOf(car.id)).toBe(0);
    expect((await getBudget()).readyToAssignCents).toBe(0);
  });

  it('blocks new transactions and transfers into a closed account until reopened', async () => {
    const closed = await createAccount('Old', 'savings');
    const open = await createAccount('Main', 'checking', 100_00);
    await send('POST', `/api/accounts/${closed.id}/close`, { date: DATE });

    expect(
      (
        await call('POST', `/api/accounts/${closed.id}/transactions`, {
          date: DATE,
          amountCents: 5_00,
        })
      ).statusCode,
    ).toBe(409);
    expect((await transfer(open.id, closed.id, -5_00)).statusCode).toBe(400);
    expect(
      (await call('POST', `/api/accounts/${closed.id}/close`, { date: DATE })).statusCode,
    ).toBe(409);

    expect((await call('POST', `/api/accounts/${closed.id}/reopen`)).statusCode).toBe(204);
    expect((await transfer(open.id, closed.id, -5_00)).statusCode).toBe(201);
  });
});

describe('transfers', () => {
  it('creates both sides between budget accounts with no category', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');

    expect(
      (await transfer(checking.id, savings.id, -200_00, { payee: 'ignored' })).statusCode,
    ).toBe(201);

    expect(await balanceOf(checking.id)).toBe(800_00);
    expect(await balanceOf(savings.id)).toBe(200_00);
    expect((await listTransactions(checking.id))[0]).toMatchObject({
      payee: '',
      transferAccountId: savings.id,
      transferAccountName: 'Savings',
      hasCategoryLine: false,
    });
    expect((await listTransactions(savings.id))[0]).toMatchObject({
      amountCents: 200_00,
      transferAccountId: checking.id,
    });
    expect((await getBudget()).readyToAssignCents).toBe(1_000_00);
    expect((await getBudget()).uncategorized).toEqual([]);
  });

  it('pays a credit card without changing categories or Ready to Assign', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const card = await createAccount('Card', 'credit_card');
    const food = await createCategory();
    await send('PUT', `/api/budget/${MONTH}/categories/${food}`, { assignedCents: 100_00 });

    await send('POST', `/api/accounts/${card.id}/transactions`, {
      date: DATE,
      payee: 'Market',
      amountCents: -40_00,
      categoryId: food,
    });
    expect(await findCategory(food)).toMatchObject({
      activityCents: -40_00,
      availableCents: 60_00,
    });

    await transfer(checking.id, card.id, -40_00);

    expect(await balanceOf(card.id)).toBe(0);
    expect(await balanceOf(checking.id)).toBe(960_00);
    expect(await findCategory(food)).toMatchObject({
      activityCents: -40_00,
      availableCents: 60_00,
    });
    expect((await getBudget()).readyToAssignCents).toBe(900_00);
  });

  it('categorizes the budget side of a transfer to a tracking account', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const investments = await createAccount('Investments', 'asset');
    const food = await createCategory();

    await transfer(investments.id, checking.id, 300_00, { categoryId: food });

    expect(await balanceOf(investments.id)).toBe(300_00);
    expect(await findCategory(food)).toMatchObject({ activityCents: -300_00 });
    expect(await listTransactions(investments.id)).toMatchObject([
      { hasCategoryLine: true, categoryId: food },
    ]);
  });

  it('flags an uncategorized transfer to a tracking account on the budget side', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const investments = await createAccount('Investments', 'asset');

    await transfer(checking.id, investments.id, -300_00);

    expect((await getBudget()).uncategorized).toEqual([
      expect.objectContaining({ accountId: checking.id, count: 1 }),
    ]);
  });

  it('rejects invalid transfers and categories', async () => {
    const checking = await createAccount('Checking', 'checking', 100_00);
    const savings = await createAccount('Savings', 'savings');
    const house = await createAccount('House', 'asset');
    const food = await createCategory();

    expect((await transfer(checking.id, checking.id, -5_00)).statusCode).toBe(400);
    expect((await transfer(checking.id, 99_999, -5_00)).statusCode).toBe(400);
    expect((await transfer(checking.id, savings.id, -5_00, { categoryId: food })).statusCode).toBe(
      400,
    );
    expect(
      (
        await call('POST', `/api/accounts/${house.id}/transactions`, {
          date: DATE,
          amountCents: 5_00,
          categoryId: food,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('keeps both sides in step when the date or amount is edited from either side', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    const created = (await transfer(checking.id, savings.id, -200_00)).json<TransactionRow>();

    await send('PATCH', `/api/transactions/${created.id}`, { amountCents: -250_00 });
    const [savingsSide] = await listTransactions(savings.id);
    expect(savingsSide).toMatchObject({ amountCents: 250_00 });

    await send('PATCH', `/api/transactions/${savingsSide!.id}`, { date: `${MONTH}-15` });
    expect((await listTransactions(checking.id))[0]).toMatchObject({
      date: `${MONTH}-15`,
      amountCents: -250_00,
    });
  });

  it('moves a transfer to a different account', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    const cash = await createAccount('Cash', 'cash');
    const created = (await transfer(checking.id, savings.id, -200_00)).json<TransactionRow>();

    await send('PATCH', `/api/transactions/${created.id}`, { transferAccountId: cash.id });

    expect(await balanceOf(savings.id)).toBe(0);
    expect(await balanceOf(cash.id)).toBe(200_00);
    expect(await listTransactions(savings.id)).toEqual([]);
  });

  it('converts between a transfer and a regular transaction', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    const food = await createCategory();
    const created = await send<TransactionRow>(
      'POST',
      `/api/accounts/${checking.id}/transactions`,
      {
        date: DATE,
        payee: 'Market',
        amountCents: -50_00,
        categoryId: food,
      },
    );

    await send('PATCH', `/api/transactions/${created.id}`, { transferAccountId: savings.id });
    expect(await balanceOf(savings.id)).toBe(50_00);
    expect(await findCategory(food)).toMatchObject({ activityCents: 0 });

    await send('PATCH', `/api/transactions/${created.id}`, {
      transferAccountId: null,
      payee: 'Market',
      categoryId: food,
    });
    expect(await balanceOf(savings.id)).toBe(0);
    expect(await findCategory(food)).toMatchObject({ activityCents: -50_00 });
    expect((await listTransactions(checking.id))[0]).toMatchObject({
      payee: 'Market',
      transferAccountId: null,
    });
  });

  it('moves the category to the budget side when a transfer changes direction of budget', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    const house = await createAccount('House', 'asset');
    const food = await createCategory();
    const created = (
      await transfer(checking.id, house.id, -100_00, { categoryId: food })
    ).json<TransactionRow>();
    expect(await findCategory(food)).toMatchObject({ activityCents: -100_00 });

    await send('PATCH', `/api/transactions/${created.id}`, { transferAccountId: savings.id });

    expect(await findCategory(food)).toMatchObject({ activityCents: 0 });
    expect((await listTransactions(checking.id))[0]).toMatchObject({ hasCategoryLine: false });
  });

  it('deletes both sides when either side is deleted', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    await transfer(checking.id, savings.id, -200_00);
    const [savingsSide] = await listTransactions(savings.id);

    expect((await call('DELETE', `/api/transactions/${savingsSide!.id}`)).statusCode).toBe(204);

    expect(await balanceOf(checking.id)).toBe(1_000_00);
    expect(await listTransactions(checking.id)).toHaveLength(1);
  });

  it('refuses to delete an account that has transfers', async () => {
    const checking = await createAccount('Checking', 'checking', 1_000_00);
    const savings = await createAccount('Savings', 'savings');
    await transfer(checking.id, savings.id, -200_00);

    expect((await call('DELETE', `/api/accounts/${savings.id}`)).statusCode).toBe(409);
  });
});

it('keeps Ready to Assign plus Available equal to budget account balances', async () => {
  const checking = await createAccount('Checking', 'checking', 2_000_00);
  const card = await createAccount('Card', 'credit_card', -300_00);
  const savings = await createAccount('Savings', 'savings', 500_00);
  const house = await createAccount('House', 'asset', 250_000_00);
  const loan = await createAccount('Loan', 'liability', -10_000_00);
  const food = await createCategory();
  await send('PUT', `/api/budget/${MONTH}/categories/${food}`, { assignedCents: 400_00 });

  await send('POST', `/api/accounts/${card.id}/transactions`, {
    date: DATE,
    amountCents: -120_00,
    categoryId: food,
  });
  await transfer(checking.id, card.id, -300_00);
  await transfer(checking.id, savings.id, -100_00);
  await transfer(checking.id, loan.id, -500_00, { categoryId: food });
  await transfer(house.id, savings.id, 1_000_00, { categoryId: food });

  const budget = await getBudget();
  const available = budget.groups
    .flatMap((group) => group.categories)
    .reduce((sum, category) => sum + category.availableCents, 0);
  const budgetBalances = (await listAccounts())
    .filter((account) => account.onBudget)
    .reduce((sum, account) => sum + account.balanceCents, 0);

  expect(budget.readyToAssignCents + available).toBe(budgetBalances);
});
