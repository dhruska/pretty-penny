import { api, type Account } from '@/api';
import { Button } from '@/components/ui/button';
import { notify, notifyError } from '@/lib/notify';
import { refresh } from '@/lib/queries';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Above an account's register when transactions from the bank need review, as in YNAB: Review
 * shows only those, and Approve all approves every one.
 */
export function ReviewBanner({
  account,
  reviewing,
  onReview,
}: {
  account: Account;
  reviewing: boolean;
  onReview: (reviewing: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const approveAll = useMutation({
    mutationFn: () => api.approveAll(account.id),
    onSuccess: ({ approved }) => {
      onReview(false);
      notify(approved === 1 ? '1 transaction approved' : `${approved} transactions approved`);
    },
    onError: notifyError,
    onSettled: () => refresh(queryClient, 'imports'),
  });

  const count = account.unapprovedCount;
  if (count === 0) return null;
  return (
    <section
      aria-label="Needs review"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-accent-soft px-3 py-2 text-sm"
    >
      <p className="font-medium text-accent-ink">
        {count === 1 ? '1 transaction needs review' : `${count} transactions need review`}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onReview(!reviewing)}>
          {reviewing ? 'Show all' : 'Review'}
        </Button>
        <Button size="sm" disabled={approveAll.isPending} onClick={() => approveAll.mutate()}>
          Approve all
        </Button>
      </div>
    </section>
  );
}
