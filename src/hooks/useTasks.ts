import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { useLiveStatus } from '@/lib/live';
import { isAppError } from '@/lib/errors';
import { isTerminal, type Task } from '@/domain/tasks';
import { queryKeys } from './queryKeys';

/** Fallback polling while Realtime is not confirmed live (never shown as "Live"). */
const POLL_ACTIVE_TASKS_MS = 5_000;
const POLL_AGENTS_MS = 15_000;

export function useRecentTasks(limit = 10) {
  const { tasks } = useServices();
  const user = useCurrentUser();
  const live = useLiveStatus().tasks;
  return useQuery({
    queryKey: queryKeys.tasksRecent(user.id, limit),
    queryFn: () => tasks.listRecent(user.id, limit),
    refetchInterval: (q) => (live !== 'live' && (q.state.data ?? []).some((t) => !isTerminal(t.status)) ? POLL_ACTIVE_TASKS_MS : false),
  });
}

export function useTaskAttempts(task: Task | null) {
  const { tasks } = useServices();
  const user = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.taskAttempts(user.id, task?.id ?? 'none'),
    queryFn: () => tasks.listAttempts(task!.id),
    enabled: !!task,
  });
}

export function useTaskTypes() {
  const { tasks } = useServices();
  const user = useCurrentUser();
  return useQuery({ queryKey: queryKeys.taskTypes(user.id), queryFn: () => tasks.listTypes(), staleTime: 5 * 60_000 });
}

export function useAgents() {
  const { agents } = useServices();
  const user = useCurrentUser();
  const live = useLiveStatus().agents;
  return useQuery({
    queryKey: queryKeys.agents(user.id),
    queryFn: () => agents.list(),
    refetchInterval: live === 'live' ? false : POLL_AGENTS_MS,
  });
}

/** Re-renders every `ms` so relative times and heartbeat freshness stay truthful. */
export function useNow(ms = 5_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Submits a task with an idempotency key that belongs to the user's intent,
 * not to the HTTP request: if the request fails in a way where the server may
 * have received it (network error, timeout), retrying reuses the same key and
 * the database returns the original task instead of creating a second one.
 */
export function useSubmitTask() {
  const { tasks } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const pendingKey = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ taskType, payload }: { taskType: string; payload: Record<string, unknown> }) => {
      pendingKey.current ??= `ui-${crypto.randomUUID()}`;
      return tasks.submit(taskType, payload, pendingKey.current);
    },
    onSuccess: () => {
      pendingKey.current = null;
      void qc.invalidateQueries({ queryKey: queryKeys.tasks(user.id) });
    },
    onError: (e) => {
      // Keep the key only when the outcome is unknown; a definite refusal starts fresh next time.
      const outcomeUnknown = isAppError(e) && (e.kind === 'network' || (e.kind === 'unavailable' && !(e.code ?? '').startsWith('TPU')));
      if (!outcomeUnknown) pendingKey.current = null;
    },
  });
  const submit = useCallback((taskType: string, payload: Record<string, unknown> = {}) => mutation.mutateAsync({ taskType, payload }), [mutation]);
  return { ...mutation, submit };
}

export function useCancelTask() {
  const { tasks } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasks.cancel(taskId),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.tasks(user.id) }),
  });
}
