import {
  api,
  type ImportNotes,
  type ImportPreview,
  type ImportReport,
  type YnabPlanSummary,
} from '@/api';
import { SELECT_CLASS } from '@/components/CategorySelect';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { accountTypeLabel } from '@/lib/accountTypes';
import { today } from '@/lib/dates';
import {
  fractionalAmountLine,
  needsAttention,
  noteLines,
  partLine,
  plural,
  reportText,
  skippedScheduleLine,
  toFixLine,
  ynabTypeLabel,
} from '@/lib/importReport';
import { formatMonth } from '@/lib/months';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function ErrorText({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="text-sm text-negative">
      {error.message}
    </p>
  ) : null;
}

function Preview({ preview }: { preview: ImportPreview }) {
  const { counts, notes } = preview;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {plural(counts.accounts, 'account', 'accounts')},{' '}
        {plural(counts.categories, 'category', 'categories')} in{' '}
        {plural(counts.categoryGroups, 'group', 'groups')},{' '}
        {plural(counts.transactions, 'transaction', 'transactions')},{' '}
        {plural(counts.payees, 'payee', 'payees')},{' '}
        {plural(counts.scheduled, 'scheduled transaction', 'scheduled transactions')} and{' '}
        {plural(counts.months, 'month', 'months')} of assignments.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Account</th>
              <th className="py-1.5 pr-3 font-medium">In YNAB</th>
              <th className="py-1.5 pr-3 font-medium">In Pretty Penny</th>
              <th className="py-1.5 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {preview.accounts.map((account) => (
              <tr key={account.name} className="border-b last:border-0">
                <td className="py-1.5 pr-3">
                  {account.name}
                  {account.closed && <span className="text-muted-foreground"> (closed)</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{ynabTypeLabel(account.ynabType)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {accountTypeLabel(account.type)}
                  <span className="text-muted-foreground">
                    {' '}
                    · {account.onBudget ? 'Budget' : 'Tracking'}
                  </span>
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <Money cents={account.balanceCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="text-sm font-medium">Changes from YNAB</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {noteLines(notes).map((line) => (
            <li key={line}>{line}</li>
          ))}
          {notes.skippedSchedules.length > 0 && (
            <li>
              {plural(
                notes.skippedSchedules.length,
                'scheduled transaction is',
                'scheduled transactions are',
              )}{' '}
              skipped:
              <ul className="mt-1 list-[circle] space-y-1 pl-5">
                {notes.skippedSchedules.map((schedule) => (
                  <li key={skippedScheduleLine(schedule)}>{skippedScheduleLine(schedule)}</li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      </div>
      <ToFixList notes={notes} imported={false} />
    </>
  );
}

/** Transactions to look at once imported: those without a category, and unpaired transfers. */
function ToFixList({ notes, imported }: { notes: ImportNotes; imported: boolean }) {
  if (notes.toFix.length === 0) return null;
  return (
    <div className="text-sm">
      <h4 className="font-medium">To fix after importing</h4>
      <p className="text-muted-foreground">
        {imported ? (
          <>
            Find these in{' '}
            <Link to="/transactions" className="text-primary underline-offset-2 hover:underline">
              All transactions
            </Link>
            . Give each a category, or edit an unpaired transfer and choose the account it went to.
          </>
        ) : (
          'These come in as they are. You can fix them in Pretty Penny afterward.'
        )}
      </p>
      <ul className="mt-1 max-h-64 list-disc space-y-1 overflow-y-auto pl-5">
        {notes.toFix.map((item, index) => (
          <li key={index}>{toFixLine(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function Report({ report }: { report: ImportReport }) {
  const { readyToAssign } = report;
  const mismatched = report.accounts.filter((account) => !account.matches);

  function download() {
    const url = URL.createObjectURL(new Blob([reportText(report)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pretty-penny-import-report-${today()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <p
        className={cn(
          'rounded-md p-3 text-sm',
          needsAttention(report) ? 'bg-warning/10' : 'bg-positive/10',
        )}
      >
        {needsAttention(report)
          ? 'Imported, but some figures don’t match YNAB in ways the import can’t explain. The details are below.'
          : 'Imported. Every account balance matches YNAB, and the budget differs only in the expected ways below.'}
      </p>

      <div>
        <h4 className="text-sm font-medium">
          Account balances{' '}
          <span className="font-normal text-muted-foreground">
            {mismatched.length === 0
              ? `(all ${report.accounts.length} match)`
              : `(${plural(mismatched.length, 'doesn’t', 'don’t')} match)`}
          </span>
        </h4>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Account</th>
                <th className="py-1.5 pr-3 text-right font-medium">Balance</th>
                <th className="py-1.5 pr-3 text-right font-medium">In YNAB</th>
                <th className="py-1.5 pr-3 text-right font-medium">Cleared</th>
                <th className="py-1.5 pr-3 text-right font-medium">In YNAB</th>
                <th className="py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((account) => (
                <tr key={account.name} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{account.name}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                    <Money cents={account.balanceCents} />
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                    <Money cents={account.ynabBalanceCents} />
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                    <Money cents={account.clearedCents} />
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                    <Money cents={account.ynabClearedCents} />
                  </td>
                  <td className={cn('py-1.5', !account.matches && 'font-medium text-negative')}>
                    {account.matches ? 'Matches' : 'Differs'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1 text-sm">
        <h4 className="font-medium">Budget for {formatMonth(report.month)}</h4>
        <p>
          Ready to Assign is <Money cents={readyToAssign.cents} /> here and{' '}
          <Money cents={readyToAssign.ynabCents} /> in YNAB.
        </p>
        {readyToAssign.parts.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {readyToAssign.parts.map((part) => (
              <li
                key={part.key}
                className={cn(part.key === 'unexplained' && 'font-medium text-negative')}
              >
                {partLine(part)}
              </li>
            ))}
          </ul>
        )}
        {report.categoryDifferences.length === 0 ? (
          <p>
            Available matches YNAB in all{' '}
            {plural(report.categoriesCompared, 'category', 'categories')}.
          </p>
        ) : (
          <>
            <p className="font-medium text-negative">
              {plural(report.categoryDifferences.length, 'category doesn’t', 'categories don’t')}{' '}
              match YNAB. That isn’t expected and is worth investigating:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {report.categoryDifferences.map((difference) => (
                <li key={`${difference.groupName}/${difference.name}`}>
                  {difference.groupName}: {difference.name} has{' '}
                  <Money cents={difference.availableCents} /> here and{' '}
                  <Money cents={difference.ynabAvailableCents} /> in YNAB, first differing in{' '}
                  {formatMonth(difference.firstMonth)}.
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <ToFixList notes={report.notes} imported />

      {report.notes.skippedSchedules.length > 0 && (
        <div className="text-sm">
          <h4 className="font-medium">Skipped scheduled transactions</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.notes.skippedSchedules.map((schedule) => (
              <li key={skippedScheduleLine(schedule)}>{skippedScheduleLine(schedule)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/">Go to the budget</Link>
        </Button>
        <Button variant="secondary" onClick={download}>
          Download report
        </Button>
      </div>
    </>
  );
}

/** A one-time import of a YNAB plan through YNAB's API, with a preview and a comparison report. */
export function ImportPage() {
  const id = useId();
  const queryClient = useQueryClient();
  // The token stays in this page's memory only; it is sent with each request and never saved.
  const [token, setToken] = useState('');
  const [plans, setPlans] = useState<YnabPlanSummary[] | null>(null);
  const [planId, setPlanId] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const status = useQuery({ queryKey: ['import-status'], queryFn: api.importStatus });

  const previewPlan = useMutation({
    mutationFn: (id: string) => api.previewYnabImport(token.trim(), id),
    onSuccess: setPreview,
  });

  const connect = useMutation({
    mutationFn: () => api.listYnabPlans(token.trim()),
    onSuccess: ({ plans: found }) => {
      setPlans(found);
      setPlanId(found[0]?.id ?? '');
      if (found.length === 1) previewPlan.mutate(found[0]!.id);
    },
  });

  const runImport = useMutation({
    mutationFn: () => api.importYnabPlan(token.trim(), planId),
    onSuccess: (result) => {
      setToken('');
      setReport(result);
      void queryClient.invalidateQueries();
    },
  });

  function startOver() {
    setPlans(null);
    setPreview(null);
    connect.reset();
    previewPlan.reset();
    runImport.reset();
  }

  function submitToken(event: FormEvent) {
    event.preventDefault();
    if (token.trim() !== '') connect.mutate();
  }

  if (report) {
    return (
      <div className="max-w-4xl space-y-4">
        <h2 className="text-xl font-semibold">Import from YNAB</h2>
        <Card title="Import report">
          <Report report={report} />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">Import from YNAB</h2>

      {status.data && !status.data.canImport ? (
        <p className="rounded-md bg-warning/10 p-3 text-sm">
          Importing only works on an empty budget, so it can’t mix with or duplicate what’s already
          here. To import again, empty the database first; the README explains how.
        </p>
      ) : (
        <>
          <Card title="Connect to YNAB">
            <p className="text-sm text-muted-foreground">
              In YNAB, open Account Settings, then Developer Settings, and create a personal access
              token. Paste it here. Pretty Penny uses it only to read your plan for this import and
              never saves it.
            </p>
            <form onSubmit={submitToken} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`${id}-token`}>Personal access token</Label>
                <Input
                  id={`${id}-token`}
                  type="password"
                  autoComplete="off"
                  value={token}
                  disabled={plans !== null}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              {plans === null ? (
                <Button
                  key="connect"
                  type="submit"
                  disabled={token.trim() === '' || connect.isPending}
                >
                  {connect.isPending ? 'Connecting…' : 'Connect'}
                </Button>
              ) : (
                <Button key="start-over" type="button" variant="secondary" onClick={startOver}>
                  Start over
                </Button>
              )}
            </form>
            <ErrorText error={connect.error} />
            {plans?.length === 0 && (
              <p className="text-sm text-negative">This YNAB account has no plans to import.</p>
            )}

            {plans && plans.length > 1 && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor={`${id}-plan`}>Plan</Label>
                  <select
                    id={`${id}-plan`}
                    className={SELECT_CLASS}
                    value={planId}
                    onChange={(event) => {
                      setPlanId(event.target.value);
                      setPreview(null);
                    }}
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  disabled={previewPlan.isPending}
                  onClick={() => previewPlan.mutate(planId)}
                >
                  Preview
                </Button>
              </div>
            )}
          </Card>

          {previewPlan.isPending && (
            <p className="text-muted-foreground">Reading the plan from YNAB…</p>
          )}
          <ErrorText error={previewPlan.error} />

          {preview && (
            <Card title={`Preview of ${preview.planName}`}>
              <Preview preview={preview} />
              {preview.problems.length > 0 ? (
                <div role="alert" className="space-y-2 text-sm">
                  <ul className="space-y-1 text-negative">
                    {preview.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                  {preview.fractionalAmounts.length > 0 && (
                    <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5">
                      {preview.fractionalAmounts.map((item, index) => (
                        <li key={index}>{fractionalAmountLine(item)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={runImport.isPending}
                    onClick={() => runImport.mutate()}
                  >
                    {runImport.isPending ? 'Importing…' : 'Import'}
                  </Button>
                  {runImport.isPending && (
                    <span className="text-sm text-muted-foreground">
                      This can take a minute for a long history.
                    </span>
                  )}
                </div>
              )}
              <ErrorText error={runImport.error} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
