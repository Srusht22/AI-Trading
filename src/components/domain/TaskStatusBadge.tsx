import { Ban, CircleCheck, CircleDot, CircleSlash, CircleX, Clock, Loader2, TimerOff, type LucideIcon } from 'lucide-react';
import { Badge, Tooltip, type Tone } from '@/components/ui';
import { taskStatusText, type TaskStatus } from '@/domain/tasks';

const visual: Record<TaskStatus, { icon: LucideIcon; tone: Tone; spin?: boolean }> = {
  queued: { icon: Clock, tone: 'neutral' },
  claimed: { icon: CircleDot, tone: 'info' },
  running: { icon: Loader2, tone: 'accent', spin: true },
  succeeded: { icon: CircleCheck, tone: 'positive' },
  failed: { icon: CircleX, tone: 'negative' },
  cancel_requested: { icon: CircleSlash, tone: 'warning' },
  cancelled: { icon: Ban, tone: 'neutral' },
  expired: { icon: TimerOff, tone: 'warning' },
};

/** Task status as icon + text + colour (never colour alone), with a plain-English tooltip. */
export function TaskStatusBadge({ status, withTooltip = true }: { status: TaskStatus; withTooltip?: boolean }) {
  const v = visual[status];
  const text = taskStatusText[status];
  const badge = (
    <Badge tone={v.tone} icon={v.icon} className={v.spin ? '[&_svg]:motion-safe:animate-spin' : undefined} data-status={status}>
      {text.label}
    </Badge>
  );
  if (!withTooltip) return badge;
  return (
    <Tooltip content={text.description}>
      <span tabIndex={0} className="inline-flex rounded-sm">
        {badge}
      </span>
    </Tooltip>
  );
}
