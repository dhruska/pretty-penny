import { api, type AssignmentInput, type Budget, type BudgetCategory } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AUTO_ASSIGN_OPTIONS, autoAssignTarget } from '@/lib/autoAssign';
import { centsToInput, formatCents, parseDollars } from '@/lib/money';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type FormEvent } from 'react';
import { SELECT_CLASS } from './CategorySelect';
import { Money } from './Money';

type Move = { fromCategoryId: number | null; toCategoryId: number | null; amountCents: number };

/** Moves money and sets assignments for a month, refreshing all data afterward. */
export function useBudgetActions(month: string, onDone?: () => void) {
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    await queryClient.invalidateQueries();
    onDone?.();
  };

  return {
    move: useMutation({ mutationFn: (move: Move) => api.moveMoney(month, move), onSuccess }),
    setAssignments: useMutation({
      mutationFn: (assignments: AssignmentInput[]) => api.setAssignments(month, assignments),
      onSuccess,
    }),
  };
}

interface MoveOption {
  categoryId: number | null;
  label: string;
}

function MoveForm({
  title,
  placeLabel,
  submitLabel,
  defaultCents,
  options,
  isPending,
  onMove,
}: {
  title: string;
  placeLabel: string;
  submitLabel: string;
  defaultCents: number;
  options: MoveOption[];
  isPending: boolean;
  onMove: (amountCents: number, categoryId: number | null) => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(defaultCents > 0 ? centsToInput(defaultCents) : '');
  const [place, setPlace] = useState(String(options[0]?.categoryId ?? ''));
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const cents = parseDollars(amount);
    if (cents === null || cents <= 0) {
      setError('Enter a positive amount with at most two decimal places.');
      return;
    }
    setError(null);
    onMove(cents, place === '' ? null : Number(place));
  }

  return (
    <form aria-label={title} onSubmit={handleSubmit} className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-amount`}>Amount</Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            className="h-8 text-right tabular-nums"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-place`}>{placeLabel}</Label>
          <select
            id={`${id}-place`}
            className={cn(SELECT_CLASS, 'h-8')}
            value={place}
            onChange={(event) => setPlace(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.categoryId ?? 'ready'} value={option.categoryId ?? ''}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button type="submit" size="sm" disabled={isPending || options.length === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}

function CategoryMoneyPanel({
  category,
  budget,
  onDone,
}: {
  category: BudgetCategory;
  budget: Budget;
  onDone: () => void;
}) {
  const { move, setAssignments } = useBudgetActions(budget.month, onDone);
  const error = move.error ?? setAssignments.error;

  const others = budget.groups
    .flatMap((group) => group.categories)
    .filter((other) => other.id !== category.id && !other.hidden);
  const readyToAssign = {
    categoryId: null,
    label: `Ready to Assign (${formatCents(budget.readyToAssignCents)})`,
  };
  const destinations = [readyToAssign, ...others.map((o) => ({ categoryId: o.id, label: o.name }))];
  // As in YNAB, only categories with money available can give it.
  const sources = [
    readyToAssign,
    ...others
      .filter((other) => other.availableCents > 0)
      .map((other) => ({
        categoryId: other.id,
        label: `${other.name} (${formatCents(other.availableCents)})`,
      })),
  ];
  const isOverspent = category.availableCents < 0;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{category.name}</span>
        <span>
          <Money cents={category.availableCents} /> available
        </span>
      </div>

      {error && <p className="text-negative">{error.message}</p>}

      {category.availableCents > 0 && (
        <MoveForm
          title="Move money out"
          placeLabel="To"
          submitLabel="Move"
          defaultCents={category.availableCents}
          options={destinations}
          isPending={move.isPending}
          onMove={(amountCents, toCategoryId) =>
            move.mutate({ fromCategoryId: category.id, toCategoryId, amountCents })
          }
        />
      )}

      <MoveForm
        title={isOverspent ? 'Cover overspending' : 'Move money in'}
        placeLabel="From"
        submitLabel={isOverspent ? 'Cover' : 'Move in'}
        defaultCents={isOverspent ? -category.availableCents : 0}
        options={sources}
        isPending={move.isPending}
        onMove={(amountCents, fromCategoryId) =>
          move.mutate({ fromCategoryId, toCategoryId: category.id, amountCents })
        }
      />

      <section aria-label="Auto-assign this category" className="space-y-1 border-t pt-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Auto-assign
        </h3>
        {AUTO_ASSIGN_OPTIONS.map((option) => {
          const target = autoAssignTarget(category, option.value);
          return (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              className="flex w-full justify-between"
              disabled={target === null || setAssignments.isPending}
              onClick={() =>
                target !== null &&
                setAssignments.mutate([{ categoryId: category.id, assignedCents: target }])
              }
            >
              <span>{option.label}</span>
              <Money
                cents={target === null ? 0 : target - category.assignedCents}
                className="text-foreground"
              />
            </Button>
          );
        })}
      </section>
    </div>
  );
}

/** A category's Available amount, which opens tools for moving money in or out. */
export function AvailableButton({
  category,
  budget,
}: {
  category: BudgetCategory;
  budget: Budget;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const cents = category.availableCents;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${formatCents(cents)} available in ${category.name}`}
          className={cn(
            'inline-block cursor-pointer rounded-full px-2 py-0.5 tabular-nums hover:ring-2 hover:ring-ring/30',
            cents > 0 && 'bg-positive/10 text-positive',
            cents === 0 && 'text-muted-foreground',
            cents < 0 && 'bg-negative/10 text-negative',
          )}
        >
          {formatCents(cents)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={`Move money for ${category.name}`}
        // Stays within the window, scrolling if there isn't room above or below the row.
        className="max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <CategoryMoneyPanel category={category} budget={budget} onDone={() => setIsOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
