import { FlaskConical } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Persistent reminder that the product targets simulated trading.
 * NOTE: UI-level indicator only — enforcement lives in later backend/connector phases.
 */
export function DemoEnvironmentBadge({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <Tooltip content="TradePilot is set up for simulated (demo) trading and research. No real-money trading is possible in this version.">
      <span
        tabIndex={0}
        className={cn(
          'text-warning bg-warning-soft inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-2xs font-semibold tracking-[0.08em] whitespace-nowrap uppercase',
          'border-[color-mix(in_srgb,var(--tp-warning)_30%,transparent)]',
          className,
        )}
      >
        <FlaskConical className="size-3.5" aria-hidden strokeWidth={2.25} />
        {compact ? 'Demo' : 'Demo environment'}
      </span>
    </Tooltip>
  );
}
