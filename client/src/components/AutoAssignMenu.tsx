import type { Budget } from '@/api';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AUTO_ASSIGN_OPTIONS, planAutoAssign } from '@/lib/autoAssign';
import { useState } from 'react';
import { useBudgetActions } from './CategoryMoney';
import { Money } from './Money';

/** Applies an auto-assign option to every visible category in the month. */
export function AutoAssignMenu({ budget }: { budget: Budget }) {
  const [isOpen, setIsOpen] = useState(false);
  const { setAssignments } = useBudgetActions(budget.month, () => setIsOpen(false));

  // Hidden categories are skipped, as they are in the grid.
  const visible = budget.groups
    .filter((group) => !group.hidden)
    .flatMap((group) => group.categories.filter((category) => !category.hidden));

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          Auto-assign
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Auto-assign" className="w-72 space-y-1 text-sm">
        <p className="pb-1 text-xs text-muted-foreground">
          Assigns money to every visible category this month.
        </p>
        {setAssignments.isError && <p className="text-negative">{setAssignments.error.message}</p>}
        {AUTO_ASSIGN_OPTIONS.map((option) => {
          const plan = planAutoAssign(visible, option.value);
          return (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              className="flex w-full justify-between"
              disabled={plan.changes.length === 0 || setAssignments.isPending}
              onClick={() => setAssignments.mutate(plan.changes)}
            >
              <span>{option.label}</span>
              <Money cents={plan.totalCents} className="text-foreground" />
            </Button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
