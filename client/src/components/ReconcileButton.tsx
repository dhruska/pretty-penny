import { api, type Account } from '@/api';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { notify } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { centsToInput, formatCents, parseDollars } from '@/lib/money';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Money } from './Money';

/** Reconciles an account against the bank, following YNAB's two-step flow. */
export function ReconcileButton({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'ask' | 'enter'>('ask');
  const [bankBalance, setBankBalance] = useState('');

  const reconcile = useMutation({
    mutationFn: (bankBalanceCents: number) =>
      api.reconcileAccount(account.id, bankBalanceCents, today()),
    onSuccess: ({ adjustmentCents }) => {
      setIsOpen(false);
      refresh(queryClient, 'transactions');
      notify(
        adjustmentCents === 0
          ? `${account.name} reconciled`
          : `${account.name} reconciled, with a ${formatCents(adjustmentCents)} adjustment`,
      );
    },
  });

  const clearedCents = account.clearedBalanceCents;
  const bankCents = bankBalance.trim() === '' ? null : parseDollars(bankBalance);
  const differenceCents = bankCents === null ? null : bankCents - clearedCents;

  function open(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (nextOpen) {
      setStep('ask');
      setBankBalance('');
      reconcile.reset();
    }
  }

  function handleFinish(event: FormEvent) {
    event.preventDefault();
    if (bankCents !== null) reconcile.mutate(bankCents);
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={open}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reconcile
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reconcile {account.name}</AlertDialogTitle>
          <AlertDialogDescription>
            {step === 'ask'
              ? `Is your bank’s current balance for this account ${formatCents(clearedCents)}? Compare it with the balance your bank shows, leaving out pending transactions.`
              : 'Enter the balance your bank shows, leaving out pending transactions.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {reconcile.isError && <p className="text-sm text-negative">{reconcile.error.message}</p>}

        {step === 'ask' ? (
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={() => {
                // A linked account starts from the balance the bank last gave Plaid.
                const fromBank = account.bank?.balanceCents;
                if (fromBank !== null && fromBank !== undefined) {
                  setBankBalance(`${fromBank < 0 ? '-' : ''}${centsToInput(fromBank)}`);
                }
                setStep('enter');
              }}
            >
              No
            </Button>
            <Button disabled={reconcile.isPending} onClick={() => reconcile.mutate(clearedCents)}>
              Yes
            </Button>
          </AlertDialogFooter>
        ) : (
          <form onSubmit={handleFinish} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor={`reconcile-${account.id}-bank`}>Bank balance</Label>
              <Input
                id={`reconcile-${account.id}-bank`}
                inputMode="decimal"
                placeholder="0.00"
                autoFocus
                value={bankBalance}
                onChange={(event) => setBankBalance(event.target.value)}
              />
            </div>
            <p aria-label="Difference" className="text-sm">
              Difference{' '}
              {differenceCents === null ? (
                <span className="text-muted-foreground">–</span>
              ) : (
                <Money cents={differenceCents} className="font-medium" />
              )}
            </p>
            {differenceCents !== null && differenceCents !== 0 && (
              <p className="text-sm text-muted-foreground">
                Finishing adds a Reconciliation Balance Adjustment for the difference. If you’d
                rather find the missing transaction first, go back and cancel.
              </p>
            )}
            <AlertDialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep('ask')}>
                Back
              </Button>
              <Button type="submit" disabled={bankCents === null || reconcile.isPending}>
                {differenceCents === 0 || differenceCents === null
                  ? 'Finish'
                  : 'Create adjustment and finish'}
              </Button>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
