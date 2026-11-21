import {
  api,
  isReconciledError,
  type Account,
  type ClearedStatus,
  type FlagColor,
  type SearchResults,
  type Transaction,
  type TransactionInput,
} from '@/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { notify, notifyDeleted, notifyError } from '@/lib/notify';
import { applyCleared, updateInPages, updateInResults } from '@/lib/optimistic';
import { refresh, updateNow } from '@/lib/queries';
import { payeeLabel } from '@/lib/transactions';
import { useIsPhone } from '@/lib/useIsPhone';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { cn } from 'cn';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete';
import { FlagPicker } from './FlagPicker';
import { Money } from './Money';
import { TransactionForm } from './TransactionForm';

const UNCATEGORIZED = <span className="font-medium text-warning">Uncategorized</span>;

interface TransactionRegisterProps {
  transactions: Transaction[];
  /** Shows each transaction's account, for lists spanning several accounts. */
  showAccount?: boolean;
  /** Running balances, shown by default in a single account's full register. */
  showBalance?: boolean;
  emptyMessage?: string;
  /** More transactions to load, which happens as the end of the list comes into view. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

type Pages = InfiniteData<Transaction[], number | undefined>;

/**
 * Changes a transaction's cleared status or flag on screen right away, then on the server; if
 * the server refuses, the change is put back with a message.
 */
function useQuickChange(transaction: Transaction) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: {
      cleared?: Exclude<ClearedStatus, 'reconciled'>;
      flag?: FlagColor | null;
    }) => api.updateTransaction(transaction.id, change),
    onMutate: (change) =>
      updateNow(queryClient, [
        {
          queryKey: ['transactions'],
          update: (data: Pages) => updateInPages(data, transaction.id, change),
        },
        {
          queryKey: ['search'],
          update: (data: SearchResults) => updateInResults(data, transaction.id, change),
        },
        ...(change.cleared
          ? [
              {
                queryKey: ['accounts'],
                update: (data: Account[]) => applyCleared(data, transaction, change.cleared!),
              },
            ]
          : []),
      ]),
    onError: (error, _change, putBack) => {
      putBack?.();
      notifyError(error);
    },
    onSettled: () => refresh(queryClient, 'quickChanges'),
  });
}

/** Deletes a transaction, taking it off screen right away and offering Undo. */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTransaction(id),
    onMutate: (id) => removeNow(queryClient, id),
    onSuccess: ({ undo }) => notifyDeleted(queryClient, undo),
    onError: (error, _id, putBack) => {
      putBack?.();
      notifyError(error);
    },
    onSettled: () => refresh(queryClient, 'transactions'),
  });
}

const removeNow = (queryClient: QueryClient, id: number) =>
  updateNow(queryClient, [
    { queryKey: ['transactions'], update: (data: Pages) => updateInPages(data, id, null) },
    { queryKey: ['search'], update: (data: SearchResults) => updateInResults(data, id, null) },
  ]);

/**
 * Delete, at once with Undo. A reconciled transaction still asks first, since deleting it can
 * make the account stop matching the bank.
 */
function DeleteButton({
  transaction,
  label = 'Delete',
  onDelete,
}: {
  transaction: Transaction;
  label?: string;
  onDelete: () => void;
}) {
  if (transaction.cleared === 'reconciled') {
    return (
      <ConfirmDelete
        triggerLabel={label}
        title="Delete this transaction?"
        description={deleteDescription(transaction)}
        onConfirm={onDelete}
      />
    );
  }
  return (
    <Button variant="ghost" size="sm" className="text-negative" onClick={onDelete}>
      {label}
    </Button>
  );
}

/** Loads more as the end of the list comes into view, with a button as a fallback. */
function LoadMore({ onLoadMore, isLoading }: { onLoadMore: () => void; isLoading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onLoadMore);
  useEffect(() => {
    latest.current = onLoadMore;
  });
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: '600px' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex justify-center py-3">
      <Button variant="ghost" size="sm" disabled={isLoading} onClick={onLoadMore}>
        {isLoading ? 'Loading more…' : 'Load more'}
      </Button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current">
      <path d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}

function ClearedToggle({ transaction }: { transaction: Transaction }) {
  const isCleared = transaction.cleared === 'cleared';
  const change = useQuickChange(transaction);

  // As in YNAB, reconciled transactions are locked and can't go back to cleared or uncleared.
  if (transaction.cleared === 'reconciled') {
    return (
      <span
        role="img"
        aria-label="Reconciled"
        title="Reconciled and locked"
        className="inline-flex size-6 items-center justify-center text-positive max-md:m-2"
      >
        <LockIcon />
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={isCleared ? 'Cleared' : 'Uncleared'}
      aria-pressed={isCleared}
      title={
        isCleared ? 'Cleared. Select to mark uncleared.' : 'Uncleared. Select to mark cleared.'
      }
      onClick={() => change.mutate({ cleared: isCleared ? 'uncleared' : 'cleared' })}
      className={cn(
        'inline-flex size-6 cursor-pointer items-center justify-center rounded-full border text-xs font-semibold max-md:m-2',
        isCleared
          ? 'border-positive bg-positive text-positive-foreground'
          : 'border-border text-muted-foreground hover:border-positive',
      )}
    >
      C
    </button>
  );
}

/** A transaction's flag, changed right in the register. Flags don't affect balances, so even a
 * reconciled transaction changes without asking. */
function RegisterFlag({ transaction }: { transaction: Transaction }) {
  const change = useQuickChange(transaction);
  return <FlagPicker value={transaction.flag} onChange={(flag) => change.mutate({ flag })} />;
}

export function TransactionRegister({
  transactions,
  showAccount = false,
  showBalance: showBalanceProp,
  emptyMessage = 'No transactions yet.',
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
}: TransactionRegisterProps) {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function toggleExpanded(id: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Running balances only mean something within one account, where the account column isn't needed.
  const showBalance = showBalanceProp ?? !showAccount;
  const columnCount = 9;

  const deleteTransaction = useDeleteTransaction();

  // Resolves the open "Save anyway?" question for a reconciled transaction.
  const [answerConfirm, setAnswerConfirm] = useState<((confirmed: boolean) => void) | null>(null);

  function askToSaveAnyway() {
    return new Promise<boolean>((resolve) => setAnswerConfirm(() => resolve));
  }

  function answer(confirmed: boolean) {
    answerConfirm?.(confirmed);
    setAnswerConfirm(null);
  }

  async function saveEdit(id: number, input: TransactionInput) {
    try {
      await api.updateTransaction(id, input);
    } catch (error) {
      if (!isReconciledError(error)) throw error;
      if (!(await askToSaveAnyway())) {
        throw new Error('Not saved. The reconciled transaction is unchanged.');
      }
      await api.updateTransaction(id, { ...input, confirmReconciled: true });
    }
    // The form closes as soon as the save succeeds; the rest refreshes in the background.
    setEditingId(null);
    notify('Transaction saved');
    refresh(queryClient, 'transactions');
  }

  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <>
      <AlertDialog
        open={answerConfirm !== null}
        onOpenChange={(open) => {
          if (!open) answer(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This transaction is reconciled</AlertDialogTitle>
            <AlertDialogDescription>
              It matched your bank when you reconciled this account. Changing its amount, date,
              account or category can make the account stop matching.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)}>Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isPhone ? (
        <PhoneRegister
          transactions={transactions}
          showAccount={showAccount}
          editingId={editingId}
          onEdit={setEditingId}
          onSave={saveEdit}
          onDelete={(id) => {
            deleteTransaction.mutate(id);
            setEditingId(null);
          }}
        />
      ) : (
        /* `relative` keeps the visually hidden column label inside the scroll area. */
        <div className="relative overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                {/* The flag sits beside the date, as YNAB's flag column does, without widening the table. */}
                <th className="py-2 pr-2 pl-9 font-medium">Date</th>
                {showAccount && <th className="px-2 py-2 font-medium">Account</th>}
                <th className="px-2 py-2 font-medium">Payee</th>
                <th className="px-2 py-2 font-medium">Category</th>
                <th className="px-2 py-2 font-medium">Memo</th>
                <th className="px-2 py-2 text-right font-medium">Outflow</th>
                <th className="px-2 py-2 text-right font-medium">Inflow</th>
                <th className="px-2 py-2 text-center font-medium">
                  <abbr title="Cleared" className="no-underline">
                    C
                  </abbr>
                </th>
                {showBalance && <th className="px-2 py-2 text-right font-medium">Balance</th>}
                <th className="px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const account = accounts.data?.find((a) => a.id === transaction.accountId);

                if (transaction.id === editingId && account) {
                  return (
                    <tr key={transaction.id} className="border-b last:border-0">
                      <td colSpan={columnCount} className="p-3">
                        <TransactionForm
                          label="Edit transaction"
                          submitLabel="Save"
                          account={account}
                          transaction={transaction}
                          onSubmit={(input) => saveEdit(transaction.id, input)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  );
                }

                const isSplit = transaction.lines.length > 1;
                const isExpanded = isSplit && expandedIds.has(transaction.id);

                return (
                  <Fragment key={transaction.id}>
                    <tr className="border-b last:border-0">
                      <td className="py-1 pr-2 pl-2 whitespace-nowrap tabular-nums">
                        <span className="flex items-center gap-1">
                          <RegisterFlag transaction={transaction} />
                          {transaction.date}
                        </span>
                      </td>
                      {showAccount && <td className="px-2 py-1.5">{transaction.accountName}</td>}
                      <td className="px-2 py-1.5">{payeeLabel(transaction)}</td>
                      <td className="px-2 py-1.5">
                        {isSplit ? (
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            className="cursor-pointer text-primary underline-offset-2 hover:underline"
                            onClick={() => toggleExpanded(transaction.id)}
                          >
                            Split ({transaction.lines.length})
                          </button>
                        ) : (
                          transaction.hasCategoryLine && (transaction.categoryName ?? UNCATEGORIZED)
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{transaction.memo}</td>
                      <td className="px-2 py-1.5 text-right">
                        {transaction.amountCents < 0 && (
                          <Money cents={-transaction.amountCents} className="text-foreground" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {transaction.amountCents > 0 && <Money cents={transaction.amountCents} />}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <ClearedToggle transaction={transaction} />
                      </td>
                      {showBalance && (
                        <td className="px-2 py-1.5 text-right">
                          <Money cents={transaction.runningBalanceCents ?? 0} />
                        </td>
                      )}
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!account}
                          onClick={() => setEditingId(transaction.id)}
                        >
                          Edit
                        </Button>
                        <DeleteButton
                          transaction={transaction}
                          onDelete={() => deleteTransaction.mutate(transaction.id)}
                        />
                      </td>
                    </tr>
                    {isExpanded &&
                      transaction.lines.map((line, index) => (
                        <tr
                          key={index}
                          aria-label={`Split line ${index + 1}`}
                          className="border-b bg-muted/40 text-muted-foreground last:border-0"
                        >
                          <td />
                          {showAccount && <td />}
                          <td />
                          <td className="px-2 py-1 pl-5 text-foreground">
                            {line.categoryName ?? UNCATEGORIZED}
                          </td>
                          <td className="px-2 py-1">{line.memo}</td>
                          <td className="px-2 py-1 text-right">
                            {line.amountCents < 0 && <Money cents={-line.amountCents} />}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {line.amountCents > 0 && <Money cents={line.amountCents} />}
                          </td>
                          <td />
                          {showBalance && <td />}
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && onLoadMore && <LoadMore onLoadMore={onLoadMore} isLoading={isLoadingMore} />}
    </>
  );
}

function deleteDescription(transaction: Transaction) {
  return [
    transaction.cleared === 'reconciled' &&
      'This transaction is reconciled, so the account may stop matching your bank.',
    transaction.transferAccountName &&
      `This also deletes the matching transaction in ${transaction.transferAccountName}.`,
    "This can't be undone.",
  ]
    .filter(Boolean)
    .join(' ');
}

/** A transaction's category for the second line of a phone row. */
function phoneCategory(transaction: Transaction) {
  if (transaction.lines.length > 1) return `Split (${transaction.lines.length})`;
  if (!transaction.hasCategoryLine) return null;
  return transaction.categoryName ?? UNCATEGORIZED;
}

/**
 * On phones, as in YNAB's app: two-line rows with payee and amount, then date and category.
 * Tapping a row opens it full screen for editing. Running balances are left out.
 */
function PhoneRegister({
  transactions,
  showAccount,
  editingId,
  onEdit,
  onSave,
  onDelete,
}: {
  transactions: Transaction[];
  showAccount: boolean;
  editingId: number | null;
  onEdit: (id: number | null) => void;
  onSave: (id: number, input: TransactionInput) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const editing = transactions.find((transaction) => transaction.id === editingId);
  const editingAccount = accounts.data?.find((a) => a.id === editing?.accountId);

  return (
    <>
      <ul aria-label="Transactions" className="divide-y rounded-lg border bg-card">
        {transactions.map((transaction) => {
          const category = phoneCategory(transaction);
          return (
            <li key={transaction.id} className="flex items-center gap-1 px-1">
              <RegisterFlag transaction={transaction} />
              <button
                type="button"
                aria-label={`Edit ${payeeLabel(transaction) || 'transaction'}, ${transaction.date}`}
                onClick={() => onEdit(transaction.id)}
                className="flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 px-1 py-1.5 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {payeeLabel(transaction) || 'No payee'}
                  </span>
                  <Money
                    cents={transaction.amountCents}
                    className={cn(transaction.amountCents < 0 && 'text-foreground')}
                  />
                </span>
                <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{transaction.date}</span>
                  {showAccount && <span className="truncate">{transaction.accountName}</span>}
                  {category && <span className="min-w-0 truncate">{category}</span>}
                </span>
              </button>
              <ClearedToggle transaction={transaction} />
            </li>
          );
        })}
      </ul>

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && onEdit(null)}>
        {editing && editingAccount && (
          <DialogContent placement="full">
            <DialogHeader title="Edit transaction" />
            <TransactionForm
              label="Edit transaction"
              submitLabel="Save"
              account={editingAccount}
              transaction={editing}
              onSubmit={(input) => onSave(editing.id, input)}
              onCancel={() => onEdit(null)}
            />
            <div className="mt-6 border-t pt-4">
              <DeleteButton
                transaction={editing}
                label="Delete transaction"
                onDelete={() => onDelete(editing.id)}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
