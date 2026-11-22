import type { PlaidAccount } from './plaid.js';

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
        });
        return { status: 200, body: { access_token: accessToken, item_id: `item-${exchanged}` } };
      }
      case '/accounts/get': {
        const found = item(body);
        if (!found) return notFound;
        if (found.error) return { status: 400, body: found.error };
        return { status: 200, body: { accounts: found.accounts, item: { item_id: found.itemId } } };
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
    reset() {
      items.clear();
      requests.length = 0;
      exchanged = 0;
      failure = null;
    },
  };
}
