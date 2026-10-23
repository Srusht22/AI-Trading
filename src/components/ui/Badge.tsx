import type { HTMLAttributes, ReactNode } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleX,
  Eye,
  Info,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'accent';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-line-soft text-fg-2 border-line',
  positive: 'bg-positive-soft text-positive border-[color-mix(in_srgb,var(--tp-positive)_28%,transparent)]',
  negative: 'bg-negative-soft text-negative border-[color-mix(in_srgb,var(--tp-negative)_28%,transparent)]',
  warning: 'bg-warning-soft text-warning border-[color-mix(in_srgb,var(--tp-warning)_28%,transparent)]',
  info: 'bg-info-soft text-info border-[color-mix(in_srgb,var(--tp-info)_28%,transparent)]',
  accent: 'bg-accent-soft text-accent border-[color-mix(in_srgb,var(--tp-accent)_28%,transparent)]',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: LucideIcon;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', icon: Icon, size = 'sm', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5.5 px-1.5 text-xs' : 'h-7 px-2.5 text-sm',
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden strokeWidth={2.25} />}
      {children}
    </span>
  );
}

/** Status values understood across the app. Each maps to a tone AND a distinct icon. */
export type Status =
  | 'success'
  | 'failed'
  | 'warning'
  | 'running'
  | 'stopped'
  | 'idle'
  | 'not_connected'
  | 'not_configured'
  | 'info'
  | 'pending';

const statusMap: Record<Status, { tone: Tone; icon: LucideIcon }> = {
  success: { tone: 'positive', icon: CircleCheck },
  failed: { tone: 'negative', icon: CircleX },
  warning: { tone: 'warning', icon: TriangleAlert },
  running: { tone: 'accent', icon: CircleDot },
  stopped: { tone: 'neutral', icon: CircleMinus },
  idle: { tone: 'neutral', icon: CircleDashed },
  not_connected: { tone: 'neutral', icon: CircleDashed },
  not_configured: { tone: 'neutral', icon: CircleDashed },
  info: { tone: 'info', icon: Info },
  pending: { tone: 'warning', icon: CircleAlert },
};

export function StatusBadge({ status, children, size, className }: { status: Status; children: ReactNode; size?: 'sm' | 'md'; className?: string }) {
  const { tone, icon } = statusMap[status];
  return (
    <Badge tone={tone} icon={icon} size={size} className={className}>
      {children}
    </Badge>
  );
}

/**
 * Marker for any area showing invented data or a non-functional design.
 * Visually distinct (dashed outline) so it is never mistaken for a status.
 */
export function PreviewTag({ kind = 'sample', compact, className }: { kind?: 'sample' | 'preview'; compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'text-accent-2 inline-flex h-5.5 shrink-0 items-center gap-1 rounded-sm border border-dashed px-1.5 text-2xs font-semibold tracking-[0.06em] whitespace-nowrap uppercase',
        'border-[color-mix(in_srgb,var(--tp-accent-2)_50%,transparent)] bg-accent-2-soft',
        className,
      )}
    >
      <Eye className="size-3" aria-hidden strokeWidth={2.25} />
      {compact ? <span aria-label={kind === 'sample' ? 'Sample data' : 'UI preview'}>{kind === 'sample' ? 'Sample' : 'Preview'}</span> : kind === 'sample' ? 'Sample data' : 'UI preview'}
    </span>
  );
}
