import type { ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';
import { cn } from '@/lib/cn';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={250} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Disable the tooltip while keeping the trigger rendered. */
  disabled?: boolean;
  className?: string;
}

/**
 * Hover/focus tooltip for short supplementary labels. For explanations that
 * must work on touch devices, use <InfoTip> instead (it opens on tap).
 */
export function Tooltip({ content, children, side = 'top', disabled, className }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-tooltip)' }}
          className={cn(
            'bg-raised text-fg border-line shadow-md max-w-64 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed',
            'data-[state=delayed-open]:animate-fade-in',
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
