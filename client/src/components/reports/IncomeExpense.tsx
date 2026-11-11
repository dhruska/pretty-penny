import type { IncomeExpenseReport, IncomeExpenseRow } from '@/api';
import { Money } from '@/components/Money';
import { cn } from 'cn';
import { ReportCard, shortMonth } from './chartParts';

function Cells({
  byMonth,
  totalCents,
  months,
}: {
  byMonth: number[];
  totalCents: number;
  months: number;
}) {
  return (
    <>
      {byMonth.map((cents, index) => (
        <td key={index} className="px-2 py-1 text-right whitespace-nowrap">
          <Money cents={cents} />
        </td>
      ))}
      <td className="px-2 py-1 text-right whitespace-nowrap">
        <Money cents={months === 0 ? 0 : Math.round(totalCents / months)} />
      </td>
      <td className="py-1 pl-2 text-right font-medium whitespace-nowrap">
        <Money cents={totalCents} />
      </td>
    </>
  );
}

function Row({
  row,
  months,
  indent,
  strong,
}: {
  row: IncomeExpenseRow;
  months: number;
  indent?: boolean;
  strong?: boolean;
}) {
  return (
    <tr className={cn('border-b', strong && 'bg-muted font-medium')}>
      <th
        scope="row"
        className={cn(
          // Labels stay in view while the months scroll sideways.
          'sticky left-0 z-10 bg-card py-1 pr-2 text-left font-normal',
          indent && 'pl-4',
          strong && 'bg-muted font-medium',
        )}
      >
        {row.label}
      </th>
      <Cells byMonth={row.byMonth} totalCents={row.totalCents} months={months} />
    </tr>
  );
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** YNAB's Income v Expense table: income by payee, expenses by group and category, by month. */
export function IncomeExpense({ report }: { report: IncomeExpenseReport }) {
  const count = report.months.length;
  const totalRow = (label: string, byMonth: number[]) => ({
    label,
    byMonth,
    totalCents: sum(byMonth),
  });

  return (
    <ReportCard
      title="Income v expense"
      description="Income by payee and spending by category, month by month. Starting balances and tracking account activity aren’t included, as in YNAB."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-card py-1.5 pr-2 font-medium" />
              {report.months.map((month) => (
                <th key={month} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                  {shortMonth(month)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Average</th>
              <th className="py-1.5 pl-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th colSpan={count + 3} className="pt-3 pb-1 text-left font-semibold">
                Income
              </th>
            </tr>
            {report.income.map((row) => (
              <Row key={row.label} row={row} months={count} indent />
            ))}
            <Row row={totalRow('Total income', report.incomeByMonth)} months={count} strong />

            <tr>
              <th colSpan={count + 3} className="pt-4 pb-1 text-left font-semibold">
                Expenses
              </th>
            </tr>
            {report.expenseGroups.map((group) => [
              <Row key={group.label} row={group} months={count} />,
              ...group.categories.map((category) => (
                <Row
                  key={`${group.label}/${category.label}`}
                  row={category}
                  months={count}
                  indent
                />
              )),
            ])}
            <Row row={totalRow('Total expenses', report.expensesByMonth)} months={count} strong />

            <tr>
              <td colSpan={count + 3} className="pt-2" />
            </tr>
            <Row row={totalRow('Net income', report.netByMonth)} months={count} strong />
          </tbody>
        </table>
      </div>
    </ReportCard>
  );
}
