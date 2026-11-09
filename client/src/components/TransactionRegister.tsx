import { api, type Transaction, type TransactionInput } from '@/api';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete';
import { Money } from './Money';
import { TransactionForm } from './TransactionForm';

const COLUMN_COUNT = 7;

export function TransactionRegister({ transactions }: { transactions: Transaction[] }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);

  const deleteTransaction = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  async function saveEdit(id: number, input: TransactionInput) {
    await api.updateTransaction(id, input);
    await queryClient.invalidateQueries();
    setEditingId(null);
  }

  if (transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions yet.</p>;
  }

  return (
    <>
      {deleteTransaction.isError && (
        <p className="mb-2 text-sm text-negative">{deleteTransaction.error.message}</p>
      )}
      {/* `relative` keeps the visually hidden column label inside the scroll area. */}
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Payee</th>
              <th className="px-3 py-2 font-medium">Memo</th>
              <th className="px-3 py-2 text-right font-medium">Outflow</th>
              <th className="px-3 py-2 text-right font-medium">Inflow</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) =>
              transaction.id === editingId ? (
                <tr key={transaction.id} className="border-b last:border-0">
                  <td colSpan={COLUMN_COUNT} className="p-3">
                    <TransactionForm
                      label="Edit transaction"
                      submitLabel="Save"
                      transaction={transaction}
                      onSubmit={(input) => saveEdit(transaction.id, input)}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={transaction.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{transaction.date}</td>
                  <td className="px-3 py-1.5">{transaction.payee}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{transaction.memo}</td>
                  <td className="px-3 py-1.5 text-right">
                    {transaction.amountCents < 0 && (
                      <Money cents={-transaction.amountCents} className="text-foreground" />
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {transaction.amountCents > 0 && <Money cents={transaction.amountCents} />}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Money cents={transaction.runningBalanceCents} />
                  </td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(transaction.id)}>
                      Edit
                    </Button>
                    <ConfirmDelete
                      triggerLabel="Delete"
                      title="Delete this transaction?"
                      description="This can't be undone."
                      onConfirm={() => deleteTransaction.mutate(transaction.id)}
                    />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
