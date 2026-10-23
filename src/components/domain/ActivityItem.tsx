import {
  CircleCheck,
  CircleX,
  FlaskConical,
  Lightbulb,
  type LucideIcon,
  Settings2,
  ShieldQuestion,
  Unplug,
} from 'lucide-react';
import type { ActivityEvent, ActivityKind } from '@/data/types';
import { cn } from '@/lib/cn';

const kindVisual: Record<ActivityKind, { icon: LucideIcon; className: string }> = {
  backtest_completed: { icon: CircleCheck, className: 'text-positive bg-positive-soft' },
  backtest_failed: { icon: CircleX, className: 'text-negative bg-negative-soft' },
  candidate_created: { icon: FlaskConical, className: 'text-accent bg-accent-soft' },
  robot_updated: { icon: Settings2, className: 'text-fg-2 bg-line-soft' },
  connection_lost: { icon: Unplug, className: 'text-warning bg-warning-soft' },
  proposal_created: { icon: Lightbulb, className: 'text-info bg-info-soft' },
  approval_requested: { icon: ShieldQuestion, className: 'text-warning bg-warning-soft' },
};

export function formatRelative(iso: string, now = new Date('2026-09-30T12:00:00Z')) {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  const d = Math.round(diff / 86400);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

export function ActivityItem({ event, last }: { event: ActivityEvent; last?: boolean }) {
  const v = kindVisual[event.kind];
  const Icon = v.icon;
  return (
    <li className="relative flex gap-3.5 pb-5">
      {!last && <span aria-hidden className="bg-line-soft absolute top-9 bottom-0 left-[15px] w-px" />}
      <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full', v.className)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-fg text-sm font-medium">{event.title}</p>
          <time dateTime={event.at} className="text-fg-3 shrink-0 text-xs">
            {formatRelative(event.at)}
          </time>
        </div>
        <p className="text-fg-2 mt-0.5 text-sm leading-relaxed">{event.detail}</p>
      </div>
    </li>
  );
}
