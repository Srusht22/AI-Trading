import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { PreviewTag, SegmentedControl } from '@/components/ui';
import { cn } from '@/lib/cn';

interface ChartContainerProps {
  title: ReactNode;
  /** Plain-language explanation of what the chart shows. */
  explanation?: ReactNode;
  controls?: ReactNode;
  legend?: ReactNode;
  sample?: boolean;
  /** Status shown next to the title, e.g. a data-freshness badge. */
  badge?: ReactNode;
  /** Accessible alternative to the plotted marks. */
  table?: ReactNode;
  /** Rendered instead of the chart when there is no data. */
  empty?: ReactNode;
  height?: number;
  children: ReactNode;
  className?: string;
  headingLevel?: 'h2' | 'h3';
}

export function ChartContainer({
  title,
  explanation,
  controls,
  legend,
  sample,
  badge,
  table,
  empty,
  height = 300,
  children,
  className,
  headingLevel: H = 'h2',
}: ChartContainerProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={cn('surface flex flex-col p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <H className="text-fg text-md font-semibold">{title}</H>
            {sample && <PreviewTag />}
            {badge}
          </div>
          {explanation && <p className="text-fg-2 mt-1 max-w-2xl text-sm">{explanation}</p>}
        </div>
        {!empty && (controls || table) && (
          <div className="flex flex-wrap items-center gap-2">
            {controls}
            {table && (
              <SegmentedControl
                label="Display as"
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'chart', label: <BarChart3 />, ariaLabel: 'Show chart' },
                  { value: 'table', label: <Table2 />, ariaLabel: 'Show data table' },
                ]}
              />
            )}
          </div>
        )}
      </div>
      {empty ? (
        <div className="mt-4">{empty}</div>
      ) : (
        <>
          {legend && <div className="mt-4">{legend}</div>}
          {view === 'chart' ? (
            // The plot fills whatever height the panel has, but never less than `height`.
            <div className="relative mt-4 flex-1" style={{ minHeight: height }}>
              <div className="absolute inset-0">{children}</div>
            </div>
          ) : (
            <div className="mt-4 max-h-[360px] overflow-y-auto">{table}</div>
          )}
        </>
      )}
    </section>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)} aria-label="Chart legend">
      {items.map((i) => (
        <li key={i.label} className="text-fg-2 flex items-center gap-2 text-xs">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="17"
              y2="4"
              stroke={i.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={i.dashed ? '3 3' : undefined}
            />
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
