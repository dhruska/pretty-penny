import { api, type Budget } from '@/api';
import { BudgetGrid } from '@/components/BudgetGrid';
import { CategoryManager } from '@/components/CategoryManager';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { currentMonth, formatMonth, isMonth, shiftMonth } from '@/lib/months';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

function UncategorizedNotice({ uncategorized }: { uncategorized: Budget['uncategorized'] }) {
  const total = uncategorized.reduce((sum, account) => sum + account.count, 0);
  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-medium">
        {total === 1 ? '1 transaction needs a category:' : `${total} transactions need a category:`}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4">
        {uncategorized.map((account) => (
          <li key={account.accountId}>
            <Link to={`/accounts/${account.accountId}`} className="underline underline-offset-2">
              {account.accountName} ({account.count})
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BudgetPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isManaging, setIsManaging] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const thisMonth = currentMonth();
  const requestedMonth = searchParams.get('month');
  const month = isMonth(requestedMonth) ? requestedMonth : thisMonth;

  const budget = useQuery({
    queryKey: ['budget', month, thisMonth],
    queryFn: () => api.getBudget(month, thisMonth),
    placeholderData: keepPreviousData,
  });

  const assign = useMutation({
    mutationFn: (input: { month: string; categoryId: number; assignedCents: number }) =>
      api.setAssignment(input.month, input.categoryId, input.assignedCents),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const readyToAssign = budget.data?.readyToAssignCents ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            onClick={() => setSearchParams({ month: shiftMonth(month, -1) })}
          >
            ‹
          </Button>
          <h2 className="w-44 text-center text-xl font-semibold">{formatMonth(month)}</h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            onClick={() => setSearchParams({ month: shiftMonth(month, 1) })}
          >
            ›
          </Button>
          {month !== thisMonth && (
            <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
              This month
            </Button>
          )}
        </div>

        {budget.data && (
          <section
            aria-label="Ready to Assign"
            className={cn(
              'rounded-lg px-4 py-2 text-right',
              readyToAssign < 0 ? 'bg-negative/10' : 'bg-positive/10',
            )}
          >
            <Money
              cents={readyToAssign}
              className={cn('block text-xl font-semibold', readyToAssign >= 0 && 'text-positive')}
            />
            <span className="text-xs text-muted-foreground">Ready to Assign</span>
          </section>
        )}
      </header>

      {budget.isError && <p className="text-negative">{budget.error.message}</p>}
      {assign.isError && <p className="text-sm text-negative">{assign.error.message}</p>}
      {budget.data && <UncategorizedNotice uncategorized={budget.data.uncategorized} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => setIsManaging(!isManaging)}>
          {isManaging ? 'Done' : 'Manage categories'}
        </Button>
        {!isManaging && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            Show hidden
          </label>
        )}
      </div>

      {budget.isPending && <p className="text-muted-foreground">Loading…</p>}
      {isManaging && <CategoryManager />}
      {!isManaging && budget.data && (
        <BudgetGrid
          budget={budget.data}
          showHidden={showHidden}
          onAssign={(categoryId, assignedCents) =>
            assign.mutate({ month: budget.data.month, categoryId, assignedCents })
          }
        />
      )}
    </div>
  );
}
