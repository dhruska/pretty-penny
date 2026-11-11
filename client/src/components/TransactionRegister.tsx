import { api, isReconciledError, type Transaction, type TransactionInput } from '@/api';
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
import { payeeLabel } from '@/lib/transactions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Fragment, useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete';
import { Money } from './Money';
import { TransactionForm } from './TransactionForm';

const UNCATEGORIZED = <span className="font-medium text-warning">Uncategorized</span>;

interface TransactionRegisterProps {
  transactions: Transaction[];
  /** Shows each transaction's account, for lists spanning several accounts. */
  showAccount?: boolean;
  emptyMessage?: string;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current">
      <path d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}

function ClearedToggle({ transaction }: { transaction: Transaction }) {
  const queryClient = useQueryClient();
  const isCleared = transaction.cleared === 'cleared';
  const toggle = useMutation({
    mutationFn: () =>
      api.updateTransaction(transaction.id, { cleared: isCleared ? 'uncleared' : 'cleared' }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  // As in YNAB, reconciled transactions are locked and can't go back to cleared or uncleared.
  if (transaction.cleared === 'reconciled') {
    return (
      <span
        role="img"
        aria-label="Reconciled"
        title="Reconciled and locked"
        className="inline-flex size-6 items-center justify-center text-positive"
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
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
      className={cn(
        'inline-flex size-6 cursor-pointer items-center justify-center rounded-full border text-xs font-semibold',
        isCleared
          ? 'border-positive bg-positive text-white'
          : 'border-border text-muted-foreground hover:border-positive',
      )}
    >
      C
    </button>
  );
}

export function TransactionRegister({
  transactions,
  showAccount = false,
  emptyMessage = 'No transactions yet.',
}: TransactionRegisterProps) {
  const queryClient = useQueryClient();
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
  const showBalance = !showAccount;
  const columnCount = 9;

  const deleteTransaction = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => queryClient.invalidateQueries(),
  });

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
    await queryClient.invalidateQueries();
    setEditingId(null);
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
      {deleteTransaction.isError && (
        <p className="mb-2 text-sm text-negative">{deleteTransaction.error.message}</p>
      )}
      {/* `relative` keeps the visually hidden column label inside the scroll area. */}
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Date</th>
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
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                      {transaction.date}
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
                      <ConfirmDelete
                        triggerLabel="Delete"
                        title="Delete this transaction?"
                        description={[
                          transaction.cleared === 'reconciled' &&
                            'This transaction is reconciled, so the account may stop matching your bank.',
                          transaction.transferAccountName &&
                            `This also deletes the matching transaction in ${transaction.transferAccountName}.`,
                          "This can't be undone.",
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onConfirm={() => deleteTransaction.mutate(transaction.id)}
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
    </>
  );
}
