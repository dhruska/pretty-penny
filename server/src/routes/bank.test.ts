import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createFakePlaid, FAKE_PUBLIC_TOKEN, LOGIN_REQUIRED } from '../bank/fake-plaid.js';
import { bankConfig, refreshAllConnections } from '../bank/service.js';
import { createDb } from '../db/client.js';
import { bankAccounts, bankConnections, transactions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';

const { db, close } = createDb(getTestDatabaseUrl());
const plaid = createFakePlaid();
let networkDown = false;

const fakeFetch: typeof fetch = async (input, init) => {
  if (networkDown) throw new TypeError('fetch failed');
  const path = new URL(String(input)).pathname;
  const { status, body } = plaid.handle(path, JSON.parse(String(init?.body ?? '{}')));
  return new Response(JSON.stringify(body), { status });
};

const KEY = randomBytes(32).toString('base64');
const settings = {
  plaid: {
    clientId: 'client-test',
    secret: 'secret-test',
    environment: 'sandbox',
    baseUrl: 'https://plaid.test',
  },
  bankTokenKey: KEY,
  fetch: fakeFetch,
};
const TODAY = '2026-11-15';

const app = buildApp(db, { requireLogin: false, today: () => TODAY, ...settings });
const notSetUp = buildApp(db, { requireLogin: false });

interface BankAccountView {
  id: number;
  name: string;
  mask: string | null;
  balanceCents: number | null;
  accountId: number | null;
  accountName: string | null;
  suggestedType: string;
}
interface ConnectionView {
  id: number;
  institutionName: string;
  status: string;
  problem: string | null;
  accounts: BankAccountView[];
}

beforeEach(async () => {
  await resetDb(db);
  plaid.reset();
  networkDown = false;
});

afterAll(async () => {
  await app.close();
  await notSetUp.close();
  await close();
});

const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, on = app) =>
  on.inject({ method, url, ...(payload && { payload }) });

async function get<T>(url: string, on = app) {
  const response = await on.inject({ method: 'GET', url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function connect() {
  const response = await send('POST', '/api/bank/connections', {
    publicToken: FAKE_PUBLIC_TOKEN,
    institutionName: 'Northwind Bank',
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ConnectionView>();
}

async function createAccount(name = 'Household Checking', type = 'checking') {
  const response = await send('POST', '/api/accounts', {
    name,
    type,
    startingBalanceCents: 10000,
    date: '2026-11-01',
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: number }>().id;
}

const link = (bankAccountId: number, accountId: number | null) =>
  send('PUT', `/api/bank/accounts/${bankAccountId}/link`, { accountId });

const lastRequest = (path: string) => plaid.requests.filter((r) => r.path === path).at(-1)!;

describe('setting up bank sync', () => {
  it('lists what is missing from .env and refuses to connect until it is set', async () => {
    expect(await get('/api/bank/status', notSetUp)).toEqual({
      configured: false,
      environment: null,
      problems: [
        'PLAID_CLIENT_ID isn’t set.',
        'PLAID_SECRET isn’t set.',
        'PLAID_ENV must be sandbox or production.',
        'BANK_TOKEN_KEY isn’t set.',
      ],
    });
    const refused = await send('POST', '/api/bank/link-token', {}, notSetUp);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'BANK_NOT_SET_UP',
      message: expect.stringContaining('PLAID_CLIENT_ID isn’t set.'),
    });
    expect(await get('/api/bank/connections', notSetUp)).toEqual([]);
  });

  it('is ready once every setting is there', async () => {
    expect(await get('/api/bank/status')).toEqual({
      configured: true,
      environment: 'sandbox',
      problems: [],
    });
  });

  it('sends banks back to the tailnet address only when it uses HTTPS', () => {
    expect(bankConfig({ ...settings, publicUrl: 'https://mini.example.ts.net/' }).redirectUri).toBe(
      'https://mini.example.ts.net/bank/oauth',
    );
    expect(
      bankConfig({ ...settings, publicUrl: 'http://localhost:5173' }).redirectUri,
    ).toBeUndefined();
    expect(bankConfig(settings).redirectUri).toBeUndefined();
  });
});

describe('connecting a bank', () => {
  it('asks Plaid for Transactions only, with two years of history', async () => {
    const response = await send('POST', '/api/bank/link-token', {});
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ linkToken: expect.stringMatching(/^link-sandbox-/) });
    expect(lastRequest('/link/token/create').body).toEqual({
      client_id: 'client-test',
      secret: 'secret-test',
      client_name: 'Pretty Penny',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: 'pretty-penny-owner' },
      products: ['transactions'],
      transactions: { days_requested: 730 },
    });
  });

  it('includes the redirect address when there is one', async () => {
    const withRedirect = buildApp(db, {
      requireLogin: false,
      ...settings,
      publicUrl: 'https://mini.example.ts.net',
    });
    await send('POST', '/api/bank/link-token', {}, withRedirect);
    expect(lastRequest('/link/token/create').body.redirect_uri).toBe(
      'https://mini.example.ts.net/bank/oauth',
    );
    await withRedirect.close();
  });

  it('saves the connection with its accounts, keeping the access token encrypted', async () => {
    const connection = await connect();
    expect(connection).toMatchObject({
      institutionName: 'Northwind Bank',
      status: 'ok',
      problem: null,
      accounts: [
        {
          name: 'Everyday Checking',
          mask: '1234',
          balanceCents: 245000,
          accountId: null,
          suggestedType: 'checking',
        },
        {
          name: 'Northwind Rewards Card',
          mask: '9876',
          balanceCents: -31245,
          suggestedType: 'credit_card',
        },
      ],
    });

    const [saved] = await db.select().from(bankConnections);
    expect(saved!.plaidItemId).toBe('item-1');
    expect(saved!.accessTokenEncrypted).not.toContain('access-sandbox');

    // Neither the token nor its encrypted form ever reaches the browser.
    const listed = JSON.stringify(await get('/api/bank/connections'));
    expect(listed).not.toContain('access-sandbox');
    expect(listed).not.toContain(saved!.accessTokenEncrypted);
  });

  it('names a connection "Bank" when Plaid gives no name', async () => {
    const response = await send('POST', '/api/bank/connections', {
      publicToken: FAKE_PUBLIC_TOKEN,
    });
    expect(response.json()).toMatchObject({ institutionName: 'Bank' });
  });

  it('explains a token Plaid refuses, and saves nothing', async () => {
    const response = await send('POST', '/api/bank/connections', { publicToken: 'public-old' });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe(
      'Plaid returned an error: provided public token is expired',
    );
    expect(await db.select().from(bankConnections)).toEqual([]);
  });

  it('ends the connection at Plaid if its accounts can’t be fetched, so none is left behind', async () => {
    const original = plaid.handle;
    plaid.handle = (path, body) =>
      path === '/accounts/get'
        ? {
            status: 500,
            body: {
              error_type: 'API_ERROR',
              error_code: 'INTERNAL_SERVER_ERROR',
              error_message: 'oops',
            },
          }
        : original(path, body);
    try {
      const response = await send('POST', '/api/bank/connections', {
        publicToken: FAKE_PUBLIC_TOKEN,
      });
      expect(response.statusCode).toBe(502);
    } finally {
      plaid.handle = original;
    }
    expect(plaid.items.get('access-sandbox-1')?.removed).toBe(true);
    expect(await db.select().from(bankConnections)).toEqual([]);
  });

  it('explains wrong Plaid keys and an unreachable Plaid', async () => {
    plaid.failWith({
      status: 400,
      body: {
        error_type: 'INVALID_INPUT',
        error_code: 'INVALID_API_KEYS',
        error_message: 'invalid client_id or secret provided',
      },
    });
    const wrongKeys = await send('POST', '/api/bank/link-token', {});
    expect(wrongKeys.statusCode).toBe(502);
    expect(wrongKeys.json().message).toMatch(/didn’t accept PLAID_CLIENT_ID and PLAID_SECRET/);

    plaid.failWith(null);
    networkDown = true;
    const down = await send('POST', '/api/bank/link-token', {});
    expect(down.statusCode).toBe(502);
    expect(down.json().message).toBe(
      'Couldn’t reach Plaid. Check the internet connection and try again.',
    );
  });

  it('explains a response Plaid shouldn’t send', async () => {
    const original = plaid.handle;
    plaid.handle = () => ({ status: 503, body: { unexpected: true } });
    try {
      const response = await send('POST', '/api/bank/link-token', {});
      expect(response.json().message).toBe('Plaid returned an error (503). Try again later.');
    } finally {
      plaid.handle = original;
    }
  });
});

describe('linking accounts', () => {
  it('links a bank account to an existing account and shows the bank’s balance on it', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    const checking = connection.accounts[0]!;

    const response = await link(checking.id, accountId);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConnectionView>().accounts[0]).toMatchObject({
      accountId,
      accountName: 'Household Checking',
    });

    const [account] = await get<{ bank: object | null }[]>('/api/accounts');
    expect(account!.bank).toEqual({
      bankAccountId: checking.id,
      institutionName: 'Northwind Bank',
      mask: '1234',
      balanceCents: 245000,
      status: 'ok',
      problem: null,
      updatedAt: expect.any(String),
    });

    // Importing starts where you choose when linking an existing account, in Milestone 16.
    const [saved] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, checking.id));
    expect(saved!.importFrom).toBeNull();
  });

  it('links each account to one bank account at most, and only open accounts', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    await link(connection.accounts[0]!.id, accountId);

    const second = await link(connection.accounts[1]!.id, accountId);
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toBe(
      'Household Checking is already linked to Everyday Checking ••1234. Unlink that first.',
    );

    // Linking the same pair again is fine.
    expect((await link(connection.accounts[0]!.id, accountId)).statusCode).toBe(200);

    const closedId = await createAccount('Old Savings', 'savings');
    await send('POST', `/api/accounts/${closedId}/close`, { date: TODAY });
    const closed = await link(connection.accounts[1]!.id, closedId);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().message).toBe('Reopen this account before linking it.');

    expect((await link(connection.accounts[1]!.id, 9999)).statusCode).toBe(404);
    expect((await link(9999, accountId)).statusCode).toBe(404);
  });

  it('unlinks an account', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    await link(connection.accounts[0]!.id, accountId);

    const response = await link(connection.accounts[0]!.id, null);
    expect(response.json<ConnectionView>().accounts[0]!.accountId).toBeNull();
    const [account] = await get<{ bank: object | null }[]>('/api/accounts');
    expect(account!.bank).toBeNull();
  });

  it('creates a new account from a bank account, starting at the bank’s balance today', async () => {
    const connection = await connect();
    const card = connection.accounts[1]!;

    const response = await send('POST', `/api/bank/accounts/${card.id}/create-account`, {
      name: 'Northwind Card',
      type: 'credit_card',
    });
    expect(response.statusCode, response.body).toBe(201);
    const { accountId, accounts } = response.json<ConnectionView & { accountId: number }>();
    expect(accounts[1]).toMatchObject({ accountId, accountName: 'Northwind Card' });

    const [account] =
      await get<{ id: number; type: string; balanceCents: number; onBudget: boolean }[]>(
        '/api/accounts',
      );
    expect(account).toMatchObject({
      id: accountId,
      type: 'credit_card',
      balanceCents: -31245,
      onBudget: true,
    });
    const [starting] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(starting).toMatchObject({ date: TODAY, isStartingBalance: true, cleared: 'cleared' });

    // That balance includes today's transactions, so importing starts tomorrow.
    const [saved] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, card.id));
    expect(saved!.importFrom).toBe('2026-11-16');

    const again = await send('POST', `/api/bank/accounts/${card.id}/create-account`, {
      name: 'Another',
      type: 'credit_card',
    });
    expect(again.statusCode).toBe(409);
  });

  it('starts a new account at zero when the bank gives no balance', async () => {
    await connect();
    plaid.setBalance('acc-northwind-checking', null);
    const [connection] = await db.select().from(bankConnections);
    await send('POST', `/api/bank/connections/${connection!.id}/refresh`);
    const [checking] = await db.select().from(bankAccounts).orderBy(bankAccounts.id);

    const response = await send('POST', `/api/bank/accounts/${checking!.id}/create-account`, {
      name: 'Everyday',
      type: 'checking',
    });
    expect(response.statusCode).toBe(201);
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it('unlinks a bank account when its Pretty Penny account is deleted', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    await link(connection.accounts[0]!.id, accountId);
    expect((await send('DELETE', `/api/accounts/${accountId}`)).statusCode).toBe(204);

    const [saved] = await db.select().from(bankAccounts).orderBy(bankAccounts.id);
    expect(saved!.accountId).toBeNull();
  });
});

describe('keeping connections up to date', () => {
  it('fetches new balances', async () => {
    const connection = await connect();
    plaid.setBalance('acc-northwind-checking', 1999.99);

    const response = await send('POST', `/api/bank/connections/${connection.id}/refresh`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConnectionView>().accounts[0]!.balanceCents).toBe(199999);
  });

  it('notices when the bank wants you to sign in again, and recovers once fixed', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    await link(connection.accounts[0]!.id, accountId);
    plaid.setItemError(LOGIN_REQUIRED);

    const refreshed = await send('POST', `/api/bank/connections/${connection.id}/refresh`);
    expect(refreshed.json()).toMatchObject({
      status: 'needs_sign_in',
      problem: 'Northwind Bank needs you to sign in again. Use Fix connection.',
    });
    const [account] = await get<{ bank: { status: string } }[]>('/api/accounts');
    expect(account!.bank.status).toBe('needs_sign_in');

    // Fixing opens Plaid's update mode for the same connection, using no new login.
    const fix = await send('POST', '/api/bank/link-token', { connectionId: connection.id });
    expect(fix.statusCode).toBe(200);
    const updateRequest = lastRequest('/link/token/create').body;
    expect(updateRequest.access_token).toBe('access-sandbox-1');
    expect(updateRequest.products).toBeUndefined();

    plaid.setItemError(null);
    const fixed = await send('POST', `/api/bank/connections/${connection.id}/refresh`);
    expect(fixed.json()).toMatchObject({ status: 'ok', problem: null });
  });

  it('shows errors that aren’t about the connection instead of saving them', async () => {
    const connection = await connect();
    plaid.failWith({
      status: 400,
      body: {
        error_type: 'INVALID_INPUT',
        error_code: 'INVALID_API_KEYS',
        error_message: 'invalid',
      },
    });
    const response = await send('POST', `/api/bank/connections/${connection.id}/refresh`);
    expect(response.statusCode).toBe(502);
    const [saved] = await db.select().from(bankConnections);
    expect(saved!.status).toBe('ok');
  });

  it('fails clearly when BANK_TOKEN_KEY has changed', async () => {
    const connection = await connect();
    const otherKey = buildApp(db, {
      requireLogin: false,
      ...settings,
      bankTokenKey: randomBytes(32).toString('base64'),
    });
    const response = await send(
      'POST',
      '/api/bank/link-token',
      { connectionId: connection.id },
      otherKey,
    );
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'BANK_KEY' });
    await otherKey.close();
  });

  it('refreshes every connection hourly, carrying on past one that fails', async () => {
    await connect();
    await connect();
    const config = bankConfig(settings);
    expect(await refreshAllConnections(db, config)).toEqual({ refreshed: 2, failed: [] });

    const [first] = await db.select().from(bankConnections).orderBy(bankConnections.id);
    await db
      .update(bankConnections)
      .set({ accessTokenEncrypted: 'v1.damaged' })
      .where(eq(bankConnections.id, first!.id));
    const result = await refreshAllConnections(db, config);
    expect(result.refreshed).toBe(1);
    expect(result.failed).toEqual([
      { connectionId: first!.id, message: expect.stringContaining('BANK_TOKEN_KEY') },
    ]);

    expect(await refreshAllConnections(db, bankConfig({}))).toEqual({ refreshed: 0, failed: [] });
  });

  it('refuses to refresh a connection that doesn’t exist', async () => {
    expect((await send('POST', '/api/bank/connections/9999/refresh')).statusCode).toBe(404);
  });
});

describe('removing a connection', () => {
  it('ends it at Plaid and unlinks its accounts, keeping their transactions', async () => {
    const connection = await connect();
    const accountId = await createAccount();
    await link(connection.accounts[0]!.id, accountId);

    expect((await send('DELETE', `/api/bank/connections/${connection.id}`)).statusCode).toBe(204);
    expect(plaid.items.get('access-sandbox-1')?.removed).toBe(true);
    expect(await get('/api/bank/connections')).toEqual([]);
    expect(await db.select().from(bankAccounts)).toEqual([]);

    const [account] = await get<{ bank: object | null; balanceCents: number }[]>('/api/accounts');
    expect(account).toMatchObject({ bank: null, balanceCents: 10000 });
  });

  it('goes ahead when Plaid has already forgotten it', async () => {
    const connection = await connect();
    plaid.items.get('access-sandbox-1')!.removed = true;
    expect((await send('DELETE', `/api/bank/connections/${connection.id}`)).statusCode).toBe(204);
    expect(await db.select().from(bankConnections)).toEqual([]);
  });

  it('keeps it when Plaid can’t remove it, so it can be tried again', async () => {
    const connection = await connect();
    plaid.failWith({
      status: 500,
      body: {
        error_type: 'API_ERROR',
        error_code: 'INTERNAL_SERVER_ERROR',
        error_message: 'try again',
      },
    });
    const response = await send('DELETE', `/api/bank/connections/${connection.id}`);
    expect(response.statusCode).toBe(502);
    expect(await db.select().from(bankConnections)).toHaveLength(1);
  });

  it('refuses to remove a connection that doesn’t exist', async () => {
    expect((await send('DELETE', '/api/bank/connections/9999')).statusCode).toBe(404);
  });
});
