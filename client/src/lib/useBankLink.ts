import { api, type BankConnection } from '@/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notify, notifyError } from './notify';
import {
  clearPendingLink,
  openPlaidLink,
  savePendingLink,
  type LinkResult,
  type PendingLink,
} from './plaidLink';
import { refresh } from './queries';

export type LinkOutcome = { kind: 'connected' | 'fixed'; connection: BankConnection } | null;

/** Saves what Plaid's sign-in window did: a new connection, or a fixed one. Null if closed. */
export async function finishLink(
  pending: PendingLink,
  result: LinkResult | null,
): Promise<LinkOutcome> {
  clearPendingLink();
  if (!result) return null;
  if (pending.connectionId === null) {
    return {
      kind: 'connected',
      connection: await api.connectBank(result.publicToken, result.institutionName),
    };
  }
  return { kind: 'fixed', connection: await api.refreshBankConnection(pending.connectionId) };
}

/** Says what happened after the sign-in window, and refreshes what it changed. */
export function useLinkOutcome(onConnected: (connection: BankConnection) => void) {
  const queryClient = useQueryClient();
  return (outcome: LinkOutcome) => {
    if (!outcome) return;
    refresh(queryClient, 'bank');
    const { connection } = outcome;
    if (outcome.kind === 'connected') {
      notify(`${connection.institutionName} connected`);
      onConnected(connection);
    } else if (connection.status === 'ok') {
      notify(`${connection.institutionName} fixed`);
    } else {
      notifyError(new Error(connection.problem ?? 'The connection still needs fixing.'));
    }
  };
}

/**
 * Opens Plaid's sign-in window to connect a bank, or with a connection's ID, to fix it. Banks
 * that sign you in on their own site come back through /bank/oauth instead.
 */
export function useBankLink(onConnected: (connection: BankConnection) => void) {
  const handleOutcome = useLinkOutcome(onConnected);
  return useMutation({
    mutationFn: async (connectionId: number | null) => {
      const { linkToken } = await api.createLinkToken(connectionId ?? undefined);
      const pending = { token: linkToken, connectionId };
      savePendingLink(pending);
      try {
        return await finishLink(pending, await openPlaidLink(linkToken));
      } finally {
        clearPendingLink();
      }
    },
    onSuccess: handleOutcome,
    onError: notifyError,
  });
}
