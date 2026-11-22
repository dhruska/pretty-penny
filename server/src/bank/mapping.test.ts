import { describe, expect, it } from 'vitest';
import { balanceCents, connectionProblem, guessAccountType, plaidErrorMessage } from './mapping.js';
import { PlaidError } from './plaid.js';

const balance = (type: string, current: number | null) =>
  balanceCents({ type, balances: { current, iso_currency_code: 'USD' } });

describe('bank balances', () => {
  it('keeps money held positive and turns money owed negative', () => {
    expect(balance('depository', 2450.1)).toBe(245010);
    expect(balance('investment', 10)).toBe(1000);
    expect(balance('credit', 312.45)).toBe(-31245);
    expect(balance('loan', 1000)).toBe(-100000);
    // A card with a credit owed back to you.
    expect(balance('credit', -20)).toBe(2000);
  });

  it('rounds to whole cents and leaves an unknown balance unknown', () => {
    expect(balance('depository', 0.1 + 0.2)).toBe(30);
    expect(balance('depository', null)).toBeNull();
  });
});

describe('account types for new accounts', () => {
  it.each([
    ['depository', 'checking', 'checking'],
    ['depository', 'savings', 'savings'],
    ['depository', 'money market', 'savings'],
    ['depository', 'cd', 'savings'],
    ['depository', null, 'checking'],
    ['credit', 'credit card', 'credit_card'],
    ['loan', 'line of credit', 'line_of_credit'],
    ['loan', 'mortgage', 'liability'],
    ['loan', 'student', 'liability'],
    ['investment', 'brokerage', 'asset'],
    ['other', null, 'asset'],
  ])('%s / %s becomes %s', (type, subtype, expected) => {
    expect(guessAccountType({ type, subtype })).toBe(expected);
  });
});

describe('connection problems', () => {
  const error = (type: string, code: string, display: string | null = null) =>
    new PlaidError(type, code, `plaid says ${code}`, display);

  it('asks you to sign in again when the bank wants it', () => {
    expect(connectionProblem(error('ITEM_ERROR', 'ITEM_LOGIN_REQUIRED'), 'Northwind Bank')).toEqual(
      {
        status: 'needs_sign_in',
        problem: 'Northwind Bank needs you to sign in again. Use Fix connection.',
      },
    );
  });

  it('describes a bank that is down, a forgotten connection and other connection errors', () => {
    expect(
      connectionProblem(error('INSTITUTION_ERROR', 'INSTITUTION_DOWN'), 'Northwind Bank')?.problem,
    ).toMatch(/isn’t responding/);
    expect(
      connectionProblem(error('INVALID_INPUT', 'ITEM_NOT_FOUND'), 'Northwind Bank')?.problem,
    ).toMatch(/no longer has this connection/);
    expect(
      connectionProblem(error('ITEM_ERROR', 'NO_ACCOUNTS', 'No accounts found.'), 'X'),
    ).toEqual({
      status: 'error',
      problem: 'No accounts found.',
    });
    expect(connectionProblem(error('ITEM_ERROR', 'SOMETHING_NEW'), 'X')?.problem).toBe(
      'Plaid couldn’t update X: plaid says SOMETHING_NEW',
    );
  });

  it('leaves errors that are not about the connection to be shown as errors', () => {
    expect(connectionProblem(error('INVALID_INPUT', 'INVALID_API_KEYS'), 'X')).toBeNull();
    expect(plaidErrorMessage(error('INVALID_INPUT', 'INVALID_API_KEYS'))).toMatch(
      /PLAID_CLIENT_ID/,
    );
    expect(plaidErrorMessage(error('RATE_LIMIT_EXCEEDED', 'RATE_LIMIT'))).toMatch(/limiting/);
    expect(plaidErrorMessage(error('API_ERROR', 'INTERNAL_SERVER_ERROR', 'Try later.'))).toBe(
      'Plaid returned an error: Try later.',
    );
  });
});
