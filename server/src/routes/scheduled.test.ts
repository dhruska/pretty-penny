import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { transactions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { postDueScheduled } from '../scheduled.js';
import { resetDb } from '../test/reset-db.js';

const TODAY = '2026-06-15';
const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db, { today: () => TODAY });

interface Schedule {
  id: number;
  frequency: string;
  nextDate: string;
  payee: string;
  amountCents: number;
  categoryId: number | null;
  categoryName: string | null;
  lines: { categoryId: number | null; amountCents: number }[] | null;
  transferAccountId: number | null;
  transferAccountName: string | null;
}

interface TransactionRow {
  id: number;
  date: string;
  payee: string;
  amountCents: number;
  categoryName: string | null;
}

interface BudgetCategory {
  id: number;
  activityCents: number;
  upcomingCents: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

function call(method: Method, url: string, body?: object) {
  return app.inject({ method, url, ...(body ? { payload: body } : {}) });
}

async function send<T>(method: Method, url: string, body?: object) {
  const response = await call(method, url, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return (response.body ? response.json<T>() : undefined) as T;
}

let checkingId: number;
let rentId: number;
let groceriesId: number;

const createAccount = (name: string, type: string) =>
  send<{ id: number }>('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents: 0,
    date: '2026-01-01',
  });

const schedule = (fields: object, accountId = checkingId) =>
  call('POST', `/api/accounts/${accountId}/scheduled`, {
    payee: 'Landlord',
    amountCents: -1_800_00,
    categoryId: rentId,
    frequency: 'monthly',
    ...fields,
  });

async function createSchedule(fields: object, accountId = checkingId) {
  const response = await schedule(fields, accountId);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: number; posted: number }>();
}

const listSchedules = (accountId = checkingId) =>
  send<Schedule[]>('GET', `/api/accounts/${accountId}/scheduled`);

const register = (accountId = checkingId) =>
  send<TransactionRow[]>('GET', `/api/accounts/${accountId}/transactions`);

async function budgetCategory(id: number, month = '2026-06') {
  const budget = await send<{ groups: { categories: BudgetCategory[] }[] }>(
    'GET',
    `/api/budget?month=${month}&currentMonth=2026-06`,
  );
  return budget.groups.flatMap((group) => group.categories).find((c) => c.id === id)!;
}

beforeEach(async () => {
  await resetDb(db);
  checkingId = (await createAccount('Checking', 'checking')).id;
  const group = await send<{ id: number }>('POST', '/api/category-groups', { name: 'Bills' });
  rentId = (
    await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name: 'Rent' })
  ).id;
  groceriesId = (
    await send<{ id: number }>('POST', '/api/categories', { groupId: group.id, name: 'Groceries' })
  ).id;
});

afterAll(async () => {
  await app.close();
  await close();
});

describe('creating schedules', () => {
  it('waits for a future first date without posting', async () => {
    const created = await createSchedule({ date: '2026-07-01' });

    expect(created.posted).toBe(0);
    expect(await listSchedules()).toMatchObject([
      {
        id: created.id,
        frequency: 'monthly',
        nextDate: '2026-07-01',
        payee: 'Landlord',
        categoryName: 'Rent',
      },
    ]);
    expect(await register()).toEqual([]);
  });

  it('posts right away when the first date is today, then waits for the next', async () => {
    const created = await createSchedule({ date: TODAY });

    expect(created.posted).toBe(1);
    expect(await register()).toMatchObject([
      { date: TODAY, payee: 'Landlord', amountCents: -1_800_00, categoryName: 'Rent' },
    ]);
    expect((await listSchedules())[0]).toMatchObject({ nextDate: '2026-07-15' });
  });

  it('posts every occurrence already past, each with its own date', async () => {
    const created = await createSchedule({ date: '2026-03-15' });

    expect(created.posted).toBe(4);
    expect((await register()).map((row) => row.date)).toEqual([
      '2026-06-15',
      '2026-05-15',
      '2026-04-15',
      '2026-03-15',
    ]);
  });

  it('records which schedule each posted transaction came from', async () => {
    const created = await createSchedule({ date: TODAY });

    const rows = await db
      .select({ scheduledTransactionId: transactions.scheduledTransactionId })
      .from(transactions);
    expect(rows).toEqual([{ scheduledTransactionId: created.id }]);
  });

  it('removes a one-time schedule once it posts', async () => {
    await createSchedule({ date: '2026-06-01', frequency: 'never' });

    expect(await register()).toHaveLength(1);
    expect(await listSchedules()).toEqual([]);
  });

  it('applies the same rules as transactions', async () => {
    const savings = await createAccount('Savings', 'savings');
    await send('POST', `/api/accounts/${savings.id}/close`, { date: TODAY });

    expect((await schedule({ date: '2026-07-01', frequency: 'hourly' })).statusCode).toBe(400);
    expect((await schedule({ date: '2026-07-01' }, 99_999)).statusCode).toBe(404);
    expect((await schedule({ date: '2026-07-01' }, savings.id)).statusCode).toBe(409);
    expect(
      (
        await schedule({
          date: '2026-07-01',
          categoryId: undefined,
          lines: [
            { categoryId: rentId, amountCents: -1_000_00 },
            { categoryId: groceriesId, amountCents: -500_00 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(await listSchedules()).toEqual([]);
  });

  it('rejects a category on a transfer between budget accounts', async () => {
    const savings = await createAccount('Savings', 'savings');

    expect((await schedule({ date: '2026-07-01', transferAccountId: savings.id })).statusCode).toBe(
      400,
    );
  });
});

describe('posting due schedules', () => {
  it('posts nothing before the next date', async () => {
    await createSchedule({ date: '2026-07-01' });

    expect(await postDueScheduled(db, '2026-06-30')).toEqual({ posted: 0, failed: [] });
    expect(await register()).toEqual([]);
  });

  it('catches up on every missed occurrence', async () => {
    await createSchedule({ date: '2026-07-01', frequency: 'weekly', amountCents: -10_00 });

    const result = await postDueScheduled(db, '2026-07-22');

    expect(result.posted).toBe(4);
    expect((await listSchedules())[0]).toMatchObject({ nextDate: '2026-07-29' });
  });

  it('posts both sides of a scheduled transfer', async () => {
    const savings = await createAccount('Savings', 'savings');
    await createSchedule({
      date: '2026-07-01',
      payee: '',
      amountCents: -200_00,
      categoryId: null,
      transferAccountId: savings.id,
    });

    await postDueScheduled(db, '2026-07-01');

    expect(await register(savings.id)).toMatchObject([{ amountCents: 200_00 }]);
    expect((await listSchedules())[0]).toMatchObject({ transferAccountName: 'Savings' });
  });

  it('posts every line of a scheduled split', async () => {
    await createSchedule({
      date: '2026-06-20',
      payee: 'Costco',
      amountCents: -150_00,
      categoryId: undefined,
      lines: [
        { categoryId: groceriesId, amountCents: -100_00, memo: 'food' },
        { categoryId: rentId, amountCents: -50_00 },
      ],
    });

    await postDueScheduled(db, '2026-06-20');

    expect((await register())[0]).toMatchObject({ categoryName: 'Split' });
    expect(await budgetCategory(groceriesId)).toMatchObject({ activityCents: -100_00 });
  });

  it('reports a schedule that can’t post and still posts the others', async () => {
    const wallet = await createAccount('Wallet', 'cash');
    await createSchedule({ date: '2026-07-01', categoryId: null, payee: 'Cash' }, wallet.id);
    await createSchedule({ date: '2026-07-01' });
    await send('POST', `/api/accounts/${wallet.id}/close`, { date: TODAY });

    const result = await postDueScheduled(db, '2026-07-01');

    expect(result.posted).toBe(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ message: 'Reopen this account to add transactions.' }),
    ]);
    expect(await listSchedules(wallet.id)).toMatchObject([{ nextDate: '2026-07-01' }]);
  });
});

describe('managing schedules', () => {
  it('enters the next occurrence now, with its scheduled date', async () => {
    const created = await createSchedule({ date: '2026-07-01' });

    expect((await call('POST', `/api/scheduled/${created.id}/enter-now`)).statusCode).toBe(204);

    expect(await register()).toMatchObject([{ date: '2026-07-01' }]);
    expect((await listSchedules())[0]).toMatchObject({ nextDate: '2026-08-01' });
  });

  it('skips an occurrence without posting it', async () => {
    const created = await createSchedule({ date: '2026-07-01' });

    await send('POST', `/api/scheduled/${created.id}/skip`);

    expect(await register()).toEqual([]);
    expect((await listSchedules())[0]).toMatchObject({ nextDate: '2026-08-01' });
  });

  it('removes a one-time schedule when skipped', async () => {
    const created = await createSchedule({ date: '2026-07-01', frequency: 'never' });

    await send('POST', `/api/scheduled/${created.id}/skip`);

    expect(await listSchedules()).toEqual([]);
  });

  it('edits a schedule, starting it again from the new date', async () => {
    const created = await createSchedule({ date: '2026-07-01' });

    await send('PUT', `/api/scheduled/${created.id}`, {
      date: '2026-07-05',
      payee: 'New Landlord',
      amountCents: -1_900_00,
      categoryId: rentId,
      frequency: 'everyOtherMonth',
    });

    expect((await listSchedules())[0]).toMatchObject({
      nextDate: '2026-07-05',
      payee: 'New Landlord',
      amountCents: -1_900_00,
      frequency: 'everyOtherMonth',
    });
  });

  it('posts right away when edited to a date that has passed', async () => {
    const created = await createSchedule({ date: '2026-07-01' });

    const result = await send<{ posted: number }>('PUT', `/api/scheduled/${created.id}`, {
      date: '2026-06-10',
      payee: 'Landlord',
      amountCents: -1_800_00,
      categoryId: rentId,
      frequency: 'monthly',
    });

    expect(result.posted).toBe(1);
    expect((await listSchedules())[0]).toMatchObject({ nextDate: '2026-07-10' });
  });

  it('deletes a schedule but keeps what it already posted', async () => {
    const created = await createSchedule({ date: TODAY });

    await send('DELETE', `/api/scheduled/${created.id}`);

    expect(await listSchedules()).toEqual([]);
    expect(await register()).toHaveLength(1);
  });

  it('returns 404 for a schedule that doesn’t exist', async () => {
    for (const [method, url] of [
      ['DELETE', '/api/scheduled/999'],
      ['POST', '/api/scheduled/999/enter-now'],
      ['POST', '/api/scheduled/999/skip'],
    ] as const) {
      expect((await call(method, url)).statusCode).toBe(404);
    }
  });

  it('protects categories used by a schedule, including in split lines', async () => {
    await createSchedule({
      date: '2026-07-01',
      categoryId: undefined,
      lines: [
        { categoryId: groceriesId, amountCents: -1_000_00 },
        { categoryId: rentId, amountCents: -800_00 },
      ],
    });

    expect((await call('DELETE', `/api/categories/${groceriesId}`)).statusCode).toBe(409);
  });
});

describe('upcoming amounts for Underfunded', () => {
  it('counts occurrences still to come in the viewed month', async () => {
    await createSchedule({ date: '2026-06-20', amountCents: -100_00, frequency: 'weekly' });

    // June 20 and 27 are still to come in June; July has 4, 11, 18 and 25.
    expect(await budgetCategory(rentId, '2026-06')).toMatchObject({ upcomingCents: -200_00 });
    expect(await budgetCategory(rentId, '2026-07')).toMatchObject({ upcomingCents: -400_00 });
  });

  it('stops counting an occurrence once it posts', async () => {
    const created = await createSchedule({ date: '2026-06-20' });

    await send('POST', `/api/scheduled/${created.id}/enter-now`);

    expect(await budgetCategory(rentId)).toMatchObject({
      upcomingCents: 0,
      activityCents: -1_800_00,
    });
  });

  it('counts money leaving the budget through a transfer, from either side', async () => {
    const brokerage = await createAccount('Brokerage', 'asset');
    await createSchedule({
      date: '2026-06-20',
      payee: '',
      amountCents: -500_00,
      categoryId: groceriesId,
      transferAccountId: brokerage.id,
    });
    await createSchedule(
      {
        date: '2026-06-25',
        payee: '',
        amountCents: 100_00,
        categoryId: groceriesId,
        transferAccountId: checkingId,
      },
      brokerage.id,
    );

    expect(await budgetCategory(groceriesId)).toMatchObject({ upcomingCents: -600_00 });
  });

  it('ignores transfers between budget accounts', async () => {
    const savings = await createAccount('Savings', 'savings');
    await createSchedule({
      date: '2026-06-20',
      payee: '',
      categoryId: null,
      transferAccountId: savings.id,
    });

    expect(await budgetCategory(rentId)).toMatchObject({ upcomingCents: 0 });
  });
});

it('removes an account’s schedules when the account is deleted', async () => {
  const wallet = await createAccount('Wallet', 'cash');
  await createSchedule({ date: '2026-07-01', categoryId: null }, wallet.id);

  await send('DELETE', `/api/accounts/${wallet.id}`);

  const remaining = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.accountId, wallet.id));
  expect(remaining).toEqual([]);
  expect(await listSchedules(wallet.id)).toEqual([]);
});
