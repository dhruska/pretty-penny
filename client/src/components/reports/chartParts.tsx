import { formatCents } from '@/lib/money';
import { formatMonth } from '@/lib/months';
import type { ReactNode } from 'react';

/** Recessive chart chrome, from the validated dataviz palette. */
export const CHART = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  inkMuted: 'var(--chart-ink-muted)',
  series: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const,
  tick: { fill: 'var(--chart-ink-muted)', fontSize: 12 },
};

/** Compact axis labels for cents, such as $950, $1.2K or $-3K. */
export function compactMoney(cents: number): string {
  const dollars = cents / 100;
  const absolute = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  if (absolute >= 1_000_000) return `${sign}$${trim(absolute / 1_000_000)}M`;
  if (absolute >= 1_000) return `${sign}$${trim(absolute / 1_000)}K`;
  return `${sign}$${Math.round(absolute)}`;
}

function trim(value: number) {
  return value.toFixed(1).replace(/\.0$/, '');
}

/** "Mar 26" style labels for month ticks. */
export function shortMonth(month: string): string {
  const [name, year] = formatMonth(month).split(' ');
  return `${name!.slice(0, 3)} ${year!.slice(2)}`;
}

/** A tooltip in text tokens, with a swatch beside each value rather than colored text. */
export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; cents: number; color?: string }[];
}) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {row.color && (
              <span className="size-2 rounded-full" style={{ backgroundColor: row.color }} />
            )}
            {row.label}
          </span>
          <span className="tabular-nums">{formatCents(row.cents)}</span>
        </p>
      ))}
    </div>
  );
}

/** A card holding one report: its title, chart and the table of the same numbers. */
export function ReportCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A legend entry: a colored mark beside text in the normal ink. */
export function LegendItem({
  color,
  label,
  line,
}: {
  color: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={line ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-sm'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
