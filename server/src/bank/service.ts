import { asc, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import { bankAccounts, bankConnections } from '../db/schema.js';
import { HttpError } from '../routes/schemas.js';
import type { FetchFn } from '../ynab/client.js';
import { decryptToken, parseBankKey } from './crypto.js';
import { balanceCents, connectionProblem, guessAccountType, plaidErrorMessage } from './mapping.js';
import {
  createPlaidClient,
  PLAID_ENVIRONMENTS,
  PlaidError,
  type PlaidAccount,
  type PlaidClient,
  type PlaidEnvironment,
} from './plaid.js';

/** Plaid settings as read from .env, any of which may be missing. */
export interface PlaidOptions {
  clientId?: string;
  secret?: string;
  environment?: string;
  baseUrl?: string;
}

/** Bank sync's settings, or the problems to fix in .env before it can be used. */
export interface BankConfig {
  plaid: PlaidClient | null;
  key: Buffer | null;
  problems: string[];
  /** Where banks send you back after signing in on their own site; registered with Plaid. */
  redirectUri?: string;
}

export const BANK_NOT_SET_UP_CODE = 'BANK_NOT_SET_UP';

export function bankConfig(options: {
  plaid?: PlaidOptions;
  bankTokenKey?: string;
  publicUrl?: string;
  fetch?: FetchFn;
}): BankConfig {
  const problems: string[] = [];
  const { clientId, secret, environment, baseUrl } = options.plaid ?? {};
  if (!clientId) problems.push('PLAID_CLIENT_ID isn’t set.');
  if (!secret) problems.push('PLAID_SECRET isn’t set.');
  const validEnvironment = (PLAID_ENVIRONMENTS as readonly string[]).includes(environment ?? '');
  if (!validEnvironment) problems.push('PLAID_ENV must be sandbox or production.');

  const parsed = parseBankKey(options.bankTokenKey);
  if ('problem' in parsed) problems.push(parsed.problem);

  const ready = clientId && secret && validEnvironment && 'key' in parsed;
  return {
    plaid: ready
      ? createPlaidClient(
          { clientId, secret, environment: environment as PlaidEnvironment, baseUrl },
          options.fetch,
        )
      : null,
    key: 'key' in parsed ? parsed.key : null,
    problems,
    // Plaid only accepts an HTTPS address it has been told about, such as the tailnet's.
    redirectUri: options.publicUrl?.startsWith('https://')
      ? `${options.publicUrl.replace(/\/$/, '')}/bank/oauth`
      : undefined,
  };
}

/** The Plaid client and key, or an error explaining that bank sync isn't set up. */
export function requireBank(config: BankConfig) {
  if (!config.plaid || !config.key) {
    throw new HttpError(
      409,
      `Bank sync isn’t set up yet. ${config.problems.join(' ')}`,
      BANK_NOT_SET_UP_CODE,
    );
  }
  return { plaid: config.plaid, key: config.key };
}

/** Turns a Plaid error that isn't about one connection into a message for the page. */
export function toHttpError(error: unknown): unknown {
  return error instanceof PlaidError ? new HttpError(502, plaidErrorMessage(error)) : error;
}

/** Adds the connection's accounts, or updates their names and balances if already saved. */
export async function saveBankAccounts(
  tx: Executor,
  connectionId: number,
  accounts: PlaidAccount[],
) {
  for (const account of accounts) {
    const values = {
      name: account.official_name || account.name,
      mask: account.mask,
      plaidType: account.type,
      plaidSubtype: account.subtype,
      balanceCents: balanceCents(account),
    };
    await tx
      .insert(bankAccounts)
      .values({ connectionId, plaidAccountId: account.account_id, ...values })
      .onConflictDoUpdate({ target: bankAccounts.plaidAccountId, set: values });
  }
}

type Connection = typeof bankConnections.$inferSelect;

/**
 * Fetches a connection's balances from Plaid and records whether it works. A problem with the
 * connection, such as the bank wanting you to sign in again, is saved rather than thrown.
 */
export async function refreshConnection(db: Db, config: BankConfig, connection: Connection) {
  const { plaid, key } = requireBank(config);
  try {
    const accounts = await plaid.getAccounts(decryptToken(key, connection.accessTokenEncrypted));
    await db.transaction(async (tx) => {
      await saveBankAccounts(tx, connection.id, accounts);
      await tx
        .update(bankConnections)
        .set({ status: 'ok', problem: null, updatedAt: new Date() })
        .where(eq(bankConnections.id, connection.id));
    });
  } catch (error) {
    const problem =
      error instanceof PlaidError ? connectionProblem(error, connection.institutionName) : null;
    if (!problem) throw toHttpError(error);
    await db.update(bankConnections).set(problem).where(eq(bankConnections.id, connection.id));
  }
}

/** Refreshes every connection, as the hourly job does. One failing doesn't stop the others. */
export async function refreshAllConnections(db: Db, config: BankConfig) {
  const failed: { connectionId: number; message: string }[] = [];
  if (!config.plaid || !config.key) return { refreshed: 0, failed };

  const connections = await db.select().from(bankConnections).orderBy(asc(bankConnections.id));
  let refreshed = 0;
  for (const connection of connections) {
    try {
      await refreshConnection(db, config, connection);
      refreshed += 1;
    } catch (error) {
      failed.push({
        connectionId: connection.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { refreshed, failed };
}

/** The day after a date, both as YYYY-MM-DD. */
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Connections with their accounts and what each is linked to, for the Bank connections page. */
export async function listConnections(db: Executor) {
  const connections = await db
    .select({
      id: bankConnections.id,
      institutionName: bankConnections.institutionName,
      status: bankConnections.status,
      problem: bankConnections.problem,
      updatedAt: bankConnections.updatedAt,
    })
    .from(bankConnections)
    .orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));

  const accounts = await db
    .select({
      id: bankAccounts.id,
      connectionId: bankAccounts.connectionId,
      name: bankAccounts.name,
      mask: bankAccounts.mask,
      plaidType: bankAccounts.plaidType,
      plaidSubtype: bankAccounts.plaidSubtype,
      balanceCents: bankAccounts.balanceCents,
      accountId: bankAccounts.accountId,
      accountName: sql<
        string | null
      >`(select name from accounts where id = ${bankAccounts.accountId})`,
    })
    .from(bankAccounts)
    .orderBy(asc(bankAccounts.id));

  return connections.map((connection) => ({
    ...connection,
    accounts: accounts
      .filter((account) => account.connectionId === connection.id)
      .map((account) => ({
        ...account,
        // What a new account for it starts as.
        suggestedType: guessAccountType({ type: account.plaidType, subtype: account.plaidSubtype }),
      })),
  }));
}
