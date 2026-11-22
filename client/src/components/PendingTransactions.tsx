import { api } from '@/api';
import { shortDate } from '@/lib/dates';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Money } from './Money';

/**
 * Transactions the bank hasn't posted yet, apart from the register as in YNAB. They don't affect
 * balances or the budget, and are replaced by the posted transaction once it arrives.
 */
export function PendingTransactions({ accountId }: { accountId: number }) {
  const pending = useQuery({
    queryKey: ['pending', accountId],
    queryFn: () => api.listPending(accountId),
  });
  const rows = pending.data ?? [];
  if (rows.length === 0) return null;

  return (
    <details className="group rounded-xl border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
        />
        Pending ({rows.length})
        <span className="font-normal text-muted-foreground max-sm:hidden">
          · not in your balances until they post
        </span>
      </summary>
      <ul aria-label="Pending transactions" className="divide-y border-t">
        {rows.map((row) => (
          <li key={row.id} className="flex items-baseline gap-3 px-3 py-2 text-muted-foreground">
            <time dateTime={row.date} className="w-14 shrink-0 tabular-nums">
              {shortDate(row.date)}
            </time>
            <span className="min-w-0 flex-1 truncate text-foreground">{row.payee}</span>
            <Money cents={row.amountCents} />
          </li>
        ))}
      </ul>
    </details>
  );
}
