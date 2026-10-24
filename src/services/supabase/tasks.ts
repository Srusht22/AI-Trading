import { z } from 'zod';
import type { TradePilotClient } from '@/lib/supabase/client';
import { AppError, fromPostgrestError } from '@/lib/errors';
import {
  AGENT_COLUMNS,
  agentSchema,
  ATTEMPT_COLUMNS,
  TASK_COLUMNS,
  TASK_TYPE_COLUMNS,
  taskAttemptSchema,
  taskSchema,
  taskTypeSchema,
} from '@/domain/tasks';
import type { AgentService, TaskService } from '../types';
import { parseResponse } from './validate';

interface PgError {
  code?: string;
  message?: string;
}

/**
 * Errors raised by submit_task / cancel_task carry TradePilot SQLSTATEs whose
 * messages are written for people (see the migration); everything else goes
 * through the generic mapping.
 */
function fromTaskError(error: PgError, action: string, status?: number): AppError {
  const msg = error.message ?? '';
  switch (error.code) {
    case 'TPU01':
      return new AppError('unavailable', msg || 'This kind of task is not available yet.', { code: error.code, cause: error });
    case 'TPU02':
      return new AppError('unavailable', 'No agent that can run this task is online right now. Start a diagnostics agent and try again.', {
        code: error.code,
        cause: error,
      });
    case 'TPR01':
      return new AppError('rate_limited', `Unable to ${action}: ${msg || 'too many tasks'}. Wait for running tasks to finish and try again.`, {
        code: error.code,
        cause: error,
      });
    case 'TPV01':
      return new AppError('validation', `Unable to ${action}. The request was not valid.`, { code: error.code, cause: error });
    case 'TPI01':
      return new AppError('conflict', `Unable to ${action}. This request was already sent with different details.`, { code: error.code, cause: error });
    case 'TPS01':
      return new AppError('conflict', 'This task has already finished, so it can no longer be changed.', { code: error.code, cause: error });
    case 'P0002':
      return new AppError('not_found', 'That task could not be found.', { code: error.code, cause: error });
  }
  return fromPostgrestError(error, action, status);
}

export function createTaskService(client: TradePilotClient): TaskService {
  return {
    async listRecent(userId, limit) {
      const { data, error, status } = await client
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(Math.min(Math.max(1, limit), 50));
      if (error) throw fromPostgrestError(error, 'load your tasks', status);
      return parseResponse(z.array(taskSchema), data ?? [], 'your tasks');
    },

    async listAttempts(taskId) {
      const { data, error, status } = await client
        .from('task_attempts')
        .select(ATTEMPT_COLUMNS)
        .eq('task_id', taskId)
        .order('attempt_number', { ascending: true });
      if (error) throw fromPostgrestError(error, 'load the task history', status);
      return parseResponse(z.array(taskAttemptSchema), data ?? [], 'the task history');
    },

    async listTypes() {
      const { data, error, status } = await client.from('task_types').select(TASK_TYPE_COLUMNS).order('task_type');
      if (error) throw fromPostgrestError(error, 'load the task types', status);
      return parseResponse(z.array(taskTypeSchema), data ?? [], 'the task types');
    },

    async submit(taskType, payload, idempotencyKey) {
      const { data, error, status } = await client.rpc('submit_task', {
        p_task_type: taskType,
        p_payload: payload as never,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw fromTaskError(error, 'start the task', status);
      return parseResponse(taskSchema, data, 'the task');
    },

    async cancel(taskId) {
      const { data, error, status } = await client.rpc('cancel_task', { p_task_id: taskId });
      if (error) throw fromTaskError(error, 'cancel the task', status);
      return parseResponse(taskSchema, data, 'the task');
    },
  };
}

export function createAgentService(client: TradePilotClient): AgentService {
  return {
    async list() {
      const { data, error, status } = await client.from('agents').select(AGENT_COLUMNS).order('created_at', { ascending: true });
      if (error) throw fromPostgrestError(error, 'load your agents', status);
      return parseResponse(z.array(agentSchema), data ?? [], 'your agents');
    },
  };
}
