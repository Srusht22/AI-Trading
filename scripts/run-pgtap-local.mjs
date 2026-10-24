#!/usr/bin/env node
/**
 * Run the pgTAP suite with plain psql against DATABASE_URL (local only).
 * Equivalent to `supabase test db` for stacks not started by the Supabase CLI.
 * Each file runs in its own transaction and rolls back.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadServerEnv, requireEnv } from './load-server-env.mjs';
import { assertLocalTarget } from './assert-local-target.mjs';

loadServerEnv();
const url = requireEnv('DATABASE_URL');
assertLocalTarget(url.replace(/^postgres(ql)?:/, 'http:'));
const dir = 'supabase/tests/database';
let failed = 0;
let total = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort()) {
  const r = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=0', '-f', file], { cwd: dir, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).split('\n');
  const ok = lines.filter((l) => l.startsWith('ok ')).length;
  const bad = lines.filter((l) => l.startsWith('not ok') || /ERROR:|# Looks like/.test(l));
  total += ok;
  failed += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${file}: ${ok} ok`);
  for (const l of bad) console.log(`      ${l}`);
}
console.log(`\n${total} assertions passed, ${failed} problems.`);
process.exit(failed ? 1 : 0);
