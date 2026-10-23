import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EquityPoint } from '@/data/types';
import { formatPercent } from '@/lib/format';
import { useReducedMotion } from '@/lib/useMediaQuery';
import { axisProps, ChartTooltipCard, cursorProps, dateLong, dateTick, gridProps, niceTicks } from './chartTheme';

/** "Underwater" chart: how far below its previous peak the account was at each point. */
export function DrawdownChart({ points, color = 'var(--tp-negative)' }: { points: EquityPoint[]; color?: string }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  let peak = -Infinity;
  const rows = points.map((p) => {
    peak = Math.max(peak, p.equity);
    return { t: p.t, dd: ((p.equity - peak) / peak) * 100 };
  });

  const ticks = niceTicks(Math.min(...rows.map((r) => r.dd)), 0, 4);

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 240 }}>
      <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`${id}-dd`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.05} />
            <stop offset="100%" stopColor={color} stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={dateTick} minTickGap={36} {...axisProps} />
        <YAxis ticks={ticks} domain={[ticks[0], 0]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} {...axisProps} />
        <Tooltip
          cursor={cursorProps}
          isAnimationActive={false}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <ChartTooltipCard
                title={dateLong(label as number)}
                rows={[{ label: 'Below previous peak', value: formatPercent(payload[0].payload.dd, 1), color }]}
                note="Sample data — not a real result"
              />
            ) : null
          }
        />
        <Area type="monotone" dataKey="dd" stroke={color} strokeWidth={1.5} fill={`url(#${id}-dd)`} isAnimationActive={!reduced} animationDuration={700} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
