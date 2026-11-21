import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { addDemoData, demoPlan, monthsBetween, shiftDate } from './demo.js';
import { getTestDatabaseUrl } from './env.js';
import { resetDb } from './test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db, { requireLogin: false });

beforeEach(() => resetDb(db));

afterAll(async () => {
  await app.close();
  await close();
});

describe('moving dates', () => {
  it('moves by whole months, keeping the day where the month has it', () => {
    expect(shiftDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(shiftDate('2026-11-30', 4)).toBe('2027-03-31');
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-31');
    expect(shiftDate('2026-03-10', -3)).toBe('2025-12-10');
    expect(shiftDate('2026-11-01', 0)).toBe('2026-11-01');
    expect(shiftDate('2026-10-01T15:00:00.000Z', 2)).toBe('2026-12-01T15:00:00.000Z');
  });

  it('counts months between two months', () => {
    expect(monthsBetween('2026-11', '2027-03')).toBe(4);
    expect(monthsBetween('2026-11', '2026-02')).toBe(-9);
  });

  it('moves the whole sample plan to the current month', () => {
    const plan = demoPlan('2027-03');
    expect(plan.name).toBe('Demo budget');
    expect(plan.months.map((month) => month.month)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      // The sample's month after its "current" one holds money assigned ahead.
      '2027-04-01',
    ]);
    expect(plan.transactions.find((item) => item.id === 't-pay-nov')!.date).toBe('2027-03-02');
    const rent = plan.scheduled_transactions.find((item) => item.id === 'st-rent')!;
    expect([rent.date_first, rent.date_next]).toEqual(['2026-05-31', '2027-03-31']);
    expect(plan.accounts.find((item) => item.id === 'acct-checking')!.last_reconciled_at).toBe(
      '2027-02-01T15:00:00.000Z',
    );
  });
});

describe('demo data', () => {
  it('fills an empty database with the sample budget, with today’s figures', async () => {
    const counts = await addDemoData(db, '2027-03');
    expect(counts).toMatchObject({ accounts: 6, transactions: 30 });

    // The same figures the sample plan has in its own month, now in March 2027.
    const budget = await app.inject({
      method: 'GET',
      url: '/api/budget?month=2027-03&currentMonth=2027-03',
    });
    expect(budget.json().readyToAssignCents).toBe(3650_00);
  });

  it('leaves a database with data alone', async () => {
    await addDemoData(db, '2027-03');
    expect(await addDemoData(db, '2027-03')).toBeNull();
    const accounts = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(accounts.json()).toHaveLength(6);
  });
});
