import type { PlaidAccount, PlaidTransaction } from './plaid.js';

/**
 * A stand-in for Plaid's API, for tests and browser tests, with made-up banks and accounts.
 * `handle` answers one request the way Plaid would.
 */
export interface FakePlaidError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message?: string | null;
}

interface FakeItem {
  itemId: string;
  accounts: PlaidAccount[];
  /** Returned by /accounts/get until cleared, such as a bank wanting you to sign in again. */
  error: FakePlaidError | null;
  removed: boolean;
  /** Every change to its transactions, in order; a sync cursor is a position in it. */
  log: { kind: 'add' | 'modify' | 'remove'; transaction: PlaidTransaction }[];
  /** Plaid's transactions_update_status, such as NOT_READY right after connecting. */
  syncStatus: string;
}

export const FAKE_PUBLIC_TOKEN = 'public-sandbox-northwind';

export function fakeAccounts(): PlaidAccount[] {
  return [
    {
      account_id: 'acc-northwind-checking',
      name: 'Everyday Checking',
      official_name: null,
      mask: '1234',
      type: 'depository',
      subtype: 'checking',
      balances: { current: 2450, iso_currency_code: 'USD' },
    },
    {
      account_id: 'acc-northwind-card',
      name: 'Northwind Rewards Card',
      official_name: null,
      mask: '9876',
      type: 'credit',
      subtype: 'credit card',
      balances: { current: 312.45, iso_currency_code: 'USD' },
    },
  ];
}

/** A made-up transaction for the fake bank; `account` is a base account ID, such as acc-northwind-card. */
export interface FakeTransactionInput {
  id: string;
  account: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
}

type SyncEntry = { kind: 'added' | 'modified' | 'removed'; transaction: PlaidTransaction };

/** What changed between two positions in an item's log, as Plaid reports it: the net result. */
function netChanges(item: FakeItem, base: number, end: number): SyncEntry[] {
  const before = new Map<string, PlaidTransaction>();
  for (const entry of item.log.slice(0, base)) {
    if (entry.kind === 'remove') before.delete(entry.transaction.transaction_id);
    else before.set(entry.transaction.transaction_id, entry.transaction);
  }
  const after = new Map(before);
  const touched = new Set<string>();
  for (const entry of item.log.slice(base, end)) {
    touched.add(entry.transaction.transaction_id);
    if (entry.kind === 'remove') after.delete(entry.transaction.transaction_id);
    else after.set(entry.transaction.transaction_id, entry.transaction);
  }
  const added: SyncEntry[] = [];
  const modified: SyncEntry[] = [];
  const removed: SyncEntry[] = [];
  for (const id of touched) {
    const now = after.get(id);
    const was = before.get(id);
    if (!now) {
      if (was) removed.push({ kind: 'removed', transaction: was });
    } else if (!was) {
      added.push({ kind: 'added', transaction: now });
    } else {
      modified.push({ kind: 'modified', transaction: now });
    }
  }
  return [...added, ...modified, ...removed];
}

export const LOGIN_REQUIRED: FakePlaidError = {
  error_type: 'ITEM_ERROR',
  error_code: 'ITEM_LOGIN_REQUIRED',
  error_message: 'the login details of this item have changed',
  display_message: null,
};

export function createFakePlaid() {
  const items = new Map<string, FakeItem>();
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let exchanged = 0;
  /** The next response to every request, such as wrong keys; null for normal answers. */
  let failure: { status: number; body: FakePlaidError } | null = null;
  /** How many changes one sync page holds; Plaid's is up to 500. */
  let pageSize = 500;
  /** Makes the next sync page after the first fail as though data changed while paging. */
  let failNextPage = false;

  function item(body: Record<string, unknown>) {
    const found = items.get(String(body.access_token));
    return found && !found.removed ? found : null;
  }

  const notFound = {
    status: 400,
    body: {
      error_type: 'INVALID_INPUT',
      error_code: 'INVALID_ACCESS_TOKEN',
      error_message: 'provided access token is in an invalid format',
    },
  };

  function handle(path: string, body: Record<string, unknown>): { status: number; body: object } {
    requests.push({ path, body });
    if (failure) return failure;

    switch (path) {
      case '/link/token/create':
        return { status: 200, body: { link_token: `link-sandbox-${requests.length}` } };
      case '/item/public_token/exchange': {
        if (body.public_token !== FAKE_PUBLIC_TOKEN) {
          return {
            status: 400,
            body: {
              error_type: 'INVALID_INPUT',
              error_code: 'INVALID_PUBLIC_TOKEN',
              error_message: 'provided public token is expired',
            },
          };
        }
        exchanged += 1;
        const accessToken = `access-sandbox-${exchanged}`;
        // Each connection's accounts get their own IDs, as Plaid's do.
        const accounts = fakeAccounts().map((account) => ({
          ...account,
          account_id: `${account.account_id}-${exchanged}`,
        }));
        items.set(accessToken, {
          itemId: `item-${exchanged}`,
          accounts,
          error: null,
          removed: false,
          log: [],
          syncStatus: 'HISTORICAL_UPDATE_COMPLETE',
        });
        return { status: 200, body: { access_token: accessToken, item_id: `item-${exchanged}` } };
      }
      case '/accounts/get': {
        const found = item(body);
        if (!found) return notFound;
        if (found.error) return { status: 400, body: found.error };
        return { status: 200, body: { accounts: found.accounts, item: { item_id: found.itemId } } };
      }
      case '/transactions/sync': {
        const found = item(body);
        if (!found) return notFound;
        if (found.error) return { status: 400, body: found.error };
        const [base, end, offset] =
          typeof body.cursor === 'string'
            ? body.cursor.split(':').map(Number)
            : [0, found.log.length, 0];
        // A cursor between pages keeps reading the same changes, unless they changed since.
        const windowEnd = offset === 0 ? found.log.length : end!;
        if (offset! > 0 && failNextPage) {
          failNextPage = false;
          return {
            status: 400,
            body: {
              error_type: 'TRANSACTIONS_ERROR',
              error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
              error_message: 'Underlying transaction data changed since last page was fetched.',
            },
          };
        }
        const changes = netChanges(found, base!, windowEnd);
        const page = changes.slice(offset!, offset! + pageSize);
        const hasMore = offset! + pageSize < changes.length;
        const of = (kind: SyncEntry['kind']) =>
          page.filter((entry) => entry.kind === kind).map((entry) => entry.transaction);
        return {
          status: 200,
          body: {
            added: of('added'),
            modified: of('modified'),
            removed: of('removed').map((transaction) => ({
              transaction_id: transaction.transaction_id,
              account_id: transaction.account_id,
            })),
            next_cursor: hasMore
              ? `${base}:${windowEnd}:${offset! + pageSize}`
              : `${windowEnd}:${windowEnd}:0`,
            has_more: hasMore,
            transactions_update_status: found.syncStatus,
          },
        };
      }
      case '/item/remove': {
        const found = item(body);
        if (!found) return notFound;
        found.removed = true;
        return { status: 200, body: { request_id: 'fake' } };
      }
      default:
        return {
          status: 404,
          body: { error_type: 'API_ERROR', error_code: 'NOT_FOUND', error_message: 'not found' },
        };
    }
  }

  return {
    handle,
    requests,
    items,
    /** Makes every request fail with this error until cleared with null. */
    failWith(next: { status: number; body: FakePlaidError } | null) {
      failure = next;
    },
    /** Sets or clears an error for every connection, such as needing to sign in again. */
    setItemError(error: FakePlaidError | null) {
      for (const found of items.values()) found.error = error;
    },
    /** Changes the balance of an account on every connection, by its base ID. */
    setBalance(baseAccountId: string, current: number | null) {
      for (const found of items.values()) {
        for (const account of found.accounts) {
          if (account.account_id.startsWith(baseAccountId)) account.balances.current = current;
        }
      }
    },
    /**
     * Adds a transaction to every connection with that account. Its ID gets the connection's
     * number, as Plaid's IDs differ between connections.
     */
    addTransaction(input: FakeTransactionInput) {
      for (const [index, found] of [...items.values()].entries()) {
        const account = found.accounts.find((candidate) =>
          candidate.account_id.startsWith(input.account),
        );
        if (!account) continue;
        found.log.push({
          kind: 'add',
          transaction: {
            transaction_id: `${input.id}-${index + 1}`,
            account_id: account.account_id,
            amount: input.amount,
            date: input.date,
            authorized_date: input.authorized_date ?? null,
            name: input.name,
            merchant_name: input.merchant_name ?? null,
            pending: input.pending ?? false,
          },
        });
      }
    },
    /** Changes a transaction everywhere it was added, by the ID it was added with. */
    changeTransaction(id: string, changes: Partial<Omit<PlaidTransaction, 'transaction_id'>>) {
      for (const found of items.values()) {
        const latest = [...found.log]
          .reverse()
          .find((entry) => entry.transaction.transaction_id.startsWith(`${id}-`));
        if (!latest || latest.kind === 'remove') continue;
        found.log.push({ kind: 'modify', transaction: { ...latest.transaction, ...changes } });
      }
    },
    /** Removes a transaction everywhere, as when a bank drops it or posts a pending one. */
    removeTransaction(id: string) {
      for (const found of items.values()) {
        const latest = [...found.log]
          .reverse()
          .find((entry) => entry.transaction.transaction_id.startsWith(`${id}-`));
        if (!latest || latest.kind === 'remove') continue;
        found.log.push({ kind: 'remove', transaction: latest.transaction });
      }
    },
    setPageSize(size: number) {
      pageSize = size;
    },
    failNextSyncPage() {
      failNextPage = true;
    },
    setSyncStatus(status: string) {
      for (const found of items.values()) found.syncStatus = status;
    },
    reset() {
      items.clear();
      requests.length = 0;
      exchanged = 0;
      failure = null;
      pageSize = 500;
      failNextPage = false;
    },
  };
}
