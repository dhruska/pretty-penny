import { api, type Account } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { notify, notifyError } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AccountTypeSelect } from './AccountTypeSelect';
import { BankLinkSection } from './BankLinkSection';
import { ConfirmDelete } from './ConfirmDelete';

/**
 * An account's settings in one place, as in YNAB: its name and type, its bank link, and closing,
 * reopening or deleting it.
 */
export function EditAccountDialog({ account }: { account: Account }) {
  const id = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const changed = () => refresh(queryClient, 'accounts');

  const save = useMutation({
    mutationFn: () => api.updateAccount(account.id, { name: name.trim(), type }),
    onSuccess: () => {
      changed();
      setOpen(false);
      notify('Account saved');
    },
  });

  const setClosed = useMutation({
    mutationFn: (close: boolean) =>
      close ? api.closeAccount(account.id, today()) : api.reopenAccount(account.id),
    onSuccess: (_result, close) => {
      changed();
      setOpen(false);
      notify(close ? `${account.name} closed` : `${account.name} reopened`);
    },
    onError: notifyError,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: () => {
      setOpen(false);
      navigate('/');
      changed();
      notify(`${account.name} deleted`);
    },
    onError: notifyError,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() !== '') save.mutate();
  }

  const closeDescription =
    account.balanceCents === 0
      ? 'You can still view it, and reopen it later.'
      : `Its balance of ${formatCents(account.balanceCents)} will be zeroed with a Balance Adjustment transaction. You can still view it, and reopen it later.`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Each opening starts from the account as it is.
        if (next) {
          setName(account.name);
          setType(account.type);
          save.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 aria-hidden="true" className="size-4" />
          Edit account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader title="Edit account" />
        <form aria-label="Account settings" onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-name`}>Account name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-type`}>Account type</Label>
            {/* Only types on the same side, budget or tracking, as in YNAB. */}
            <AccountTypeSelect
              id={`${id}-type`}
              compact
              value={type}
              onBudget={account.onBudget}
              onChange={setType}
            />
          </div>
          {save.isError && <p className="text-sm text-negative">{save.error.message}</p>}
          <Button type="submit" className="w-full" disabled={save.isPending || name.trim() === ''}>
            Save
          </Button>
        </form>
        <BankLinkSection account={account} />
        <div className="mt-5 flex flex-wrap justify-between gap-2 border-t pt-4">
          {account.closed ? (
            <Button variant="outline" size="sm" onClick={() => setClosed.mutate(false)}>
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
            onConfirm={() => remove.mutate()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
