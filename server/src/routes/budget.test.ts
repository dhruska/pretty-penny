import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

const MONTH = '2026-03';

interface BudgetCategory {
  id: number;
  name: string;
  hidden: boolean;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
}

interface BudgetResponse {
  readyToAssignCents: number;
  uncategorized: { accountId: number; accountName: string; count: number }[];
  groups: { id: number; name: string; categories: BudgetCategory[] }[];
}

interface CategoriesResponse {
  readyToAssignId: number;
  groups: {
    id: number;
    name: string;
    hidden: boolean;
    categories: { id: number; name: string; hidden: boolean }[];
  }[];
}

interface TransactionRow {
  id: number;
  payee: string;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode).toBeLessThan(300);
  return response.json<T>();
}

const createGroup = (name = 'Everyday') =>
  send<{ id: number }>('POST', '/api/category-groups', { name });

const createCategory = (groupId: number, name = 'Groceries') =>
  send<{ id: number }>('POST', '/api/categories', { groupId, name });

async function setUpCategory(name = 'Groceries') {
  const group = await createGroup();
  const category = await createCategory(group.id, name);
  return { groupId: group.id, categoryId: category.id };
}

const createAccount = (startingBalanceCents = 1000_00) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name: 'Checking',
    startingBalanceCents,
    date: `${MONTH}-01`,
  });

const addTransaction = (
  accountId: number,
  amountCents: number,
  categoryId: number | null | undefined,
  date = `${MONTH}-10`,
) =>
  send<{ id: number }>('POST', `/api/accounts/${accountId}/transactions`, {
    date,
    payee: 'Store',
    amountCents,
    ...(categoryId !== undefined && { categoryId }),
  });

const assign = (categoryId: number, assignedCents: number, month = MONTH) =>
  call('PUT', `/api/budget/${month}/categories/${categoryId}`, { assignedCents });

const getBudget = (month = MONTH, currentMonth = MONTH) =>
  send<BudgetResponse>('GET', `/api/budget?month=${month}&currentMonth=${currentMonth}`);

const listCategories = () => send<CategoriesResponse>('GET', '/api/categories');

const listTransactions = (accountId: number) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);

function findCategory(budget: BudgetResponse, id: number) {
  return budget.groups.flatMap((group) => group.categories).find((category) => category.id === id);
}

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('categories', () => {
  it('always has the Ready to Assign category, outside any group', async () => {
    const result = await listCategories();

    expect(result.readyToAssignId).toEqual(expect.any(Number));
    expect(result.groups).toEqual([]);
  });

  it('creates groups and categories in order', async () => {
    const first = await createGroup('First');
    const second = await createGroup('Second');
    await createCategory(first.id, 'A');
    await createCategory(first.id, 'B');

    const { groups } = await listCategories();

    expect(groups.map((group) => group.id)).toEqual([first.id, second.id]);
    expect(groups[0]?.categories.map((category) => category.name)).toEqual(['A', 'B']);
  });

  it('renames and hides a category and a group', async () => {
    const { groupId, categoryId } = await setUpCategory();

    await send('PATCH', `/api/categories/${categoryId}`, { name: 'Food', hidden: true });
    await send('PATCH', `/api/category-groups/${groupId}`, { name: 'Home', hidden: true });

    const { groups } = await listCategories();
    expect(groups[0]).toMatchObject({ name: 'Home', hidden: true });
    expect(groups[0]?.categories[0]).toMatchObject({ name: 'Food', hidden: true });
  });

  it('moves categories up and down, ignoring moves past the ends', async () => {
    const group = await createGroup();
    const a = await createCategory(group.id, 'A');
    await createCategory(group.id, 'B');
    const c = await createCategory(group.id, 'C');
    const names = async () =>
      (await listCategories()).groups[0]?.categories.map((category) => category.name);

    await call('POST', `/api/categories/${c.id}/move`, { direction: 'up' });
    expect(await names()).toEqual(['A', 'C', 'B']);

    await call('POST', `/api/categories/${a.id}/move`, { direction: 'down' });
    expect(await names()).toEqual(['C', 'A', 'B']);

    await call('POST', `/api/categories/${c.id}/move`, { direction: 'up' });
    expect(await names()).toEqual(['C', 'A', 'B']);
  });

  it('moves groups up and down', async () => {
    await createGroup('A');
    const b = await createGroup('B');

    await call('POST', `/api/category-groups/${b.id}/move`, { direction: 'up' });

    expect((await listCategories()).groups.map((group) => group.name)).toEqual(['B', 'A']);
  });

  it('moves a category to the end of another group', async () => {
    const source = await createGroup('Source');
    const target = await createGroup('Target');
    const moving = await createCategory(source.id, 'Moving');
    await createCategory(target.id, 'Existing');

    await send('PATCH', `/api/categories/${moving.id}`, { groupId: target.id });

    const { groups } = await listCategories();
    expect(groups[0]?.categories).toEqual([]);
    expect(groups[1]?.categories.map((category) => category.name)).toEqual(['Existing', 'Moving']);
  });

  it('deletes an unused category and an empty group', async () => {
    const { groupId, categoryId } = await setUpCategory();

    expect((await call('DELETE', `/api/categories/${categoryId}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/category-groups/${groupId}`)).statusCode).toBe(204);
    expect((await listCategories()).groups).toEqual([]);
  });

  it('refuses to delete a group that still has categories', async () => {
    const { groupId } = await setUpCategory();

    expect((await call('DELETE', `/api/category-groups/${groupId}`)).statusCode).toBe(409);
  });

  it('refuses to delete a category with transactions', async () => {
    const { categoryId } = await setUpCategory();
    const account = await createAccount();
    await addTransaction(account.id, -5_00, categoryId);

    expect((await call('DELETE', `/api/categories/${categoryId}`)).statusCode).toBe(409);
  });

  it('refuses to delete a category with assigned money', async () => {
    const { categoryId } = await setUpCategory();
    await assign(categoryId, 5_00);

    expect((await call('DELETE', `/api/categories/${categoryId}`)).statusCode).toBe(409);
  });

  it('protects the Ready to Assign category', async () => {
    const { readyToAssignId } = await listCategories();

    expect((await call('DELETE', `/api/categories/${readyToAssignId}`)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/api/categories/${readyToAssignId}`, { name: 'X' })).statusCode,
    ).toBe(404);
    expect((await assign(readyToAssignId, 5_00)).statusCode).toBe(404);
  });

  it('rejects invalid category input', async () => {
    const group = await createGroup();

    expect(
      (await call('POST', '/api/categories', { groupId: group.id, name: '  ' })).statusCode,
    ).toBe(400);
    expect((await call('POST', '/api/categories', { groupId: 999, name: 'X' })).statusCode).toBe(
      400,
    );
    expect((await call('POST', '/api/category-groups', {})).statusCode).toBe(400);
  });
});

describe('budget', () => {
  it('puts a starting balance into Ready to Assign', async () => {
    const account = await createAccount(1000_00);

    expect((await getBudget()).readyToAssignCents).toBe(1000_00);
    expect(await listTransactions(account.id)).toMatchObject([
      { payee: 'Starting Balance', categoryName: 'Ready to Assign' },
    ]);
  });

  it('reduces Ready to Assign when a negative starting balance is added', async () => {
    await createAccount(-200_00);

    expect((await getBudget()).readyToAssignCents).toBe(-200_00);
  });

  it('assigns money to a category', async () => {
    await createAccount(1000_00);
    const { categoryId } = await setUpCategory();

    expect((await assign(categoryId, 300_00)).statusCode).toBe(200);

    const budget = await getBudget();
    expect(budget.readyToAssignCents).toBe(700_00);
    expect(findCategory(budget, categoryId)).toMatchObject({
      assignedCents: 300_00,
      activityCents: 0,
      availableCents: 300_00,
    });
  });

  it('replaces an assignment and allows clearing it', async () => {
    const { categoryId } = await setUpCategory();

    await assign(categoryId, 100_00);
    await assign(categoryId, 250_00);
    expect(findCategory(await getBudget(), categoryId)?.assignedCents).toBe(250_00);

    await assign(categoryId, 0);
    expect(findCategory(await getBudget(), categoryId)?.assignedCents).toBe(0);
    expect((await call('DELETE', `/api/categories/${categoryId}`)).statusCode).toBe(204);
  });

  it('allows a negative assignment', async () => {
    const { categoryId } = await setUpCategory();

    expect((await assign(categoryId, -5_00)).statusCode).toBe(200);
    expect(findCategory(await getBudget(), categoryId)?.availableCents).toBe(-5_00);
  });

  it('applies categorized spending to Activity and Available', async () => {
    const account = await createAccount(1000_00);
    const { categoryId } = await setUpCategory();
    await assign(categoryId, 300_00);

    await addTransaction(account.id, -50_00, categoryId);

    const budget = await getBudget();
    expect(findCategory(budget, categoryId)).toMatchObject({
      activityCents: -50_00,
      availableCents: 250_00,
    });
    expect(budget.readyToAssignCents).toBe(700_00);
  });

  it('rolls Available into the next month', async () => {
    const account = await createAccount(1000_00);
    const { categoryId } = await setUpCategory();
    await assign(categoryId, 300_00);
    await addTransaction(account.id, -50_00, categoryId);

    expect(findCategory(await getBudget('2026-04'), categoryId)).toMatchObject({
      assignedCents: 0,
      activityCents: 0,
      availableCents: 250_00,
    });
  });

  it('takes an overspend from Ready to Assign once the month has closed', async () => {
    const account = await createAccount(100_00);
    const { categoryId } = await setUpCategory();
    await addTransaction(account.id, -30_00, categoryId);

    expect((await getBudget(MONTH, MONTH)).readyToAssignCents).toBe(100_00);

    const nextMonth = await getBudget('2026-04', '2026-04');
    expect(nextMonth.readyToAssignCents).toBe(70_00);
    expect(findCategory(nextMonth, categoryId)?.availableCents).toBe(0);
  });

  it('counts inflows categorized to Ready to Assign', async () => {
    const account = await createAccount(0);
    const { readyToAssignId } = await listCategories();

    await addTransaction(account.id, 500_00, readyToAssignId);

    expect((await getBudget()).readyToAssignCents).toBe(500_00);
  });

  it('assigns to a future month and reduces Ready to Assign now', async () => {
    await createAccount(100_00);
    const { categoryId } = await setUpCategory();

    await assign(categoryId, 40_00, '2026-05');

    expect((await getBudget()).readyToAssignCents).toBe(60_00);
    expect(findCategory(await getBudget(), categoryId)?.availableCents).toBe(0);
    expect(findCategory(await getBudget('2026-05'), categoryId)?.availableCents).toBe(40_00);
  });

  it('keeps hidden categories in the math', async () => {
    await createAccount(100_00);
    const { categoryId } = await setUpCategory();
    await assign(categoryId, 40_00);
    await send('PATCH', `/api/categories/${categoryId}`, { hidden: true });

    const budget = await getBudget();
    expect(budget.readyToAssignCents).toBe(60_00);
    expect(findCategory(budget, categoryId)).toMatchObject({ hidden: true, availableCents: 40_00 });
  });

  it('leaves uncategorized transactions out of budget figures and reports them', async () => {
    const account = await createAccount(100_00);
    await addTransaction(account.id, -10_00, undefined);
    await addTransaction(account.id, 20_00, null);

    const budget = await getBudget();

    expect(budget.readyToAssignCents).toBe(100_00);
    expect(budget.uncategorized).toEqual([
      { accountId: account.id, accountName: 'Checking', count: 2 },
    ]);
  });

  it('removes a deleted transaction from the budget', async () => {
    const account = await createAccount(100_00);
    const { categoryId } = await setUpCategory();
    const transaction = await addTransaction(account.id, -10_00, categoryId);

    await call('DELETE', `/api/transactions/${transaction.id}`);

    expect(findCategory(await getBudget(), categoryId)?.activityCents).toBe(0);
  });

  it('rejects invalid months and assignments', async () => {
    const { categoryId } = await setUpCategory();

    expect((await call('GET', '/api/budget?month=2026-13&currentMonth=2026-01')).statusCode).toBe(
      400,
    );
    expect((await call('GET', '/api/budget?month=2026-01')).statusCode).toBe(400);
    expect((await assign(categoryId, 5_00, 'March')).statusCode).toBe(400);
    expect(
      (await call('PUT', `/api/budget/${MONTH}/categories/${categoryId}`, { assignedCents: 1.5 }))
        .statusCode,
    ).toBe(400);
    expect((await assign(999, 5_00)).statusCode).toBe(404);
  });
});

describe('transaction categories', () => {
  it('stores and returns a category', async () => {
    const account = await createAccount(0);
    const { categoryId } = await setUpCategory();

    await addTransaction(account.id, -5_00, categoryId);

    expect(await listTransactions(account.id)).toMatchObject([
      { categoryId, categoryName: 'Groceries', amountCents: -5_00 },
    ]);
  });

  it('defaults to Uncategorized', async () => {
    const account = await createAccount(0);

    await addTransaction(account.id, -5_00, undefined);

    expect(await listTransactions(account.id)).toMatchObject([
      { categoryId: null, categoryName: null },
    ]);
  });

  it('can change only the category on an edit', async () => {
    const account = await createAccount(0);
    const { categoryId } = await setUpCategory();
    const transaction = await addTransaction(account.id, -5_00, null);

    await send('PATCH', `/api/transactions/${transaction.id}`, { categoryId });

    expect(findCategory(await getBudget(), categoryId)?.activityCents).toBe(-5_00);
    expect((await getBudget()).uncategorized).toEqual([]);
  });

  it('keeps the budget in step when an amount is edited', async () => {
    const account = await createAccount(0);
    const { categoryId } = await setUpCategory();
    const transaction = await addTransaction(account.id, -5_00, categoryId);

    await send('PATCH', `/api/transactions/${transaction.id}`, { amountCents: -7_50 });

    expect(findCategory(await getBudget(), categoryId)?.activityCents).toBe(-7_50);
  });

  it('can set a transaction back to Uncategorized', async () => {
    const account = await createAccount(0);
    const { categoryId } = await setUpCategory();
    const transaction = await addTransaction(account.id, -5_00, categoryId);

    await send('PATCH', `/api/transactions/${transaction.id}`, { categoryId: null });

    expect(findCategory(await getBudget(), categoryId)?.activityCents).toBe(0);
  });

  it('moves activity to the new month when a date is edited', async () => {
    const account = await createAccount(0);
    const { categoryId } = await setUpCategory();
    const transaction = await addTransaction(account.id, -5_00, categoryId);

    await send('PATCH', `/api/transactions/${transaction.id}`, { date: '2026-04-02' });

    expect(findCategory(await getBudget('2026-03', '2026-04'), categoryId)?.activityCents).toBe(0);
    expect(findCategory(await getBudget('2026-04', '2026-04'), categoryId)?.activityCents).toBe(
      -5_00,
    );
  });

  it('rejects a category that does not exist', async () => {
    const account = await createAccount(0);
    const transaction = await addTransaction(account.id, -5_00, null);

    const created = await call('POST', `/api/accounts/${account.id}/transactions`, {
      date: `${MONTH}-10`,
      amountCents: -1_00,
      categoryId: 999_999,
    });
    const edited = await call('PATCH', `/api/transactions/${transaction.id}`, {
      categoryId: 999_999,
    });

    expect(created.statusCode).toBe(400);
    expect(edited.statusCode).toBe(400);
  });
});
