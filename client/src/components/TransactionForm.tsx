import type { Transaction, TransactionInput } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { amountFromFields, centsToInput } from '@/lib/money';
import { useId, useState, type FormEvent } from 'react';

interface TransactionFormProps {
  label: string;
  submitLabel: string;
  transaction?: Transaction;
  onSubmit: (input: TransactionInput) => Promise<void>;
  onCancel?: () => void;
}

export function TransactionForm({
  label,
  submitLabel,
  transaction,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const id = useId();
  const amount = transaction?.amountCents ?? 0;
  const [date, setDate] = useState(transaction?.date ?? today());
  const [payee, setPayee] = useState(transaction?.payee ?? '');
  const [memo, setMemo] = useState(transaction?.memo ?? '');
  const [outflow, setOutflow] = useState(amount < 0 ? centsToInput(amount) : '');
  const [inflow, setInflow] = useState(amount > 0 ? centsToInput(amount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = amountFromFields(outflow, inflow);
    if (result.error !== undefined) {
      setError(result.error);
      return;
    }
    if (date === '') {
      setError('Enter a date.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSubmit({ date, payee, memo, amountCents: result.cents });
      if (!transaction) {
        setPayee('');
        setMemo('');
        setOutflow('');
        setInflow('');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Couldn’t save.');
    } finally {
      setIsSaving(false);
    }
  }

  const fields = [
    { name: 'Payee', value: payee, onChange: setPayee, maxLength: 200 },
    { name: 'Memo', value: memo, onChange: setMemo, maxLength: 500 },
    { name: 'Outflow', value: outflow, onChange: setOutflow, inputMode: 'decimal' as const },
    { name: 'Inflow', value: inflow, onChange: setInflow, inputMode: 'decimal' as const },
  ];

  return (
    <form aria-label={label} onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[10rem_1fr_1fr_7rem_7rem]">
        <div className="col-span-2 space-y-1 lg:col-span-1">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {fields.map(({ name, onChange, ...input }) => (
          <div key={name} className="space-y-1">
            <Label htmlFor={`${id}-${name}`}>{name}</Label>
            <Input
              id={`${id}-${name}`}
              {...input}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
