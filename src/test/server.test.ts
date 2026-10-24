import { describe, expect, it } from 'vitest';
import { handleAgentRequest } from '../../server/agentApi';
import { handleHealthRequest } from '../../server/healthApi';
import { applyApiMiddleware } from '../../server/middleware';
import { resolveServerEnv } from '../../server/env';

const fakeJwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
// Obviously fake: only the `sb_secret_` prefix matters to the code under test.
const FAKE_SECRET = ['sb', 'secret', 'NOT-A-REAL-KEY'].join('_');
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: FAKE_SECRET, APP_ENV: 'staging' };
const token = `tpa_${'a'.repeat(43)}`;

function req(action: string, init: RequestInit = {}) {
  return new Request(`https://app.test/api/agent/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
    ...init,
  });
}

describe('server configuration', () => {
  it('accepts only server keys and requires https outside development', () => {
    expect(resolveServerEnv(env)).not.toBeNull();
    expect(resolveServerEnv({ ...env, SUPABASE_SECRET_KEY: 'sb_publishable_abc' })).toBeNull();
    expect(resolveServerEnv({ ...env, SUPABASE_SECRET_KEY: fakeJwt('anon') })).toBeNull();
    expect(resolveServerEnv({ ...env, SUPABASE_SECRET_KEY: fakeJwt('service_role') })).not.toBeNull();
    expect(resolveServerEnv({ ...env, SUPABASE_URL: 'http://example.supabase.co' })).toBeNull();
    expect(resolveServerEnv({ ...env, SUPABASE_URL: 'http://127.0.0.1:54321', APP_ENV: 'development' })).not.toBeNull();
    expect(resolveServerEnv({})).toBeNull();
  });
});

describe('agent API boundary', () => {
  it('hashes the token and never forwards it, and maps database errors to structured codes', async () => {
    let sent: { url: string; body: string; headers: Headers } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body), headers: new Headers(init.headers) };
      return new Response(JSON.stringify({ code: 'TPL01', message: 'lease lost' }), { status: 400 });
    }) as unknown as typeof fetch;
    const res = await handleAgentRequest(
      req('start', { body: JSON.stringify({ task_id: crypto.randomUUID(), lease_token: crypto.randomUUID() }) }),
      env,
      'start',
      { fetch: fetchImpl },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: { code: 'lease_lost', message: expect.any(String) } });
    expect(sent!.url).toBe('https://example.supabase.co/rest/v1/rpc/agent_start_task');
    expect(sent!.body).not.toContain(token);
    expect(sent!.body).toMatch(/"p_token_sha256":"\\\\x[0-9a-f]{64}"/);
    expect(sent!.headers.get('apikey')).toBe(env.SUPABASE_SECRET_KEY);
    expect(sent!.headers.get('authorization')).toBeNull(); // sb_secret keys go in apikey only
  });

  it('rejects requests before any database call when they are unauthenticated or malformed', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('null');
    }) as unknown as typeof fetch;
    const cases: [Request, string, number][] = [
      [req('claim', { headers: { 'Content-Type': 'application/json' } }), 'claim', 401],
      [req('claim', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' } }), 'claim', 401],
      [req('claim', { method: 'GET', body: undefined }), 'claim', 405],
      [req('claim'), 'drop-tables', 404],
      [req('claim', { headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${token}` } }), 'claim', 415],
      [req('claim', { body: '{"x":1}' }), 'claim', 422],
      [req('claim', { body: 'x'.repeat(9000) }), 'claim', 413],
      [req('complete', { body: JSON.stringify({ task_id: 'nope', lease_token: 'nope', result: {} }) }), 'complete', 422],
    ];
    for (const [r, action, status] of cases) expect((await handleAgentRequest(r, env, action, { fetch: fetchImpl })).status).toBe(status);
    expect(calls).toBe(0);
    expect((await handleAgentRequest(req('claim'), { APP_ENV: 'production' }, 'claim', { fetch: fetchImpl })).status).toBe(503);
  });

  it('hides unexpected database errors behind a generic 502', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ code: '42P01', message: 'relation "x" does not exist' }), { status: 404 })) as unknown as typeof fetch;
    const res = await handleAgentRequest(req('claim'), env, 'claim', { fetch: fetchImpl });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('relation');
  });
});

describe('API middleware', () => {
  it('adds security headers to every Function response and hides exceptions', async () => {
    const res = await applyApiMiddleware(new Request('https://app.test/api/health'), env, async () => handleHealthRequest(new Request('https://app.test/api/health'), env));
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const boom = await applyApiMiddleware(new Request('https://app.test/api/x'), { APP_ENV: 'production' }, async () => {
      throw new Error('secret stack trace');
    });
    expect(boom.status).toBe(500);
    expect(await boom.text()).not.toContain('secret stack trace');
    expect(boom.headers.get('x-robots-tag')).toBeNull();
  });
});
