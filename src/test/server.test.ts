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

describe('MT5 connector actions', () => {
  const capture = () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    return { sent, fetchImpl };
  };

  it('pairs with the hash of the normalised code and of the self-generated token — never the raw values', async () => {
    const { sent, fetchImpl } = capture();
    const res = await handleAgentRequest(req('pair', { body: JSON.stringify({ pairing_code: 'ab12-CD34-ef56-7890-AAAA', agent_version: '1.0.0' }) }), env, 'pair', { fetch: fetchImpl });
    expect(res.status).toBe(200);
    expect(sent[0].url).toMatch(/\/rpc\/agent_pair$/);
    const body = JSON.stringify(sent[0].body);
    expect(body).not.toContain(token);
    expect(body).not.toMatch(/AB12/i);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('AB12CD34EF567890AAAA'))), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(sent[0].body.p_code_sha256).toBe(`\\x${expected}`);
  });

  it('accepts only the read-only data kinds with strict per-kind schemas', async () => {
    const { sent, fetchImpl } = capture();
    const base = { connection_id: crypto.randomUUID(), account_fingerprint: 'a'.repeat(64) };
    const call = (body: unknown) => handleAgentRequest(req('mt5-publish', { body: JSON.stringify(body) }), env, 'mt5-publish', { fetch: fetchImpl });
    const quotes = { observed_at: '2026-10-24T10:00:00Z', quotes: [{ symbol: 'EURUSD.r', bid: 1.1, ask: 1.1001, last: null, tick_time: '2026-10-24T09:59:59Z' }] };
    expect((await call({ ...base, kind: 'quotes', data: quotes })).status).toBe(200);
    expect(sent[0].body.p_kind).toBe('quotes');
    expect((await call({ ...base, kind: 'order_send', data: {} })).status).toBe(422);
    expect((await call({ ...base, kind: 'quotes', data: { ...quotes, comment: 'x' } })).status).toBe(422);
    expect((await call({ ...base, kind: 'quotes', data: { ...quotes, quotes: [{ ...quotes.quotes[0], tick_time: '2026-10-24 10:00' }] } })).status).toBe(422);
    expect(sent).toHaveLength(1);
  });

  it('allows larger bodies only for mt5-publish', async () => {
    const { fetchImpl } = capture();
    const symbols = Array.from({ length: 900 }, (_, i) => ({
      name: `SYM${i}`, description: 'A broker instrument with a long description', path: 'Forex\\Majors', digits: 5, point: 0.00001,
      currency_base: 'EUR', currency_profit: 'USD', trade_mode: 4, visible: false,
    }));
    const body = JSON.stringify({ connection_id: crypto.randomUUID(), account_fingerprint: 'a'.repeat(64), kind: 'symbols', data: { batch_id: crypto.randomUUID(), page: 0, final: true, symbols } });
    expect(body.length).toBeGreaterThan(8 * 1024);
    expect((await handleAgentRequest(req('mt5-publish', { body }), env, 'mt5-publish', { fetch: fetchImpl })).status).toBe(200);
    expect((await handleAgentRequest(req('mt5-connection', { body }), env, 'mt5-connection', { fetch: fetchImpl })).status).toBe(413);
  });
});
