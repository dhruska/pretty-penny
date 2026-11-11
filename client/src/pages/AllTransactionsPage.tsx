import { api } from '@/api';
import { SELECT_CLASS } from '@/components/CategorySelect';
import { Money } from '@/components/Money';
import { TransactionRegister } from '@/components/TransactionRegister';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { currentMonth, monthRange, shiftMonth } from '@/lib/months';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useId, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

const FILTER_KEYS = ['q', 'accountId', 'categoryId', 'from', 'to', 'cleared'] as const;

type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;
type DatePreset = 'all' | 'thisMonth' | 'lastMonth' | 'custom';

function readFilters(params: URLSearchParams): Filters {
  return Object.fromEntries(
    FILTER_KEYS.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function AllTransactionsPage() {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });

  // The filters live in state so quick successive changes never work from stale values, and are
  // copied into the URL so filtered links, such as from the budget's uncategorized notice, work.
  const [filters, setFilters] = useState<Filters>(() => readFilters(params));
  const latestFilters = useRef(filters);

  const filterKey = useDeferredValue(
    new URLSearchParams(filters as Record<string, string>).toString(),
  );
  const results = useQuery({
    queryKey: ['search', filterKey],
    queryFn: () => api.searchTransactions(new URLSearchParams(filterKey)),
    placeholderData: keepPreviousData,
  });

  const thisMonth = monthRange(currentMonth());
  const lastMonth = monthRange(shiftMonth(currentMonth(), -1));
  const from = filters.from ?? '';
  const to = filters.to ?? '';
  const matchedPreset: DatePreset =
    !from && !to
      ? 'all'
      : from === thisMonth.from && to === thisMonth.to
        ? 'thisMonth'
        : from === lastMonth.from && to === lastMonth.to
          ? 'lastMonth'
          : 'custom';
  const [isCustom, setIsCustom] = useState(matchedPreset === 'custom');
  const datePreset = isCustom ? 'custom' : matchedPreset;

  function update(changes: Filters) {
    const next: Filters = { ...latestFilters.current };
    for (const [key, value] of Object.entries(changes) as [FilterKey, string][]) {
      if (value) next[key] = value;
      else delete next[key];
    }
    latestFilters.current = next;
    setFilters(next);
    setParams(new URLSearchParams(next as Record<string, string>), { replace: true });
  }

  function chooseDatePreset(preset: DatePreset) {
    setIsCustom(preset === 'custom');
    if (preset === 'all') update({ from: '', to: '' });
    if (preset === 'thisMonth') update(thisMonth);
    if (preset === 'lastMonth') update(lastMonth);
  }

  const listed = results.data?.transactions ?? [];
  const totalCents = listed.reduce((sum, transaction) => sum + transaction.amountCents, 0);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">All transactions</h2>

      <section
        aria-label="Filters"
        className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 md:grid-cols-5"
      >
        <div className="col-span-2 md:col-span-1">
          <Field label="Search" id={`${id}-q`}>
            <Input
              id={`${id}-q`}
              type="search"
              placeholder="Payee, category, memo…"
              value={filters.q ?? ''}
              onChange={(event) => update({ q: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Account" id={`${id}-account`}>
          <select
            id={`${id}-account`}
            className={SELECT_CLASS}
            value={filters.accountId ?? ''}
            onChange={(event) => update({ accountId: event.target.value })}
          >
            <option value="">All accounts</option>
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" id={`${id}-category`}>
          <select
            id={`${id}-category`}
            className={SELECT_CLASS}
            value={filters.categoryId ?? ''}
            onChange={(event) => update({ categoryId: event.target.value })}
          >
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {categories.data && (
              <option value={categories.data.readyToAssignId}>Ready to Assign</option>
            )}
            {categories.data?.groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Dates" id={`${id}-dates`}>
          <select
            id={`${id}-dates`}
            className={SELECT_CLASS}
            value={datePreset}
            onChange={(event) => chooseDatePreset(event.target.value as DatePreset)}
          >
            <option value="all">All dates</option>
            <option value="thisMonth">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Cleared" id={`${id}-cleared`}>
          <select
            id={`${id}-cleared`}
            className={SELECT_CLASS}
            value={filters.cleared ?? ''}
            onChange={(event) => update({ cleared: event.target.value })}
          >
            <option value="">Any</option>
            <option value="cleared">Cleared</option>
            <option value="uncleared">Uncleared</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </Field>
        {datePreset === 'custom' && (
          <>
            <Field label="From" id={`${id}-from`}>
              <Input
                id={`${id}-from`}
                type="date"
                value={from}
                onChange={(event) => update({ from: event.target.value })}
              />
            </Field>
            <Field label="To" id={`${id}-to`}>
              <Input
                id={`${id}-to`}
                type="date"
                value={to}
                onChange={(event) => update({ to: event.target.value })}
              />
            </Field>
          </>
        )}
      </section>

      {results.isError && <p className="text-negative">{results.error.message}</p>}
      {results.isPending && <p className="text-muted-foreground">Loading…</p>}
      {results.data && (
        <>
          <p aria-label="Results summary" className="text-sm text-muted-foreground">
            {listed.length === 1 ? '1 transaction' : `${listed.length} transactions`}
            {results.data.hasMore && ' shown (more match; narrow the filters to see them)'}
            {' · Total '}
            <Money cents={totalCents} className="font-medium text-foreground" />
          </p>
          <TransactionRegister
            transactions={listed}
            showAccount
            emptyMessage="No transactions match."
          />
        </>
      )}
    </div>
  );
}
