import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  createFakePlaid,
  FAKE_PUBLIC_TOKEN,
  type FakeTransactionInput,
} from '../bank/fake-plaid.js';
import { createDb } from '../db/client.js';
import { bankTransactions, scheduledTransactions, transactions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

// Made-up data throughout: Northwind Bank, with Everyday Checking and a rewards card.
const { db, close } = createDb(getTestDatabaseUrl());
const plaid = createFakePlaid();

const fakeFetch: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const { status, body } = plaid.handle(path, JSON.parse(String(init?.body ?? '{}')));
  return new Response(JSON.stringify(body), { status });
};

const TODAY = '2026-11-15';
const app = buildApp(db, {
  requireLogin: false,
  today: () => TODAY,
  plaid: {
    clientId: 'client-test',
    secret: 'secret-test',
    environment: 'sandbox',
    baseUrl: 'https://plaid.test',
  },
  bankTokenKey: randomBytes(32).toString('base64'),
  fetch: fakeFetch,
});

interface Row {
  id: number;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: string;
  approved: boolean;
  categoryId: number | null;
  transferAccountId: number | null;
  bank: { name: string; matched: boolean; institutionName: string } | null;
}
interface Connection {
  id: number;
  gettingTransactions: boolean;
  accounts: { id: number; accountId: number | null; importFrom: string | null }[];
}
interface AccountRow {
  id: number;
  name: string;
  balanceCents: number;
  onBudget: boolean;
  unapprovedCount: number;
  bank: { importFrom: string | null } | null;
}

beforeEach(async () => {
  await resetDb(db);
  plaid.reset();
});

afterAll(async () => {
  await app.close();
  await close();
});

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  const response = await app.inject({ method, url, ...(payload && { payload }) });
  expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
  return (response.statusCode === 204 ? undefined : response.json()) as T;
}

async function createAccount(name: string, type = 'checking', startingBalanceCents = 100000) {
  return (
    await call<{ id: number }>('POST', '/api/accounts', {
      name,
      type,
      startingBalanceCents,
      date: '2026-10-01',
    })
  ).id;
}

const enter = (accountId: number, body: object) =>
  call('POST', `/api/accounts/${accountId}/transactions`, body);

async function categoryId(name: string) {
  const group = await call<{ id: number }>('POST', '/api/category-groups', { name: 'Everyday' });
  return (await call<{ id: number }>('POST', '/api/categories', { groupId: group.id, name })).id;
}

const register = (accountId: number) =>
  call<Row[]>('GET', `/api/accounts/${accountId}/transactions`);
const accounts = () => call<AccountRow[]>('GET', '/api/accounts');
const connect = () =>
  call<Connection>('POST', '/api/bank/connections', {
    publicToken: FAKE_PUBLIC_TOKEN,
    institutionName: 'Northwind Bank',
  });
const link = (bankAccountId: number, accountId: number | null) =>
  call<Connection>('PUT', `/api/bank/accounts/${bankAccountId}/link`, { accountId });
const update = (connectionId: number) =>
  call<Connection>('POST', `/api/bank/connections/${connectionId}/refresh`);

const bank = (
  input: Partial<FakeTransactionInput> &
    Pick<FakeTransactionInput, 'id' | 'amount' | 'date' | 'name'>,
) => plaid.addTransaction({ account: 'acc-northwind-checking', ...input });

/**
 * Household Checking, with a transaction entered on Nov 8, linked to Everyday Checking. Importing
 * starts 3 days before that: Nov 5.
 */
async function setUp() {
  const checking = await createAccount('Household Checking');
  await enter(checking, { date: '2026-11-08', payee: 'Corner Market', amountCents: -4250 });
  const connection = await connect();
  return { checking, connection, checkingBank: connection.accounts[0]!.id };
}

describe('importing', () => {
  it('imports from the start date as cleared transactions needing review', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'coffee', amount: 4.5, date: '2026-11-04', name: 'BEAN THERE' });
    bank({
      id: 'grocer',
      amount: 61.2,
      date: '2026-11-12',
      authorized_date: '2026-11-11',
      name: 'GREENLEAF GROCERY #22',
      merchant_name: 'Greenleaf Grocery',
    });
    bank({ id: 'check', amount: 0, date: '2026-11-12', name: 'CARD VERIFICATION' });
    bank({ id: 'pay', amount: -2500, date: '2026-11-14', name: 'PAYROLL DEPOSIT' });

    const linked = await link(checkingBank, checking);
    expect(linked.accounts[0]).toMatchObject({ accountId: checking, importFrom: '2026-11-05' });

    const rows = await register(checking);
    expect(
      rows.map((row) => [row.date, row.payee, row.amountCents, row.cleared, row.approved]),
    ).toEqual([
      ['2026-11-14', 'PAYROLL DEPOSIT', 250000, 'cleared', false],
      // The purchase date, and Plaid's merchant name.
      ['2026-11-11', 'Greenleaf Grocery', -6120, 'cleared', false],
      ['2026-11-08', 'Corner Market', -4250, 'uncleared', true],
      ['2026-10-01', 'Starting Balance', 100000, 'cleared', true],
    ]);
    expect(rows[1]!.bank).toEqual({
      name: 'GREENLEAF GROCERY #22',
      matched: false,
      institutionName: 'Northwind Bank',
    });
    const [account] = await accounts();
    expect(account).toMatchObject({
      unapprovedCount: 2,
      balanceCents: 100000 + 250000 - 6120 - 4250,
    });

    // Before the start date and zero amounts wait or are skipped.
    const states = await db
      .select({ plaid: bankTransactions.plaidTransactionId, state: bankTransactions.state })
      .from(bankTransactions)
      .orderBy(bankTransactions.plaidTransactionId);
    expect(states).toEqual([
      { plaid: 'check-1', state: 'skipped' },
      { plaid: 'coffee-1', state: 'waiting' },
      { plaid: 'grocer-1', state: 'imported' },
      { plaid: 'pay-1', state: 'imported' },
    ]);

    // Syncing again brings nothing twice.
    await update(connection.id);
    expect(await register(checking)).toHaveLength(4);
  });

  it('gives a payee you’ve used before its usual category', async () => {
    const { checking, checkingBank } = await setUp();
    const groceries = await categoryId('Groceries');
    await enter(checking, {
      date: '2026-10-15',
      payee: 'Greenleaf Grocery',
      amountCents: -3000,
      categoryId: groceries,
    });
    bank({
      id: 'grocer',
      amount: 61.2,
      date: '2026-11-12',
      name: 'GREENLEAF',
      merchant_name: 'greenleaf grocery',
    });
    bank({ id: 'new', amount: 9, date: '2026-11-12', name: 'NEW PLACE' });
    await link(checkingBank, checking);

    const rows = await register(checking);
    expect(rows.find((row) => row.amountCents === -6120)).toMatchObject({
      payee: 'Greenleaf Grocery',
      categoryId: groceries,
    });
    expect(rows.find((row) => row.payee === 'NEW PLACE')!.categoryId).toBeNull();
  });

  it('imports into a tracking account without categories', async () => {
    const investments = await createAccount('Brokerage', 'asset');
    const connection = await connect();
    plaid.addTransaction({
      account: 'acc-northwind-checking',
      id: 'div',
      amount: -12,
      date: TODAY,
      name: 'DIVIDEND',
    });
    await link(connection.accounts[0]!.id, investments);
    const [dividend] = await register(investments);
    expect(dividend).toMatchObject({ amountCents: 1200, approved: false, categoryId: null });
  });

  it('starts at the newest reconciled transaction less 3 days, and can start earlier', async () => {
    const checking = await createAccount('Household Checking');
    await enter(checking, {
      date: '2026-11-02',
      payee: 'Old',
      amountCents: -100,
      cleared: 'cleared',
    });
    await call('POST', `/api/accounts/${checking}/reconcile`, {
      bankBalanceCents: 99900,
      date: '2026-11-03',
    });
    await enter(checking, { date: '2026-11-12', payee: 'Newer', amountCents: -200 });
    const connection = await connect();
    bank({ id: 'early', amount: 7, date: '2026-10-25', name: 'EARLY' });

    const linked = await link(connection.accounts[0]!.id, checking);
    expect(linked.accounts[0]!.importFrom).toBe('2026-10-30');
    expect((await register(checking)).some((row) => row.payee === 'EARLY')).toBe(false);

    const moved = await call<Connection>(
      'PUT',
      `/api/bank/accounts/${connection.accounts[0]!.id}/import-from`,
      {
        importFrom: '2026-10-20',
      },
    );
    expect(moved.accounts[0]!.importFrom).toBe('2026-10-20');
    expect((await register(checking)).some((row) => row.payee === 'EARLY')).toBe(true);
  });

  it('refuses a start date for an unlinked bank account', async () => {
    const connection = await connect();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/bank/accounts/${connection.accounts[0]!.id}/import-from`,
      payload: { importFrom: TODAY },
    });
    expect(response.statusCode).toBe(409);
  });

  it('keeps only linked accounts’ transactions, and reads the history again when linking', async () => {
    const { checking, connection, checkingBank } = await setUp();
    plaid.addTransaction({
      account: 'acc-northwind-card',
      id: 'card-buy',
      amount: 20,
      date: TODAY,
      name: 'BOOKSHOP',
    });
    await link(checkingBank, checking);
    expect(await db.select().from(bankTransactions)).toEqual([]);

    // Linking the card later finds its earlier transaction.
    const card = await createAccount('Rewards Card', 'credit_card', -5000);
    await link(connection.accounts[1]!.id, card);
    const rows = await register(card);
    expect(rows.find((row) => row.payee === 'BOOKSHOP')).toMatchObject({ amountCents: -2000 });
  });

  it('waits while Plaid gathers history, and waits to import into a closed account', async () => {
    const { checking, connection, checkingBank } = await setUp();
    plaid.setSyncStatus('NOT_READY');
    expect((await link(checkingBank, checking)).gettingTransactions).toBe(true);
    plaid.setSyncStatus('HISTORICAL_UPDATE_COMPLETE');
    expect((await update(connection.id)).gettingTransactions).toBe(false);

    await call('POST', `/api/accounts/${checking}/close`, { date: TODAY });
    bank({ id: 'late', amount: 5, date: TODAY, name: 'LATE' });
    await update(connection.id);
    const [stored] = await db.select().from(bankTransactions);
    expect(stored!.state).toBe('waiting');
  });

  it('reads every page, starting over when Plaid reports changes while paging', async () => {
    const { checking, checkingBank } = await setUp();
    for (let day = 10; day <= 14; day += 1) {
      bank({ id: `t${day}`, amount: day, date: `2026-11-${day}`, name: `SHOP ${day}` });
    }
    plaid.setPageSize(2);
    plaid.failNextSyncPage();
    await link(checkingBank, checking);
    expect((await register(checking)).filter((row) => !row.approved)).toHaveLength(5);
  });
});

describe('matching', () => {
  it('matches what you entered, keeping your details', async () => {
    const { checking, checkingBank } = await setUp();
    const groceries = await categoryId('Groceries');
    const [entered] = await register(checking);
    await call('PATCH', `/api/transactions/${entered!.id}`, {
      categoryId: groceries,
      memo: 'milk',
    });
    bank({
      id: 'market',
      amount: 42.5,
      date: '2026-11-10',
      authorized_date: '2026-11-09',
      name: 'CORNER MKT 0042',
    });

    await link(checkingBank, checking);
    const rows = await register(checking);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: entered!.id,
      date: '2026-11-08',
      payee: 'Corner Market',
      memo: 'milk',
      categoryId: groceries,
      cleared: 'cleared',
      approved: true,
      bank: { name: 'CORNER MKT 0042', matched: true },
    });
  });

  it('unmatches: yours goes back as it was, and the import needs review', async () => {
    const { checking, checkingBank } = await setUp();
    bank({ id: 'market', amount: 42.5, date: '2026-11-09', name: 'CORNER MKT 0042' });
    await link(checkingBank, checking);
    const [matched] = await register(checking);

    await call('POST', `/api/transactions/${matched!.id}/unmatch`);
    const rows = await register(checking);
    expect(
      rows.map((row) => [row.payee, row.cleared, row.approved, row.bank?.matched ?? null]),
    ).toEqual([
      ['CORNER MKT 0042', 'cleared', false, false],
      ['Corner Market', 'uncleared', true, null],
      ['Starting Balance', 'cleared', true, null],
    ]);

    const again = await app.inject({
      method: 'POST',
      url: `/api/transactions/${matched!.id}/unmatch`,
    });
    expect(again.statusCode).toBe(404);
  });

  it('refuses to unmatch a reconciled transaction', async () => {
    const { checking, checkingBank } = await setUp();
    bank({ id: 'market', amount: 42.5, date: '2026-11-09', name: 'CORNER MKT 0042' });
    await link(checkingBank, checking);
    await call('POST', `/api/accounts/${checking}/reconcile`, {
      bankBalanceCents: 95750,
      date: TODAY,
    });
    const [matched] = await register(checking);
    const response = await app.inject({
      method: 'POST',
      url: `/api/transactions/${matched!.id}/unmatch`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('enters a scheduled transaction the bank has already taken, and moves the schedule on', async () => {
    const { checking, checkingBank } = await setUp();
    await call('POST', `/api/accounts/${checking}/scheduled`, {
      date: '2026-11-20',
      payee: 'Streamly',
      amountCents: -1599,
      memo: 'plan',
      frequency: 'monthly',
    });
    bank({ id: 'stream', amount: 15.99, date: '2026-11-18', name: 'STREAMLY.COM' });
    await link(checkingBank, checking);

    const [posted] = await register(checking);
    expect(posted).toMatchObject({
      date: '2026-11-18',
      payee: 'Streamly',
      memo: 'plan',
      cleared: 'cleared',
      approved: true,
      bank: { matched: true },
    });
    const [schedule] = await db.select().from(scheduledTransactions);
    expect(schedule!.nextDate).toBe('2026-12-20');
  });

  it('matches after reconnecting a bank instead of duplicating', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'pay', amount: -2500, date: '2026-11-14', name: 'PAYROLL DEPOSIT' });
    await link(checkingBank, checking);
    await call('DELETE', `/api/bank/connections/${connection.id}`);

    const again = await connect();
    bank({ id: 'pay', amount: -2500, date: '2026-11-14', name: 'PAYROLL DEPOSIT' });
    await link(again.accounts[0]!.id, checking);
    const rows = await register(checking);
    expect(rows.filter((row) => row.amountCents === 250000)).toHaveLength(1);
  });
});

describe('reviewing', () => {
  async function withImports() {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'grocer', amount: 61.2, date: '2026-11-12', name: 'GREENLEAF' });
    bank({ id: 'pay', amount: -2500, date: '2026-11-14', name: 'PAYROLL DEPOSIT' });
    await link(checkingBank, checking);
    const rows = await register(checking);
    return {
      checking,
      connection,
      grocer: rows.find((row) => row.payee === 'GREENLEAF')!,
      pay: rows.find((row) => row.payee === 'PAYROLL DEPOSIT')!,
    };
  }

  it('finds transactions needing review, and approves one or all', async () => {
    const { checking, grocer } = await withImports();
    const review = await call<{ transactions: Row[] }>('GET', '/api/transactions?needsReview=true');
    expect(review.transactions.map((row) => row.payee)).toEqual(['PAYROLL DEPOSIT', 'GREENLEAF']);

    await call('POST', '/api/transactions/approve', { ids: [grocer.id] });
    expect((await accounts())[0]!.unapprovedCount).toBe(1);
    expect(await call('POST', `/api/accounts/${checking}/approve-all`)).toEqual({ approved: 1 });
    expect((await accounts())[0]!.unapprovedCount).toBe(0);
  });

  it('approves on saving an edit, but not on clearing or flagging', async () => {
    const { grocer, pay } = await withImports();
    await call('PATCH', `/api/transactions/${grocer.id}`, { flag: 'red' });
    await call('PATCH', `/api/transactions/${grocer.id}`, { cleared: 'uncleared' });
    await call('PATCH', `/api/transactions/${pay.id}`, { memo: 'November' });
    const review = await call<{ transactions: Row[] }>('GET', '/api/transactions?needsReview=true');
    expect(review.transactions.map((row) => row.payee)).toEqual(['GREENLEAF']);
  });

  it('never brings back a rejected import, and undo links it again', async () => {
    const { checking, connection, grocer } = await withImports();
    const { undo } = await call<{ undo: object }>('DELETE', `/api/transactions/${grocer.id}`);
    plaid.changeTransaction('grocer', { amount: 62 });
    await update(connection.id);
    expect((await register(checking)).some((row) => row.payee === 'GREENLEAF')).toBe(false);

    await call('POST', '/api/transactions/restore', undo);
    const [restored] = await db
      .select({ state: bankTransactions.state, transactionId: bankTransactions.transactionId })
      .from(bankTransactions)
      .where(eq(bankTransactions.plaidTransactionId, 'grocer-1'));
    expect(restored).toEqual({ state: 'imported', transactionId: grocer.id });
    expect((await register(checking)).find((row) => row.id === grocer.id)!.approved).toBe(false);
  });

  it('keeps Ready to Assign and Available adding up to the balances', async () => {
    const { checking } = await withImports();
    const budget = await call<{
      readyToAssignCents: number;
      groups: { categories: { availableCents: number }[] }[];
    }>('GET', '/api/budget?month=2026-11&currentMonth=2026-11');
    const available = budget.groups
      .flatMap((group) => group.categories)
      .reduce((sum, category) => sum + category.availableCents, 0);
    const balances = (await accounts())
      .filter((account) => account.onBudget)
      .reduce((sum, account) => sum + account.balanceCents, 0);
    // Uncategorized imports count in balances but not yet in the budget, as in YNAB.
    const uncategorized = (await register(checking))
      .filter((row) => row.categoryId === null && row.payee !== 'Starting Balance')
      .reduce((sum, row) => sum + row.amountCents, 0);
    expect(budget.readyToAssignCents + available + uncategorized).toBe(balances);
  });
});

describe('changes from the bank', () => {
  it('follows changes and removals while a transaction needs review, then stops', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'grocer', amount: 61.2, date: '2026-11-12', name: 'GREENLEAF' });
    bank({ id: 'gone', amount: 8, date: '2026-11-12', name: 'DROPPED' });
    bank({ id: 'kept', amount: 9, date: '2026-11-12', name: 'KEPT' });
    await link(checkingBank, checking);

    plaid.changeTransaction('grocer', {
      amount: 63.4,
      date: '2026-11-13',
      merchant_name: 'Greenleaf Grocery',
    });
    plaid.removeTransaction('gone');
    let rows = await register(checking);
    const kept = rows.find((row) => row.payee === 'KEPT')!;
    await call('POST', '/api/transactions/approve', { ids: [kept.id] });
    plaid.removeTransaction('kept');
    await update(connection.id);

    rows = await register(checking);
    expect(rows.find((row) => row.bank?.name === 'GREENLEAF')).toMatchObject({
      date: '2026-11-13',
      amountCents: -6340,
      payee: 'Greenleaf Grocery',
    });
    expect(rows.some((row) => row.payee === 'DROPPED')).toBe(false);
    // Approved, so it stays even though the bank dropped it.
    expect(rows.some((row) => row.payee === 'KEPT')).toBe(true);

    // Once approved, the bank's changes are ignored.
    const grocer = rows.find((row) => row.payee === 'Greenleaf Grocery')!;
    await call('POST', '/api/transactions/approve', { ids: [grocer.id] });
    plaid.changeTransaction('grocer', { amount: 70 });
    await update(connection.id);
    expect((await register(checking)).find((row) => row.id === grocer.id)!.amountCents).toBe(-6340);
  });

  it('drops an import needing review that the bank changes to nothing', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'hold', amount: 1, date: '2026-11-12', name: 'HOLD' });
    await link(checkingBank, checking);
    plaid.changeTransaction('hold', { amount: 0 });
    await update(connection.id);
    expect((await register(checking)).some((row) => row.payee === 'HOLD')).toBe(false);
  });

  it('shows pending transactions apart, replacing them once posted', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({
      id: 'cafe-pending',
      amount: 15,
      date: TODAY,
      name: 'PENDING CAFE',
      merchant_name: 'Cafe Lumen',
      pending: true,
    });
    bank({ id: 'other-pending', amount: 3, date: TODAY, name: 'DROPS', pending: true });
    await link(checkingBank, checking);

    expect(await call('GET', `/api/accounts/${checking}/pending`)).toEqual([
      { id: expect.any(Number), date: TODAY, amountCents: -300, payee: 'DROPS' },
      { id: expect.any(Number), date: TODAY, amountCents: -1500, payee: 'Cafe Lumen' },
    ]);
    expect((await accounts())[0]!.balanceCents).toBe(95750);
    expect((await register(checking)).some((row) => row.payee === 'Cafe Lumen')).toBe(false);

    plaid.removeTransaction('cafe-pending');
    plaid.removeTransaction('other-pending');
    bank({
      id: 'cafe',
      amount: 15.75,
      date: TODAY,
      name: 'CAFE LUMEN',
      merchant_name: 'Cafe Lumen',
    });
    await update(connection.id);
    expect(await call('GET', `/api/accounts/${checking}/pending`)).toEqual([]);
    expect((await register(checking))[0]).toMatchObject({
      payee: 'Cafe Lumen',
      amountCents: -1575,
      approved: false,
    });
  });

  it('turns a pending transaction into a waiting one when the bank posts it under the same ID', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'cafe', amount: 15, date: TODAY, name: 'CAFE', pending: true });
    await link(checkingBank, checking);
    plaid.changeTransaction('cafe', { pending: false });
    await update(connection.id);
    expect((await register(checking))[0]).toMatchObject({ payee: 'CAFE', approved: false });
  });

  it('removes stale pending transactions when reading the history again', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'cafe', amount: 15, date: TODAY, name: 'CAFE', pending: true });
    await link(checkingBank, checking);
    // Unlinking forgets what hadn't imported; the bank drops the pending meanwhile.
    plaid.removeTransaction('cafe');
    await link(checkingBank, null);
    await link(checkingBank, checking);
    expect(await call('GET', `/api/accounts/${checking}/pending`)).toEqual([]);
    expect(connection.id).toBeGreaterThan(0);
  });
});

describe('transfers between linked accounts', () => {
  async function withCard() {
    const { checking, connection, checkingBank } = await setUp();
    const card = await createAccount('Rewards Card', 'credit_card', -50000);
    bank({ id: 'paid', amount: 300, date: '2026-11-14', name: 'NORTHWIND CARD PAYMENT' });
    plaid.addTransaction({
      account: 'acc-northwind-card',
      id: 'thanks',
      amount: -300,
      date: '2026-11-15',
      name: 'PAYMENT THANK YOU',
    });
    await link(checkingBank, checking);
    await link(connection.accounts[1]!.id, card);
    const payment = (await register(checking)).find(
      (row) => row.payee === 'NORTHWIND CARD PAYMENT',
    )!;
    return { checking, card, connection, payment };
  }

  it('uses the other account’s import as the transfer’s other side', async () => {
    const { card, payment } = await withCard();
    expect((await register(card)).map((row) => row.payee)).toEqual([
      'PAYMENT THANK YOU',
      'Starting Balance',
    ]);

    await call('PATCH', `/api/transactions/${payment.id}`, { transferAccountId: card });
    const rows = await register(card);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      amountCents: 30000,
      transferAccountId: expect.any(Number),
      cleared: 'cleared',
      approved: true,
      bank: { name: 'PAYMENT THANK YOU', matched: true },
    });
    expect((await accounts()).find((account) => account.id === card)!.unapprovedCount).toBe(0);
  });

  it('lets the old side’s import arrive again when the transfer moves to another account', async () => {
    const { card, payment } = await withCard();
    await call('PATCH', `/api/transactions/${payment.id}`, { transferAccountId: card });
    const savings = await createAccount('Savings', 'savings');
    await call('PATCH', `/api/transactions/${payment.id}`, { transferAccountId: savings });

    const rows = await register(card);
    expect(rows[0]).toMatchObject({
      payee: 'PAYMENT THANK YOU',
      approved: false,
      transferAccountId: null,
    });
  });
});

describe('the transaction the bank sent', () => {
  it('stays with a transaction when it’s deleted with its account, and imports again on linking', async () => {
    const { checking, connection, checkingBank } = await setUp();
    bank({ id: 'pay', amount: -2500, date: TODAY, name: 'PAYROLL DEPOSIT' });
    await link(checkingBank, checking);
    const [stored] = await db.select().from(bankTransactions);
    await db.delete(transactions).where(eq(transactions.id, stored!.transactionId!));

    const other = await createAccount('Other Checking');
    await link(checkingBank, other);
    expect((await register(other)).map((row) => row.payee)).toContain('PAYROLL DEPOSIT');
    expect(connection.id).toBeGreaterThan(0);
  });
});
