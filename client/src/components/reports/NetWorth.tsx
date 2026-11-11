import type { NetWorthPoint } from '@/api';
import { Money } from '@/components/Money';
import { formatMonth } from '@/lib/months';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART,
  ChartTooltip,
  compactMoney,
  LegendItem,
  ReportCard,
  shortMonth,
} from './chartParts';

const [ASSETS, DEBTS, NET_WORTH] = CHART.series;

/** Assets above the baseline, debts below it, and net worth as a line, on one money axis. */
export function NetWorth({ points }: { points: NetWorthPoint[] }) {
  const latest = points.at(-1);

  return (
    <ReportCard
      title="Net worth"
      description={
        latest && (
          <>
            <Money cents={latest.netWorthCents} className="font-medium text-foreground" /> at the
            end of {formatMonth(latest.month)}, across all accounts including tracking and closed
            ones
          </>
        )
      }
    >
      <div className="flex flex-wrap gap-4" aria-hidden="true">
        <LegendItem color={ASSETS} label="Assets" />
        <LegendItem color={DEBTS} label="Debts" />
        <LegendItem color={NET_WORTH} label="Net worth" line />
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            stackOffset="sign"
            margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
          >
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
              width={64}
            />
            <ReferenceLine y={0} stroke={CHART.axis} />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as NetWorthPoint | undefined;
                if (!active || !point) return null;
                return (
                  <ChartTooltip
                    title={formatMonth(point.month)}
                    rows={[
                      { label: 'Assets', cents: point.assetsCents, color: ASSETS },
                      { label: 'Debts', cents: point.debtsCents, color: DEBTS },
                      { label: 'Net worth', cents: point.netWorthCents, color: NET_WORTH },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="assetsCents"
              stackId="balance"
              fill={ASSETS}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="debtsCents"
              stackId="balance"
              fill={DEBTS}
              maxBarSize={24}
              radius={[0, 0, 4, 4]}
            />
            <Line
              dataKey="netWorthCents"
              stroke={NET_WORTH}
              strokeWidth={2}
              dot={{ r: 4, fill: NET_WORTH, stroke: 'var(--card)', strokeWidth: 2 }}
              activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Month end</th>
              <th className="px-2 py-1.5 text-right font-medium">Assets</th>
              <th className="px-2 py-1.5 text-right font-medium">Debts</th>
              <th className="py-1.5 pl-2 text-right font-medium">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.month} className="border-b last:border-0">
                <td className="py-1 pr-2">{formatMonth(point.month)}</td>
                <td className="px-2 py-1 text-right">
                  <Money cents={point.assetsCents} />
                </td>
                <td className="px-2 py-1 text-right">
                  <Money cents={point.debtsCents} />
                </td>
                <td className="py-1 pl-2 text-right font-medium">
                  <Money cents={point.netWorthCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportCard>
  );
}
