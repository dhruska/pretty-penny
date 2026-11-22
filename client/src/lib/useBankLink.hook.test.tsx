import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type BankConnection } from '@/api';
import { readPendingLink } from './plaidLink';
import { useBankLink, useLinkOutcome } from './useBankLink';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const connection = (changes: Partial<BankConnection> = {}): BankConnection => ({
  id: 4,
  institutionName: 'Northwind Bank',
  status: 'ok',
  problem: null,
  updatedAt: null,
  gettingTransactions: false,
  accounts: [],
  ...changes,
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** Plaid's sign-in window, finishing as `finish` says once opened. */
let finish: (config: Parameters<NonNullable<Window['Plaid']>['create']>[0]) => void;

beforeEach(() => {
  queryClient = new QueryClient();
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  window.Plaid = {
    create: (config) => ({ open: () => finish(config), destroy: () => {} }),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete window.Plaid;
  localStorage.clear();
});

describe('after the sign-in window', () => {
  it('confirms a new connection and opens linking', () => {
    const onConnected = vi.fn();
    const { result } = renderHook(() => useLinkOutcome(onConnected), { wrapper });
    result.current({ kind: 'connected', connection: connection() });
    expect(toast.success).toHaveBeenCalledWith('Northwind Bank connected');
    expect(onConnected).toHaveBeenCalledWith(connection());
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bank-connections'] });
  });

  it('confirms a fix, or says what still needs fixing', () => {
    const { result } = renderHook(() => useLinkOutcome(vi.fn()), { wrapper });
    result.current({ kind: 'fixed', connection: connection() });
    expect(toast.success).toHaveBeenCalledWith('Northwind Bank fixed');

    result.current({
      kind: 'fixed',
      connection: connection({ status: 'needs_sign_in', problem: 'Sign in again.' }),
    });
    expect(toast.error).toHaveBeenCalledWith('Sign in again.');

    result.current({ kind: 'fixed', connection: connection({ status: 'error' }) });
    expect(toast.error).toHaveBeenLastCalledWith('The connection still needs fixing.');
  });

  it('does nothing when the window was closed', () => {
    const { result } = renderHook(() => useLinkOutcome(vi.fn()), { wrapper });
    result.current(null);
    expect(toast.success).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('connecting or fixing a bank', () => {
  it('opens Plaid’s window with a new token, saves the bank and forgets the pending sign-in', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue({ linkToken: 'link-1' });
    const connect = vi.spyOn(api, 'connectBank').mockResolvedValue(connection());
    finish = (config) => {
      expect(config.token).toBe('link-1');
      // Remembered while the window is open, for banks that send you back to the app.
      expect(readPendingLink()).toEqual({ token: 'link-1', connectionId: null });
      config.onSuccess('public-1', { institution: { name: 'Northwind Bank' } });
    };
    const onConnected = vi.fn();
    const { result } = renderHook(() => useBankLink(onConnected), { wrapper });

    act(() => result.current.mutate(null));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(connect).toHaveBeenCalledWith('public-1', 'Northwind Bank');
    expect(readPendingLink()).toBeNull();
  });

  it('fixes a connection using its ID', async () => {
    const createToken = vi.spyOn(api, 'createLinkToken').mockResolvedValue({ linkToken: 'link-2' });
    const refresh = vi.spyOn(api, 'refreshBankConnection').mockResolvedValue(connection());
    finish = (config) => config.onSuccess('public-2', {});
    const { result } = renderHook(() => useBankLink(vi.fn()), { wrapper });

    act(() => result.current.mutate(4));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Northwind Bank fixed'));
    expect(createToken).toHaveBeenCalledWith(4);
    expect(refresh).toHaveBeenCalledWith(4);
  });

  it('explains a sign-in the bank refused, and forgets it', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue({ linkToken: 'link-3' });
    finish = (config) => config.onExit({ display_message: 'The bank is down.' });
    const { result } = renderHook(() => useBankLink(vi.fn()), { wrapper });

    act(() => result.current.mutate(null));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The bank is down.'));
    expect(readPendingLink()).toBeNull();
  });
});
