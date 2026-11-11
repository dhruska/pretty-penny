import {
  api,
  type Account,
  type Frequency,
  type LineInput,
  type TransactionDraft,
  type TransactionInput,
} from '@/api';
import { FREQUENCY_OPTIONS } from '@/lib/frequencies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { today } from '@/lib/dates';
import { amountFromFields, centsToInput, formatCents } from '@/lib/money';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';
import { CategorySelect, SELECT_CLASS } from './CategorySelect';
import {
  amountToFields,
  lineCents,
  newLineKey,
  SplitLinesEditor,
  type SplitLineFields,
} from './SplitLinesEditor';

interface TransactionFormProps {
  label: string;
  submitLabel: string;
  account: Account;
  transaction?: TransactionDraft;
  /** Offers a Repeat choice, for new transactions and schedules. */
  allowRepeat?: boolean;
  initialFrequency?: Frequency;
  /** `frequency` is null when the transaction doesn't repeat. */
  onSubmit: (input: TransactionInput, frequency: Frequency | null) => Promise<void>;
  onCancel?: () => void;
}

export function TransactionForm({
  label,
  submitLabel,
  account,
  transaction,
  allowRepeat = false,
  initialFrequency,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const id = useId();
  const [frequency, setFrequency] = useState<Frequency | null>(initialFrequency ?? null);
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
  const [splitLines, setSplitLines] = useState<SplitLineFields[] | null>(() =>
    transaction && transaction.lines.length > 1
      ? transaction.lines.map((line) => ({
          key: newLineKey(),
          categoryId: line.categoryId,
          memo: line.memo,
          ...amountToFields(line.amountCents),
        }))
      : null,
  );

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
  // As in YNAB, only regular transactions in budget accounts can be split.
  const canSplit = !isTransfer && account.onBudget;
  const isSplit = canSplit && splitLines !== null;
  const total = amountFromFields(outflow, inflow);
  const totalCents = total.error === undefined ? total.cents : null;

  function startSplit() {
    setSplitLines([
      {
        key: newLineKey(),
        categoryId,
        memo: '',
        ...amountToFields(totalCents ?? 0),
      },
      { key: newLineKey(), categoryId: null, memo: '', outflow: '', inflow: '' },
    ]);
  }

  function useOneCategory() {
    setCategoryId(splitLines?.[0]?.categoryId ?? null);
    setSplitLines(null);
  }

  /** The split lines to send, or an error message if they aren't ready. */
  function splitInput(amount: number): LineInput[] | string {
    const amounts = splitLines!.map(lineCents);
    const invalid = amounts.findIndex((cents) => cents === null);
    if (invalid !== -1) {
      const line = splitLines![invalid]!;
      return `Line ${invalid + 1}: ${amountFromFields(line.outflow, line.inflow).error}`;
    }

    const remaining = amount - amounts.reduce<number>((sum, cents) => sum + cents!, 0);
    if (remaining !== 0) {
      return `${formatCents(remaining)} is left to assign. Add it to a line or use Spread remaining.`;
    }

    // Lines left blank are dropped rather than saved as zero.
    const lines = splitLines!.flatMap((line, index) =>
      amounts[index] === 0
        ? []
        : [{ categoryId: line.categoryId, memo: line.memo, amountCents: amounts[index]! }],
    );
    if (lines.length < 2) return 'A split needs at least two lines with amounts.';
    return lines;
  }

  function choosePayee(value: string) {
    setPayee(value);
    if (categoryChosen || isSplit) return;
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
    const lines = isSplit ? splitInput(result.cents) : undefined;
    if (typeof lines === 'string') {
      setError(lines);
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSubmit(
        {
          date,
          payee: isTransfer ? '' : payee,
          memo,
          ...(lines ? { lines } : { categoryId: usesCategory ? categoryId : null }),
          transferAccountId,
          amountCents: result.cents,
        },
        frequency,
      );
      if (!transaction) {
        setFrequency(initialFrequency ?? null);
        setTransferAccountId(null);
        setPayee('');
        setCategoryId(null);
        setCategoryChosen(false);
        setSplitLines(null);
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
      <div
        className={cn(
          'grid grid-cols-2 gap-2 md:grid-cols-4',
          allowRepeat
            ? 'xl:grid-cols-[9rem_9rem_9rem_1fr_1.2fr_1fr_5.5rem_5.5rem]'
            : 'xl:grid-cols-[9rem_10rem_1fr_1.2fr_1fr_5.5rem_5.5rem]',
        )}
      >
        <div className="col-span-2 space-y-1 md:col-span-1">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {allowRepeat && (
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-repeat`}>Repeat</Label>
            <select
              id={`${id}-repeat`}
              className={SELECT_CLASS}
              value={frequency ?? ''}
              onChange={(event) =>
                setFrequency(event.target.value === '' ? null : (event.target.value as Frequency))
              }
            >
              <option value="">Doesn’t repeat</option>
              {FREQUENCY_OPTIONS.filter((option) => option.value !== 'never').map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
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
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={`${id}-category`}>Category</Label>
            {canSplit && (
              <button
                type="button"
                className="cursor-pointer text-xs whitespace-nowrap text-primary underline-offset-2 hover:underline"
                onClick={isSplit ? useOneCategory : startSplit}
              >
                {isSplit ? 'Use one category' : 'Split'}
              </button>
            )}
          </div>
          {isSplit ? (
            <select id={`${id}-category`} className={SELECT_CLASS} disabled>
              <option>Split ({splitLines!.length} lines)</option>
            </select>
          ) : usesCategory ? (
            <CategorySelect id={`${id}-category`} value={categoryId} onChange={chooseCategory} />
          ) : (
            <select id={`${id}-category`} className={SELECT_CLASS} disabled>
              <option>Not needed</option>
            </select>
          )}
        </div>
        {/* With Repeat shown, a one-column memo keeps the form to two rows of four. */}
        <div
          className={cn(
            'col-span-2 xl:col-span-1',
            allowRepeat ? 'md:col-span-1' : 'md:col-span-2',
          )}
        >
          {textField('Memo', memo, setMemo, { maxLength: 500 })}
        </div>
        {textField('Outflow', outflow, setOutflow, { inputMode: 'decimal' })}
        {textField('Inflow', inflow, setInflow, { inputMode: 'decimal' })}
      </div>
      {isSplit && (
        <SplitLinesEditor lines={splitLines!} totalCents={totalCents} onChange={setSplitLines} />
      )}
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
