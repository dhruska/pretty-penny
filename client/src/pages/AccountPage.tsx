import { api, type Account, type AccountBank, type Frequency, type TransactionInput } from '@/api';
import { ScheduledList } from '@/components/ScheduledList';
import { EditAccountDialog } from '@/components/EditAccountDialog';
import { Money } from '@/components/Money';
import { ReconcileButton } from '@/components/ReconcileButton';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionRegister } from '@/components/TransactionRegister';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useIsPhone } from '@/lib/useIsPhone';
import { Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { PendingTransactions } from '@/components/PendingTransactions';
import { ReviewBanner } from '@/components/ReviewBanner';
import { bankDifference, updatedAgo } from '@/lib/bank';
import { accountTypeLabel } from '@/lib/accountTypes';
import { today } from '@/lib/dates';
import { notify, notifyError } from '@/lib/notify';
import { refresh, registerQuery } from '@/lib/queries';
import { useShortcuts } from '@/lib/shortcuts';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

/** What the linked bank last said, and how it compares with the cleared balance. */
function BankBalance({ account, bank }: { account: Account; bank: AccountBank }) {
  const difference = bankDifference(account);
  const queryClient = useQueryClient();
  const importNow = useMutation({
    mutationFn: () => api.refreshBankConnection(bank.connectionId),
    onSuccess: (connection) => {
      if (connection.status === 'ok') notify(`Up to date with ${bank.institutionName}`);
    },
    onError: notifyError,
    onSettled: () => refresh(queryClient, 'imports'),
  });
  return (
    <section aria-label="Bank" className="mt-2 space-y-1 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
        <span>
          {bank.institutionName}
          {bank.mask && ` ••${bank.mask}`}{' '}
          {bank.balanceCents === null ? (
            'gives no balance'
          ) : (
            <Money cents={bank.balanceCents} className="font-medium text-foreground" />
          )}
        </span>
        <span className="text-xs">{updatedAgo(bank.updatedAt)}</span>
        {!account.closed && (
          <button
            type="button"
            disabled={importNow.isPending}
            onClick={() => importNow.mutate()}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-ink hover:underline disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                'size-3',
                importNow.isPending && 'animate-spin motion-reduce:animate-none',
              )}
            />
            Import now
          </button>
        )}
      </p>
      {difference !== null && bank.status === 'ok' && (
        <p className="text-xs text-warning">
          <Money cents={Math.abs(difference)} /> {difference > 0 ? 'more' : 'less'} than your
          cleared balance. Clear what’s gone through, or reconcile.
        </p>
      )}
      {bank.status !== 'ok' && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-negative">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            {bank.problem}{' '}
            <Link to="/bank" className="font-medium underline">
              Go to Bank connections
            </Link>
          </span>
        </p>
      )}
    </section>
  );
}

export function AccountPage() {
  const accountId = Number(useParams().id);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const account = accounts.data?.find((candidate) => candidate.id === accountId);

  if (accounts.isPending) return <SkeletonRows rows={6} label="Loading the account" />;
  if (accounts.isError) return <p className="text-negative">{accounts.error.message}</p>;
  if (!account) return <p className="text-muted-foreground">Account not found.</p>;

  // The key resets edit state when switching between accounts.
  return <AccountDetails key={account.id} account={account} />;
}

function AccountDetails({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const isPhone = useIsPhone();
  const [isAdding, setIsAdding] = useState(false);
  // Showing only the transactions from the bank that need review.
  const [reviewing, setReviewing] = useState(false);
  const isReviewing = reviewing && account.unapprovedCount > 0;

  // The newest transactions first, with more loading as you scroll.
  const transactions = useInfiniteQuery(registerQuery(account.id));
  const rows = transactions.data?.pages.flat() ?? [];

  // Filtering searches the whole account on the server, so older transactions are found too.
  const query = useDeferredValue(filter.trim());
  const filtered = useQuery({
    queryKey: ['search', 'account', account.id, query, isReviewing],
    queryFn: () =>
      api.searchTransactions(
        new URLSearchParams({
          accountId: String(account.id),
          q: query,
          ...(isReviewing && { needsReview: 'true' }),
        }),
      ),
    enabled: query !== '' || isReviewing,
    placeholderData: keepPreviousData,
  });

  const addFormRef = useRef<HTMLElement>(null);
  const focusPayee = () =>
    addFormRef.current?.querySelector<HTMLInputElement>('input[list]')?.focus();
  // Opening the add form puts the cursor in Payee, ready to type.
  useEffect(() => {
    if (isAdding && !isPhone) focusPayee();
  }, [isAdding, isPhone]);
  const filterRef = useRef<HTMLInputElement>(null);
  useShortcuts({
    n: () => {
      if (account.closed) return;
      if (isAdding) focusPayee();
      else setIsAdding(true);
    },
    '/': () => filterRef.current?.focus(),
  });

  async function addTransaction(input: TransactionInput, frequency: Frequency | null) {
    // As in YNAB, a repeating or future-dated transaction becomes a scheduled transaction.
    if (frequency !== null || input.date > today()) {
      const { posted } = await api.createScheduled(account.id, {
        ...input,
        frequency: frequency ?? 'never',
      });
      notify(posted > 0 ? 'Transaction added, and set to repeat' : 'Transaction scheduled');
    } else {
      await api.createTransaction(account.id, input);
      notify('Transaction added');
    }
    refresh(queryClient, 'transactions');
  }

  const kind = `${accountTypeLabel(account.type)} · ${account.onBudget ? 'Budget account' : 'Tracking account'}${account.closed ? ' · Closed' : ''}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{kind}</p>
          <h2 className="truncate text-2xl font-bold tracking-tight">{account.name}</h2>
          <section
            aria-label="Balances"
            className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted-foreground"
          >
            <span>
              Cleared{' '}
              <Money cents={account.clearedBalanceCents} className="font-medium text-foreground" />
            </span>
            <span>
              Uncleared{' '}
              <Money
                cents={account.balanceCents - account.clearedBalanceCents}
                className="font-medium"
              />
            </span>
            <span>
              Working{' '}
              <Money cents={account.balanceCents} className="text-base font-bold text-foreground" />
            </span>
          </section>
          <p className="mt-1 text-xs text-muted-foreground">
            {account.lastReconciledAt
              ? `Last reconciled ${new Date(account.lastReconciledAt).toLocaleDateString()}`
              : 'Not reconciled yet'}
          </p>
          {account.bank && <BankBalance account={account} bank={account.bank} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!account.closed && <ReconcileButton account={account} />}
          <EditAccountDialog key={account.id} account={account} />
          {!isPhone && !account.closed && !isAdding && (
            <Button size="sm" onClick={() => setIsAdding(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Add transaction
            </Button>
          )}
        </div>
      </header>

      {account.closed ? (
        <p className="rounded-lg border bg-muted p-3 text-sm">
          This account is closed. To add transactions, reopen it from Edit account.
        </p>
      ) : isPhone ? (
        // On phones the form opens full screen, so transactions show right away.
        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild>
            <Button className="w-full">Add transaction</Button>
          </DialogTrigger>
          <DialogContent placement="full">
            <DialogHeader title="Add transaction" />
            <TransactionForm
              label="Add transaction"
              submitLabel="Add transaction"
              account={account}
              allowRepeat
              onSubmit={async (input, frequency) => {
                await addTransaction(input, frequency);
                setIsAdding(false);
              }}
              onCancel={() => setIsAdding(false)}
            />
          </DialogContent>
        </Dialog>
      ) : (
        // On laptops the form opens above the register and stays open after each add, for
        // entering several in a row, until it's closed.
        isAdding && (
          <section
            ref={addFormRef}
            aria-label="New transaction"
            className="rounded-xl border border-primary/40 bg-card p-3 shadow-sm"
          >
            <TransactionForm
              label="Add transaction"
              submitLabel="Add transaction"
              account={account}
              allowRepeat
              onSubmit={async (input, frequency) => {
                await addTransaction(input, frequency);
                focusPayee();
              }}
              onCancel={() => setIsAdding(false)}
              cancelLabel="Close"
            />
          </section>
        )
      )}

      <ReviewBanner account={account} reviewing={isReviewing} onReview={setReviewing} />
      <PendingTransactions accountId={account.id} />
      <ScheduledList account={account} />

      {transactions.isPending && <SkeletonRows rows={8} label="Loading transactions" />}
      {transactions.isError && <p className="text-negative">{transactions.error.message}</p>}
      {transactions.isSuccess && (
        <div className="space-y-2">
          <div className="relative max-w-72">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={filterRef}
              aria-label="Filter transactions"
              placeholder="Filter transactions"
              className="h-8 pl-8"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {query === '' && !isReviewing ? (
            <TransactionRegister
              transactions={rows}
              hasMore={transactions.hasNextPage}
              isLoadingMore={transactions.isFetchingNextPage}
              onLoadMore={() => {
                if (!transactions.isFetchingNextPage) void transactions.fetchNextPage();
              }}
            />
          ) : (
            // Matches come from the whole account, so running balances aren't shown.
            <TransactionRegister
              transactions={filtered.data?.transactions ?? []}
              showBalance={false}
              emptyMessage={
                filtered.isPending
                  ? 'Searching…'
                  : isReviewing
                    ? 'Nothing left to review.'
                    : 'No transactions match.'
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
