import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { isTerminal, type Task } from '@/domain/tasks';
import { queryKeys } from './queryKeys';
import { useRecentTasks, useSubmitTask } from './useTasks';

/**
 * Requests a read-only MT5 task through the Phase 3 queue and follows it to
 * completion. When the connector finishes, the MT5 data queries are
 * refreshed; the task's real outcome (or error) is exposed to the UI.
 */
export function useMt5Task() {
  const submit = useSubmitTask();
  const recent = useRecentTasks(10);
  const qc = useQueryClient();
  const user = useCurrentUser();
  const [taskId, setTaskId] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const task: Task | null = (recent.data ?? []).find((t) => t.id === taskId) ?? null;

  useEffect(() => {
    if (task && isTerminal(task.status) && handled.current !== `${task.id}:${task.status}`) {
      handled.current = `${task.id}:${task.status}`;
      void qc.invalidateQueries({ queryKey: queryKeys.mt5(user.id) });
    }
  }, [task, qc, user.id]);

  return {
    task,
    pending: submit.isPending || (!!task && !isTerminal(task.status)) || (!!taskId && !task),
    error: submit.error,
    run: async (taskType: string, payload: Record<string, unknown>) => {
      const t = await submit.submit(taskType, payload);
      setTaskId(t.id);
      return t;
    },
  };
}
