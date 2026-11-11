import type { Budget, BudgetCategory } from '@/api';
import { Input } from '@/components/ui/input';
import { centsToInput, parseDollars } from '@/lib/money';
import { useState } from 'react';
import { AvailableButton } from './CategoryMoney';
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

export function BudgetGrid({ budget, showHidden, onAssign }: BudgetGridProps) {
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
