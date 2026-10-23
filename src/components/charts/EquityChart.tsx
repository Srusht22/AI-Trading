import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EquityPoint } from '@/data/types';
import { formatMoney } from '@/lib/format';
import { useReducedMotion } from '@/lib/useMediaQuery';
import { axisProps, ChartTooltipCard, cursorProps, dateLong, dateTick, gridProps, niceTicks } from './chartTheme';

interface EquityChartProps {
  data: EquityPoint[];
  showBalance?: boolean;
  sample?: boolean;
  color?: string;
}

export const equityLegend = (showBalance = true) => [
  { label: 'Equity', color: 'var(--tp-accent)' },
  ...(showBalance ? [{ label: 'Balance (closed trades)', color: 'var(--tp-fg-3)', dashed: true }] : []),
];

export function EquityChart({ data, showBalance = true, sample, color = 'var(--tp-accent)' }: EquityChartProps) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const values = data.flatMap((d) => [d.equity, d.balance]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ticks = niceTicks(min, max, 5);

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 240 }}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} minTickGap={36} {...axisProps} />
        <YAxis
          domain={[ticks[0], ticks[ticks.length - 1]]}
          ticks={ticks}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(ticks[1] - ticks[0] < 100 ? 2 : 1)}k`}
          width={52}
          {...axisProps}
        />
        <Tooltip
          cursor={cursorProps}
          isAnimationActive={false}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <ChartTooltipCard
                title={dateLong(label as number)}
                rows={[
                  { label: 'Equity', value: formatMoney(payload[0].payload.equity), color },
                  ...(showBalance ? [{ label: 'Balance', value: formatMoney(payload[0].payload.balance), color: 'var(--tp-fg-3)', dashed: true }] : []),
                ]}
                note={sample ? 'Sample data — not a real result' : undefined}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id}-fill)`}
          isAnimationActive={!reduced}
          animationDuration={700}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--tp-raised)', fill: color }}
        />
        {showBalance && (
          <Line
            type="stepAfter"
            dataKey="balance"
            stroke="var(--tp-fg-3)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
