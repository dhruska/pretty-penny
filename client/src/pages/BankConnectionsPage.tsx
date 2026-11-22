import { api, type Account, type BankConnection } from '@/api';
import { BankAccountRow } from '@/components/BankAccountRow';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { SkeletonRows } from '@/components/ui/skeleton';
import { updatedAgo } from '@/lib/bank';
import { notify, notifyError } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useBankLink } from '@/lib/useBankLink';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

function ConnectionCard({
  connection,
  accounts,
  onFix,
  fixing,
}: {
  connection: BankConnection;
  accounts: Account[];
  onFix: () => void;
  fixing: boolean;
}) {
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: () => api.refreshBankConnection(connection.id),
    onSuccess: (updated) => {
      refresh(queryClient, 'bank');
      if (updated.status === 'ok') notify(`${updated.institutionName} updated`);
    },
    onError: notifyError,
  });

  const remove = useMutation({
    mutationFn: () => api.removeBankConnection(connection.id),
    onSuccess: () => {
      refresh(queryClient, 'bank');
      notify(`${connection.institutionName} removed`);
    },
    onError: notifyError,
  });

  return (
    <section
      aria-label={connection.institutionName}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{connection.institutionName}</h3>
          <p className="text-sm text-muted-foreground">
            {connection.gettingTransactions
              ? `Getting transactions from ${connection.institutionName}…`
              : updatedAgo(connection.updatedAt)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          <RefreshCw aria-hidden="true" className="size-4" strokeWidth={1.75} />
          Update now
        </Button>
      </header>

      {connection.status !== 'ok' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative-soft p-3 text-sm"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-negative" />
            {connection.problem}
          </p>
          <Button size="sm" disabled={fixing} onClick={onFix}>
            Fix connection
          </Button>
        </div>
      )}

      {connection.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Plaid found no accounts at this bank.</p>
      ) : (
        <ul className="divide-y">
          {connection.accounts.map((bankAccount) => (
            <BankAccountRow key={bankAccount.id} bankAccount={bankAccount} accounts={accounts} />
          ))}
        </ul>
      )}

      <div className="flex justify-end border-t pt-3">
        <ConfirmDelete
          triggerLabel="Remove connection"
          title={`Remove ${connection.institutionName}?`}
          description="Pretty Penny stops getting updates from this bank and unlinks its accounts. The accounts and their transactions stay. On Plaid’s free plan, the login it used isn’t given back."
          confirmLabel="Remove connection"
          onConfirm={() => remove.mutate()}
        />
      </div>
    </section>
  );
}

/** Shown right after connecting a bank, to link each of its accounts. */
function LinkAccountsDialog({
  connection,
  accounts,
  onClose,
}: {
  connection: BankConnection | undefined;
  accounts: Account[];
  onClose: () => void;
}) {
  return (
    <Dialog open={connection !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader title={`Link ${connection?.institutionName ?? ''} accounts`} />
        <p className="text-sm text-muted-foreground">
          Choose the Pretty Penny account for each, add a new one, or leave it unlinked. You can
          change this later.
        </p>
        <ul className="mt-2 max-h-[60svh] divide-y overflow-y-auto">
          {connection?.accounts.map((bankAccount) => (
            <BankAccountRow key={bankAccount.id} bankAccount={bankAccount} accounts={accounts} />
          ))}
        </ul>
        <Button className="mt-3 w-full" onClick={onClose}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function BankConnectionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useQuery({ queryKey: ['bank-connections', 'status'], queryFn: api.bankStatus });
  const connections = useQuery({
    queryKey: ['bank-connections', 'list'],
    queryFn: api.listBankConnections,
    enabled: status.data?.configured === true,
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  // A bank that signed you in on its own site comes back here with the new connection's ID.
  const returnedId = (location.state as { linkConnectionId?: number } | null)?.linkConnectionId;
  const [linkingId, setLinkingId] = useState<number | undefined>(returnedId);
  const linking = connections.data?.find((connection) => connection.id === linkingId);

  const bankLink = useBankLink((connection) => setLinkingId(connection.id));

  if (status.isPending) return <SkeletonRows rows={4} label="Loading bank connections" />;
  if (status.isError) return <p className="text-negative">{status.error.message}</p>;

  const heading = <h2 className="text-2xl font-semibold">Bank connections</h2>;

  if (!status.data.configured) {
    return (
      <div className="space-y-5">
        {heading}
        <EmptyState Icon={Landmark} title="Bank sync isn’t set up">
          Add your Plaid settings to .env on the computer running Pretty Penny, as the Bank sync
          section of docs/self-hosting.md explains, then restart it.
        </EmptyState>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {status.data.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }

  const connectButton = (
    <Button disabled={bankLink.isPending} onClick={() => bankLink.mutate(null)}>
      <Plus aria-hidden="true" className="size-4" />
      Connect a bank
    </Button>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {heading}
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {status.data.environment === 'sandbox'
              ? 'Using Plaid’s Sandbox: only Plaid’s test banks, with made-up data.'
              : 'Plaid’s free plan allows 10 bank logins in all. Removing a connection doesn’t give its login back, so use Fix connection when one stops working.'}
          </p>
        </div>
        {connections.data && connections.data.length > 0 && connectButton}
      </header>

      {connections.isPending && <SkeletonRows rows={4} label="Loading bank connections" />}
      {connections.isError && <p className="text-negative">{connections.error.message}</p>}
      {connections.data?.length === 0 && (
        <EmptyState Icon={Landmark} title="No banks connected" action={connectButton}>
          Connect a bank through Plaid to link its accounts and see their balances. You sign in to
          your bank in Plaid’s window; Pretty Penny never sees your password.
        </EmptyState>
      )}
      {connections.data?.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          accounts={accounts.data ?? []}
          fixing={bankLink.isPending}
          onFix={() => bankLink.mutate(connection.id)}
        />
      ))}

      <LinkAccountsDialog
        connection={linking}
        accounts={accounts.data ?? []}
        onClose={() => {
          setLinkingId(undefined);
          if (returnedId) navigate('/bank', { replace: true, state: null });
        }}
      />
    </div>
  );
}
