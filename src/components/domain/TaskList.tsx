import { ChevronRight } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import type { Task, TaskType } from '@/domain/tasks';
import { TaskStatusBadge } from './TaskStatusBadge';

/** One line of truthful context for a task, derived only from stored fields. */
export function taskSummary(task: Task, now: Date): string {
  switch (task.status) {
    case 'queued':
      if (task.error && Date.parse(task.available_at) > now.getTime())
        return `Attempt ${task.attempt_count} of ${task.max_attempts} failed — retrying ${formatRelativeTime(task.available_at, now)}.`;
      return task.error ? `Waiting to retry after: ${task.error.message}` : 'Waiting for an agent.';
    case 'claimed':
      return 'Accepted by an agent.';
    case 'running':
      return task.progress_message ?? 'In progress.';
    case 'succeeded':
      return 'Completed.';
    case 'failed':
      return task.error?.message ?? 'Failed.';
    case 'cancel_requested':
      return 'Waiting for the agent to stop.';
    case 'cancelled':
      return 'Cancelled.';
    case 'expired':
      return task.error?.message ?? 'Not picked up in time.';
  }
}

export function TaskList({
  tasks,
  types,
  prefs,
  now,
  onOpen,
}: {
  tasks: Task[];
  types: Map<string, TaskType>;
  prefs: DisplayPrefs;
  now: Date;
  onOpen: (task: Task) => void;
}) {
  return (
    <ul className="divide-line-soft divide-y" aria-label="Recent tasks">
      {tasks.map((t) => {
        const label = types.get(t.task_type)?.label ?? t.task_type;
        const showProgress = t.status === 'running' && t.progress_percent !== null;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t)}
              className="hover:bg-raised-hover focus-visible:outline-accent group -mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-md px-2 py-3 text-left transition-colors focus-visible:outline-2"
              aria-label={`${label}, ${t.status.replace('_', ' ')} — view details`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={t.status} withTooltip={false} />
                  <span className="text-fg text-sm font-medium">{label}</span>
                </div>
                <p className="text-fg-2 mt-1 truncate text-xs">{taskSummary(t, now)}</p>
                {showProgress && (
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-label={`${label} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={t.progress_percent!}
                      className="bg-line-soft h-1.5 w-full max-w-48 overflow-hidden rounded-full"
                    >
                      <div className="bg-accent h-full rounded-full transition-[width] duration-300" style={{ width: `${t.progress_percent}%` }} />
                    </div>
                    <span className="text-fg-3 num text-xs">{t.progress_percent}%</span>
                  </div>
                )}
              </div>
              <Tooltip content={formatDateTime(t.created_at, prefs)}>
                <time dateTime={t.created_at} className="text-fg-3 shrink-0 pt-0.5 text-xs">
                  {formatRelativeTime(t.created_at, now)}
                </time>
              </Tooltip>
              <ChevronRight className="text-fg-3 mt-0.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
