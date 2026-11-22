import { api, type Account, type BankAccount } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bankAccountLabel, linkableAccounts } from '@/lib/bank';
import { notify, notifyError } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type FormEvent } from 'react';
import { AccountTypeSelect } from './AccountTypeSelect';
import { SELECT_CLASS } from './CategorySelect';
import { Money } from './Money';

const NEW_ACCOUNT = 'new';

/**
 * One account at a connected bank, with what it's linked to: an existing account, a new one
 * made from it, or nothing.
 */
export function BankAccountRow({
  bankAccount,
  accounts,
}: {
  bankAccount: BankAccount;
  accounts: Account[];
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(bankAccount.name);
  const [type, setType] = useState(bankAccount.suggestedType);
  const label = bankAccountLabel(bankAccount);

  const link = useMutation({
    mutationFn: (accountId: number | null) => api.linkBankAccount(bankAccount.id, accountId),
    onSuccess: (_connection, accountId) => {
      refresh(queryClient, 'bank');
      const linked = accounts.find((account) => account.id === accountId);
      notify(linked ? `${label} linked to ${linked.name}` : `${label} unlinked`);
    },
    onError: notifyError,
  });

  const create = useMutation({
    mutationFn: () => api.createAccountFromBank(bankAccount.id, { name: name.trim(), type }),
    onSuccess: () => {
      setCreating(false);
      refresh(queryClient, 'bank', 'accounts');
      notify(`${name.trim()} added and linked`);
    },
  });

  function choose(value: string) {
    if (value === NEW_ACCOUNT) {
      setName(bankAccount.name);
      setType(bankAccount.suggestedType);
      create.reset();
      setCreating(true);
    } else {
      setCreating(false);
      link.mutate(value === '' ? null : Number(value));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // The row can sit inside another form, such as a dialog's.
    event.stopPropagation();
    if (name.trim() !== '') create.mutate();
  }

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate font-medium" title={label}>
            {label}
          </p>
          <p className="text-sm text-muted-foreground">
            Bank balance{' '}
            {bankAccount.balanceCents === null ? (
              'not given'
            ) : (
              <Money cents={bankAccount.balanceCents} className="text-foreground" />
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 max-md:w-full">
          <Label htmlFor={`${id}-link`} className="shrink-0 text-sm text-muted-foreground">
            Linked to
          </Label>
          <select
            id={`${id}-link`}
            className={cn(SELECT_CLASS, 'w-52 max-md:flex-1')}
            value={creating ? NEW_ACCOUNT : String(bankAccount.accountId ?? '')}
            disabled={link.isPending}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">Not linked</option>
            {linkableAccounts(accounts, bankAccount.id).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            {bankAccount.accountId === null && <option value={NEW_ACCOUNT}>New account…</option>}
          </select>
        </div>
      </div>

      {creating && (
        <form
          aria-label={`New account for ${label}`}
          onSubmit={submit}
          className="space-y-3 rounded-lg border bg-muted/40 p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Account name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={100}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-type`}>Account type</Label>
              <AccountTypeSelect id={`${id}-type`} compact value={type} onChange={setType} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            It starts with the bank’s balance today as its starting balance.
          </p>
          {create.isError && <p className="text-sm text-negative">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || name.trim() === ''}>
              Add account
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
