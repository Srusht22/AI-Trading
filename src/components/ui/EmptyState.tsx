import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  /** What this section is for and that it is empty. */
  title: string;
  /** Why it is empty / what will appear here. */
  description: ReactNode;
  /** What the user can do next. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actions, size = 'md', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' && 'px-4 py-8',
        size === 'md' && 'px-6 py-12',
        size === 'lg' && 'px-6 py-16',
        className,
      )}
    >
      <div className="relative mb-4">
        <div aria-hidden className="bg-accent-soft absolute inset-0 -m-3 rounded-full blur-xl" />
        <div className="bg-raised border-line shadow-highlight relative flex size-12 items-center justify-center rounded-xl border">
          <Icon className="text-accent size-5" aria-hidden strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-fg text-md font-semibold">{title}</h3>
      <div className="text-fg-2 mt-1.5 max-w-md text-sm leading-relaxed">{description}</div>
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
