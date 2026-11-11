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
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  assignedLastMonthCents: number;
  spentLastMonthCents: number;
  averageAssignedCents: number;
  averageSpentCents: number;
}

interface BudgetResponse {
  readyToAssignCents: number;
  groups: { categories: BudgetCategory[] }[];
}

type Method = 'GET' | 'POST' | 'PUT';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

let accountId: number;
let groupId: number;

async function createCategory(name: string) {
  return (await send<{ id: number }>('POST', '/api/categories', { groupId, name })).id;
}

const assign = (categoryId: number, assignedCents: number, month = MONTH) =>
  send('PUT', `/api/budget/${month}/categories/${categoryId}`, { assignedCents });

const spend = (categoryId: number, amountCents: number, date = `${MONTH}-10`) =>
  send('POST', `/api/accounts/${accountId}/transactions`, { date, amountCents, categoryId });

const move = (fromCategoryId: number | null, toCategoryId: number | null, amountCents: number) =>
  call('POST', `/api/budget/${MONTH}/move`, { fromCategoryId, toCategoryId, amountCents });

async function getBudget(month = MONTH) {
  return send<BudgetResponse>('GET', `/api/budget?month=${month}&currentMonth=${month}`);
}

async function category(id: number, month = MONTH) {
  return (await getBudget(month)).groups
    .flatMap((group) => group.categories)
    .find((c) => c.id === id)!;
}

beforeEach(async () => {
  await resetDb(db);
  accountId = (
    await send<{ id: number }>('POST', '/api/accounts', {
      name: 'Checking',
      startingBalanceCents: 1_000_00,
      date: '2025-01-01',
    })
  ).id;
  groupId = (await send<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' })).id;
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('moving money', () => {
  it('moves between categories by changing both Assigned amounts', async () => {
    const groceries = await createCategory('Groceries');
    const dining = await createCategory('Dining');
    await assign(groceries, 100_00);

    expect((await move(groceries, dining, 30_00)).statusCode).toBe(204);

    expect(await category(groceries)).toMatchObject({
      assignedCents: 70_00,
      availableCents: 70_00,
    });
    expect(await category(dining)).toMatchObject({ assignedCents: 30_00, availableCents: 30_00 });
    expect((await getBudget()).readyToAssignCents).toBe(900_00);
  });

  it('covers an overspent category', async () => {
    const groceries = await createCategory('Groceries');
    const dining = await createCategory('Dining');
    await assign(groceries, 100_00);
    await spend(dining, -30_00);

    await move(groceries, dining, 30_00);

    expect(await category(dining)).toMatchObject({ assignedCents: 30_00, availableCents: 0 });
    expect(await category(groceries)).toMatchObject({ availableCents: 70_00 });
  });

  it('moves money from and back to Ready to Assign', async () => {
    const groceries = await createCategory('Groceries');

    await move(null, groceries, 200_00);
    expect((await getBudget()).readyToAssignCents).toBe(800_00);

    await move(groceries, null, 50_00);
    expect((await getBudget()).readyToAssignCents).toBe(850_00);
    expect(await category(groceries)).toMatchObject({ assignedCents: 150_00 });
  });

  it('lets Ready to Assign go negative', async () => {
    const groceries = await createCategory('Groceries');

    expect((await move(null, groceries, 1_500_00)).statusCode).toBe(204);
    expect((await getBudget()).readyToAssignCents).toBe(-500_00);
  });

  it('only moves up to what a category has available', async () => {
    const groceries = await createCategory('Groceries');
    const dining = await createCategory('Dining');
    await assign(groceries, 100_00);
    await spend(groceries, -40_00);

    expect((await move(groceries, dining, 60_01)).statusCode).toBe(400);
    expect((await move(groceries, dining, 60_00)).statusCode).toBe(204);
    expect(await category(groceries)).toMatchObject({ availableCents: 0 });
  });

  it('counts rolled-over money as available to move', async () => {
    const groceries = await createCategory('Groceries');
    const dining = await createCategory('Dining');
    await assign(groceries, 100_00, '2026-02');

    expect((await move(groceries, dining, 100_00)).statusCode).toBe(204);
    expect(await category(groceries)).toMatchObject({ assignedCents: -100_00, availableCents: 0 });
  });

  it('rejects invalid moves', async () => {
    const groceries = await createCategory('Groceries');
    await assign(groceries, 100_00);
    const { readyToAssignId } = await send<{ readyToAssignId: number }>('GET', '/api/categories');

    expect((await move(null, null, 5_00)).statusCode).toBe(400);
    expect((await move(groceries, groceries, 5_00)).statusCode).toBe(400);
    expect((await move(groceries, 99_999, 5_00)).statusCode).toBe(400);
    expect((await move(readyToAssignId, groceries, 5_00)).statusCode).toBe(400);
    expect((await move(groceries, null, 0)).statusCode).toBe(400);
    expect(
      (
        await call('POST', '/api/budget/March/move', {
          fromCategoryId: null,
          toCategoryId: groceries,
          amountCents: 5_00,
        })
      ).statusCode,
    ).toBe(400);
    expect(await category(groceries)).toMatchObject({ assignedCents: 100_00 });
  });
});

describe('setting several assignments', () => {
  it('sets each category’s Assigned', async () => {
    const groceries = await createCategory('Groceries');
    const dining = await createCategory('Dining');
    await assign(dining, 10_00);

    await send('POST', `/api/budget/${MONTH}/assignments`, {
      assignments: [
        { categoryId: groceries, assignedCents: 120_00 },
        { categoryId: dining, assignedCents: 0 },
      ],
    });

    expect(await category(groceries)).toMatchObject({ assignedCents: 120_00 });
    expect(await category(dining)).toMatchObject({ assignedCents: 0 });
  });

  it('changes nothing if any category is invalid', async () => {
    const groceries = await createCategory('Groceries');

    const response = await call('POST', `/api/budget/${MONTH}/assignments`, {
      assignments: [
        { categoryId: groceries, assignedCents: 120_00 },
        { categoryId: 99_999, assignedCents: 5_00 },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(await category(groceries)).toMatchObject({ assignedCents: 0 });
  });

  it('rejects an empty list', async () => {
    expect(
      (await call('POST', `/api/budget/${MONTH}/assignments`, { assignments: [] })).statusCode,
    ).toBe(400);
  });
});

it('includes auto-assign figures in the budget', async () => {
  const groceries = await createCategory('Groceries');
  await assign(groceries, 300_00, '2026-01');
  await assign(groceries, 100_00, '2026-02');
  await spend(groceries, -80_00, '2026-02-15');

  expect(await category(groceries)).toMatchObject({
    assignedLastMonthCents: 100_00,
    spentLastMonthCents: 80_00,
    averageAssignedCents: 200_00,
    averageSpentCents: 40_00,
  });
});
