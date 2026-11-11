import type { SpendingReport } from '@/api';
import { Money } from '@/components/Money';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART, ChartTooltip, compactMoney, ReportCard } from './chartParts';

const ROW_HEIGHT = 32;
/** Beyond this many bars the chart gets hard to read; the table still lists everything. */
const MAX_BARS = 12;

/** Ranked bars of spending, one color for every bar, with the full table below. */
export function SpendingBreakdown({ report }: { report: SpendingReport }) {
  const bars = report.items.slice(0, MAX_BARS);

  return (
    <ReportCard
      title="Spending breakdown"
      description={
        <>
          Total spending <Money cents={report.totalCents} className="font-medium text-foreground" />
        </>
      }
    >
      {report.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spending in this range.</p>
      ) : (
        <>
          <div style={{ height: bars.length * ROW_HEIGHT + 40 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={bars}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis
                  type="number"
                  dataKey="spentCents"
                  tickFormatter={compactMoney}
                  tick={CHART.tick}
                  stroke={CHART.axis}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={130}
                  tick={CHART.tick}
                  stroke={CHART.axis}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)' }}
                  content={({ active, payload }) => {
                    const item = payload?.[0]?.payload as
                      SpendingReport['items'][number] | undefined;
                    if (!active || !item) return null;
                    return (
                      <ChartTooltip
                        title={item.label}
                        rows={[{ label: 'Spent', cents: item.spentCents }]}
                      />
                    );
                  }}
                />
                <Bar
                  dataKey="spentCents"
                  fill={CHART.series[0]}
                  maxBarSize={20}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {report.items.length > MAX_BARS && (
            <p className="text-xs text-muted-foreground">
              The chart shows the top {MAX_BARS}; the table lists all {report.items.length}.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Name</th>
                  <th className="px-2 py-1.5 text-right font-medium">Spent</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.label} className="border-b last:border-0">
                    <td className="py-1 pr-2">{item.label}</td>
                    <td className="px-2 py-1 text-right">
                      <Money cents={item.spentCents} />
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      {((item.spentCents / report.totalCents) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportCard>
  );
}
