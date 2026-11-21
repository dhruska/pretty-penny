import { api, type Budget } from '@/api';
import { AutoAssignMenu } from '@/components/AutoAssignMenu';
import { BudgetGrid } from '@/components/BudgetGrid';
import { CategoryManager } from '@/components/CategoryManager';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { currentMonth, formatMonth, isMonth, shiftMonth } from '@/lib/months';
import { notifyError } from '@/lib/notify';
import { applyAssignment } from '@/lib/optimistic';
import { refresh, updateNow } from '@/lib/queries';
import { useShortcuts } from '@/lib/shortcuts';
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
            <Link
              to={`/transactions?categoryId=uncategorized&accountId=${account.accountId}`}
              className="underline underline-offset-2"
            >
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

  // The new amount shows right away; if the server refuses it, it's put back with a message.
  const assign = useMutation({
    mutationFn: (input: { month: string; categoryId: number; assignedCents: number }) =>
      api.setAssignment(input.month, input.categoryId, input.assignedCents),
    onMutate: (input) =>
      updateNow(queryClient, [
        {
          queryKey: ['budget', input.month],
          update: (data: Budget) => applyAssignment(data, input.categoryId, input.assignedCents),
        },
      ]),
    onError: (error, _input, putBack) => {
      putBack?.();
      notifyError(error);
    },
    // Later months roll the change forward, so they refresh too.
    onSettled: () => refresh(queryClient, 'budget'),
  });

  useShortcuts({
    ArrowLeft: () => setSearchParams({ month: shiftMonth(month, -1) }),
    ArrowRight: () => setSearchParams({ month: shiftMonth(month, 1) }),
    t: () => setSearchParams({}),
  });

  const importStatus = useQuery({ queryKey: ['import-status'], queryFn: api.importStatus });

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
      {budget.data && <UncategorizedNotice uncategorized={budget.data.uncategorized} />}
      {importStatus.data?.canImport && (
        <p className="rounded-lg border bg-card p-3 text-sm">
          Your budget is empty. Coming from YNAB?{' '}
          <Link to="/import" className="underline underline-offset-2">
            Import your plan
          </Link>
          , or add accounts and categories to start fresh.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {!isManaging && budget.data && <AutoAssignMenu budget={budget.data} />}
          <Button variant="secondary" size="sm" onClick={() => setIsManaging(!isManaging)}>
            {isManaging ? 'Done' : 'Manage categories'}
          </Button>
        </div>
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

      {budget.isPending && <SkeletonRows rows={8} label="Loading the budget" />}
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
