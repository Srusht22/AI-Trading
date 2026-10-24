import { z } from 'zod';

/**
 * Durable tasks (Phase 3). Mirrors public.tasks / task_attempts / agents /
 * task_types; every response is validated against these schemas.
 */

export const TASK_STATUSES = ['queued', 'claimed', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled', 'expired'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'expired'];
export const isTerminal = (s: TaskStatus) => TERMINAL_STATUSES.includes(s);
export const isCancellable = (s: TaskStatus) => s === 'queued' || s === 'claimed' || s === 'running';

export const taskErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
export type TaskError = z.infer<typeof taskErrorSchema>;

export const taskSchema = z.object({
  id: z.string().uuid(),
  task_type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(TASK_STATUSES),
  created_at: z.string(),
  updated_at: z.string(),
  available_at: z.string(),
  expires_at: z.string(),
  claimed_by_agent: z.string().uuid().nullable(),
  claimed_at: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  started_at: z.string().nullable(),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  progress_percent: z.number().int().nullable(),
  progress_message: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: taskErrorSchema.nullable(),
  cancel_requested_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  revision: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;

export const TASK_COLUMNS =
  'id, task_type, payload, status, created_at, updated_at, available_at, expires_at, claimed_by_agent, claimed_at, lease_expires_at, started_at, attempt_count, max_attempts, progress_percent, progress_message, result, error, cancel_requested_at, completed_at, revision';

export const taskAttemptSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  attempt_number: z.number().int(),
  agent_id: z.string().uuid().nullable(),
  claimed_at: z.string(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  outcome: z.enum(['succeeded', 'failed', 'retry_scheduled', 'lease_expired', 'cancelled']).nullable(),
  error: taskErrorSchema.nullable(),
});
export type TaskAttempt = z.infer<typeof taskAttemptSchema>;

export const ATTEMPT_COLUMNS = 'id, task_id, attempt_number, agent_id, claimed_at, started_at, ended_at, outcome, error';

export const agentSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  allowed_capabilities: z.array(z.string()),
  reported_capabilities: z.array(z.string()),
  agent_version: z.string().nullable(),
  platform: z.string().nullable(),
  last_heartbeat_at: z.string().nullable(),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
});
export type Agent = z.infer<typeof agentSchema>;

export const AGENT_COLUMNS = 'id, display_name, allowed_capabilities, reported_capabilities, agent_version, platform, last_heartbeat_at, created_at, revoked_at';

export const taskTypeSchema = z.object({
  task_type: z.string(),
  label: z.string(),
  description: z.string(),
  available: z.boolean(),
  unavailable_reason: z.string().nullable(),
  required_capability: z.string(),
  min_agent_version: z.string(),
});
export type TaskType = z.infer<typeof taskTypeSchema>;

export const TASK_TYPE_COLUMNS = 'task_type, label, description, available, unavailable_reason, required_capability, min_agent_version';

export const HEALTH_CHECK = 'system.health_check';

/** Same threshold as private.agent_is_online() in the database. */
export const AGENT_ONLINE_WINDOW_MS = 45_000;

export type AgentPresence = 'online' | 'not_responding' | 'never_connected' | 'revoked';

export function agentPresence(agent: Agent, now: Date): AgentPresence {
  if (agent.revoked_at) return 'revoked';
  if (!agent.last_heartbeat_at) return 'never_connected';
  return now.getTime() - Date.parse(agent.last_heartbeat_at) < AGENT_ONLINE_WINDOW_MS ? 'online' : 'not_responding';
}

const parseVersion = (v: string | null) => (v && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
function versionAtLeast(v: string | null, min: string): boolean {
  const a = parseVersion(v);
  const b = parseVersion(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** Agents that could run `type` right now (mirrors the eligibility rule in submit_task). */
export function eligibleAgents(agents: Agent[], type: TaskType | undefined, now: Date): Agent[] {
  if (!type?.available) return [];
  return agents.filter(
    (a) =>
      agentPresence(a, now) === 'online' &&
      a.allowed_capabilities.includes(type.required_capability) &&
      a.reported_capabilities.includes(type.required_capability) &&
      versionAtLeast(a.agent_version, type.min_agent_version),
  );
}

export const taskStatusText: Record<TaskStatus, { label: string; description: string }> = {
  queued: { label: 'Queued', description: 'Waiting for an agent to pick it up.' },
  claimed: { label: 'Assigned', description: 'An agent has accepted the task and is about to start.' },
  running: { label: 'Running', description: 'An agent is working on it.' },
  succeeded: { label: 'Succeeded', description: 'Finished successfully.' },
  failed: { label: 'Failed', description: 'Stopped with an error.' },
  cancel_requested: { label: 'Cancelling', description: 'Cancellation requested; waiting for the agent to stop.' },
  cancelled: { label: 'Cancelled', description: 'Cancelled before it finished.' },
  expired: { label: 'Expired', description: 'No agent picked it up before its deadline.' },
};
