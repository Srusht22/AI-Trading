import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PreviewTag } from './Badge';

interface MetricCardProps {
  label: ReactNode;
  icon: LucideIcon;
  value: ReactNode;
  /** Short qualifier beside the value, e.g. "configured". */
  unit?: ReactNode;
  footer?: ReactNode;
  /** Marks the figure as invented sample data. */
  sample?: boolean;
  className?: string;
}

export function MetricCard({ label, icon: Icon, value, unit, footer, sample, className }: MetricCardProps) {
  return (
    <article className={cn('surface group relative flex min-h-40 flex-col p-5 transition-[border-color,box-shadow] duration-200 hover:border-line hover:shadow-md', className)}>
      <header className="flex items-start justify-between gap-2">
        <div className="text-fg-2 flex min-w-0 items-center gap-2 text-sm leading-snug font-medium">
          <span className="bg-sunken border-line-soft flex size-7 items-center justify-center rounded-md border">
            <Icon className="text-fg-2 size-3.5" aria-hidden />
          </span>
          {label}
        </div>
        {sample && <PreviewTag compact />}
      </header>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-fg num text-2xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-fg-3 text-sm">{unit}</span>}
      </div>
      {footer && <div className="text-fg-2 mt-auto pt-3 text-sm">{footer}</div>}
    </article>
  );
}
