import type { ReactNode } from 'react';
import { CircleAlert, Eye, Info, type LucideIcon, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

type CalloutTone = 'info' | 'warning' | 'danger' | 'preview';

const tones: Record<CalloutTone, { icon: LucideIcon; className: string; iconClass: string }> = {
  info: { icon: Info, className: 'bg-info-soft border-[color-mix(in_srgb,var(--tp-info)_25%,transparent)]', iconClass: 'text-info' },
  warning: { icon: TriangleAlert, className: 'bg-warning-soft border-[color-mix(in_srgb,var(--tp-warning)_25%,transparent)]', iconClass: 'text-warning' },
  danger: { icon: CircleAlert, className: 'bg-negative-soft border-[color-mix(in_srgb,var(--tp-negative)_25%,transparent)]', iconClass: 'text-negative' },
  preview: { icon: Eye, className: 'bg-accent-2-soft border-dashed border-[color-mix(in_srgb,var(--tp-accent-2)_45%,transparent)]', iconClass: 'text-accent-2' },
};

interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/** Inline notification for contextual messages that stay on the page. */
export function Callout({ tone = 'info', title, children, actions, icon, className }: CalloutProps) {
  const t = tones[tone];
  const Icon = icon ?? t.icon;
  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3', t.className, className)}>
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', t.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1 basis-56 text-sm">
        {title && <p className="text-fg font-medium">{title}</p>}
        {children && <div className={cn('text-fg-2 leading-relaxed', title && 'mt-0.5')}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  );
}

/** Page-level notice that the content below is invented sample data. */
export function SampleDataBanner({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <Callout tone="preview" title="You are viewing sample data" actions={actions} className={className}>
      {children ?? 'Figures on this page are invented to preview the finished layout. They do not come from a broker, MT5, a backtest or an AI service.'}
    </Callout>
  );
}
