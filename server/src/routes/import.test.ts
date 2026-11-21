import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { accounts, payees, transactions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';
import { sampleYnabPlan } from '../test/ynab-plan.js';
import type { ImportReport } from '../ynab/compare.js';
import type { YnabPlan } from '../ynab/types.js';

const TOKEN = 'secret-token-123';
const { db, close } = createDb(getTestDatabaseUrl());

/** What the fake YNAB returns next: a plan, an HTTP status, or a network failure. */
let ynab: { plan: YnabPlan; status: number; fail: boolean; body?: unknown };
const requests: { url: string; authorization: string | null }[] = [];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  requests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
  if (ynab.fail) throw new TypeError('fetch failed');
  const body =
    ynab.body ??
    (url.endsWith('/plans')
      ? { data: { plans: [{ id: ynab.plan.id, name: ynab.plan.name, last_modified_on: null }] } }
      : url.endsWith(`/plans/${ynab.plan.id}`)
        ? { data: { plan: ynab.plan, server_knowledge: 1 } }
        : null);
  const status = body === null ? 404 : ynab.status;
  return new Response(JSON.stringify(body ?? { error: { id: '404' } }), { status });
};

const app = buildApp(db, {
  today: () => '2026-11-15',
  fetch: fakeFetch,
  ynabApiUrl: 'https://ynab.test/v1',
});

beforeEach(async () => {
  await resetDb(db);
  ynab = { plan: sampleYnabPlan(), status: 200, fail: false };
  requests.length = 0;
});

afterAll(async () => {
  await app.close();
  await close();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const runImport = () => post('/api/import/ynab', { token: TOKEN, planId: 'plan-sample' });

async function get<T>(url: string) {
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

describe('YNAB import', () => {
  it('reports whether the database is empty enough to import', async () => {
    expect(await get('/api/import/status')).toEqual({ canImport: true });
    await post('/api/category-groups', { name: 'Bills' });
    expect(await get('/api/import/status')).toEqual({ canImport: false });
  });

  it('lists plans using the token, without echoing it', async () => {
    const response = await post('/api/import/ynab/plans', { token: ` ${TOKEN} ` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      plans: [{ id: 'plan-sample', name: 'Sample Plan', lastModifiedOn: null }],
    });
    expect(requests).toEqual([
      { url: 'https://ynab.test/v1/plans', authorization: `Bearer ${TOKEN}` },
    ]);
    expect(response.body).not.toContain(TOKEN);
  });

  it('explains YNAB errors without including the token', async () => {
    ynab.status = 401;
    let response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'YNAB_TOKEN' });
    expect(response.body).not.toContain(TOKEN);

    ynab.status = 429;
    response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(429);
    expect(response.json().message).toContain('200 requests an hour');

    ynab.status = 500;
    response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(502);

    ynab = { ...ynab, status: 200, fail: true };
    response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain('Couldn’t reach YNAB');

    ynab = { ...ynab, fail: false, body: {} };
    response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(502);

    ynab = { ...ynab, body: { data: { something: 'else' } } };
    response = await post('/api/import/ynab/plans', { token: TOKEN });
    expect(response.statusCode).toBe(502);
    response = await post('/api/import/ynab/preview', { token: TOKEN, planId: 'plan-sample' });
    expect(response.statusCode).toBe(502);

    ynab = { ...ynab, body: undefined };
    response = await post('/api/import/ynab/preview', { token: TOKEN, planId: 'another' });
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('That plan wasn’t found in YNAB.');
  });

  it('rejects a blank token', async () => {
    const response = await post('/api/import/ynab/plans', { token: '   ' });
    expect(response.statusCode).toBe(400);
  });

  it('previews a plan', async () => {
    const response = await post('/api/import/ynab/preview', {
      token: TOKEN,
      planId: 'plan-sample',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      planName: 'Sample Plan',
      counts: { accounts: 6, transactions: 30 },
      problems: [],
    });
  });

  it('imports a plan and reports how it compares with YNAB', async () => {
    const response = await runImport();
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json<ImportReport>();

    expect(report.month).toBe('2026-11');
    expect(report.accounts.every((account) => account.matches)).toBe(true);
    expect(report.accounts.find((account) => account.name === 'Mortgage')).toEqual({
      name: 'Mortgage',
      ynabBalanceCents: -299_000_00,
      balanceCents: -299_000_00,
      ynabClearedCents: -299_500_00,
      clearedCents: -299_500_00,
      matches: true,
    });
    expect(report.categoriesCompared).toBe(5);
    expect(report.categoryDifferences).toEqual([]);
    expect(report.readyToAssign).toEqual({
      ynabCents: 3660_00,
      cents: 3650_00,
      parts: [
        { key: 'paymentCategories', cents: 300_00 },
        { key: 'startingDebt', cents: -300_00 },
        { key: 'uncategorized', cents: 40_00 },
        { key: 'creditOverspending', cents: -50_00 },
      ],
    });
    expect(report.notes.skippedSchedules).toHaveLength(1);
    expect(response.body).not.toContain(TOKEN);
  });

  it('creates accounts, categories, transactions and schedules as YNAB had them', async () => {
    expect((await runImport()).statusCode).toBe(200);

    const accountList = await get<
      {
        id: number;
        name: string;
        type: string;
        closed: boolean;
        lastReconciledAt: string | null;
      }[]
    >('/api/accounts');
    expect(accountList.map(({ name, type, closed }) => ({ name, type, closed }))).toEqual([
      { name: 'Checking', type: 'checking', closed: false },
      { name: 'Visa', type: 'credit_card', closed: false },
      { name: 'Old Savings', type: 'savings', closed: true },
      { name: 'House', type: 'asset', closed: false },
      { name: 'Mortgage', type: 'liability', closed: false },
      { name: 'Emergency Fund', type: 'asset', closed: false },
    ]);
    const [checking, visa, oldSavings, , mortgage, emergency] = accountList;
    expect(checking!.lastReconciledAt).toBe('2026-10-01T15:00:00.000Z');
    const [closedRow] = await db
      .select({ closedAt: accounts.closedAt })
      .from(accounts)
      .where(eq(accounts.id, oldSavings!.id));
    expect(closedRow!.closedAt!.getDate()).toBe(20);

    const budget = await get<{
      readyToAssignCents: number;
      groups: {
        name: string;
        hidden: boolean;
        categories: { name: string; hidden: boolean; availableCents: number }[];
      }[];
    }>('/api/budget?month=2026-11&currentMonth=2026-11');
    expect(budget.readyToAssignCents).toBe(3650_00);
    expect(
      budget.groups.map((group) => ({
        name: group.name,
        hidden: group.hidden,
        categories: group.categories.map(({ name, hidden, availableCents }) => [
          name,
          hidden,
          availableCents,
        ]),
      })),
    ).toEqual([
      {
        name: 'Bills',
        hidden: false,
        categories: [
          ['Rent', false, 1200_00],
          ['Mortgage', false, 1500_00],
        ],
      },
      {
        name: 'Everyday',
        hidden: false,
        categories: [
          ['Groceries', false, 300_00],
          ['Fun Money', true, 20_00],
        ],
      },
      { name: 'Old Stuff', hidden: true, categories: [['Old Category', false, 0]] },
    ]);

    type Row = {
      date: string;
      payee: string;
      memo: string;
      amountCents: number;
      cleared: string;
      categoryName: string | null;
      transferAccountName: string | null;
      lines: { categoryName: string | null; amountCents: number; memo: string }[];
    };
    const checkingRows = await get<Row[]>(`/api/accounts/${checking!.id}/transactions`);
    const bigBox = checkingRows.find((row) => row.payee === 'Big Box')!;
    expect(bigBox).toMatchObject({
      amountCents: -150_00,
      categoryName: 'Split',
      memo: 'Weekly run',
    });
    expect(
      bigBox.lines.map(({ categoryName, amountCents, memo }) => [categoryName, amountCents, memo]),
    ).toEqual([
      ['Groceries', -100_00, 'food'],
      ['Fun Money', -50_00, 'games'],
    ]);
    expect(checkingRows.find((row) => row.transferAccountName === 'Emergency Fund')).toMatchObject({
      amountCents: -30_00,
      categoryName: 'Fun Money',
    });
    expect(checkingRows.find((row) => row.payee === 'Starting Balance')).toMatchObject({
      cleared: 'reconciled',
      categoryName: 'Ready to Assign',
    });
    expect(checkingRows.find((row) => row.payee === 'Mystery Shop')!.categoryName).toBeNull();

    const visaRows = await get<Row[]>(`/api/accounts/${visa!.id}/transactions`);
    expect(visaRows.find((row) => row.memo === 'Thanks')).toMatchObject({
      amountCents: 300_00,
      cleared: 'cleared',
      transferAccountName: 'Checking',
    });
    expect(visaRows.find((row) => row.payee === 'Starting Balance')!.categoryName).toBe(
      'Ready to Assign',
    );

    const mortgageRows = await get<Row[]>(`/api/accounts/${mortgage!.id}/transactions`);
    expect(mortgageRows.filter((row) => row.transferAccountName === 'Checking')).toHaveLength(2);
    expect((await get<Row[]>(`/api/accounts/${emergency!.id}/transactions`))[0]).toMatchObject({
      amountCents: 30_00,
      memo: 'save',
      cleared: 'uncleared',
    });

    const starts = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.isStartingBalance, true));
    expect(starts).toHaveLength(6);
    expect((await db.select().from(payees)).map((payee) => payee.name).sort()).toEqual([
      'Acme Payroll',
      'Allowance',
      'Big Box',
      'Corner Market',
      'Interest Charge',
      'Landlord',
      'Mystery Shop',
      'Starting Balance',
    ]);

    type Schedule = {
      frequency: string;
      nextDate: string;
      payee: string;
      lines: unknown[] | null;
      transferAccountName: string | null;
      categoryName: string | null;
    };
    const checkingSchedules = await get<Schedule[]>(`/api/accounts/${checking!.id}/scheduled`);
    expect(
      checkingSchedules.map(
        ({ frequency, nextDate, payee, transferAccountName, categoryName }) => ({
          frequency,
          nextDate,
          payee,
          transferAccountName,
          categoryName,
        }),
      ),
    ).toEqual([
      {
        frequency: 'twiceAMonth',
        nextDate: '2026-11-20',
        payee: 'Allowance',
        transferAccountName: null,
        categoryName: 'Fun Money',
      },
      {
        frequency: 'monthly',
        nextDate: '2026-11-30',
        payee: 'Landlord',
        transferAccountName: null,
        categoryName: 'Rent',
      },
      {
        frequency: 'monthly',
        nextDate: '2026-12-05',
        payee: '',
        transferAccountName: 'Mortgage',
        categoryName: 'Mortgage',
      },
    ]);
    const visaSchedules = await get<Schedule[]>(`/api/accounts/${visa!.id}/scheduled`);
    expect(visaSchedules[0]!.lines).toHaveLength(2);
    expect(await get(`/api/accounts/${oldSavings!.id}/scheduled`)).toEqual([]);
  });

  it('imports flags and their names', async () => {
    const report = (await runImport()).json<ImportReport>();
    expect(report.notes.flagged).toBe(2);
    expect(report.notes.toFix).toMatchObject([{ reason: 'uncategorized', payee: 'Mystery Shop' }]);

    expect(await get<{ color: string; name: string | null }[]>('/api/flags')).toEqual([
      { color: 'red', name: 'Check this' },
      { color: 'orange', name: null },
      { color: 'yellow', name: null },
      { color: 'green', name: null },
      { color: 'blue', name: 'Reimbursable' },
      { color: 'purple', name: null },
    ]);
    const flagged = await get<{
      transactions: { accountName: string; payee: string; flag: string; date: string }[];
    }>('/api/transactions?flag=any');
    expect(
      flagged.transactions.map(({ accountName, payee, flag, date }) => [
        accountName,
        payee,
        flag,
        date,
      ]),
    ).toEqual([
      ['Visa', '', 'blue', '2026-10-15'],
      ['Visa', 'Corner Market', 'red', '2026-10-12'],
    ]);

    const accountList = await get<{ id: number; name: string }[]>('/api/accounts');
    const checkingId = accountList.find((account) => account.name === 'Checking')!.id;
    const schedules = await get<{ payee: string; flag: string | null }[]>(
      `/api/accounts/${checkingId}/scheduled`,
    );
    expect(schedules.find((schedule) => schedule.payee === 'Landlord')!.flag).toBe('green');
  });

  it('refuses to import into a database with data, leaving it unchanged', async () => {
    await post('/api/accounts', {
      name: 'Existing',
      startingBalanceCents: 100_00,
      date: '2026-11-01',
    });
    let response = await runImport();
    expect(response.statusCode).toBe(409);
    response = await post('/api/import/ynab/preview', { token: TOKEN, planId: 'plan-sample' });
    expect(response.statusCode).toBe(409);
    expect(await get<unknown[]>('/api/accounts')).toHaveLength(1);
  });

  it('refuses a second import', async () => {
    expect((await runImport()).statusCode).toBe(200);
    expect((await runImport()).statusCode).toBe(409);
    expect(await get<unknown[]>('/api/accounts')).toHaveLength(6);
  });

  it('refuses a plan with problems', async () => {
    ynab.plan.currency_format = { iso_code: 'JPY', decimal_digits: 0 };
    const response = await runImport();
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('2 decimal places');
    expect(await get('/api/import/status')).toEqual({ canImport: true });
  });

  it('leaves the database empty when the import fails part way', async () => {
    // A transfer from an account to itself, which Pretty Penny refuses.
    const pair = ynab.plan.transactions.filter((item) => item.id.startsWith('t-visa-pay-oct'));
    pair[1]!.account_id = 'acct-checking';
    pair[0]!.transfer_account_id = 'acct-checking';

    const response = await runImport();
    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe(
      'Couldn’t import the 2026-10-15 transaction in Checking: A transfer needs two different accounts.',
    );
    expect(await get('/api/import/status')).toEqual({ canImport: true });
  });

  it('explains a database failure with the database’s own reason', async () => {
    // A memo the database can't store (a null character), which only the database rejects.
    ynab.plan.transactions.find((item) => item.id === 't-start-checking')!.memo = 'bad\u0000memo';

    const response = await runImport();
    expect(response.statusCode).toBe(422);
    const { message } = response.json<{ message: string }>();
    expect(message).toBe(
      'Couldn’t import the 2026-09-01 transaction in Checking: invalid byte sequence for encoding "UTF8": 0x00',
    );
    expect(message).not.toContain('insert into');
    expect(await get('/api/import/status')).toEqual({ canImport: true });
  });

  it('flags differences it can’t explain', async () => {
    const november = ynab.plan.months.find((month) => month.month === '2026-11-01')!;
    november.categories.find((category) => category.id === 'cat-groceries')!.balance = 310_000;
    november.to_be_budgeted = 4800_000; // $3,600 after December’s $1,200
    ynab.plan.accounts.find((account) => account.id === 'acct-visa')!.balance = -60_000;
    // A closed account with no transactions is closed as of the import.
    ynab.plan.accounts.push({ ...ynab.plan.accounts[2]!, id: 'acct-empty', name: 'Never Used' });
    // A schedule our transfer rules refuse is skipped and reported rather than failing the import.
    ynab.plan.scheduled_transactions[0]!.transfer_account_id = 'acct-checking';

    const report = (await runImport()).json<ImportReport>();
    expect(report.accounts.find((account) => account.name === 'Visa')).toMatchObject({
      ynabBalanceCents: -60_00,
      balanceCents: -50_00,
      matches: false,
    });
    expect(report.categoryDifferences).toEqual([
      {
        groupName: 'Everyday',
        name: 'Groceries',
        ynabAvailableCents: 310_00,
        availableCents: 300_00,
        firstMonth: '2026-11',
      },
    ]);
    expect(report.readyToAssign.parts.at(-1)).toEqual({ key: 'unexplained', cents: 10_00 });
    expect(report.notes.skippedSchedules.map((item) => item.reason)).toContain(
      'A transfer needs two different accounts.',
    );
    expect(report.accounts.find((account) => account.name === 'Never Used')!.matches).toBe(true);
    const accountList = await get<{ name: string; closed: boolean }[]>('/api/accounts');
    expect(accountList.find((account) => account.name === 'Never Used')!.closed).toBe(true);
  });

  it('only blames credit overspending when YNAB had credit accounts', async () => {
    // With the card set up as a checking account, YNAB treats its overspending as cash, so a
    // leftover that lowers ours is unexplained.
    ynab.plan.accounts.find((account) => account.id === 'acct-visa')!.type = 'checking';
    const report = (await runImport()).json<ImportReport>();
    expect(report.readyToAssign.parts.at(-1)).toEqual({ key: 'unexplained', cents: -50_00 });
  });

  it('finds the first month a category differed', async () => {
    const october = ynab.plan.months.find((month) => month.month === '2026-10-01')!;
    october.categories.find((category) => category.id === 'cat-fun')!.balance = 25_000;
    const november = ynab.plan.months.find((month) => month.month === '2026-11-01')!;
    november.categories.find((category) => category.id === 'cat-fun')!.balance = 25_000;

    const report = (await runImport()).json<ImportReport>();
    expect(report.categoryDifferences).toMatchObject([
      { name: 'Fun Money', firstMonth: '2026-10' },
    ]);
  });

  it('compares against YNAB’s latest month when the current month is missing', async () => {
    ynab.plan.months = ynab.plan.months.filter((month) => month.month < '2026-11');
    ynab.plan.months.find((month) => month.month === '2026-10-01')!.to_be_budgeted = 3700_000;
    const report = (await runImport()).json<ImportReport>();
    expect(report.month).toBe('2026-10');
  });
});
