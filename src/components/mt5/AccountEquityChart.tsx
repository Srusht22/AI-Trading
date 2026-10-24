import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useId } from 'react';
import { axisProps, ChartTooltipCard, cursorProps, gridProps } from '@/components/charts/chartTheme';
import { formatAccountMoney, type AccountSnapshot } from '@/domain/mt5';

/** Equity and balance over time from stored, timestamped snapshots (never back-filled). */
export function AccountEquityChart({
  snapshots,
  currency,
  digits,
  timeZone,
}: {
  snapshots: AccountSnapshot[];
  currency: string;
  digits: number;
  timeZone: string;
}) {
  const id = useId().replace(/:/g, '');
  const data = snapshots.map((s) => ({ t: Date.parse(s.observed_at), equity: s.equity, balance: s.balance }));
  const values = data.flatMap((d) => [d.equity, d.balance]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) * 0.001 || 1) * 0.15;
  const spanMs = (data.at(-1)?.t ?? 0) - (data[0]?.t ?? 0);
  const tickFmt = new Intl.DateTimeFormat('en-GB', spanMs > 2 * 86_400_000 ? { timeZone, day: 'numeric', month: 'short' } : { timeZone, hour: '2-digit', minute: '2-digit' });
  const longFmt = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const money = (v: number) => formatAccountMoney(v, currency, digits);

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 240 }}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tp-accent)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--tp-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => tickFmt.format(t)} minTickGap={40} {...axisProps} />
        <YAxis domain={[min - pad, max + pad]} tickFormatter={(v: number) => money(v).replace(/\.\d+/, '')} width={84} {...axisProps} />
        <Tooltip
          cursor={cursorProps}
          isAnimationActive={false}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <ChartTooltipCard
                title={longFmt.format(label as number)}
                rows={[
                  { label: 'Equity', value: money(payload[0].payload.equity), color: 'var(--tp-accent)' },
                  { label: 'Balance', value: money(payload[0].payload.balance), color: 'var(--tp-fg-3)', dashed: true },
                ]}
                note="Snapshot recorded by the connector"
              />
            ) : null
          }
        />
        <Area type="linear" dataKey="equity" stroke="var(--tp-accent)" strokeWidth={2} fill={`url(#${id}-fill)`} isAnimationActive={false} dot={data.length < 3} />
        <Line type="stepAfter" dataKey="balance" stroke="var(--tp-fg-3)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
