import type { ReactNode } from 'react';
import { CircleSlash } from 'lucide-react';
import { Button, Callout, Dialog, Skeleton } from '@/components/ui';
import { formatDateTime, type DisplayPrefs } from '@/lib/datetime';
import { isCancellable, taskStatusText, type Agent, type Task, type TaskAttempt, type TaskType } from '@/domain/tasks';
import { TaskStatusBadge } from './TaskStatusBadge';

const outcomeText: Record<NonNullable<TaskAttempt['outcome']>, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  retry_scheduled: 'Failed — retry scheduled',
  lease_expired: 'Agent stopped responding',
  cancelled: 'Cancelled',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-fg-3 text-xs">{label}</dt>
      <dd className="text-fg-2 text-right text-sm">{children}</dd>
    </div>
  );
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Health-check results get labelled rows; anything else is shown as escaped JSON. */
function ResultView({ task }: { task: Task }) {
  const r = task.result;
  if (!r) return null;
  if (task.task_type === 'system.health_check') {
    const latency = r.api_latency_ms as Record<string, unknown> | undefined;
    const runtime = r.runtime as Record<string, unknown> | undefined;
    const offset = num(r.clock_offset_ms);
    return (
      <dl className="divide-line-soft divide-y">
        {latency && num(latency.median) !== null && (
          <Row label="API round trip (median of 3)">
            <span className="num">{num(latency.median)} ms</span>{' '}
            <span className="text-fg-3 text-xs">
              (min {num(latency.min)} / max {num(latency.max)})
            </span>
          </Row>
        )}
        {offset !== null && (
          <Row label="Agent clock vs server">
            <span className="num">{offset > 0 ? `+${offset}` : offset} ms</span>
          </Row>
        )}
        {runtime && (
          <Row label="Runtime">
            {String(runtime.node ?? '')} on {String(runtime.platform ?? '')}/{String(runtime.arch ?? '')}
          </Row>
        )}
        {num(r.memory_free_mb) !== null && (
          <Row label="Free memory">
            <span className="num">{num(r.memory_free_mb)} MB</span>
          </Row>
        )}
        {typeof r.agent_version === 'string' && <Row label="Agent version">{r.agent_version}</Row>}
        {typeof r.request_note === 'string' && <Row label="Your note">{r.request_note}</Row>}
      </dl>
    );
  }
  return <pre className="bg-sunken border-line-soft num overflow-x-auto rounded-md border p-3 text-xs">{JSON.stringify(r, null, 2)}</pre>;
}

export function TaskDetailsDialog({
  task,
  type,
  agents,
  attempts,
  attemptsLoading,
  prefs,
  onClose,
  onCancel,
  cancelling,
}: {
  task: Task | null;
  type?: TaskType;
  agents: Agent[];
  attempts: TaskAttempt[] | undefined;
  attemptsLoading: boolean;
  prefs: DisplayPrefs;
  onClose: () => void;
  onCancel: (task: Task) => void;
  cancelling: boolean;
}) {
  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.display_name ?? 'Unknown agent') : '—');
  const time = (iso: string | null) => (iso ? <time dateTime={iso}>{formatDateTime(iso, prefs)}</time> : '—');
  return (
    <Dialog
      open={!!task}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={type?.label ?? task?.task_type ?? 'Task'}
      description={task ? taskStatusText[task.status].description : undefined}
      footer={
        task && isCancellable(task.status) ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="danger" leadingIcon={<CircleSlash />} loading={cancelling} onClick={() => onCancel(task)}>
              Cancel task
            </Button>
          </>
        ) : undefined
      }
    >
      {task && (
        <div className="space-y-5 pb-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <span className="text-fg-3 text-xs">
              Attempt {Math.max(task.attempt_count, 1)} of {task.max_attempts}
            </span>
          </div>

          {task.status === 'running' && task.progress_percent !== null && (
            <div>
              <div className="text-fg-3 mb-1 flex justify-between text-xs">
                <span>{task.progress_message ?? 'Progress'}</span>
                <span className="num">{task.progress_percent}%</span>
              </div>
              <div role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress_percent} className="bg-line-soft h-2 overflow-hidden rounded-full">
                <div className="bg-accent h-full rounded-full transition-[width] duration-300" style={{ width: `${task.progress_percent}%` }} />
              </div>
            </div>
          )}

          {task.error && (
            <Callout tone={task.status === 'failed' || task.status === 'expired' ? 'danger' : 'warning'} title={task.status === 'queued' ? 'Last attempt failed — will retry' : 'Error'}>
              {task.error.message} <span className="text-fg-3 text-xs">({task.error.code})</span>
            </Callout>
          )}

          {task.result && (
            <section aria-label="Result">
              <p className="eyebrow mb-1">Result</p>
              <ResultView task={task} />
            </section>
          )}

          <section aria-label="Timeline">
            <p className="eyebrow mb-1">Timeline</p>
            <dl className="divide-line-soft divide-y">
              <Row label="Submitted">{time(task.created_at)}</Row>
              {task.claimed_at && <Row label="Accepted by agent">{time(task.claimed_at)}</Row>}
              {task.claimed_by_agent && <Row label="Agent">{agentName(task.claimed_by_agent)}</Row>}
              {task.started_at && <Row label="Started">{time(task.started_at)}</Row>}
              {task.cancel_requested_at && <Row label="Cancellation requested">{time(task.cancel_requested_at)}</Row>}
              {task.completed_at && <Row label="Finished">{time(task.completed_at)}</Row>}
              {!task.completed_at && <Row label="Must start before">{time(task.expires_at)}</Row>}
            </dl>
          </section>

          <section aria-label="Attempts">
            <p className="eyebrow mb-1">Attempts</p>
            {attemptsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : attempts && attempts.length > 0 ? (
              <ol className="divide-line-soft divide-y">
                {attempts.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                    <span className="text-fg-2">
                      #{a.attempt_number} · {agentName(a.agent_id)}
                    </span>
                    <span className="text-fg-3 text-right text-xs">
                      {a.outcome ? outcomeText[a.outcome] : 'In progress'}
                      {a.error ? ` — ${a.error.message}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-fg-3 text-sm">No agent has picked this task up yet.</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
