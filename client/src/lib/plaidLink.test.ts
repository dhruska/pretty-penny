import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingLink,
  openPlaidLink,
  PLAID_SCRIPT_URL,
  readPendingLink,
  savePendingLink,
} from './plaidLink';

type Config = Parameters<NonNullable<Window['Plaid']>['create']>[0];
let config: Config;
const handler = { open: vi.fn(), destroy: vi.fn() };

beforeEach(() => {
  localStorage.clear();
  window.Plaid = {
    create: (next) => {
      config = next;
      return handler;
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
  delete window.Plaid;
});

describe('the pending sign-in', () => {
  it('is remembered on this device until cleared', () => {
    expect(readPendingLink()).toBeNull();
    savePendingLink({ token: 'link-1', connectionId: 3 });
    expect(readPendingLink()).toEqual({ token: 'link-1', connectionId: 3 });
    clearPendingLink();
    expect(readPendingLink()).toBeNull();
  });

  it('ignores something else saved under its name', () => {
    localStorage.setItem('pretty-penny.plaid-link', 'not json');
    expect(readPendingLink()).toBeNull();
    localStorage.setItem('pretty-penny.plaid-link', '{"connectionId":1}');
    expect(readPendingLink()).toBeNull();
  });

  it('works without storage, as in a private window', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePendingLink({ token: 'link-1', connectionId: null })).not.toThrow();
    expect(() => clearPendingLink()).not.toThrow();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});

describe('Plaid’s sign-in window', () => {
  it('resolves with the public token and bank name when it succeeds', async () => {
    const result = openPlaidLink('link-1');
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    expect(config.token).toBe('link-1');
    expect(config.receivedRedirectUri).toBeUndefined();
    config.onSuccess('public-1', { institution: { name: 'Northwind Bank' } });
    await expect(result).resolves.toEqual({
      publicToken: 'public-1',
      institutionName: 'Northwind Bank',
    });
    expect(handler.destroy).toHaveBeenCalled();
  });

  it('resumes after a bank sends you back, and resolves null when closed', async () => {
    const result = openPlaidLink(
      'link-1',
      'https://mini.example.ts.net/bank/oauth?oauth_state_id=x',
    );
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    expect(config.receivedRedirectUri).toBe(
      'https://mini.example.ts.net/bank/oauth?oauth_state_id=x',
    );
    config.onExit(null);
    await expect(result).resolves.toBeNull();
  });

  it('rejects with the bank’s message when it fails', async () => {
    const result = openPlaidLink('link-1');
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    config.onExit({ error_message: 'internal', display_message: 'The bank is down.' });
    await expect(result).rejects.toThrow('The bank is down.');

    const second = openPlaidLink('link-2');
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalledTimes(2));
    config.onExit({ error_message: 'internal' });
    await expect(second).rejects.toThrow('internal');
  });

  it('loads Plaid’s script when it isn’t loaded yet, and explains when it can’t', async () => {
    delete window.Plaid;
    const result = openPlaidLink('link-1');
    const script = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT_URL}"]`);
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event('error'));
    await expect(result).rejects.toThrow('Couldn’t load Plaid’s sign-in');
    expect(document.querySelector(`script[src="${PLAID_SCRIPT_URL}"]`)).toBeNull();
  });
});
