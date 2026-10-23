import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { LogLine } from '@/data/types';
import { cn } from '@/lib/cn';

const levelVisual = {
  info: { icon: Info, className: 'text-fg-3', label: 'Info' },
  warn: { icon: TriangleAlert, className: 'text-warning', label: 'Warning' },
  error: { icon: CircleAlert, className: 'text-negative', label: 'Error' },
} as const;

/** Monospace, timestamped log with level icons (not colour alone). */
export function LogList({ lines, label, className }: { lines: LogLine[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} tabIndex={0} className={cn('bg-sunken border-line-soft max-h-80 overflow-auto rounded-lg border py-1.5 font-mono text-xs', className)}>
      {lines.map((l, i) => {
        const v = levelVisual[l.level];
        const Icon = v.icon;
        return (
          <li key={i} className="hover:bg-line-soft flex items-start gap-3 px-3.5 py-1.5">
            <time dateTime={l.at} className="text-fg-3 num shrink-0">
              {new Date(l.at).toISOString().slice(5, 19).replace('T', ' ')}
            </time>
            <Icon className={cn('mt-px size-3.5 shrink-0', v.className)} aria-label={v.label} />
            <span className="text-fg-2 min-w-0">
              <span className="text-fg">{l.source}</span> · {l.message}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
