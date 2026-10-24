#!/usr/bin/env node
/**
 * Register (or revoke) a worker agent. Trusted machine only: uses the
 * service-role key from .env.server.local.
 *
 *   npm run agent:register -- "Diagnostics (laptop)"            capabilities: system.health_check
 *   npm run agent:register -- "Name" --capability system.health_check --out .env.agent.local
 *   npm run agent:revoke -- <agent-id>
 *
 * The agent token is generated here, written ONLY to the --out file
 * (default .env.agent.local, permissions 0600, git-ignored) and never printed.
 * The database stores its SHA-256 hash; a lost token cannot be recovered —
 * revoke the agent and register a new one.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { loadServerEnv, requireEnv } from './load-server-env.mjs';

loadServerEnv();
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = ['--capability', '--out'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
const revoke = args.includes('--revoke');

const admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (revoke) {
  const id = positional[0];
  if (!id) {
    console.error('Usage: npm run agent:revoke -- <agent-id>');
    process.exit(2);
  }
  const { error } = await admin.rpc('admin_revoke_agent', { p_agent_id: id });
  if (error) {
    console.error(`Agent not revoked: ${error.code === 'P0002' ? 'no active agent with that id.' : error.message}`);
    process.exit(1);
  }
  console.log(`Agent ${id} revoked. Its token no longer works; any task it held is recovered when its lease runs out.`);
  process.exit(0);
}

const name = positional[0];
if (!name) {
  console.error('Usage: npm run agent:register -- "<display name>" [--capability system.health_check] [--out .env.agent.local]');
  process.exit(2);
}
const capabilities = args.flatMap((a, i) => (a === '--capability' ? [args[i + 1]] : []));
if (capabilities.length === 0) capabilities.push('system.health_check');
const out = flag('--out') ?? '.env.agent.local';
if (existsSync(out) && !args.includes('--force')) {
  console.error(`${out} already exists. Pass --force to overwrite it (the old agent keeps working until revoked).`);
  process.exit(2);
}

const token = `tpa_${randomBytes(32).toString('base64url')}`;
const hash = createHash('sha256').update(token).digest('hex');
const { data: id, error } = await admin.rpc('admin_register_agent', {
  p_display_name: name,
  p_capabilities: capabilities,
  p_token_sha256: `\\x${hash}`,
  p_max_concurrent_tasks: 1,
});
if (error) {
  console.error(`Agent not registered: ${error.message}`);
  process.exit(1);
}

const apiUrl = process.env.TRADEPILOT_API_URL ?? 'http://127.0.0.1:8788';
writeFileSync(
  out,
  `# TradePilot agent credentials for "${name}" (agent ${id}). Keep private; do not commit.\n` +
    `TRADEPILOT_API_URL=${apiUrl}\nTRADEPILOT_AGENT_ID=${id}\nTRADEPILOT_AGENT_TOKEN=${token}\n`,
  { mode: 0o600 },
);
console.log(`Agent registered: ${name} (id ${id}), capabilities: ${capabilities.join(', ')}.`);
console.log(`Token written to ${out} (mode 600). It is not shown here and cannot be recovered.`);
