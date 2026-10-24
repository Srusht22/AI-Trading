import { useMemo, useState } from 'react';
import { Bot, ListChecks, RotateCcw, Stethoscope } from 'lucide-react';
import { Button, Callout, EmptyState, SectionHeader, Skeleton } from '@/components/ui';
import { useDisplayPrefs } from '@/hooks/useDisplayPrefs';
import { useAgents, useCancelTask, useNow, useRecentTasks, useSubmitTask, useTaskAttempts, useTaskTypes } from '@/hooks/useTasks';
import { useLiveStatus } from '@/lib/live';
import { useToast } from '@/lib/toast';
import { toAppError } from '@/lib/errors';
import { agentPresence, eligibleAgents, HEALTH_CHECK, type Agent, type AgentPresence, type Task } from '@/domain/tasks';
import { LiveIndicator } from './LiveIndicator';
import { AgentList } from './AgentList';
import { TaskList } from './TaskList';
import { TaskDetailsDialog } from './TaskDetailsDialog';

/**
 * Real diagnostics: registered agents (with heartbeat freshness) and the
 * owner's tasks from the durable queue. The only runnable task is the
 * harmless system health check; it can be started only while an eligible
 * agent is online, mirroring the rule the database enforces.
 */
export function DiagnosticsSection() {
  const prefs = useDisplayPrefs();
  const now = useNow(5_000);
  const toast = useToast();
  const live = useLiveStatus();
  const agents = useAgents();
  const tasks = useRecentTasks(10);
  const types = useTaskTypes();
  const submit = useSubmitTask();
  const cancel = useCancelTask();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const typeMap = useMemo(() => new Map((types.data ?? []).map((t) => [t.task_type, t])), [types.data]);
  const healthType = typeMap.get(HEALTH_CHECK);
  const ready = eligibleAgents(agents.data ?? [], healthType, now);
  // Online agents first; revoked ones are history and stay folded away unless asked for.
  const order: Record<AgentPresence, number> = { online: 0, not_responding: 1, never_connected: 2, revoked: 3 };
  const sortedAgents = [...(agents.data ?? [])].sort(
    (a: Agent, b: Agent) => order[agentPresence(a, now)] - order[agentPresence(b, now)] || a.display_name.localeCompare(b.display_name),
  );
  const revokedCount = sortedAgents.filter((a) => a.revoked_at).length;
  const visibleAgents = showRevoked ? sortedAgents : sortedAgents.filter((a) => !a.revoked_at);
  // The selected task always reflects the latest stored row (live or refetched).
  const selected = (tasks.data ?? []).find((t) => t.id === selectedId) ?? null;
  const attempts = useTaskAttempts(selected);

  const runHealthCheck = async () => {
    try {
      const task = await submit.submit(HEALTH_CHECK, {});
      toast({ tone: 'success', title: 'Health check queued', description: 'An online diagnostics agent will pick it up within about 10 seconds.' });
      setSelectedId(task.id);
    } catch (e) {
      toast({ tone: 'error', title: 'Health check not started', description: toAppError(e, 'start the health check').userMessage });
    }
  };

  const cancelTask = async (task: Task) => {
    try {
      const updated = await cancel.mutateAsync(task.id);
      toast({
        tone: 'info',
        title: updated.status === 'cancelled' ? 'Task cancelled' : 'Cancellation requested',
        description: updated.status === 'cancelled' ? undefined : 'The agent will stop at its next check-in.',
      });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not cancel', description: toAppError(e, 'cancel the task').userMessage });
    }
  };

  const disabledReason = agents.isPending || types.isPending
    ? 'Checking for online agents…'
    : !healthType?.available
      ? (healthType?.unavailable_reason ?? 'Health checks are not available.')
      : ready.length === 0
        ? 'No diagnostics agent is online. Start one to run a health check.'
        : null;

  return (
    <section aria-labelledby="diag-title" className="surface mt-6 p-5 sm:p-6">
      <SectionHeader
        id="diag-title"
        title={
          <>
            <Stethoscope className="text-fg-3 size-[18px]" aria-hidden /> Diagnostics
          </>
        }
        description="A diagnostics agent is a small program you run on a computer you trust. It reports its clock accuracy and connection latency — it cannot trade or touch MetaTrader 5."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <LiveIndicator status={live.tasks} />
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Stethoscope />}
              disabled={!!disabledReason}
              loading={submit.isPending}
              onClick={runHealthCheck}
              aria-describedby={disabledReason ? 'diag-disabled-reason' : undefined}
            >
              Run health check
            </Button>
          </div>
        }
      />
      {disabledReason && (
        <p id="diag-disabled-reason" className="text-fg-3 -mt-2 mb-4 text-xs">
          {disabledReason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-fg mb-1 flex items-center gap-2 text-sm font-semibold">
            <Bot className="text-fg-3 size-4" aria-hidden /> Agents
          </h3>
          {agents.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : agents.isError ? (
            <Callout tone="danger" actions={<Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} onClick={() => void agents.refetch()}>Retry</Button>}>
              {toAppError(agents.error, 'load your agents').userMessage}
            </Callout>
          ) : visibleAgents.length === 0 && revokedCount === 0 ? (
            <EmptyState
              size="sm"
              icon={Bot}
              title="No agents registered"
              description={
                <>
                  On a trusted computer, run <code className="num text-fg-2">npm run agent:register -- "My laptop"</code> and then{' '}
                  <code className="num text-fg-2">npm run agent:diagnostics</code>. See docs/deployment.md.
                </>
              }
            />
          ) : (
            <>
              {visibleAgents.length > 0 ? (
                <AgentList agents={visibleAgents} prefs={prefs} now={now} />
              ) : (
                <p className="text-fg-3 py-3 text-sm">No active agents. Register a new one to run health checks.</p>
              )}
              {revokedCount > 0 && (
                <Button size="sm" variant="ghost" className="mt-1" aria-expanded={showRevoked} onClick={() => setShowRevoked((v) => !v)}>
                  {showRevoked ? 'Hide revoked agents' : `Show ${revokedCount} revoked ${revokedCount === 1 ? 'agent' : 'agents'}`}
                </Button>
              )}
            </>
          )}
        </div>

        <div>
          <h3 className="text-fg mb-1 flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="text-fg-3 size-4" aria-hidden /> Recent tasks
          </h3>
          {tasks.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : tasks.isError ? (
            <Callout tone="danger" actions={<Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} onClick={() => void tasks.refetch()}>Retry</Button>}>
              {toAppError(tasks.error, 'load your tasks').userMessage}
            </Callout>
          ) : tasks.data.length === 0 ? (
            <EmptyState size="sm" icon={ListChecks} title="No tasks yet" description="Health checks you run appear here with their status, timing and result." />
          ) : (
            <TaskList tasks={tasks.data} types={typeMap} prefs={prefs} now={now} onOpen={(t) => setSelectedId(t.id)} />
          )}
        </div>
      </div>

      <TaskDetailsDialog
        task={selected}
        type={selected ? typeMap.get(selected.task_type) : undefined}
        agents={agents.data ?? []}
        attempts={attempts.data}
        attemptsLoading={attempts.isPending && !!selected}
        prefs={prefs}
        onClose={() => setSelectedId(null)}
        onCancel={cancelTask}
        cancelling={cancel.isPending}
      />
    </section>
  );
}
