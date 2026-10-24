import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM reference agent
import { LeaseLost, processTask } from '../../agent/diagnostics-worker.mjs';

type Call = (action: string, body?: Record<string, unknown>) => Promise<unknown>;

const task = { task_id: 't-1', lease_token: 'l-1', task_type: 'system.health_check', payload: {}, attempt: 1, max_attempts: 3 };
const healthFetch = async () => new Response(JSON.stringify({ ok: true, data: { time: new Date().toISOString() } }), { status: 200 });

function recorder(overrides: Record<string, (body: Record<string, unknown>) => unknown> = {}) {
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  const call: Call = async (action, body = {}) => {
    calls.push({ action, body });
    if (overrides[action]) return overrides[action](body);
    if (action === 'start') return { status: 'running', cancel_requested: false };
    if (action === 'renew') return { cancel_requested: false };
    return { status: 'ok' };
  };
  return { call, calls };
}

describe('reference diagnostics agent', () => {
  it('starts, reports real progress and completes with measured values only', async () => {
    const { call, calls } = recorder();
    const outcome = await processTask(call, task, { apiUrl: 'http://api.test', fetchImpl: healthFetch });
    expect(outcome).toBe('succeeded');
    expect(calls.map((c) => c.action)).toEqual(['start', 'renew', 'renew', 'complete']);
    const result = calls.at(-1)!.body.result as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.api_latency_ms).toMatchObject({ min: expect.any(Number), median: expect.any(Number), max: expect.any(Number) });
    // Result keys must pass the database's credential-like key filter.
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|session|apikey/i);
  });

  it('stops and acknowledges when the owner cancels', async () => {
    const { call, calls } = recorder({ renew: () => ({ cancel_requested: true }) });
    expect(await processTask(call, task, { apiUrl: 'http://api.test', fetchImpl: healthFetch })).toBe('cancelled');
    expect(calls.map((c) => c.action)).toEqual(['start', 'renew', 'ack-cancel']);
  });

  it('drops a task silently when its lease was lost (another worker owns it)', async () => {
    const { call, calls } = recorder({
      renew: () => {
        throw new LeaseLost('lease lost');
      },
    });
    expect(await processTask(call, task, { apiUrl: 'http://api.test', fetchImpl: healthFetch })).toBe('lease_lost');
    expect(calls.map((c) => c.action)).not.toContain('complete');
    expect(calls.map((c) => c.action)).not.toContain('fail');
  });

  it('reports a structured, retryable failure when the check itself fails', async () => {
    const { call, calls } = recorder();
    const failing = async () => new Response('{}', { status: 503 });
    expect(await processTask(call, task, { apiUrl: 'http://api.test', fetchImpl: failing })).toBe('failed');
    const fail = calls.find((c) => c.action === 'fail')!;
    expect(fail.body.error).toEqual({ code: 'api_unhealthy', message: 'health endpoint answered 503', retryable: true });
  });
});
