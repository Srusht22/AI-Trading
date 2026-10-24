import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { agentPresence, eligibleAgents, TASK_STATUSES, type Agent, type Task, type TaskType } from '@/domain/tasks';
import { TaskStatusBadge } from '@/components/domain/TaskStatusBadge';
import { taskSummary } from '@/components/domain/TaskList';
import { createFakeBackend } from './fakeServices';
import { renderWorkspace } from './renderApp';

const NOW = new Date('2026-10-24T12:00:00Z');

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: crypto.randomUUID(),
    display_name: 'Laptop diagnostics',
    allowed_capabilities: ['system.health_check'],
    reported_capabilities: ['system.health_check'],
    agent_version: '0.1.0',
    platform: 'linux/x64',
    last_heartbeat_at: new Date(Date.now() - 5_000).toISOString(),
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    revoked_at: null,
    ...over,
  };
}

const healthType: TaskType = {
  task_type: 'system.health_check',
  label: 'Health check',
  description: '',
  available: true,
  unavailable_reason: null,
  required_capability: 'system.health_check',
  min_agent_version: '0.1.0',
};

describe('task domain rules', () => {
  it('derives agent presence from the heartbeat age, like the database', () => {
    expect(agentPresence(agent({ last_heartbeat_at: new Date(NOW.getTime() - 10_000).toISOString() }), NOW)).toBe('online');
    expect(agentPresence(agent({ last_heartbeat_at: new Date(NOW.getTime() - 60_000).toISOString() }), NOW)).toBe('not_responding');
    expect(agentPresence(agent({ last_heartbeat_at: null }), NOW)).toBe('never_connected');
    expect(agentPresence(agent({ revoked_at: NOW.toISOString() }), NOW)).toBe('revoked');
  });

  it('only counts online agents with the capability and a sufficient version as eligible', () => {
    const fresh = new Date(NOW.getTime() - 1_000).toISOString();
    const ok = agent({ last_heartbeat_at: fresh });
    const list = [
      ok,
      agent({ last_heartbeat_at: fresh, reported_capabilities: [] }),
      agent({ last_heartbeat_at: fresh, allowed_capabilities: ['mt5.backtest'] }),
      agent({ last_heartbeat_at: fresh, agent_version: '0.0.9' }),
      agent({ last_heartbeat_at: new Date(NOW.getTime() - 120_000).toISOString() }),
    ];
    expect(eligibleAgents(list, healthType, NOW)).toEqual([ok]);
    expect(eligibleAgents(list, { ...healthType, available: false }, NOW)).toEqual([]);
  });

  it('summarises a scheduled retry from stored fields only', () => {
    const t = {
      status: 'queued',
      attempt_count: 1,
      max_attempts: 3,
      available_at: new Date(NOW.getTime() + 120_000).toISOString(),
      error: { code: 'check_failed', message: 'x', retryable: true },
    } as Task;
    expect(taskSummary(t, NOW)).toMatch(/Attempt 1 of 3 failed — retrying in 2 minutes/);
  });
});

describe('TaskStatusBadge', () => {
  it.each(TASK_STATUSES)('renders %s with an icon and text, never colour alone', (status) => {
    const { container } = render(<TaskStatusBadge status={status} withTooltip={false} />);
    const badge = container.querySelector(`[data-status="${status}"]`)!;
    expect(badge.textContent?.trim().length).toBeGreaterThan(3);
    expect(badge.querySelector('svg')).not.toBeNull();
  });
});

describe('diagnostics on the Connections page', () => {
  it('disables the health check and explains why when no agent is online', async () => {
    await renderWorkspace('/connections');
    expect(await screen.findByText('No agents registered')).toBeInTheDocument();
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run health check' })).toBeDisabled();
    expect(screen.getByText('No diagnostics agent is online. Start one to run a health check.')).toBeInTheDocument();
  });

  it('shows a stale agent as not responding and keeps the action disabled', async () => {
    await renderWorkspace('/connections', { agents: [agent({ last_heartbeat_at: new Date(Date.now() - 300_000).toISOString() })] });
    expect(await screen.findByText('Not responding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run health check' })).toBeDisabled();
  });

  it('queues a real task with an online agent and shows its stored status', async () => {
    const backend = createFakeBackend({ agents: [agent()] });
    const { user } = await renderWorkspace('/connections', { backend });
    expect(await screen.findByText('Online')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Run health check' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(backend.tasks()).toHaveLength(1));
    // The new task opens in the details dialog, straight from the stored row.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Queued').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('No agent has picked this task up yet.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    const list = await screen.findByRole('list', { name: 'Recent tasks' });
    expect(within(list).getByText('Queued')).toBeInTheDocument();
    // No progress bar is invented for a task that has not reported progress.
    expect(within(list).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('reuses the idempotency key when a submission fails with an unknown outcome', async () => {
    const backend = createFakeBackend({ agents: [agent()] });
    const keys: string[] = [];
    const original = backend.services.tasks.submit;
    backend.services.tasks.submit = (type, payload, key) => {
      keys.push(key);
      return original(type, payload, key);
    };
    backend.failNext('tasks.submit', new AppError('network', 'We couldn’t reach the TradePilot server.'));
    const { user } = await renderWorkspace('/connections', { backend });
    const button = await screen.findByRole('button', { name: 'Run health check' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(await screen.findByText('Health check not started')).toBeInTheDocument();
    await user.click(button);
    await waitFor(() => expect(backend.tasks()).toHaveLength(1));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows real progress and result details as the task changes', async () => {
    const backend = createFakeBackend({ agents: [agent()] });
    const { user, queryClient } = await renderWorkspace('/connections', { backend });
    const button = await screen.findByRole('button', { name: 'Run health check' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(backend.tasks()).toHaveLength(1));
    const id = backend.tasks()[0].id;
    const a = backend.agents()[0];
    backend.updateTask(id, {
      status: 'running',
      claimed_by_agent: a.id,
      claimed_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      attempt_count: 1,
      progress_percent: 50,
      progress_message: 'Measured API latency',
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('progressbar', { name: 'Task progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(dialog).getByRole('button', { name: 'Cancel task' })).toBeInTheDocument();

    backend.updateTask(id, {
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      claimed_by_agent: null,
      lease_expires_at: null,
      progress_percent: 100,
      result: { ok: true, api_latency_ms: { min: 4, median: 6, max: 9 }, clock_offset_ms: -12, agent_version: '0.1.0' },
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    expect(await within(dialog).findByText('6 ms')).toBeInTheDocument();
    expect(within(dialog).getByText('-12 ms')).toBeInTheDocument();
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel task' })).not.toBeInTheDocument();
  });
});

describe('agent list ordering', () => {
  it('lists online agents first and folds revoked agents away', async () => {
    const online = agent({ display_name: 'Zed online' });
    const revoked = agent({ display_name: 'Alpha revoked', revoked_at: new Date().toISOString() });
    const stale = agent({ display_name: 'Beta stale', last_heartbeat_at: new Date(Date.now() - 600_000).toISOString() });
    const { user } = await renderWorkspace('/connections', { agents: [revoked, stale, online] });
    const list = await screen.findByRole('list', { name: 'Registered agents' });
    const names = within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(names[0]).toContain('Zed online');
    expect(names[1]).toContain('Beta stale');
    expect(within(list).queryByText('Alpha revoked')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 revoked agent' }));
    expect(within(screen.getByRole('list', { name: 'Registered agents' })).getByText('Alpha revoked')).toBeInTheDocument();
  });
});
