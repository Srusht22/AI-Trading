import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' };

/** Elevated surface for grouping meaningful information. Use sparingly. */
export function Card({ as: As = 'section', padding = 'md', interactive, className, ...props }: CardProps) {
  return (
    <As
      className={cn(
        'surface relative',
        pad[padding],
        interactive &&
          'hover:border-line hover:bg-[color-mix(in_srgb,var(--tp-raised-hover)_55%,var(--tp-raised))] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small label above the title. */
  eyebrow?: ReactNode;
  as?: 'h2' | 'h3';
  id?: string;
  className?: string;
}

export function SectionHeader({ title, description, actions, eyebrow, as: H = 'h2', id, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-60">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <H id={id} className={cn('text-fg flex flex-wrap items-center gap-2 font-semibold', H === 'h2' ? 'text-lg' : 'text-md')}>
          {title}
        </H>
        {description && <p className="text-fg-2 mt-1 max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-line-soft my-6 border-t', className)} />;
}
