import { api, type Budget } from '@/api';
import { AutoAssignMenu } from '@/components/AutoAssignMenu';
import { BudgetGrid } from '@/components/BudgetGrid';
import { AddAccountButton } from '@/components/AccountSidebar';
import { CategoryManager } from '@/components/CategoryManager';
import { PennyMark } from '@/components/PennyMark';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { monthSummary } from '@/lib/budgetSummary';
import { currentMonth, formatMonth, isMonth, shiftMonth } from '@/lib/months';
import { notifyError } from '@/lib/notify';
import { applyAssignment } from '@/lib/optimistic';
import { refresh, updateNow } from '@/lib/queries';
import { useShortcuts } from '@/lib/shortcuts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

/**
 * Transactions from the bank waiting for review, linking to them. The sidebar shows each
 * account's count, but on phones the sidebar is in the menu, so this says it here too.
 */
function ReviewNotice() {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const total = (accounts.data ?? []).reduce((sum, account) => sum + account.unapprovedCount, 0);
  if (total === 0) return null;
  return (
    <Link
      to="/transactions?needsReview=true"
      className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-accent-soft px-3 py-2 text-sm font-medium text-accent-ink hover:underline"
    >
      {total === 1 ? '1 transaction needs review' : `${total} transactions need review`}
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  );
}

/** A brand-new budget's first steps, or bringing everything over from YNAB. */
function Welcome({ onManage }: { onManage: () => void }) {
  const steps = [
    {
      title: 'Add your accounts',
      body: 'Checking, savings and cards, with their balances today.',
      action: <AddAccountButton className="w-full sm:w-auto" />,
    },
    {
      title: 'Create categories',
      body: 'What you spend on and save for, such as Rent, Groceries or a vacation.',
      action: (
        <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onManage}>
          Manage categories
        </Button>
      ),
    },
    {
      title: 'Give every dollar a job',
      body: 'Assign your Ready to Assign money to categories until it reaches zero.',
    },
  ];
  return (
    <section aria-label="Welcome" className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <PennyMark className="size-9" />
        <div>
          <h3 className="text-lg font-bold tracking-tight">Welcome to Pretty Penny</h3>
          <p className="text-sm text-muted-foreground">
            Coming from YNAB?{' '}
            <Link
              to="/import"
              className="font-medium text-accent-ink underline-offset-4 hover:underline"
            >
              Import your plan
            </Link>{' '}
            and everything comes over. Or start fresh in three steps.
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {index + 1}
            </span>
            <p className="font-semibold">{step.title}</p>
            <p className="flex-1 text-sm text-muted-foreground">{step.body}</p>
            {step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Ready to Assign, with what was assigned and spent this month beside it. */
function MonthSummary({ budget }: { budget: Budget }) {
  const ready = budget.readyToAssignCents;
  const { assignedCents, spentCents } = monthSummary(budget);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <section
        aria-label="Ready to Assign"
        className="col-span-2 rounded-xl border bg-card px-5 py-4"
      >
        <p className="text-sm text-muted-foreground">Ready to Assign</p>
        <Money
          cents={ready}
          className={cn(
            'block text-3xl font-bold tracking-tight',
            ready > 0 && 'text-positive',
            ready === 0 && 'text-foreground',
          )}
        />
        {ready < 0 && (
          <p className="mt-1 text-sm text-negative">
            More is assigned than you have. Take some back from a category.
          </p>
        )}
      </section>
      <section
        aria-label="Assigned this month"
        className="rounded-xl border bg-card px-4 py-3 sm:px-5 sm:py-4"
      >
        <p className="text-sm text-muted-foreground">Assigned this month</p>
        <Money cents={assignedCents} className="mt-1 block text-lg font-semibold sm:text-xl" />
      </section>
      <section
        aria-label="Spent this month"
        className="rounded-xl border bg-card px-4 py-3 sm:px-5 sm:py-4"
      >
        <p className="text-sm text-muted-foreground">Spent this month</p>
        <Money cents={spentCents} className="mt-1 block text-lg font-semibold sm:text-xl" />
      </section>
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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setSearchParams({ month: shiftMonth(month, -1) })}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <h2 className="min-w-44 text-center text-2xl font-bold tracking-tight">
          {formatMonth(month)}
        </h2>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setSearchParams({ month: shiftMonth(month, 1) })}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
            This month
          </Button>
        )}
      </header>

      {budget.data && <MonthSummary budget={budget.data} />}

      {budget.isError && <p className="text-negative">{budget.error.message}</p>}
      <ReviewNotice />
      {budget.data && <UncategorizedNotice uncategorized={budget.data.uncategorized} />}
      {importStatus.data?.canImport && <Welcome onManage={() => setIsManaging(true)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {!isManaging && budget.data && <AutoAssignMenu budget={budget.data} />}
          <Button variant="outline" size="sm" onClick={() => setIsManaging(!isManaging)}>
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
