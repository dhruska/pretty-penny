import type { AccountType } from '../account-types.js';
import type { PlaidAccount } from './plaid.js';
import { PlaidError } from './plaid.js';

/** Plaid's account types where a positive balance is money owed rather than money held. */
const OWED_TYPES = new Set(['credit', 'loan']);

/** The bank's balance in Pretty Penny's terms: negative when money is owed, as on a card. */
export function balanceCents(account: Pick<PlaidAccount, 'type' | 'balances'>): number | null {
  const current = account.balances.current;
  if (current === null || !Number.isFinite(current)) return null;
  const cents = Math.round(current * 100);
  return OWED_TYPES.has(account.type) ? -cents : cents;
}

/** The closest Pretty Penny account type to Plaid's type and subtype, used for new accounts. */
export function guessAccountType(account: Pick<PlaidAccount, 'type' | 'subtype'>): AccountType {
  const subtype = account.subtype ?? '';
  switch (account.type) {
    case 'depository':
      return ['savings', 'money market', 'cd', 'hsa'].includes(subtype) ? 'savings' : 'checking';
    case 'credit':
      return 'credit_card';
    case 'loan':
      return ['line of credit', 'home equity'].includes(subtype) ? 'line_of_credit' : 'liability';
    default:
      // Investment, brokerage and anything else Plaid adds later.
      return 'asset';
  }
}

export type ConnectionStatus = 'ok' | 'needs_sign_in' | 'error';

/**
 * What a Plaid error means for a connection, in plain words. Errors that aren't about the
 * connection itself, such as Plaid refusing the client ID, return null and are shown as errors.
 */
export function connectionProblem(
  error: PlaidError,
  institutionName: string,
): { status: ConnectionStatus; problem: string } | null {
  switch (error.errorCode) {
    case 'ITEM_LOGIN_REQUIRED':
    case 'PENDING_EXPIRATION':
    case 'ACCESS_NOT_GRANTED':
      return {
        status: 'needs_sign_in',
        problem: `${institutionName} needs you to sign in again. Use Fix connection.`,
      };
    case 'INSTITUTION_DOWN':
    case 'INSTITUTION_NOT_RESPONDING':
    case 'INSTITUTION_NOT_AVAILABLE':
      return {
        status: 'error',
        problem: `${institutionName} isn’t responding to Plaid right now. Pretty Penny will try again every hour.`,
      };
    case 'ITEM_NOT_FOUND':
    case 'INVALID_ACCESS_TOKEN':
      return {
        status: 'error',
        problem: `Plaid no longer has this connection. Remove it and connect ${institutionName} again.`,
      };
  }
  if (error.errorType === 'ITEM_ERROR' || error.errorType === 'INSTITUTION_ERROR') {
    return {
      status: 'error',
      problem: error.displayMessage ?? `Plaid couldn’t update ${institutionName}: ${error.message}`,
    };
  }
  return null;
}

/** A message for Plaid errors that aren't about one connection, such as wrong settings. */
export function plaidErrorMessage(error: PlaidError): string {
  if (error.errorCode === 'INVALID_API_KEYS') {
    return 'Plaid didn’t accept PLAID_CLIENT_ID and PLAID_SECRET. Check them in .env, and that PLAID_ENV matches the secret.';
  }
  if (error.errorType === 'RATE_LIMIT_EXCEEDED') {
    return 'Plaid is limiting requests right now. Try again in a few minutes.';
  }
  return `Plaid returned an error: ${error.displayMessage ?? error.message}`;
}
