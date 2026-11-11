import type { TrendsReport } from '@/api';
import { Money } from '@/components/Money';
import { formatMonth } from '@/lib/months';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART, ChartTooltip, compactMoney, ReportCard, shortMonth } from './chartParts';

/** Monthly spending as columns, with the average as a labeled line. */
export function SpendingTrends({ report, subject }: { report: TrendsReport; subject: string }) {
  return (
    <ReportCard
      title="Spending trends"
      description={
        <>
          {subject}, averaging{' '}
          <Money cents={report.averageCents} className="font-medium text-foreground" /> a month
        </>
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report.months} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              tick={CHART.tick}
              stroke={CHART.axis}
              tickLine={false}
            />
            <YAxis
              tickFormatter={compactMoney}
              tick={CHART.tick}
              stroke={CHART.axis}
              tickLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TrendsReport['months'][number] | undefined;
                if (!active || !point) return null;
                return (
                  <ChartTooltip
                    title={formatMonth(point.month)}
                    rows={[
                      { label: 'Spent', cents: point.spentCents },
                      { label: 'Average', cents: report.averageCents },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="spentCents"
              fill={CHART.series[0]}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            />
            <ReferenceLine
              y={report.averageCents}
              stroke={CHART.inkMuted}
              strokeWidth={1}
              label={{
                value: 'Average',
                position: 'insideTopRight',
                fill: CHART.inkMuted,
                fontSize: 12,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Month</th>
              <th className="py-1.5 pl-2 text-right font-medium">Spent</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((point) => (
              <tr key={point.month} className="border-b last:border-0">
                <td className="py-1 pr-2">{formatMonth(point.month)}</td>
                <td className="py-1 pl-2 text-right">
                  <Money cents={point.spentCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportCard>
  );
}
