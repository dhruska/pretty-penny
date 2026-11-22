import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type BankConnection } from '@/api';
import { readPendingLink, savePendingLink } from './plaidLink';
import { finishLink } from './useBankLink';

const connection: BankConnection = {
  id: 4,
  institutionName: 'Northwind Bank',
  status: 'ok',
  problem: null,
  updatedAt: null,
  gettingTransactions: false,
  accounts: [],
};

afterEach(() => vi.restoreAllMocks());

describe('finishing a bank sign-in', () => {
  it('saves a new connection', async () => {
    const connect = vi.spyOn(api, 'connectBank').mockResolvedValue(connection);
    const pending = { token: 'link-1', connectionId: null };
    savePendingLink(pending);
    await expect(
      finishLink(pending, { publicToken: 'public-1', institutionName: 'Northwind Bank' }),
    ).resolves.toEqual({ kind: 'connected', connection });
    expect(connect).toHaveBeenCalledWith('public-1', 'Northwind Bank');
    expect(readPendingLink()).toBeNull();
  });

  it('checks a fixed connection again', async () => {
    const refresh = vi.spyOn(api, 'refreshBankConnection').mockResolvedValue(connection);
    await expect(
      finishLink(
        { token: 'link-1', connectionId: 4 },
        { publicToken: 'p', institutionName: undefined },
      ),
    ).resolves.toEqual({ kind: 'fixed', connection });
    expect(refresh).toHaveBeenCalledWith(4);
  });

  it('does nothing when the window was closed', async () => {
    const connect = vi.spyOn(api, 'connectBank');
    await expect(finishLink({ token: 'link-1', connectionId: null }, null)).resolves.toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
});
