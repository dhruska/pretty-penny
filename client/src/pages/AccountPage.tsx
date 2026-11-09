import { api, type Account, type TransactionInput } from '@/api';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { Money } from '@/components/Money';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionRegister } from '@/components/TransactionRegister';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  const transactions = useQuery({
    queryKey: ['transactions', account.id],
    queryFn: () => api.listTransactions(account.id),
  });

  const rename = useMutation({
    mutationFn: (newName: string) => api.renameAccount(account.id, newName),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      setIsRenaming(false);
    },
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: async () => {
      navigate('/');
      await queryClient.invalidateQueries();
    },
  });

  async function addTransaction(input: TransactionInput) {
    await api.createTransaction(account.id, input);
    await queryClient.invalidateQueries();
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (name.trim() !== '') rename.mutate(name);
  }

  const actionError = rename.error ?? deleteAccount.error;

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
            <Button type="submit" size="sm" disabled={rename.isPending}>
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
            <Money cents={account.balanceCents} className="text-lg" />
          </div>
        )}
        {!isRenaming && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setIsRenaming(true)}>
              Rename
            </Button>
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

      <section className="rounded-lg border bg-card p-3">
        <TransactionForm
          label="Add transaction"
          submitLabel="Add transaction"
          onSubmit={addTransaction}
        />
      </section>

      {transactions.isPending && <p className="text-muted-foreground">Loading…</p>}
      {transactions.isError && <p className="text-negative">{transactions.error.message}</p>}
      {transactions.isSuccess && <TransactionRegister transactions={transactions.data} />}
    </div>
  );
}
