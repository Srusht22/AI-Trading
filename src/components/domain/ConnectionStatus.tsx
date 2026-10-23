import { CircleCheck, CircleDashed, CircleX, Loader2, type LucideIcon, TriangleAlert } from 'lucide-react';
import { connectionStateLabel, type ConnectionState } from '@/config/integrations';
import { cn } from '@/lib/cn';

const stateVisual: Record<ConnectionState, { icon: LucideIcon; className: string }> = {
  unavailable: { icon: CircleDashed, className: 'text-fg-3' },
  not_configured: { icon: CircleDashed, className: 'text-fg-3' },
  not_connected: { icon: CircleDashed, className: 'text-fg-3' },
  connecting: { icon: Loader2, className: 'text-info animate-spin' },
  connected: { icon: CircleCheck, className: 'text-positive' },
  degraded: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleX, className: 'text-negative' },
};

/** Icon + text representation of a connection state (never colour alone). */
export function ConnectionStateIcon({ state, className }: { state: ConnectionState; className?: string }) {
  const v = stateVisual[state];
  const Icon = v.icon;
  return <Icon className={cn('size-4 shrink-0', v.className, className)} aria-hidden />;
}

interface ConnectionStatusProps {
  label: string;
  state: ConnectionState;
  detail?: string;
  /** Override the state label, e.g. "UI preview". */
  stateLabel?: string;
  layout?: 'row' | 'stack';
  className?: string;
}

export function ConnectionStatus({ label, state, detail, stateLabel, layout = 'row', className }: ConnectionStatusProps) {
  const text = stateLabel ?? connectionStateLabel[state];
  if (layout === 'stack') {
    return (
      <div className={cn('flex items-start gap-3', className)}>
        <ConnectionStateIcon state={state} className="mt-0.5" />
        <div className="min-w-0">
          <p className="text-fg text-sm font-medium">{label}</p>
          <p className="text-fg-2 text-sm">{text}</p>
          {detail && <p className="text-fg-3 mt-0.5 text-xs leading-relaxed">{detail}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="text-fg-2 truncate text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
        <ConnectionStateIcon state={state} className="size-3.5" />
        <span className="text-fg-2">{text}</span>
      </span>
    </div>
  );
}
