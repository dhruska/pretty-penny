import { api } from '@/api';
import { SELECT_CLASS } from '@/components/CategorySelect';
import { IncomeExpense } from '@/components/reports/IncomeExpense';
import { NetWorth } from '@/components/reports/NetWorth';
import { SpendingBreakdown } from '@/components/reports/SpendingBreakdown';
import { SpendingTrends } from '@/components/reports/SpendingTrends';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { presetRange, RANGE_PRESETS, rangeParams, type RangePreset } from '@/lib/dateRanges';
import { today } from '@/lib/dates';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type ReactNode } from 'react';

const REPORTS = [
  { value: 'spending', label: 'Spending breakdown' },
  { value: 'trends', label: 'Spending trends' },
  { value: 'incomeExpense', label: 'Income v expense' },
  { value: 'netWorth', label: 'Net worth' },
] as const;

type Report = (typeof REPORTS)[number]['value'];
type GroupBy = 'category' | 'group' | 'payee';

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ReportsPage() {
  const id = useId();
  const [report, setReport] = useState<Report>('spending');
  const [preset, setPreset] = useState<RangePreset>('last3Months');
  const [custom, setCustom] = useState(() => presetRange('last3Months'));
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [trendFilter, setTrendFilter] = useState('');
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });

  const range =
    preset === 'custom' ? { from: custom.from, to: custom.to || today() } : presetRange(preset);
  const extra: Record<string, string> =
    report === 'spending'
      ? { groupBy }
      : report === 'trends' && trendFilter
        ? { [trendFilter.split(':')[0]!]: trendFilter.split(':')[1]! }
        : {};
  const params = rangeParams(range, extra);

  const data = useQuery({
    queryKey: ['report', report, params.toString()],
    queryFn: async () => {
      if (report === 'spending') return { report, data: await api.spendingReport(params) } as const;
      if (report === 'trends') return { report, data: await api.trendsReport(params) } as const;
      if (report === 'incomeExpense') {
        return { report, data: await api.incomeExpenseReport(params) } as const;
      }
      return { report, data: await api.netWorthReport(params) } as const;
    },
    placeholderData: keepPreviousData,
  });

  const trendSubject = (() => {
    if (!trendFilter) return 'All spending';
    const [kind, value] = trendFilter.split(':');
    const groups = categories.data?.groups ?? [];
    if (kind === 'groupId') return groups.find((group) => String(group.id) === value)?.name ?? '';
    return (
      groups.flatMap((group) => group.categories).find((category) => String(category.id) === value)
        ?.name ?? ''
    );
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Reports</h2>
        <div className="flex flex-wrap gap-2">
          {/* Plain links, so the browser saves the CSV the server sends as a download. */}
          <Button asChild variant="secondary" size="sm">
            <a href="/api/export/transactions.csv" download>
              Export transactions
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href="/api/export/budget.csv" download>
              Export budget
            </a>
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-1">
        {REPORTS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={report === option.value}
            onClick={() => setReport(option.value)}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1.5 text-sm hover:bg-muted',
              report === option.value && 'bg-muted font-medium',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section
        aria-label="Report filters"
        className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 md:grid-cols-4"
      >
        <Field label="Dates" id={`${id}-range`}>
          <select
            id={`${id}-range`}
            className={SELECT_CLASS}
            value={preset}
            onChange={(event) => setPreset(event.target.value as RangePreset)}
          >
            {RANGE_PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="From" id={`${id}-from`}>
              <Input
                id={`${id}-from`}
                type="date"
                value={custom.from ?? ''}
                onChange={(event) => setCustom({ ...custom, from: event.target.value })}
              />
            </Field>
            <Field label="To" id={`${id}-to`}>
              <Input
                id={`${id}-to`}
                type="date"
                value={custom.to}
                onChange={(event) => setCustom({ ...custom, to: event.target.value })}
              />
            </Field>
          </>
        )}
        {report === 'spending' && (
          <Field label="Group by" id={`${id}-group`}>
            <select
              id={`${id}-group`}
              className={SELECT_CLASS}
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            >
              <option value="category">Category</option>
              <option value="group">Category group</option>
              <option value="payee">Payee</option>
            </select>
          </Field>
        )}
        {report === 'trends' && (
          <Field label="Show" id={`${id}-trend`}>
            <select
              id={`${id}-trend`}
              className={SELECT_CLASS}
              value={trendFilter}
              onChange={(event) => setTrendFilter(event.target.value)}
            >
              <option value="">All spending</option>
              {categories.data?.groups.map((group) => (
                <optgroup key={group.id} label={group.name}>
                  <option value={`groupId:${group.id}`}>All of {group.name}</option>
                  {group.categories.map((category) => (
                    <option key={category.id} value={`categoryId:${category.id}`}>
                      {category.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        )}
      </section>

      {data.isError && <p className="text-negative">{data.error.message}</p>}
      {data.isPending && <p className="text-muted-foreground">Loading…</p>}
      {/* The previous report stays, dimmed, while the next loads, so the page doesn't jump. */}
      <div className={cn(data.isPlaceholderData && 'opacity-60 transition-opacity')}>
        {data.data?.report === 'spending' && <SpendingBreakdown report={data.data.data} />}
        {data.data?.report === 'trends' && (
          <SpendingTrends report={data.data.data} subject={trendSubject} />
        )}
        {data.data?.report === 'incomeExpense' && <IncomeExpense report={data.data.data} />}
        {data.data?.report === 'netWorth' && <NetWorth points={data.data.data} />}
      </div>
    </div>
  );
}
