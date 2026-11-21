import { cn } from 'cn';

/** A grey placeholder shape shown while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** Placeholder rows in the shape of a list or table, with a label for screen readers. */
export function SkeletonRows({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 rounded-lg border bg-card p-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
