import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text title for the browser tab when `title` is not a string. */
  documentTitle?: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}

export function PageHeader({ title, documentTitle, description, actions, eyebrow, className }: PageHeaderProps) {
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (tabTitle) document.title = `${tabTitle} · TradePilot AI`;
  }, [tabTitle]);

  return (
    <header className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 flex-1 basis-80">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-fg text-2xl font-semibold tracking-[-0.02em] sm:text-[1.875rem] sm:leading-[2.375rem]">{title}</h1>
        {description && <p className="text-fg-2 mt-2 max-w-2xl text-base leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
