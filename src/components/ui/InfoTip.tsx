import type { ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { Info } from 'lucide-react';
import { glossary, type GlossaryKey } from '@/content/glossary';
import { cn } from '@/lib/cn';

interface InfoTipProps {
  title?: ReactNode;
  children: ReactNode;
  more?: ReactNode;
  label?: string;
  className?: string;
}

/**
 * Small "i" button that reveals a short explanation. Opens on click, tap or
 * Enter/Space so it works for keyboard and touch users, not just mouse hover.
 */
export function InfoTip({ title, children, more, label, className }: InfoTipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label ?? (typeof title === 'string' ? `What is ${title.toLowerCase()}?` : 'More information')}
          className={cn(
            'text-fg-3 hover:text-fg-2 data-[state=open]:text-accent inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle',
            'transition-colors',
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-popover)' }}
          className="bg-raised border-line shadow-lg data-[state=open]:animate-fade-in w-[min(18rem,calc(100vw-24px))] rounded-lg border p-3.5"
        >
          {title && <p className="text-fg mb-1 text-sm font-semibold">{title}</p>}
          <div className="text-fg-2 text-sm leading-relaxed">{children}</div>
          {more && <p className="text-fg-3 border-line-soft mt-2.5 border-t pt-2.5 text-xs leading-relaxed">{more}</p>}
          <Popover.Arrow className="fill-[var(--tp-line)]" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface TermProps {
  k: GlossaryKey;
  /** Override the visible label (defaults to the glossary term). */
  children?: ReactNode;
  className?: string;
}

/** A specialist term with its plain-English definition one tap away. */
export function Term({ k, children, className }: TermProps) {
  const entry = glossary[k];
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span>{children ?? entry.term}</span>
      <InfoTip title={entry.term} more={'more' in entry ? entry.more : undefined} label={`What is ${entry.term}?`}>
        {entry.definition}
      </InfoTip>
    </span>
  );
}
