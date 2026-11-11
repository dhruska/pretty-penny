import { api, type Account, type Transaction, type TransactionInput } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { amountFromFields, centsToInput } from '@/lib/money';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';
import { CategorySelect, SELECT_CLASS } from './CategorySelect';

interface TransactionFormProps {
  label: string;
  submitLabel: string;
  account: Account;
  transaction?: Transaction;
  onSubmit: (input: TransactionInput) => Promise<void>;
  onCancel?: () => void;
}

export function TransactionForm({
  label,
  submitLabel,
  account,
  transaction,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const id = useId();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const amount = transaction?.amountCents ?? 0;
  const [date, setDate] = useState(transaction?.date ?? today());
  const [transferAccountId, setTransferAccountId] = useState(
    transaction?.transferAccountId ?? null,
  );
  const [payee, setPayee] = useState(transaction?.payee ?? '');
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? null);
  // Choosing a payee fills in its usual category, unless a category was already chosen.
  const [categoryChosen, setCategoryChosen] = useState(transaction !== undefined);
  const payees = useQuery({ queryKey: ['payees'], queryFn: api.listPayees });
  const [memo, setMemo] = useState(transaction?.memo ?? '');
  const [outflow, setOutflow] = useState(amount < 0 ? centsToInput(amount) : '');
  const [inflow, setInflow] = useState(amount > 0 ? centsToInput(amount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // A closed account stays listed only if this transaction already transfers to it.
  const transferOptions = (accounts.data ?? []).filter(
    (option) =>
      option.id !== account.id && (!option.closed || option.id === transaction?.transferAccountId),
  );
  const transferAccount = transferOptions.find((option) => option.id === transferAccountId);
  const isTransfer = transferAccountId !== null;
  // Only money entering or leaving the budget gets a category.
  const usesCategory = isTransfer
    ? transferAccount !== undefined && transferAccount.onBudget !== account.onBudget
    : account.onBudget;

  function choosePayee(value: string) {
    setPayee(value);
    if (categoryChosen) return;
    const match = payees.data?.find(
      (option) => option.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match?.defaultCategoryId != null) setCategoryId(match.defaultCategoryId);
  }

  function chooseCategory(value: number | null) {
    setCategoryChosen(true);
    setCategoryId(value);
  }

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
      await onSubmit({
        date,
        payee: isTransfer ? '' : payee,
        memo,
        categoryId: usesCategory ? categoryId : null,
        transferAccountId,
        amountCents: result.cents,
      });
      if (!transaction) {
        setTransferAccountId(null);
        setPayee('');
        setCategoryId(null);
        setCategoryChosen(false);
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[9rem_10rem_1fr_1.2fr_1fr_5.5rem_5.5rem]">
        <div className="col-span-2 space-y-1 md:col-span-1">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-transfer`}>Transfer</Label>
          <select
            id={`${id}-transfer`}
            className={SELECT_CLASS}
            value={transferAccountId ?? ''}
            onChange={(event) =>
              setTransferAccountId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">Not a transfer</option>
            {transferOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        {isTransfer
          ? textField('Payee', `Transfer: ${transferAccount?.name ?? ''}`, () => {}, {
              disabled: true,
            })
          : textField('Payee', payee, choosePayee, {
              maxLength: 200,
              list: `${id}-payees`,
              autoComplete: 'off',
            })}
        <datalist id={`${id}-payees`}>
          {payees.data?.map((option) => (
            <option key={option.id} value={option.name} />
          ))}
        </datalist>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-category`}>Category</Label>
          {usesCategory ? (
            <CategorySelect id={`${id}-category`} value={categoryId} onChange={chooseCategory} />
          ) : (
            <select id={`${id}-category`} className={SELECT_CLASS} disabled>
              <option>Not needed</option>
            </select>
          )}
        </div>
        <div className="col-span-2 md:col-span-2 xl:col-span-1">
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
