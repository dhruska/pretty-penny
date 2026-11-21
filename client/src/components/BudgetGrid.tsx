import { api, type Budget, type BudgetCategory, type Transaction } from '@/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SkeletonRows } from '@/components/ui/skeleton';
import { shortDate } from '@/lib/dates';
import { monthRange } from '@/lib/months';
import { payeeLabel } from '@/lib/transactions';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCents, parseDollars } from '@/lib/money';
import { useIsPhone } from '@/lib/useIsPhone';
import { cn } from 'cn';
import { useRef, useState } from 'react';
import { AvailableButton, CategoryMoneyPanel } from './CategoryMoney';
import { Money } from './Money';

interface BudgetGridProps {
  budget: Budget;
  showHidden: boolean;
  onAssign: (categoryId: number, assignedCents: number) => void;
}

function sum(
  categories: BudgetCategory[],
  field: 'assignedCents' | 'activityCents' | 'availableCents',
) {
  return categories.reduce((total, category) => total + category[field], 0);
}

/**
 * Assigned reads as a plain amount, as in YNAB, and is edited in place when clicked or tabbed to.
 * Enter or leaving the field saves; Escape puts it back.
 */
function AssignedInput({
  category,
  onAssign,
}: {
  category: BudgetCategory;
  onAssign: BudgetGridProps['onAssign'];
}) {
  // What's being typed, or null when the field isn't being edited.
  const [draft, setDraft] = useState<string | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const cancelled = useRef(false);

  function commit() {
    if (cancelled.current || draft === null) {
      cancelled.current = false;
      setDraft(null);
      setIsInvalid(false);
      return;
    }
    const cents = draft.trim() === '' ? 0 : parseDollars(draft);
    if (cents === null) {
      setIsInvalid(true);
      return;
    }
    setIsInvalid(false);
    setDraft(null);
    if (cents !== category.assignedCents) onAssign(category.id, cents);
  }

  return (
    <Input
      aria-label={`Assigned for ${category.name}`}
      aria-invalid={isInvalid}
      inputMode="decimal"
      className="ml-auto h-8 w-32 cursor-pointer border-transparent bg-transparent text-right tabular-nums shadow-none hover:border-input focus:cursor-text focus-visible:border-ring focus-visible:bg-card"
      value={draft ?? formatCents(category.assignedCents)}
      onChange={(event) => setDraft(event.target.value)}
      // The text isn't changed on focus, which could race with typing; it's all selected, so
      // typing replaces it, and "$1,450.00" reads back as an amount.
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A category's transactions for the month, from its Activity amount. */
function ActivityButton({ category, month }: { category: BudgetCategory; month: string }) {
  const [open, setOpen] = useState(false);
  const range = monthRange(month);
  const filters = { categoryId: String(category.id), ...range };
  const results = useQuery({
    queryKey: ['search', 'activity', filters],
    queryFn: () => api.searchTransactions(new URLSearchParams(filters)),
    enabled: open,
  });
  const listed = results.data?.transactions ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Activity in ${category.name}: ${formatCents(category.activityCents)}`}
          className="cursor-pointer rounded px-1 text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline"
        >
          {formatCents(category.activityCents)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={`${category.name} activity`}
        className="max-h-[var(--radix-popover-content-available-height)] w-[24rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
      >
        <div className="flex items-baseline justify-between border-b px-4 py-3">
          <h3 className="font-semibold">{category.name}</h3>
          <Money cents={category.activityCents} className="text-sm" />
        </div>
        {results.isPending && <SkeletonRows rows={3} label="Loading activity" />}
        {results.isSuccess && listed.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No activity this month.</p>
        )}
        <ul className="divide-y text-sm">
          {listed.map((transaction) => (
            <li key={transaction.id} className="flex items-baseline gap-3 px-4 py-2">
              <span className="w-12 shrink-0 text-muted-foreground">
                {shortDate(transaction.date)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {payeeLabel(transaction) || 'No payee'}
                <span className="block truncate text-xs text-muted-foreground">
                  {transaction.accountName}
                </span>
              </span>
              <Money cents={categoryAmount(transaction, category.id)} />
            </li>
          ))}
        </ul>
        <Link
          to={`/transactions?${new URLSearchParams(filters)}`}
          className="block border-t px-4 py-2.5 text-sm font-medium text-accent-ink hover:bg-muted"
        >
          See them in All transactions
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** The part of a transaction in one category: a split line's amount, or the whole transaction. */
function categoryAmount(transaction: Transaction, categoryId: number) {
  const lines = transaction.lines.filter((line) => line.categoryId === categoryId);
  if (lines.length === 0) return transaction.amountCents;
  // Lines on the other side of a budget-to-tracking transfer are stored with its signs.
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return Math.sign(total) === Math.sign(transaction.amountCents) ? total : -total;
}

/** Available as a colored pill, as in YNAB: green with money, red when overspent. */
function availableClass(cents: number) {
  return cn(
    'inline-block rounded-full px-2 py-0.5 whitespace-nowrap tabular-nums',
    cents > 0 && 'bg-positive/10 text-positive',
    cents === 0 && 'text-muted-foreground',
    cents < 0 && 'bg-negative/10 text-negative',
  );
}

/** On phones, as in YNAB's app: each category shows its Available, and tapping it opens the rest. */
function PhoneBudgetList({
  budget,
  groups,
  onAssign,
}: {
  budget: Budget;
  groups: Budget['groups'];
  onAssign: BudgetGridProps['onAssign'];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const open = groups.flatMap((group) => group.categories).find((c) => c.id === openId);

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-sm">
      <div className="flex justify-between border-b px-3 py-2 text-muted-foreground">
        <span>Category</span>
        <span>Available</span>
      </div>
      {groups.map((group) => (
        <section key={group.id} aria-label={group.name}>
          <h3 className="flex items-center justify-between gap-3 border-b bg-muted px-3 py-2 font-medium">
            <span className="min-w-0 truncate">
              {group.name}
              {group.hidden && <span className="ml-2 font-normal">(hidden)</span>}
            </span>
            <Money cents={sum(group.categories, 'availableCents')} className="px-2" />
          </h3>
          {group.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-label={`${category.name}, ${formatCents(category.availableCents)} available`}
              onClick={() => setOpenId(category.id)}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-0 hover:bg-muted/50"
            >
              <span className="min-w-0 truncate">
                {category.name}
                {category.hidden && <span className="ml-2 text-muted-foreground">(hidden)</span>}
              </span>
              <span className={availableClass(category.availableCents)}>
                {formatCents(category.availableCents)}
              </span>
            </button>
          ))}
        </section>
      ))}

      <Dialog open={open !== undefined} onOpenChange={(isOpen) => !isOpen && setOpenId(null)}>
        {open && (
          <DialogContent placement="bottom">
            <DialogHeader title={open.name} />
            <dl className="mb-4 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Assigned</dt>
              <dd>
                <AssignedInput
                  key={`${budget.month}-${open.assignedCents}`}
                  category={open}
                  onAssign={onAssign}
                />
              </dd>
              <dt className="text-muted-foreground">Activity</dt>
              <dd className="text-right">
                <Link
                  to={`/transactions?${new URLSearchParams({ categoryId: String(open.id), ...monthRange(budget.month) })}`}
                  aria-label={`Activity in ${open.name}: ${formatCents(open.activityCents)}`}
                  className="underline-offset-4 hover:underline"
                >
                  <Money cents={open.activityCents} className="text-foreground" />
                </Link>
              </dd>
              <dt className="text-muted-foreground">Available</dt>
              <dd className="text-right">
                <span className={availableClass(open.availableCents)}>
                  {formatCents(open.availableCents)}
                </span>
              </dd>
            </dl>
            <CategoryMoneyPanel
              category={open}
              budget={budget}
              showHeading={false}
              onDone={() => setOpenId(null)}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

export function BudgetGrid({ budget, showHidden, onAssign }: BudgetGridProps) {
  const isPhone = useIsPhone();
  const groups = budget.groups
    .filter((group) => showHidden || !group.hidden)
    .map((group) => ({
      ...group,
      categories: group.categories.filter((category) => showHidden || !category.hidden),
    }));

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No categories yet. Select Manage categories to add some.
      </p>
    );
  }

  if (isPhone) return <PhoneBudgetList budget={budget} groups={groups} onAssign={onAssign} />;

  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2.5 font-semibold">Category</th>
            <th className="w-40 px-3 py-2.5 text-right font-semibold">Assigned</th>
            <th className="w-36 px-3 py-2.5 text-right font-semibold">Activity</th>
            <th className="w-40 px-5 py-2.5 text-right font-semibold">Available</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr className="border-b bg-muted/60 text-xs font-semibold tracking-wider text-foreground/80 uppercase">
              <td className="px-5 py-2">
                {group.name}
                {group.hidden && <span className="ml-2 font-normal normal-case">(hidden)</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <Money cents={sum(group.categories, 'assignedCents')} className="pr-3" />
              </td>
              <td className="px-3 py-2 text-right">
                <Money
                  cents={sum(group.categories, 'activityCents')}
                  className="text-foreground/80"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <Money cents={sum(group.categories, 'availableCents')} className="px-2.5" />
              </td>
            </tr>
            {group.categories.map((category) => (
              <tr key={category.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-5 py-1">
                  {category.name}
                  {category.hidden && <span className="ml-2 text-muted-foreground">(hidden)</span>}
                </td>
                <td className="px-3 py-1 text-right">
                  {/* The key resets the field when the saved value or month changes. */}
                  <AssignedInput
                    key={`${budget.month}-${category.assignedCents}`}
                    category={category}
                    onAssign={onAssign}
                  />
                </td>
                <td className="px-3 py-1 text-right">
                  <ActivityButton category={category} month={budget.month} />
                </td>
                <td className="px-5 py-1 text-right">
                  <AvailableButton category={category} budget={budget} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
