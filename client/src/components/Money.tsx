import { formatCents } from '@/lib/money';
import { cn } from 'cn';

export function Money({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={cn('tabular-nums', cents < 0 && 'text-negative', className)}>
      {formatCents(cents)}
    </span>
  );
}
