#!/usr/bin/env node
/**
 * Guarded migration push to a HOSTED Supabase project.
 *
 *   npm run db:push -- --env staging                    dry run: lists pending migrations
 *   npm run db:push -- --env staging --apply            applies them
 *   npm run db:push -- --env production --apply --confirm-production
 *
 * The project refs are read from SUPABASE_PROJECT_REF_STAGING /
 * SUPABASE_PROJECT_REF_PRODUCTION (shell environment or .env.server.local).
 * The script refuses to run unless the project currently linked with
 * `supabase link` is exactly the one named for --env, so credentials that
 * happen to be present can never send development migrations to the wrong
 * project. Always run against staging first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { loadServerEnv } from './load-server-env.mjs';

loadServerEnv();
const args = process.argv.slice(2);
const target = args[args.indexOf('--env') + 1];
if (!['staging', 'production'].includes(target)) {
  console.error('Usage: npm run db:push -- --env staging|production [--apply] [--confirm-production]');
  process.exit(2);
}
const expected = process.env[`SUPABASE_PROJECT_REF_${target.toUpperCase()}`];
if (!expected || !/^[a-z0-9]{20}$/.test(expected)) {
  console.error(`Set SUPABASE_PROJECT_REF_${target.toUpperCase()} to the ${target} project's 20-character reference.`);
  process.exit(2);
}
const other = process.env[`SUPABASE_PROJECT_REF_${target === 'staging' ? 'PRODUCTION' : 'STAGING'}`];
if (other && other === expected) {
  console.error('Staging and production have the same project ref. They must be separate projects.');
  process.exit(2);
}
const linkedFile = 'supabase/.temp/project-ref';
const linked = existsSync(linkedFile) ? readFileSync(linkedFile, 'utf8').trim() : '';
if (linked !== expected) {
  console.error(
    `The linked project (${linked || 'none'}) is not the ${target} project (${expected}). ` +
      `Run \`npx supabase link --project-ref ${expected}\` deliberately, then retry.`,
  );
  process.exit(2);
}
if (target === 'production' && args.includes('--apply') && !args.includes('--confirm-production')) {
  console.error('Applying to production needs --confirm-production (after the same migrations succeeded on staging).');
  process.exit(2);
}

const apply = args.includes('--apply');
console.log(`${apply ? 'Applying' : 'Dry run of'} pending migrations on ${target} (${expected})…`);
const r = spawnSync('npx', ['supabase', 'db', 'push', '--linked', ...(apply ? [] : ['--dry-run'])], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
if (!apply) console.log('\nNothing was changed. Re-run with --apply to apply the migrations listed above.');
else console.log(`\nDone. Next: DB_URL=<${target} connection string> npm run db:types:check`);
