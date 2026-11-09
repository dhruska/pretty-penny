import type { Transaction, TransactionInput } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { amountFromFields, centsToInput } from '@/lib/money';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';
import { CategorySelect } from './CategorySelect';

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
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? null);
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
      await onSubmit({ date, payee, memo, categoryId, amountCents: result.cents });
      if (!transaction) {
        setPayee('');
        setCategoryId(null);
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

  function textField(
    name: string,
    value: string,
    onChange: (value: string) => void,
    props?: ComponentProps<typeof Input>,
  ) {
    return (
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${id}-${name}`}>{name}</Label>
        <Input
          id={`${id}-${name}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...props}
        />
      </div>
    );
  }

  return (
    <form aria-label={label} onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[9.5rem_1fr_1.3fr_1fr_5.5rem_5.5rem]">
        <div className="col-span-2 space-y-1 lg:col-span-1">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {textField('Payee', payee, setPayee, { maxLength: 200 })}
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-category`}>Category</Label>
          <CategorySelect id={`${id}-category`} value={categoryId} onChange={setCategoryId} />
        </div>
        <div className="col-span-2 lg:col-span-1">
          {textField('Memo', memo, setMemo, { maxLength: 500 })}
        </div>
        {textField('Outflow', outflow, setOutflow, { inputMode: 'decimal' })}
        {textField('Inflow', inflow, setInflow, { inputMode: 'decimal' })}
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
