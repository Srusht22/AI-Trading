import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EquityPoint } from '@/data/types';
import { formatPercent } from '@/lib/format';
import { useReducedMotion } from '@/lib/useMediaQuery';
import { axisProps, ChartTooltipCard, cursorProps, dateLong, dateTick, gridProps, niceTicks } from './chartTheme';

export interface ComparisonSeries {
  id: string;
  name: string;
  color: string;
  points: EquityPoint[];
}

/**
 * Compares strategies on one axis by indexing each equity curve to its
 * starting value (% return), instead of mixing account sizes.
 */
export function ComparisonChart({ series }: { series: ComparisonSeries[] }) {
  const reduced = useReducedMotion();
  const length = Math.min(...series.map((s) => s.points.length));
  const rows = Array.from({ length }, (_, i) => {
    const row: Record<string, number> = { t: series[0].points[i].t };
    series.forEach((s) => {
      row[s.id] = ((s.points[i].equity - s.points[0].equity) / s.points[0].equity) * 100;
    });
    return row;
  });

  const values = rows.flatMap((r) => series.map((s) => r[s.id]));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(...values), 5);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} minTickGap={36} {...axisProps} />
        <YAxis ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} {...axisProps} />
        <ReferenceLine y={0} stroke="var(--tp-line-strong)" />
        <Tooltip
          cursor={cursorProps}
          isAnimationActive={false}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <ChartTooltipCard
                title={dateLong(label as number)}
                rows={series.map((s) => ({ label: s.name, value: formatPercent(payload[0].payload[s.id], 1, true), color: s.color }))}
                note="Sample data — not a real result"
              />
            ) : null
          }
        />
        {series.map((s) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--tp-raised)', fill: s.color }}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
