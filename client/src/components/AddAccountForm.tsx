import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { parseDollars } from '@/lib/money';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AccountTypeSelect } from './AccountTypeSelect';

export function AddAccountForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [startingBalance, setStartingBalance] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createAccount = useMutation({
    mutationFn: api.createAccount,
    onSuccess: async (account) => {
      await queryClient.invalidateQueries();
      setName('');
      setStartingBalance('');
      navigate(`/accounts/${account.id}`);
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (name.trim() === '') {
      setError('Enter an account name.');
      return;
    }
    const startingBalanceCents = startingBalance.trim() === '' ? 0 : parseDollars(startingBalance);
    if (startingBalanceCents === null) {
      setError('Enter a valid starting balance, with at most two decimal places.');
      return;
    }

    setError(null);
    createAccount.mutate({ name, type, startingBalanceCents, date: today() });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3 border-t pt-4">
      <h2 className="text-sm font-medium">Add an account</h2>
      <div className="space-y-1">
        <Label htmlFor="account-name">Account name</Label>
        <Input
          id="account-name"
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="account-type">Account type</Label>
        <AccountTypeSelect id="account-type" value={type} onChange={setType} />
        <p className="text-xs text-muted-foreground">
          Budget accounts count toward your budget. Tracking accounts only count toward net worth,
          and this can’t be changed later.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="starting-balance">Starting balance</Label>
        <Input
          id="starting-balance"
          inputMode="decimal"
          placeholder="0.00"
          value={startingBalance}
          onChange={(event) => setStartingBalance(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button type="submit" className="w-full" disabled={createAccount.isPending}>
        Add account
      </Button>
    </form>
  );
}
