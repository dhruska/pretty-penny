import { HttpError } from '../routes/schemas.js';
import type { FetchFn } from '../ynab/client.js';

export const PLAID_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type PlaidEnvironment = (typeof PLAID_ENVIRONMENTS)[number];

export const PLAID_URLS: Record<PlaidEnvironment, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export interface PlaidSettings {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
  /** Replaces Plaid's address; browser tests point it at a fake server. */
  baseUrl?: string;
}

/** The fields of Plaid's account objects that Pretty Penny uses. */
export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; iso_currency_code: string | null };
}

/** The fields of Plaid's transaction objects that Pretty Penny uses. */
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  /** Positive for money out, as Plaid reports it for every kind of account. */
  amount: number;
  /** When the bank posted it. */
  date: string;
  /** When the purchase was made, if the bank says. */
  authorized_date: string | null;
  /** The bank's own description. */
  name: string;
  /** Plaid's cleaned-up merchant name, when it recognizes one. */
  merchant_name: string | null;
  pending: boolean;
}

/** One page of changes from /transactions/sync. */
export interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
}

/** Plaid's error when transactions changed while a sync was paging; the sync starts over. */
export const SYNC_RESTART_CODE = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

/** An error response from Plaid. Its messages never include tokens or the secret. */
export class PlaidError extends Error {
  constructor(
    public errorType: string,
    public errorCode: string,
    message: string,
    /** Plaid's message for people using the app, when it has one. */
    public displayMessage: string | null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;
/** Plaid's identifier for the person using the app. Pretty Penny has one user. */
const USER_ID = 'pretty-penny-owner';
/** As much history as Plaid offers, so any import start date works later. */
const DAYS_OF_HISTORY = 730;

export type PlaidClient = ReturnType<typeof createPlaidClient>;

/** Calls Plaid's API. The client ID and secret go in each request body, as Plaid expects. */
export function createPlaidClient(settings: PlaidSettings, fetchFn: FetchFn = fetch) {
  const baseUrl = settings.baseUrl ?? PLAID_URLS[settings.environment];

  async function post<T>(path: string, body: object): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_id: settings.clientId, secret: settings.secret, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(
        502,
        'Couldn’t reach Plaid. Check the internet connection and try again.',
      );
    }

    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      if (json && typeof json.error_code === 'string') {
        throw new PlaidError(
          String(json.error_type ?? ''),
          json.error_code,
          String(json.error_message ?? json.error_code),
          typeof json.display_message === 'string' ? json.display_message : null,
        );
      }
      throw new HttpError(502, `Plaid returned an error (${response.status}). Try again later.`);
    }
    if (!json) throw new HttpError(502, 'Plaid sent a response Pretty Penny doesn’t understand.');
    return json as T;
  }

  return {
    environment: settings.environment,

    /**
     * Starts Plaid's sign-in window. With an access token it opens in update mode, which fixes
     * an existing connection without using another of the Trial's 10 logins.
     */
    async createLinkToken(options: { accessToken?: string; redirectUri?: string } = {}) {
      const result = await post<{ link_token: string }>('/link/token/create', {
        client_name: 'Pretty Penny',
        language: 'en',
        country_codes: ['US'],
        user: { client_user_id: USER_ID },
        ...(options.accessToken
          ? { access_token: options.accessToken }
          : { products: ['transactions'], transactions: { days_requested: DAYS_OF_HISTORY } }),
        ...(options.redirectUri && { redirect_uri: options.redirectUri }),
      });
      return result.link_token;
    },

    async exchangePublicToken(publicToken: string) {
      const result = await post<{ access_token: string; item_id: string }>(
        '/item/public_token/exchange',
        { public_token: publicToken },
      );
      return { accessToken: result.access_token, itemId: result.item_id };
    },

    /** The connection's accounts with the balances Plaid last fetched, which costs nothing extra. */
    async getAccounts(accessToken: string): Promise<PlaidAccount[]> {
      const result = await post<{ accounts?: PlaidAccount[] }>('/accounts/get', {
        access_token: accessToken,
      });
      if (!Array.isArray(result.accounts)) {
        throw new HttpError(502, 'Plaid sent a response Pretty Penny doesn’t understand.');
      }
      return result.accounts;
    },

    /**
     * Transactions added, changed and removed since the cursor, a page at a time. Without a
     * cursor, everything Plaid has.
     */
    async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage> {
      const page = await post<SyncPage>('/transactions/sync', {
        access_token: accessToken,
        ...(cursor && { cursor }),
        count: 500,
      });
      if (
        !Array.isArray(page.added) ||
        !Array.isArray(page.modified) ||
        !Array.isArray(page.removed) ||
        typeof page.next_cursor !== 'string'
      ) {
        throw new HttpError(502, 'Plaid sent a response Pretty Penny doesn’t understand.');
      }
      return page;
    },

    /** Ends Plaid's access to the bank. On the Trial plan the login slot isn't given back. */
    async removeItem(accessToken: string) {
      await post('/item/remove', { access_token: accessToken });
    },
  };
}
