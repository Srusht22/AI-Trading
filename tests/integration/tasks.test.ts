import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { handleAgentRequest } from '../../server/agentApi';
import type { LiveStatus } from '@/services/types';
import { adminClient, browserClient, env, signedInUser } from './helpers';

/**
 * The durable queue end to end: real owner sessions (browser services), the
 * real agent API handler (server/agentApi.ts) and the real database
 * functions. DATABASE_URL (local superuser) is used only to simulate the
 * passage of time (expired leases, elapsed backoff) and to park leftovers.
 */
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) console.warn('[integration] DATABASE_URL not set — task queue tests are SKIPPED, not passed.');

const serverEnv = { SUPABASE_URL: env.url, SUPABASE_SECRET_KEY: env.serviceKey, APP_ENV: 'development' };

function newToken() {
  return `tpa_${randomBytes(32).toString('base64url')}`;
}

async function registerAgent(name: string, token = newToken()) {
  const hash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await adminClient().rpc('admin_register_agent', {
    p_display_name: name,
    p_capabilities: ['system.health_check'],
    p_token_sha256: `\\x${hash}`,
    p_max_concurrent_tasks: 1,
  });
  if (error) throw error;
  return { id: data as string, token };
}

async function api(token: string | null, action: string, body: unknown = {}, init: RequestInit = {}) {
  const res = await handleAgentRequest(
    new Request(`http://127.0.0.1/api/agent/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    }),
    serverEnv,
    action,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test inspects arbitrary response fields
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: any; error?: { code: string } } };
}

const heartbeat = (token: string) => api(token, 'heartbeat', { agent_version: '0.1.0', capabilities: ['system.health_check'], platform: 'test' });

describe.skipIf(!dbUrl)('task queue (integration)', () => {
  const db = new pg.Client({ connectionString: dbUrl });
  const agents: { id: string; token: string }[] = [];
  let owner: Awaited<ReturnType<typeof signedInUser>>;
  let n = 0;
  const key = () => `itest-${Date.now()}-${n++}`;

  /** Finish every unfinished task so claims in this file only see its own work. */
  async function parkLeftovers() {
    await db.query(`delete from private.task_leases`);
    // Respect the state machine (the guard trigger applies to the superuser too).
    await db.query(`update public.tasks set status = case when status = 'running' then 'failed' else 'cancelled' end,
                      error = case when status = 'running'
                                   then '{"code":"test_cleanup","message":"Parked by the test suite","retryable":false}'::jsonb
                                   else error end,
                      completed_at = clock_timestamp(), claimed_by_agent = null, claimed_at = null, lease_expires_at = null
                    where status in ('queued','claimed','running','cancel_requested')`);
  }

  async function agent(name: string) {
    const a = await registerAgent(name);
    agents.push(a);
    expect((await heartbeat(a.token)).status).toBe(200);
    return a;
  }

  beforeAll(async () => {
    await db.connect();
    owner = await signedInUser('queue-owner');
    const { error } = await adminClient().rpc('admin_assign_owner', { p_email: owner.email, p_replace: true });
    if (error) throw error;
  });

  beforeEach(async () => {
    await parkLeftovers();
    // Each test gets a fresh owner so the per-owner rate limits never interact.
    owner = await signedInUser('queue-owner');
    const { error } = await adminClient().rpc('admin_assign_owner', { p_email: owner.email, p_replace: true });
    if (error) throw error;
  });

  afterAll(async () => {
    await parkLeftovers();
    for (const a of agents) await adminClient().rpc('admin_revoke_agent', { p_agent_id: a.id });
    await db.end();
  });

  it('runs a health check end to end through the agent API', async () => {
    const a = await agent('itest e2e');
    const task = await owner.services.tasks.submit('system.health_check', { note: 'integration' }, key());
    expect(task.status).toBe('queued');

    const claim = await api(a.token, 'claim');
    expect(claim.status).toBe(200);
    expect(claim.body.data.task_id).toBe(task.id);
    const lease = { task_id: task.id, lease_token: claim.body.data.lease_token };

    expect((await api(a.token, 'start', lease)).body.data.status).toBe('running');
    expect((await api(a.token, 'renew', { ...lease, progress_percent: 50, progress_message: 'Half way' })).status).toBe(200);
    let seen = (await owner.services.tasks.listRecent(owner.id, 5)).find((t) => t.id === task.id)!;
    expect(seen.status).toBe('running');
    expect(seen.progress_percent).toBe(50);

    const done = await api(a.token, 'complete', { ...lease, result: { ok: true, api_latency_ms: { min: 1, median: 2, max: 3 } } });
    expect(done.body.data.status).toBe('succeeded');
    seen = (await owner.services.tasks.listRecent(owner.id, 5)).find((t) => t.id === task.id)!;
    expect(seen.status).toBe('succeeded');
    expect(seen.result).toMatchObject({ ok: true });
    const attempts = await owner.services.tasks.listAttempts(task.id);
    expect(attempts.map((x) => x.outcome)).toEqual(['succeeded']);
  });

  it('never hands the same task to two agents claiming at the same moment', async () => {
    const pool = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => agent(`itest race ${i}`)));
    const submitted = await Promise.all([1, 2, 3].map(() => owner.services.tasks.submit('system.health_check', {}, key())));
    const claims = await Promise.all(pool.map((a) => api(a.token, 'claim')));
    expect(claims.every((c) => c.status === 200)).toBe(true);
    const ids = claims.map((c) => c.body.data?.task_id).filter(Boolean);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(ids)).toEqual(new Set(submitted.map((t) => t.id)));
  });

  it('creates exactly one task for concurrent submissions with the same idempotency key', async () => {
    await agent('itest idem');
    const k = key();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => owner.services.tasks.submit('system.health_check', {}, k)));
    expect(new Set(results.map((t) => t.id)).size).toBe(1);
    const { rows } = await db.query('select count(*)::int as n from public.tasks where idempotency_key = $1', [k]);
    expect(rows[0].n).toBe(1);
  });

  it('recovers an expired lease, re-assigns the task and rejects the stale worker', async () => {
    const stale = await agent('itest stale');
    const fresh = await agent('itest fresh');
    const task = await owner.services.tasks.submit('system.health_check', {}, key());
    const c1 = await api(stale.token, 'claim');
    const lease1 = { task_id: task.id, lease_token: c1.body.data.lease_token };
    await api(stale.token, 'start', lease1);

    // The stale worker goes quiet; time passes beyond its lease.
    await db.query(`update public.tasks set lease_expires_at = now() - interval '1 second' where id = $1`, [task.id]);
    const recovered = await adminClient().rpc('admin_recover_tasks');
    expect((recovered.data as { requeued: number }).requeued).toBe(1);
    await db.query(`update public.tasks set available_at = now() - interval '1 second' where id = $1`, [task.id]);

    const c2 = await api(fresh.token, 'claim');
    expect(c2.body.data.task_id).toBe(task.id);
    expect(c2.body.data.attempt).toBe(2);

    const late = await api(stale.token, 'complete', { ...lease1, result: { ok: true } });
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe('lease_lost');

    const lease2 = { task_id: task.id, lease_token: c2.body.data.lease_token };
    await api(fresh.token, 'start', lease2);
    expect((await api(fresh.token, 'complete', { ...lease2, result: { ok: true } })).body.data.status).toBe('succeeded');
    const attempts = await owner.services.tasks.listAttempts(task.id);
    expect(attempts.map((x) => x.outcome)).toEqual(['lease_expired', 'succeeded']);
  });

  it('retries retryable failures with backoff and stops at the attempt limit', async () => {
    const a = await agent('itest retry');
    const task = await owner.services.tasks.submit('system.health_check', {}, key());
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.query(`update public.tasks set available_at = now() - interval '1 second' where id = $1 and status = 'queued'`, [task.id]);
      const c = await api(a.token, 'claim');
      expect(c.body.data.attempt).toBe(attempt);
      const lease = { task_id: task.id, lease_token: c.body.data.lease_token };
      await api(a.token, 'start', lease);
      const f = await api(a.token, 'fail', { ...lease, error: { code: 'probe_failed', message: 'Probe failed', retryable: true } });
      expect(f.body.data.status).toBe(attempt < 3 ? 'queued' : 'failed');
      if (attempt < 3) expect(Date.parse(f.body.data.retry_at)).toBeGreaterThan(Date.now());
    }
    const final = (await owner.services.tasks.listRecent(owner.id, 5)).find((t) => t.id === task.id)!;
    expect(final.status).toBe('failed');
    expect(final.error).toEqual({ code: 'probe_failed', message: 'Probe failed', retryable: false });
  });

  it('cancels a running task cooperatively', async () => {
    const a = await agent('itest cancel');
    const task = await owner.services.tasks.submit('system.health_check', {}, key());
    const c = await api(a.token, 'claim');
    const lease = { task_id: task.id, lease_token: c.body.data.lease_token };
    await api(a.token, 'start', lease);
    expect((await owner.services.tasks.cancel(task.id)).status).toBe('cancel_requested');
    expect((await api(a.token, 'renew', lease)).body.data.cancel_requested).toBe(true);
    expect((await api(a.token, 'ack-cancel', lease)).body.data.status).toBe('cancelled');
  });

  it('keeps tasks private to their owner and refuses non-owners', async () => {
    await agent('itest privacy');
    const task = await owner.services.tasks.submit('system.health_check', {}, key());
    const other = await signedInUser('queue-other');
    expect(await other.services.tasks.listRecent(other.id, 10)).toEqual([]);
    const { data } = await other.client.from('tasks').select('id').eq('id', task.id);
    expect(data).toEqual([]);
    await expect(other.services.tasks.cancel(task.id)).rejects.toMatchObject({ kind: 'authorization' });
    await expect(other.services.tasks.submit('system.health_check', {}, key())).rejects.toMatchObject({ kind: 'authorization' });
    expect(await other.services.agents.list()).toEqual([]);
  });

  it('refuses unavailable MT5 task types and submissions without an online agent', async () => {
    await expect(owner.services.tasks.submit('mt5.backtest', {}, key())).rejects.toMatchObject({
      kind: 'unavailable',
      userMessage: 'The MetaTrader 5 connector is not available yet.',
    });
    await db.query(`update public.agents set last_heartbeat_at = now() - interval '10 minutes' where revoked_at is null`);
    await expect(owner.services.tasks.submit('system.health_check', {}, key())).rejects.toMatchObject({ kind: 'unavailable', code: 'TPU02' });
  });

  it('does not let a browser session use the agent protocol or read credentials', async () => {
    // The client types omit agent_*; call it untyped to prove the database refuses it too.
    type UntypedRpc = (fn: string, args: object) => Promise<{ error: unknown }>;
    const { error } = await (owner.client.rpc as unknown as UntypedRpc).call(owner.client, 'agent_claim', { p_token_sha256: '\\x00' });
    expect(error).not.toBeNull();
    const anon = browserClient();
    const r = await (anon.rpc as unknown as UntypedRpc).call(anon, 'agent_claim', { p_token_sha256: '\\x00' });
    expect(r.error).not.toBeNull();
    type UntypedSchema = { schema: (s: string) => { from: (t: string) => { select: (c: string) => Promise<{ data: unknown[] | null }> } } };
    const creds = await (owner.client as unknown as UntypedSchema).schema('private').from('agent_credentials').select('*');
    expect(creds.data ?? []).toEqual([]);
  });

  it('rejects malformed, unauthenticated and oversized agent requests with structured errors', async () => {
    const a = await agent('itest api');
    expect((await api(null, 'claim')).status).toBe(401);
    expect((await api('tpa_short', 'claim')).status).toBe(401);
    expect((await api(newToken(), 'claim')).body.error?.code).toBe('unauthorized');
    expect((await api(a.token, 'nope')).status).toBe(404);
    expect((await api(a.token, 'heartbeat', { agent_version: 'x', capabilities: [] })).status).toBe(422);
    expect((await api(a.token, 'start', { task_id: 'not-a-uuid', lease_token: 'x' })).status).toBe(422);
    expect((await api(a.token, 'claim', '{not json')).status).toBe(400);
    expect((await api(a.token, 'claim', JSON.stringify({ pad: 'x'.repeat(9000) }))).status).toBe(413);
    expect((await api(a.token, 'claim', {}, { headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${a.token}` } })).status).toBe(415);
    const bad = await handleAgentRequest(
      new Request('http://127.0.0.1/api/agent/claim', { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: '{}' }),
      { ...serverEnv, SUPABASE_SECRET_KEY: env.anonKey },
      'claim',
    );
    expect(bad.status).toBe(503);
    // A revoked agent is locked out immediately.
    await adminClient().rpc('admin_revoke_agent', { p_agent_id: a.id });
    expect((await heartbeat(a.token)).status).toBe(401);
  });

  it('delivers task changes over Realtime to the owner only', async () => {
    const a = await agent('itest realtime');
    const other = await signedInUser('queue-rt-other');
    const statuses: LiveStatus[] = [];
    let ownerChanges = 0;
    let otherChanges = 0;
    const stopOwner = owner.services.realtime.watchRows({
      channel: `itest-tasks:${owner.id}`,
      table: 'tasks',
      filter: `owner_user_id=eq.${owner.id}`,
      onChange: () => ownerChanges++,
      onStatus: (s) => statuses.push(s),
    });
    let otherLive = false;
    const stopOther = other.services.realtime.watchRows({
      channel: `itest-tasks-other:${other.id}`,
      table: 'tasks',
      onChange: () => otherChanges++,
      onStatus: (s) => (otherLive ||= s === 'live'),
    });
    const until = async (cond: () => boolean, ms = 10_000) => {
      for (let t = 0; t < ms && !cond(); t += 100) await new Promise((r) => setTimeout(r, 100));
    };
    await until(() => statuses.includes('live') && otherLive);
    expect(statuses).toContain('live');

    const task = await owner.services.tasks.submit('system.health_check', {}, key());
    const c = await api(a.token, 'claim');
    await api(a.token, 'start', { task_id: task.id, lease_token: c.body.data.lease_token });
    await until(() => ownerChanges >= 3);
    expect(ownerChanges).toBeGreaterThanOrEqual(3); // insert, claim, start
    await new Promise((r) => setTimeout(r, 500));
    expect(otherChanges).toBe(0);
    stopOwner();
    stopOther();
  });
});
