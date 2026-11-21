import { formatCents } from '@/lib/money';
import { cn } from 'cn';

export function Money({ cents, className }: { cents: number; className?: string }) {
  return (
    // Browsers treat the minus sign as a place a line may break, so amounts never wrap.
    <span className={cn('whitespace-nowrap tabular-nums', cents < 0 && 'text-negative', className)}>
      {formatCents(cents)}
    </span>
  );
}
