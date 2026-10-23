import type { ReactNode } from 'react';

/** Shared axis/grid styling so every chart reads as one system. */
export const axisProps = {
  tick: { fill: 'var(--tp-fg-3)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

export const gridProps = {
  stroke: 'var(--tp-chart-grid)',
  vertical: false,
} as const;

export const cursorProps = { stroke: 'var(--tp-line-strong)', strokeWidth: 1, strokeDasharray: '3 3' } as const;

export const dateTick = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dateLong = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

interface TooltipRow {
  label: string;
  value: string;
  color: string;
  dashed?: boolean;
}

export function ChartTooltipCard({ title, rows, note }: { title: string; rows: TooltipRow[]; note?: ReactNode }) {
  return (
    <div className="bg-raised border-line shadow-lg min-w-44 rounded-lg border px-3 py-2.5 text-xs">
      <p className="text-fg-3 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="text-fg-2 flex items-center gap-1.5">
              <svg width="12" height="6" aria-hidden>
                <line x1="1" y1="3" x2="11" y2="3" stroke={r.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={r.dashed ? '2 2' : undefined} />
              </svg>
              {r.label}
            </span>
            <span className="text-fg num font-medium">{r.value}</span>
          </li>
        ))}
      </ul>
      {note && <p className="text-fg-3 border-line-soft mt-2 border-t pt-1.5">{note}</p>}
    </div>
  );
}

/** Evenly spaced, round-number axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
