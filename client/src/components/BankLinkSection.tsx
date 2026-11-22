import { api, type Account } from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { bankAccountLabel } from '@/lib/bank';
import { notify } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { SELECT_CLASS } from './CategorySelect';

/** Linking an account to a bank account, or unlinking it, from Edit account. */
export function BankLinkSection({ account }: { account: Account }) {
  const id = useId();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['bank-connections', 'status'], queryFn: api.bankStatus });
  const connections = useQuery({
    queryKey: ['bank-connections', 'list'],
    queryFn: api.listBankConnections,
    enabled: status.data?.configured === true,
  });
  const [choice, setChoice] = useState('');

  const link = useMutation({
    mutationFn: (change: { bankAccountId: number; accountId: number | null }) =>
      api.linkBankAccount(change.bankAccountId, change.accountId),
    onSuccess: (_connection, change) => {
      refresh(queryClient, 'bank');
      setChoice('');
      notify(change.accountId === null ? `${account.name} unlinked` : `${account.name} linked`);
    },
  });

  if (!status.data?.configured || account.closed) return null;

  const unlinked = (connections.data ?? []).flatMap((connection) =>
    connection.accounts
      .filter((bankAccount) => bankAccount.accountId === null)
      .map((bankAccount) => ({
        id: bankAccount.id,
        label: `${connection.institutionName}: ${bankAccountLabel(bankAccount)}`,
      })),
  );

  return (
    <section aria-label="Bank" className="mt-5 space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">Bank</h3>
      {account.bank ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="min-w-0">
            Linked to {account.bank.institutionName}
            {account.bank.mask && ` ••${account.bank.mask}`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={link.isPending}
            onClick={() =>
              link.mutate({ bankAccountId: account.bank!.bankAccountId, accountId: null })
            }
          >
            Unlink
          </Button>
        </div>
      ) : unlinked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bank accounts to link.{' '}
          <Link to="/bank" className="font-medium text-accent-ink underline">
            Connect a bank
          </Link>
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${id}-bank`}>Bank account</Label>
            <select
              id={`${id}-bank`}
              className={cn(SELECT_CLASS, 'w-full')}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">Choose…</option>
              {unlinked.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            disabled={choice === '' || link.isPending}
            onClick={() => link.mutate({ bankAccountId: Number(choice), accountId: account.id })}
          >
            Link
          </Button>
        </div>
      )}
      {link.isError && <p className="text-sm text-negative">{link.error.message}</p>}
    </section>
  );
}
