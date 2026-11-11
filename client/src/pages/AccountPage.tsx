import { api, type Account, type TransactionInput } from '@/api';
import { AccountTypeSelect } from '@/components/AccountTypeSelect';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { Money } from '@/components/Money';
import { ReconcileButton } from '@/components/ReconcileButton';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionRegister } from '@/components/TransactionRegister';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { accountTypeLabel } from '@/lib/accountTypes';
import { today } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { matchesFilter } from '@/lib/transactions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

export function AccountPage() {
  const accountId = Number(useParams().id);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const account = accounts.data?.find((candidate) => candidate.id === accountId);

  if (accounts.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (accounts.isError) return <p className="text-negative">{accounts.error.message}</p>;
  if (!account) return <p className="text-muted-foreground">Account not found.</p>;

  // The key resets edit state when switching between accounts.
  return <AccountDetails key={account.id} account={account} />;
}

function AccountDetails({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(account.name);
  const [filter, setFilter] = useState('');

  const transactions = useQuery({
    queryKey: ['transactions', account.id],
    queryFn: () => api.listTransactions(account.id),
  });

  const invalidate = () => queryClient.invalidateQueries();

  const update = useMutation({
    mutationFn: (changes: { name?: string; type?: string }) =>
      api.updateAccount(account.id, changes),
    onSuccess: async () => {
      await invalidate();
      setIsRenaming(false);
    },
  });

  const setClosed = useMutation({
    mutationFn: (close: boolean) =>
      close ? api.closeAccount(account.id, today()) : api.reopenAccount(account.id),
    onSuccess: invalidate,
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: async () => {
      navigate('/');
      await invalidate();
    },
  });

  async function addTransaction(input: TransactionInput) {
    await api.createTransaction(account.id, input);
    await invalidate();
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (name.trim() !== '') update.mutate({ name });
  }

  const actionError = update.error ?? setClosed.error ?? deleteAccount.error;
  const closeDescription =
    account.balanceCents === 0
      ? 'You can still view it, and reopen it later.'
      : `Its balance of ${formatCents(account.balanceCents)} will be zeroed with a Balance Adjustment transaction. You can still view it, and reopen it later.`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {isRenaming ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              aria-label="Account name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(account.name);
                setIsRenaming(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div>
            <h2 className="text-2xl font-semibold">{account.name}</h2>
            <p className="text-sm text-muted-foreground">
              {accountTypeLabel(account.type)} · {account.onBudget ? 'Budget' : 'Tracking'}
              {account.closed && ' · Closed'}
            </p>
            <section
              aria-label="Balances"
              className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
            >
              <span>
                <span className="text-muted-foreground">Cleared </span>
                <Money cents={account.clearedBalanceCents} />
              </span>
              <span className="text-muted-foreground">+</span>
              <span>
                <span className="text-muted-foreground">Uncleared </span>
                <Money cents={account.balanceCents - account.clearedBalanceCents} />
              </span>
              <span className="text-muted-foreground">=</span>
              <span>
                <span className="text-muted-foreground">Working </span>
                <Money cents={account.balanceCents} className="text-lg font-medium" />
              </span>
            </section>
            <p className="mt-1 text-xs text-muted-foreground">
              {account.lastReconciledAt
                ? `Last reconciled ${new Date(account.lastReconciledAt).toLocaleDateString()}`
                : 'Not reconciled yet'}
            </p>
          </div>
        )}
        {!isRenaming && (
          <div className="flex flex-wrap items-center gap-1">
            <AccountTypeSelect
              label="Change account type"
              compact
              className="h-8 w-40"
              value={account.type}
              onBudget={account.onBudget}
              onChange={(type) => update.mutate({ type })}
            />
            {!account.closed && <ReconcileButton account={account} />}
            <Button variant="ghost" size="sm" onClick={() => setIsRenaming(true)}>
              Rename
            </Button>
            {account.closed ? (
              <Button variant="ghost" size="sm" onClick={() => setClosed.mutate(false)}>
                Reopen account
              </Button>
            ) : (
              <ConfirmDelete
                triggerLabel="Close account"
                title={`Close ${account.name}?`}
                description={closeDescription}
                confirmLabel="Close account"
                destructive={false}
                onConfirm={() => setClosed.mutate(true)}
              />
            )}
            <ConfirmDelete
              triggerLabel="Delete account"
              title={`Delete ${account.name}?`}
              description="Only accounts with no transactions other than a starting balance can be deleted."
              onConfirm={() => deleteAccount.mutate()}
            />
          </div>
        )}
      </header>

      {actionError && <p className="text-sm text-negative">{actionError.message}</p>}

      {account.closed ? (
        <p className="rounded-lg border bg-muted p-3 text-sm">
          This account is closed. Reopen it to add transactions.
        </p>
      ) : (
        <section className="rounded-lg border bg-card p-3">
          <TransactionForm
            label="Add transaction"
            submitLabel="Add transaction"
            account={account}
            onSubmit={addTransaction}
          />
        </section>
      )}

      {transactions.isPending && <p className="text-muted-foreground">Loading…</p>}
      {transactions.isError && <p className="text-negative">{transactions.error.message}</p>}
      {transactions.isSuccess && (
        <div className="space-y-2">
          <Input
            aria-label="Filter transactions"
            placeholder="Filter transactions"
            className="h-8 max-w-64"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <TransactionRegister
            transactions={transactions.data.filter((row) => matchesFilter(row, filter))}
            emptyMessage={filter ? 'No transactions match.' : undefined}
          />
        </div>
      )}
    </div>
  );
}
