import {
  api,
  type Account,
  type ScheduledTransaction,
  type TransactionDraft,
  type TransactionInput,
  type Frequency,
} from '@/api';
import { Button } from '@/components/ui/button';
import { frequencyLabel } from '@/lib/frequencies';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete';
import { Money } from './Money';
import { TransactionForm } from './TransactionForm';

/** A schedule's next occurrence, in the shape the transaction form starts from. */
function toDraft(schedule: ScheduledTransaction): TransactionDraft {
  return {
    date: schedule.nextDate,
    payee: schedule.payee,
    memo: schedule.memo,
    amountCents: schedule.amountCents,
    categoryId: schedule.categoryId,
    transferAccountId: schedule.transferAccountId,
    lines: (schedule.lines ?? []).map((line) => ({ ...line, categoryName: null })),
  };
}

function scheduleLabel(schedule: ScheduledTransaction) {
  return schedule.transferAccountName
    ? `Transfer: ${schedule.transferAccountName}`
    : schedule.payee;
}

function categoryLabel(schedule: ScheduledTransaction) {
  if (schedule.lines) return `Split (${schedule.lines.length})`;
  return schedule.categoryName ?? '';
}

/** Upcoming scheduled transactions for an account, shown above its register as in YNAB. */
export function ScheduledList({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const schedules = useQuery({
    queryKey: ['scheduled', account.id],
    queryFn: () => api.listScheduled(account.id),
  });

  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  async function saveEdit(id: number, input: TransactionInput, frequency: Frequency | null) {
    await api.updateScheduled(id, { ...input, frequency: frequency ?? 'never' });
    await queryClient.invalidateQueries();
    setEditingId(null);
  }

  if (!schedules.data || schedules.data.length === 0) return null;

  return (
    <section aria-label="Scheduled transactions" className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Scheduled</h3>
      {action.isError && <p className="text-sm text-negative">{action.error.message}</p>}
      <div className="relative overflow-x-auto rounded-lg border border-dashed bg-muted/40">
        <table className="w-full min-w-[46rem] text-sm">
          <tbody>
            {schedules.data.map((schedule) =>
              schedule.id === editingId ? (
                <tr key={schedule.id}>
                  <td colSpan={7} className="p-3">
                    <TransactionForm
                      label="Edit scheduled transaction"
                      submitLabel="Save"
                      account={account}
                      transaction={toDraft(schedule)}
                      allowRepeat
                      initialFrequency={schedule.frequency}
                      onSubmit={(input, frequency) => saveEdit(schedule.id, input, frequency)}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={schedule.id} className="border-b text-muted-foreground last:border-0">
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                    {schedule.nextDate}
                  </td>
                  <td className="px-2 py-1.5">{scheduleLabel(schedule)}</td>
                  <td className="px-2 py-1.5">{categoryLabel(schedule)}</td>
                  <td className="px-2 py-1.5">{frequencyLabel(schedule.frequency)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Money cents={schedule.amountCents} className="text-muted-foreground" />
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(schedule.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate(() => api.enterScheduledNow(schedule.id))}
                    >
                      Enter now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate(() => api.skipScheduled(schedule.id))}
                    >
                      Skip
                    </Button>
                    <ConfirmDelete
                      triggerLabel="Delete"
                      title="Delete this scheduled transaction?"
                      description="Future occurrences won't be entered. Transactions it already entered stay."
                      onConfirm={() => action.mutate(() => api.deleteScheduled(schedule.id))}
                    />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
