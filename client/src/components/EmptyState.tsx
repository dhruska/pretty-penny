import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A friendly placeholder for an empty list: an icon, what's missing, and what to do about it. */
export function EmptyState({
  Icon,
  title,
  children,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
