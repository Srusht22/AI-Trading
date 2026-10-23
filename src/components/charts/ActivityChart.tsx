import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyCount } from '@/hooks/useAudit';
import { useReducedMotion } from '@/lib/useMediaQuery';
import { axisProps, ChartTooltipCard, gridProps, niceTicks } from './chartTheme';

const dayLabel = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Daily count of recorded account events. Re-renders whenever `data` changes. */
export function ActivityChart({ data }: { data: DailyCount[] }) {
  const reduced = useReducedMotion();
  const ticks = niceTicks(0, Math.max(4, ...data.map((d) => d.count)), 4).filter((t) => Number.isInteger(t));
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 240 }}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }} barCategoryGap="22%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" tickFormatter={dayLabel} interval="preserveStartEnd" minTickGap={24} {...axisProps} />
        <YAxis allowDecimals={false} ticks={ticks} domain={[0, ticks[ticks.length - 1]]} width={32} {...axisProps} />
        <Tooltip
          cursor={{ fill: 'var(--tp-line-soft)' }}
          isAnimationActive={false}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <ChartTooltipCard
                title={dayLabel(payload[0].payload.t)}
                rows={[{ label: 'Events recorded', value: String(payload[0].payload.count), color: 'var(--tp-accent-2)' }]}
              />
            ) : null
          }
        />
        <Bar dataKey="count" fill="var(--tp-accent-2)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={!reduced} animationDuration={500} />
      </BarChart>
    </ResponsiveContainer>
  );
}
