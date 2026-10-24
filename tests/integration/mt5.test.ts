import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAgentRequest } from '../../server/agentApi';
import { handleHealthRequest } from '../../server/healthApi';
import { adminClient, env, signedInUser } from './helpers';

/**
 * End to end through every real layer except MetaTrader 5 itself:
 *   Python connector (connector/tradepilot_connector, real loop + HTTP client)
 *   → HTTP → server/agentApi.ts (the Pages Function handler) → PostgREST → Postgres
 *   → owner's browser services (RLS) and Realtime.
 * The terminal is connector/tests/fakes.py:FakeTerminal, a TEST FIXTURE whose
 * server is named "TradePilot-TEST-FIXTURE". No result here is market data.
 */
const python = process.env.PYTHON ?? 'python3';
const serverEnv = { SUPABASE_URL: env.url, SUPABASE_SECRET_KEY: env.serviceKey, APP_ENV: 'development' };

const until = async (cond: () => Promise<boolean> | boolean, ms = 20_000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
};

describe('MT5 connector pipeline (fake terminal, real everything else)', { timeout: 90_000 }, () => {
  let http: Server;
  let apiUrl = '';
  let proc: ChildProcess | undefined;
  let output = '';
  const control = mkdtempSync(join(tmpdir(), 'tp-mt5-'));
  let owner: Awaited<ReturnType<typeof signedInUser>>;
  let connectionId = '';

  beforeAll(async () => {
    http = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const url = `http://127.0.0.1${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      });
      const action = (req.url ?? '').split('/api/agent/')[1] ?? '';
      const response = req.url === '/api/health' ? handleHealthRequest(request, serverEnv) : await handleAgentRequest(request, serverEnv, action);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const address = http.address();
    apiUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    owner = await signedInUser('mt5-owner');
    const { error } = await adminClient().rpc('admin_assign_owner', { p_email: owner.email, p_replace: true });
    if (error) throw error;
  });

  afterAll(async () => {
    if (process.env.MT5_TEST_DEBUG) console.log(output);
    writeFileSync(join(control, 'stop'), '1');
    await until(() => proc?.exitCode !== null, 5000);
    proc?.kill('SIGKILL');
    await new Promise((r) => http.close(r));
  });

  it('pairs with a one-time code from the owner and verifies the demo account', async () => {
    const { data, error } = await owner.client.rpc('create_agent_pairing', { p_display_name: 'Integration PC' });
    expect(error).toBeNull();
    const code = (data as { code: string }).code;
    proc = spawn(python, ['connector/tests/e2e_fixture_session.py', '--api-url', apiUrl, '--code', code, '--control-dir', control], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (d) => (output += String(d)));
    proc.stderr?.on('data', (d) => (output += String(d)));

    expect(await until(async () => {
      const { data: rows } = await owner.client.from('mt5_connections').select('id, status');
      return rows?.[0]?.status === 'verified';
    })).toBe(true);
    const { data: conn } = await owner.client.from('mt5_connections').select('*').single();
    connectionId = conn!.id;
    expect(conn).toMatchObject({ masked_account: '****821', currency: 'EUR', server: 'TradePilot-TEST-FIXTURE', detected_trade_mode: 'demo' });
    expect(JSON.stringify(conn)).not.toContain('51234821');
    // A pairing code works once.
    const again = await handleAgentRequest(
      new Request(`${apiUrl}/api/agent/pair`, {
        method: 'POST',
        headers: { Authorization: `Bearer tpa_${'B'.repeat(43)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_code: code, agent_version: '1.0.0' }),
      }),
      serverEnv,
      'pair',
    );
    expect(again.status).toBe(401);
    expect(output).not.toMatch(/tpa_[A-Za-z0-9_-]{20,}/);
  });

  it('publishes the broker symbol list and live quotes for the chosen symbol', async () => {
    expect(await until(async () => {
      const { count } = await owner.client.from('mt5_symbols').select('name', { count: 'exact', head: true }).eq('connection_id', connectionId);
      return (count ?? 0) >= 2;
    })).toBe(true);
    const { error } = await owner.client.rpc('set_mt5_monitored_symbols', { p_connection_id: connectionId, p_symbols: ['EURUSD.r'] });
    expect(error).toBeNull();

    let first: { bid: number; tick_time: string; observed_at: string } | null = null;
    expect(await until(async () => {
      const { data } = await owner.client.from('mt5_quotes').select('bid, ask, tick_time, observed_at').eq('connection_id', connectionId);
      first = (data?.[0] as typeof first) ?? null;
      return !!first;
    }, 40_000)).toBe(true);
    expect(first!.tick_time).not.toBe(first!.observed_at);
    expect(await until(async () => {
      const { data } = await owner.client.from('mt5_quotes').select('bid').eq('connection_id', connectionId).single();
      return Number(data?.bid) > Number(first!.bid);
    }, 15_000)).toBe(true);
  });

  it('delivers quote changes over Realtime to the owner only', async () => {
    const other = await signedInUser('mt5-other');
    let ownerEvents = 0;
    let otherEvents = 0;
    let ownerLive = false;
    let otherLive = false;
    const stopOwner = owner.services.realtime.watchRows({
      channel: `it-quotes:${owner.id}`, table: 'mt5_quotes', filter: `owner_user_id=eq.${owner.id}`,
      onChange: () => ownerEvents++, onStatus: (s) => (ownerLive ||= s === 'live'),
    });
    const stopOther = other.services.realtime.watchRows({
      channel: `it-quotes-other:${other.id}`, table: 'mt5_quotes',
      onChange: () => otherEvents++, onStatus: (s) => (otherLive ||= s === 'live'),
    });
    expect(await until(() => ownerLive && otherLive)).toBe(true);
    expect(await until(() => ownerEvents >= 2, 15_000)).toBe(true);
    expect(otherEvents).toBe(0);
    const { data } = await other.client.from('mt5_account_state').select('*');
    expect(data).toEqual([]);
    stopOwner();
    stopOther();
  });

  it('stores the real account summary and an equity snapshot', async () => {
    expect(await until(async () => {
      const { data } = await owner.client.from('mt5_account_state').select('equity, currency').eq('connection_id', connectionId);
      return Number(data?.[0]?.equity) === 10012.34;
    })).toBe(true);
    const { count } = await owner.client.from('mt5_account_snapshots').select('id', { count: 'exact', head: true }).eq('connection_id', connectionId);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('runs read-only history and position tasks through the queue', async () => {
    const t = await owner.services.tasks.submit('mt5.price_history', { connection_id: connectionId, symbol: 'EURUSD.r', timeframe: 'M5', count: 60 }, `it-hist-${Date.now()}`);
    expect(await until(async () => {
      const tasks = await owner.services.tasks.listRecent(owner.id, 5);
      return tasks.find((x) => x.id === t.id)?.status === 'succeeded';
    }, 30_000)).toBe(true);
    const { count } = await owner.client.from('mt5_bars').select('open_time', { count: 'exact', head: true })
      .eq('connection_id', connectionId).eq('symbol', 'EURUSD.r').eq('timeframe', 'M5');
    expect(count).toBe(60);

    const p = await owner.services.tasks.submit('mt5.positions_read', { connection_id: connectionId }, `it-pos-${Date.now()}`);
    expect(await until(async () => (await owner.services.tasks.listRecent(owner.id, 5)).find((x) => x.id === p.id)?.status === 'succeeded', 30_000)).toBe(true);
    await expect(owner.services.tasks.submit('mt5.backtest', {}, `it-bt-${Date.now()}`)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('blocks the connection and stops data when the terminal switches to a real account', async () => {
    writeFileSync(join(control, 'real-account'), '1');
    expect(await until(async () => {
      const { data } = await owner.client.from('mt5_connections').select('status, status_reason').eq('id', connectionId).single();
      return data?.status === 'blocked' && data.status_reason === 'unsupported_account_type';
    })).toBe(true);
    const { data: before } = await owner.client.from('mt5_quotes').select('received_at').eq('connection_id', connectionId).single();
    await new Promise((r) => setTimeout(r, 4000));
    const { data: after } = await owner.client.from('mt5_quotes').select('received_at').eq('connection_id', connectionId).single();
    expect(after!.received_at).toBe(before!.received_at);
  });

  it('stops a revoked connector', async () => {
    const agentId = (await owner.client.from('mt5_connections').select('agent_id').eq('id', connectionId).single()).data!.agent_id;
    const { error } = await owner.client.rpc('revoke_agent', { p_agent_id: agentId });
    expect(error).toBeNull();
    expect(await until(() => proc?.exitCode !== null && proc?.exitCode !== undefined, 40_000)).toBe(true);
    expect(output).toMatch(/revoked/);
    expect(existsSync(control)).toBe(true);
  });
});
