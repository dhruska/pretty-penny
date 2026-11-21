import type { Budget, BudgetCategory } from '@/api';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { centsToInput, formatCents, parseDollars } from '@/lib/money';
import { useIsPhone } from '@/lib/useIsPhone';
import { cn } from 'cn';
import { useState } from 'react';
import { AvailableButton, CategoryMoneyPanel } from './CategoryMoney';
import { Money } from './Money';

interface BudgetGridProps {
  budget: Budget;
  showHidden: boolean;
  onAssign: (categoryId: number, assignedCents: number) => void;
}

function toInput(cents: number) {
  return `${cents < 0 ? '-' : ''}${centsToInput(cents)}`;
}

function sum(
  categories: BudgetCategory[],
  field: 'assignedCents' | 'activityCents' | 'availableCents',
) {
  return categories.reduce((total, category) => total + category[field], 0);
}

function AssignedInput({
  category,
  onAssign,
}: {
  category: BudgetCategory;
  onAssign: BudgetGridProps['onAssign'];
}) {
  const [draft, setDraft] = useState(toInput(category.assignedCents));
  const [isInvalid, setIsInvalid] = useState(false);

  function commit() {
    const cents = draft.trim() === '' ? 0 : parseDollars(draft);
    if (cents === null) {
      setIsInvalid(true);
      return;
    }

    setIsInvalid(false);
    setDraft(toInput(cents));
    if (cents !== category.assignedCents) onAssign(category.id, cents);
  }

  return (
    <Input
      aria-label={`Assigned for ${category.name}`}
      aria-invalid={isInvalid}
      inputMode="decimal"
      className="ml-auto h-8 w-28 text-right tabular-nums"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
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
                <Money cents={open.activityCents} className="text-foreground" />
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
    <div className="relative overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Assigned</th>
            <th className="px-3 py-2 text-right font-medium">Activity</th>
            <th className="px-3 py-2 text-right font-medium">Available</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr className="border-b bg-muted font-medium">
              <td className="px-3 py-1.5">
                {group.name}
                {group.hidden && <span className="ml-2 font-normal">(hidden)</span>}
              </td>
              <td className="px-3 py-1.5 text-right">
                <Money cents={sum(group.categories, 'assignedCents')} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Money cents={sum(group.categories, 'activityCents')} className="text-foreground" />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Money cents={sum(group.categories, 'availableCents')} className="px-2" />
              </td>
            </tr>
            {group.categories.map((category) => (
              <tr key={category.id} className="border-b last:border-0">
                <td className="px-3 py-1">
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
                  <Money cents={category.activityCents} className="text-foreground" />
                </td>
                <td className="px-3 py-1 text-right">
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
