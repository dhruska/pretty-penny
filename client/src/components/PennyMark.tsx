import { cn } from 'cn';

/** The penny logo, drawn in the theme's copper so it suits light and dark. */
export function PennyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <circle cx="14" cy="14" r="13" fill="var(--primary)" />
      <circle
        cx="14"
        cy="14"
        r="10.5"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeDasharray="1 2.4"
      />
      <path
        d="M17 10.6a4.6 4.6 0 1 0 0 6.8M14 7.5v13"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
