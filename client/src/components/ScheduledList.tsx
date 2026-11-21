import {
  api,
  type Account,
  type ScheduledTransaction,
  type TransactionDraft,
  type TransactionInput,
  type Frequency,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { frequencyLabel } from '@/lib/frequencies';
import { notify, notifyError } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useIsPhone } from '@/lib/useIsPhone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete';
import { FlagBadge } from './FlagPicker';
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
    flag: schedule.flag,
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
    mutationFn: ({ run }: { run: () => Promise<unknown>; done: string }) => run(),
    onSuccess: (_result, { done }) => {
      refresh(queryClient, 'transactions');
      notify(done);
    },
    onError: notifyError,
  });
  const enterNow = (id: number) => ({ run: () => api.enterScheduledNow(id), done: 'Entered' });
  const skip = (id: number) => ({ run: () => api.skipScheduled(id), done: 'Skipped this time' });
  const remove = (id: number) => ({
    run: () => api.deleteScheduled(id),
    done: 'Scheduled transaction deleted',
  });

  async function saveEdit(id: number, input: TransactionInput, frequency: Frequency | null) {
    const { posted } = await api.updateScheduled(id, { ...input, frequency: frequency ?? 'never' });
    setEditingId(null);
    refresh(queryClient, posted > 0 ? 'transactions' : 'schedules');
    notify('Scheduled transaction saved');
  }

  const isPhone = useIsPhone();

  if (!schedules.data || schedules.data.length === 0) return null;

  if (isPhone) {
    const editing = schedules.data.find((schedule) => schedule.id === editingId);
    const run = (task: { run: () => Promise<unknown>; done: string }) => {
      action.mutate(task);
      setEditingId(null);
    };
    return (
      <section aria-label="Scheduled transactions" className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Scheduled</h3>
        <ul className="divide-y rounded-lg border border-dashed bg-muted/40">
          {schedules.data.map((schedule) => (
            <li key={schedule.id}>
              <button
                type="button"
                aria-label={`Edit scheduled ${scheduleLabel(schedule) || 'transaction'}, next on ${schedule.nextDate}`}
                onClick={() => setEditingId(schedule.id)}
                className="flex min-h-14 w-full cursor-pointer flex-col justify-center gap-0.5 px-3 py-1.5 text-left text-muted-foreground"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {schedule.flag && <FlagBadge color={schedule.flag} />}
                    <span className="truncate">{scheduleLabel(schedule)}</span>
                  </span>
                  <Money cents={schedule.amountCents} className="text-muted-foreground" />
                </span>
                <span className="flex gap-2 text-xs">
                  <span className="tabular-nums">{schedule.nextDate}</span>
                  <span>{frequencyLabel(schedule.frequency)}</span>
                  <span className="min-w-0 truncate">{categoryLabel(schedule)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditingId(null)}>
          {editing && (
            <DialogContent placement="full">
              <DialogHeader title="Scheduled transaction" />
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => run(enterNow(editing.id))}
                >
                  Enter now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => run(skip(editing.id))}
                >
                  Skip
                </Button>
                <ConfirmDelete
                  triggerLabel="Delete"
                  title="Delete this scheduled transaction?"
                  description="Future occurrences won't be entered. Transactions it already entered stay."
                  onConfirm={() => run(remove(editing.id))}
                />
              </div>
              <TransactionForm
                label="Edit scheduled transaction"
                submitLabel="Save"
                account={account}
                transaction={toDraft(editing)}
                allowRepeat
                initialFrequency={editing.frequency}
                onSubmit={(input, frequency) => saveEdit(editing.id, input, frequency)}
                onCancel={() => setEditingId(null)}
              />
            </DialogContent>
          )}
        </Dialog>
      </section>
    );
  }

  return (
    <section aria-label="Scheduled transactions" className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Scheduled</h3>
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
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {schedule.flag && <FlagBadge color={schedule.flag} />}
                      {scheduleLabel(schedule)}
                    </span>
                  </td>
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
                      onClick={() => action.mutate(enterNow(schedule.id))}
                    >
                      Enter now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate(skip(schedule.id))}
                    >
                      Skip
                    </Button>
                    <ConfirmDelete
                      triggerLabel="Delete"
                      title="Delete this scheduled transaction?"
                      description="Future occurrences won't be entered. Transactions it already entered stay."
                      onConfirm={() => action.mutate(remove(schedule.id))}
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
