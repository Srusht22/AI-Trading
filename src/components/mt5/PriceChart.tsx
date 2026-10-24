import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, ChartTooltipCard, cursorProps, gridProps } from '@/components/charts/chartTheme';
import { formatPrice, type Bar, type Quote, type Timeframe } from '@/domain/mt5';

interface Point {
  t: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  live?: boolean;
}

/** Bars (closing prices) plus, when newer, the latest real bid as the last point. */
export function chartPoints(bars: Bar[], quote: Quote | null | undefined): Point[] {
  const points: Point[] = bars.map((b) => ({ t: Date.parse(b.open_time), close: b.close, open: b.open, high: b.high, low: b.low }));
  if (quote) {
    const t = Date.parse(quote.tick_time);
    const last = points.at(-1);
    if (!last || t > last.t) points.push({ t, close: quote.bid, live: true });
  }
  return points;
}

/**
 * Price line drawn only from structured data delivered by the connector.
 * No animation: the line changes only when a new bar or tick is stored.
 */
export function PriceChart({
  bars,
  quote,
  digits,
  timeframe,
  timeZone,
}: {
  bars: Bar[];
  quote: Quote | null | undefined;
  digits: number;
  timeframe: Timeframe;
  timeZone: string;
}) {
  const data = chartPoints(bars, quote);
  const values = data.map((d) => d.close).concat(data.flatMap((d) => (d.high !== undefined && d.low !== undefined ? [d.high, d.low] : [])));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || max * 0.001) * 0.12;
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(timeframe === 'H1' ? { day: 'numeric', month: 'short' } : {}),
  });
  const longFmt = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'medium' });
  const live = data.at(-1)?.live ? data.at(-1) : undefined;

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 280 }}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => timeFmt.format(t)} minTickGap={40} {...axisProps} />
        <YAxis domain={[min - pad, max + pad]} tickFormatter={(v: number) => v.toFixed(digits)} width={digits > 3 ? 72 : 60} {...axisProps} />
        <Tooltip
          cursor={cursorProps}
          isAnimationActive={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Point;
            return (
              <ChartTooltipCard
                title={longFmt.format(p.t)}
                rows={
                  p.live
                    ? [{ label: 'Latest bid (tick)', value: formatPrice(p.close, digits), color: 'var(--tp-accent)' }]
                    : [
                        { label: 'Open', value: formatPrice(p.open, digits), color: 'var(--tp-fg-3)' },
                        { label: 'High', value: formatPrice(p.high, digits), color: 'var(--tp-fg-3)' },
                        { label: 'Low', value: formatPrice(p.low, digits), color: 'var(--tp-fg-3)' },
                        { label: 'Close', value: formatPrice(p.close, digits), color: 'var(--tp-accent)' },
                      ]
                }
                note={p.live ? 'From the most recent tick, not a completed bar' : `${timeframe} bar opening at this time`}
              />
            );
          }}
        />
        <Line type="linear" dataKey="close" stroke="var(--tp-accent)" strokeWidth={1.75} dot={false} isAnimationActive={false} activeDot={{ r: 3 }} />
        {live && <ReferenceDot x={live.t} y={live.close} r={4} fill="var(--tp-accent)" stroke="var(--tp-raised)" strokeWidth={2} ifOverflow="extendDomain" />}
      </LineChart>
    </ResponsiveContainer>
  );
}
