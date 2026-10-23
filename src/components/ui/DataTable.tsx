import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hide this column below the given breakpoint to reduce clutter. */
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: ReactNode;
  className?: string;
  dense?: boolean;
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

/**
 * Semantic table. Low-priority columns collapse on small screens and the
 * remainder scrolls horizontally inside its own container, never the page.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, empty, className, dense }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={cn('-mx-1 overflow-x-auto px-1', className)} tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[32rem] border-collapse text-sm sm:min-w-0">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-line-soft border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'text-fg-3 h-9 px-3 text-xs font-medium whitespace-nowrap first:pl-0 last:pr-0',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.hideBelow && hide[c.hideBelow],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-line-soft hover:bg-[color-mix(in_srgb,var(--tp-raised-hover)_50%,transparent)] border-b transition-colors last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'text-fg-2 px-3 align-middle first:pl-0 last:pr-0',
                    dense ? 'h-10' : 'h-12',
                    c.align === 'right' && 'num text-right',
                    c.hideBelow && hide[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
