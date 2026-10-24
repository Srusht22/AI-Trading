#!/usr/bin/env node
/**
 * TradePilot reference agent: runs `system.health_check` tasks.
 *
 *   npm run agent:diagnostics                 run until Ctrl+C
 *   npm run agent:diagnostics -- --once       handle at most one task, then exit
 *
 * Reads TRADEPILOT_API_URL / TRADEPILOT_AGENT_TOKEN from the environment or
 * .env.agent.local (written by `npm run agent:register`). It talks only to
 * the TradePilot agent API with its own token — it has no database or
 * Supabase credentials and touches no trading system. It never prints its
 * token.
 *
 * Protocol: heartbeat → claim → start → renew (progress, cancel check) →
 * complete | fail | ack-cancel. A "lease_lost" answer means another worker
 * owns the task now; this worker drops it without reporting anything.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';

export const AGENT_VERSION = '0.1.0';
// Request budget: one agent makes ~4,300 heartbeats + ~8,600 idle polls a day
// (~13k Function requests), well inside the Cloudflare free plan's daily limit.
export const HEARTBEAT_MS = 20_000; // the server treats > 45 s without one as "not responding"
export const IDLE_POLL_MS = 10_000;
export const CAPABILITIES = ['system.health_check'];

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LeaseLost extends Error {}

/** Optional Cloudflare Access service token, for deployments behind Access (staging). */
export function accessHeaders(env = process.env) {
  return env.TRADEPILOT_ACCESS_CLIENT_ID && env.TRADEPILOT_ACCESS_CLIENT_SECRET
    ? { 'CF-Access-Client-Id': env.TRADEPILOT_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.TRADEPILOT_ACCESS_CLIENT_SECRET }
    : {};
}

export function createAgentClient({ apiUrl, token, fetchImpl = fetch }) {
  const base = apiUrl.replace(/\/+$/, '');
  return async function call(action, body = {}) {
    let res;
    try {
      res = await fetchImpl(`${base}/api/agent/${action}`, {
        method: 'POST',
        headers: { ...accessHeaders(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const err = new Error(`network error calling ${action}`);
      err.retryable = true;
      err.cause = e;
      throw err;
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) return json.data;
    const code = json?.error?.code ?? `http_${res.status}`;
    if (code === 'lease_lost') throw new LeaseLost(json.error.message);
    const err = new Error(`${action} failed: ${code}`);
    err.code = code;
    err.status = res.status;
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  };
}

/** The actual health check: only facts this process can measure itself. */
export async function runHealthCheck({ apiUrl, payload, report, fetchImpl = fetch }) {
  const runtime = { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length };
  await report(25, 'Collected runtime information');

  const samples = [];
  let offset = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/api/health`, { headers: accessHeaders() });
    const t1 = Date.now();
    if (!res.ok) throw Object.assign(new Error(`health endpoint answered ${res.status}`), { code: 'api_unhealthy' });
    const body = await res.json();
    samples.push(t1 - t0);
    const serverMs = Date.parse(body?.data?.time ?? '');
    if (Number.isFinite(serverMs)) offset = Math.round(serverMs - (t0 + t1) / 2);
  }
  samples.sort((a, b) => a - b);
  await report(75, 'Measured API latency');

  const result = {
    ok: true,
    agent_version: AGENT_VERSION,
    runtime,
    memory_free_mb: Math.round(os.freemem() / 1048576),
    uptime_seconds: Math.round(os.uptime()),
    api_latency_ms: { min: samples[0], median: samples[1], max: samples[2] },
    clock_offset_ms: offset,
    checked_at: new Date().toISOString(),
  };
  if (typeof payload?.note === 'string') result.request_note = payload.note;
  return result;
}

export async function processTask(call, task, { apiUrl, log = () => {}, fetchImpl = fetch } = {}) {
  const lease = { task_id: task.task_id, lease_token: task.lease_token };
  let cancelled = false;
  try {
    const started = await call('start', lease);
    if (started.cancel_requested) cancelled = true;
    const report = async (progress_percent, progress_message) => {
      if (cancelled) throw new Error('cancelled');
      const r = await call('renew', { ...lease, progress_percent, progress_message });
      if (r.cancel_requested) {
        cancelled = true;
        throw new Error('cancelled');
      }
    };
    if (cancelled) throw new Error('cancelled');
    const result = await runHealthCheck({ apiUrl, payload: task.payload, report, fetchImpl });
    await call('complete', { ...lease, result });
    log(`task ${task.task_id} succeeded`);
    return 'succeeded';
  } catch (e) {
    if (e instanceof LeaseLost) {
      log(`task ${task.task_id}: lease lost, dropping it`);
      return 'lease_lost';
    }
    if (cancelled) {
      await call('ack-cancel', lease).catch(() => {});
      log(`task ${task.task_id} cancelled on request`);
      return 'cancelled';
    }
    const code = typeof e.code === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(e.code) ? e.code : 'check_failed';
    await call('fail', {
      ...lease,
      error: { code, message: String(e.message || 'Health check failed').slice(0, 300), retryable: e.retryable !== false },
    }).catch(() => {});
    log(`task ${task.task_id} failed (${code})`);
    return 'failed';
  }
}

async function main() {
  loadEnvFile('.env.agent.local');
  const apiUrl = process.env.TRADEPILOT_API_URL;
  const token = process.env.TRADEPILOT_AGENT_TOKEN;
  if (!apiUrl || !token) {
    console.error('Set TRADEPILOT_API_URL and TRADEPILOT_AGENT_TOKEN (or run `npm run agent:register` to create .env.agent.local).');
    process.exit(2);
  }
  const once = process.argv.includes('--once');
  const log = (m) => console.log(`[diagnostics-agent ${new Date().toISOString()}] ${m}`);
  const call = createAgentClient({ apiUrl, token });

  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; log('stopping after the current step'); });

  const heartbeat = () => call('heartbeat', { agent_version: AGENT_VERSION, capabilities: CAPABILITIES, platform: `${process.platform}/${process.arch}` });
  await heartbeat();
  log(`online (version ${AGENT_VERSION}, capabilities ${CAPABILITIES.join(', ')})`);
  const timer = setInterval(() => heartbeat().catch((e) => log(`heartbeat failed: ${e.code ?? e.message}`)), HEARTBEAT_MS);

  let backoff = 1000;
  try {
    while (!stopping) {
      try {
        const task = await call('claim');
        backoff = 1000;
        if (!task) {
          await sleep(IDLE_POLL_MS);
          continue;
        }
        log(`claimed task ${task.task_id} (${task.task_type}, attempt ${task.attempt}/${task.max_attempts})`);
        await processTask(call, task, { apiUrl, log });
        if (once) break;
      } catch (e) {
        log(`agent API error: ${e.code ?? e.message}; retrying in ${Math.round(backoff / 1000)}s`);
        if (e.code === 'unauthorized') process.exitCode = 1;
        if (e.code === 'unauthorized') break;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  } finally {
    clearInterval(timer);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[diagnostics-agent] fatal: ${e.code ?? e.message}`);
    process.exit(1);
  });
}
