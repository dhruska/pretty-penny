import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isReconciledError } from './api';

let calls: { url: string; method: string; body: unknown }[];
let respond: () => Response;

beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return respond();
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('requests', () => {
  it('send JSON and read JSON back', async () => {
    expect(await api.renameFlag('red', 'Check')).toEqual({ ok: true });
    expect(calls).toEqual([{ url: '/api/flags/red', method: 'PUT', body: { name: 'Check' } }]);
  });

  it('return nothing for an empty response', async () => {
    respond = () => new Response(null, { status: 204 });
    expect(await api.logout()).toBeUndefined();
  });

  it('turn errors into ApiError with the server’s message and code', async () => {
    respond = () =>
      new Response(JSON.stringify({ message: 'Locked.', code: 'RECONCILED' }), { status: 409 });
    const error = await api.updateTransaction(1, { memo: 'x' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Locked.', status: 409, code: 'RECONCILED' });
    expect(isReconciledError(error)).toBe(true);
    expect(isReconciledError(new Error('Locked.'))).toBe(false);
  });

  it('explain when the server can’t be reached', async () => {
    respond = () => new Response('<html>Bad gateway</html>', { status: 502 });
    await expect(api.listAccounts()).rejects.toThrow('Can’t reach the server.');
  });

  it('go to sign-in, and back afterward, when the session has ended', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/accounts/3', search: '?x=1', assign });
    respond = () =>
      new Response(JSON.stringify({ message: 'Sign in to continue.', code: 'SIGNED_OUT' }), {
        status: 401,
      });
    await expect(api.listAccounts()).rejects.toThrow('Sign in to continue.');
    expect(assign).toHaveBeenCalledWith('/login?next=%2Faccounts%2F3%3Fx%3D1');
  });
});

describe('every API call', () => {
  // Each call's method and address, so a wrong URL is caught here rather than in use.
  const cases: [string, () => Promise<unknown>, string, string, unknown?][] = [
    ['session', () => api.session(), 'GET', '/api/auth/session'],
    ['login', () => api.login('pw'), 'POST', '/api/auth/login', { password: 'pw' }],
    ['logout', () => api.logout(), 'POST', '/api/auth/logout'],
    ['listAccounts', () => api.listAccounts(), 'GET', '/api/accounts'],
    [
      'createAccount',
      () => api.createAccount({ name: 'A', type: 'cash', startingBalanceCents: 0, date: 'd' }),
      'POST',
      '/api/accounts',
      { name: 'A', type: 'cash', startingBalanceCents: 0, date: 'd' },
    ],
    [
      'updateAccount',
      () => api.updateAccount(2, { name: 'B' }),
      'PATCH',
      '/api/accounts/2',
      { name: 'B' },
    ],
    [
      'closeAccount',
      () => api.closeAccount(2, 'd'),
      'POST',
      '/api/accounts/2/close',
      { date: 'd' },
    ],
    ['reopenAccount', () => api.reopenAccount(2), 'POST', '/api/accounts/2/reopen'],
    [
      'reconcileAccount',
      () => api.reconcileAccount(2, 5, 'd'),
      'POST',
      '/api/accounts/2/reconcile',
      { bankBalanceCents: 5, date: 'd' },
    ],
    ['deleteAccount', () => api.deleteAccount(2), 'DELETE', '/api/accounts/2'],
    [
      'listTransactions',
      () => api.listTransactions(2, { limit: 200 }),
      'GET',
      '/api/accounts/2/transactions?limit=200',
    ],
    [
      'listTransactions, a later page',
      () => api.listTransactions(2, { limit: 200, before: 9 }),
      'GET',
      '/api/accounts/2/transactions?limit=200&before=9',
    ],
    [
      'createTransaction',
      () => api.createTransaction(2, { memo: 'm' } as never),
      'POST',
      '/api/accounts/2/transactions',
      { memo: 'm' },
    ],
    [
      'updateTransaction',
      () => api.updateTransaction(4, { memo: 'm' }),
      'PATCH',
      '/api/transactions/4',
      { memo: 'm' },
    ],
    [
      'searchTransactions',
      () => api.searchTransactions(new URLSearchParams({ q: 'a b' })),
      'GET',
      '/api/transactions?q=a+b',
    ],
    ['listPayees', () => api.listPayees(), 'GET', '/api/payees'],
    ['listFlags', () => api.listFlags(), 'GET', '/api/flags'],
    [
      'renameFlag',
      () => api.renameFlag('blue', 'Work'),
      'PUT',
      '/api/flags/blue',
      { name: 'Work' },
    ],
    ['listScheduled', () => api.listScheduled(2), 'GET', '/api/accounts/2/scheduled'],
    [
      'createScheduled',
      () => api.createScheduled(2, { memo: 'm' } as never),
      'POST',
      '/api/accounts/2/scheduled',
      { memo: 'm' },
    ],
    [
      'updateScheduled',
      () => api.updateScheduled(5, { memo: 'm' } as never),
      'PUT',
      '/api/scheduled/5',
      { memo: 'm' },
    ],
    ['deleteScheduled', () => api.deleteScheduled(5), 'DELETE', '/api/scheduled/5'],
    ['enterScheduledNow', () => api.enterScheduledNow(5), 'POST', '/api/scheduled/5/enter-now'],
    ['skipScheduled', () => api.skipScheduled(5), 'POST', '/api/scheduled/5/skip'],
    [
      'spendingReport',
      () => api.spendingReport(new URLSearchParams({ a: '1' })),
      'GET',
      '/api/reports/spending?a=1',
    ],
    [
      'trendsReport',
      () => api.trendsReport(new URLSearchParams({ a: '1' })),
      'GET',
      '/api/reports/trends?a=1',
    ],
    [
      'incomeExpenseReport',
      () => api.incomeExpenseReport(new URLSearchParams({ a: '1' })),
      'GET',
      '/api/reports/income-expense?a=1',
    ],
    [
      'netWorthReport',
      () => api.netWorthReport(new URLSearchParams({ a: '1' })),
      'GET',
      '/api/reports/net-worth?a=1',
    ],
    [
      'deleteTransaction',
      () => api.deleteTransaction(4),
      'DELETE',
      '/api/transactions/4?confirmReconciled=true',
    ],
    [
      'restoreTransaction',
      () => api.restoreTransaction({ snapshot: {}, signature: 's' }),
      'POST',
      '/api/transactions/restore',
      { snapshot: {}, signature: 's' },
    ],
    [
      'getBudget',
      () => api.getBudget('2026-11', '2026-12'),
      'GET',
      '/api/budget?month=2026-11&currentMonth=2026-12',
    ],
    [
      'setAssignment',
      () => api.setAssignment('2026-11', 3, 7),
      'PUT',
      '/api/budget/2026-11/categories/3',
      { assignedCents: 7 },
    ],
    [
      'moveMoney',
      () => api.moveMoney('2026-11', { fromCategoryId: null, toCategoryId: 3, amountCents: 7 }),
      'POST',
      '/api/budget/2026-11/move',
      { fromCategoryId: null, toCategoryId: 3, amountCents: 7 },
    ],
    [
      'setAssignments',
      () => api.setAssignments('2026-11', [{ categoryId: 3, assignedCents: 7 }]),
      'POST',
      '/api/budget/2026-11/assignments',
      { assignments: [{ categoryId: 3, assignedCents: 7 }] },
    ],
    ['listCategories', () => api.listCategories(), 'GET', '/api/categories'],
    ['createGroup', () => api.createGroup('G'), 'POST', '/api/category-groups', { name: 'G' }],
    [
      'updateGroup',
      () => api.updateGroup(6, { hidden: true }),
      'PATCH',
      '/api/category-groups/6',
      { hidden: true },
    ],
    [
      'moveGroup',
      () => api.moveGroup(6, 'up'),
      'POST',
      '/api/category-groups/6/move',
      { direction: 'up' },
    ],
    ['deleteGroup', () => api.deleteGroup(6), 'DELETE', '/api/category-groups/6'],
    [
      'createCategory',
      () => api.createCategory(6, 'C'),
      'POST',
      '/api/categories',
      { groupId: 6, name: 'C' },
    ],
    [
      'updateCategory',
      () => api.updateCategory(3, { name: 'D' }),
      'PATCH',
      '/api/categories/3',
      { name: 'D' },
    ],
    [
      'moveCategory',
      () => api.moveCategory(3, 'down'),
      'POST',
      '/api/categories/3/move',
      { direction: 'down' },
    ],
    ['deleteCategory', () => api.deleteCategory(3), 'DELETE', '/api/categories/3'],
    [
      'approveTransactions',
      () => api.approveTransactions([3, 4]),
      'POST',
      '/api/transactions/approve',
      { ids: [3, 4] },
    ],
    ['approveAll', () => api.approveAll(2), 'POST', '/api/accounts/2/approve-all'],
    ['unmatchTransaction', () => api.unmatchTransaction(3), 'POST', '/api/transactions/3/unmatch'],
    ['listPending', () => api.listPending(2), 'GET', '/api/accounts/2/pending'],
    [
      'setImportFrom',
      () => api.setImportFrom(6, '2026-11-01'),
      'PUT',
      '/api/bank/accounts/6/import-from',
      { importFrom: '2026-11-01' },
    ],
    ['bankStatus', () => api.bankStatus(), 'GET', '/api/bank/status'],
    ['listBankConnections', () => api.listBankConnections(), 'GET', '/api/bank/connections'],
    ['createLinkToken', () => api.createLinkToken(), 'POST', '/api/bank/link-token', {}],
    [
      'createLinkToken, to fix a connection',
      () => api.createLinkToken(4),
      'POST',
      '/api/bank/link-token',
      { connectionId: 4 },
    ],
    [
      'connectBank',
      () => api.connectBank('public-1', 'Northwind Bank'),
      'POST',
      '/api/bank/connections',
      { publicToken: 'public-1', institutionName: 'Northwind Bank' },
    ],
    [
      'connectBank, without a bank name',
      () => api.connectBank('public-1', undefined),
      'POST',
      '/api/bank/connections',
      { publicToken: 'public-1' },
    ],
    [
      'refreshBankConnection',
      () => api.refreshBankConnection(4),
      'POST',
      '/api/bank/connections/4/refresh',
    ],
    [
      'removeBankConnection',
      () => api.removeBankConnection(4),
      'DELETE',
      '/api/bank/connections/4',
    ],
    [
      'linkBankAccount',
      () => api.linkBankAccount(6, null),
      'PUT',
      '/api/bank/accounts/6/link',
      { accountId: null },
    ],
    [
      'createAccountFromBank',
      () => api.createAccountFromBank(6, { name: 'Card', type: 'credit_card' }),
      'POST',
      '/api/bank/accounts/6/create-account',
      { name: 'Card', type: 'credit_card' },
    ],
    ['importStatus', () => api.importStatus(), 'GET', '/api/import/status'],
    [
      'listYnabPlans',
      () => api.listYnabPlans('t'),
      'POST',
      '/api/import/ynab/plans',
      { token: 't' },
    ],
    [
      'previewYnabImport',
      () => api.previewYnabImport('t', 'p'),
      'POST',
      '/api/import/ynab/preview',
      { token: 't', planId: 'p' },
    ],
    [
      'importYnabPlan',
      () => api.importYnabPlan('t', 'p'),
      'POST',
      '/api/import/ynab',
      { token: 't', planId: 'p' },
    ],
  ];

  it.each(cases)('%s', async (_name, run, method, url, body) => {
    await run();
    expect(calls).toEqual([{ url, method, body }]);
  });

  it('are all covered here', () => {
    const tested = new Set(cases.map(([name]) => name.split(',')[0]));
    expect(Object.keys(api).filter((name) => !tested.has(name))).toEqual([]);
  });
});
