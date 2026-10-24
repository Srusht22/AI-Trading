#!/usr/bin/env node
/**
 * Build and deploy TradePilot to Cloudflare Pages (free plan: static assets +
 * Functions; no paid add-ons are used).
 *
 *   npm run deploy:staging                         preview deployment of the current branch
 *   npm run deploy:production -- --confirm-production
 *
 * Needs, in the shell environment only (never in a file in the repository):
 *   CLOUDFLARE_API_TOKEN    token scoped to "Cloudflare Pages: Edit" for this account
 *   CLOUDFLARE_ACCOUNT_ID
 * and the public build config for the target in .env.staging.local /
 * .env.production.local (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).
 * Server secrets (SUPABASE_SECRET_KEY) are set once per environment in
 * Cloudflare — this script never reads or uploads them.
 *
 * Guards: refuses to build staging and production against the same Supabase
 * project, refuses local Supabase URLs (the Vite config enforces https), runs
 * the bundle secret scan before uploading, and verifies the live deployment's
 * headers and routes afterwards.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const target = args[args.indexOf('--env') + 1];
if (!['staging', 'production'].includes(target)) {
  console.error('Usage: node scripts/deploy-pages.mjs --env staging|production [--confirm-production] [--project tradepilot]');
  process.exit(2);
}
const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : 'tradepilot';

function readPublicEnv(mode) {
  const file = `.env.${mode}.local`;
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const config = readPublicEnv(target);
if (!config?.VITE_SUPABASE_URL || !config?.VITE_SUPABASE_PUBLISHABLE_KEY) {
  console.error(`Missing .env.${target}.local with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the ${target} project.`);
  process.exit(2);
}
const other = readPublicEnv(target === 'staging' ? 'production' : 'staging');
if (other?.VITE_SUPABASE_URL && new URL(other.VITE_SUPABASE_URL).host === new URL(config.VITE_SUPABASE_URL).host) {
  console.error('Staging and production point at the same Supabase project. Use a separate project for staging.');
  process.exit(2);
}
if (target === 'production' && !args.includes('--confirm-production')) {
  console.error('Production deploys need --confirm-production. Check docs/deployment.md › Production checklist first.');
  process.exit(2);
}
for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) {
    console.error(`${name} is not set. Export it in this shell (it is never stored in the repository).`);
    process.exit(2);
  }
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) {
  console.error('The working tree has uncommitted changes. Commit them so the deployment matches a reviewable commit.');
  process.exit(2);
}
const branch = target === 'production' ? 'main' : git('rev-parse', '--abbrev-ref', 'HEAD');
const commit = git('rev-parse', 'HEAD');

const run = (cmd, cmdArgs, env = {}) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log(`Building ${target} (${branch} @ ${commit.slice(0, 8)})…`);
run('npx', ['tsc', '-b']);
run('npx', ['vite', 'build', '--mode', target], { VITE_APP_ENV: target });
run('node', ['scripts/check-bundle-secrets.mjs']);

console.log(`Deploying to Cloudflare Pages project "${project}" (branch ${branch})…`);
const deploy = spawnSync(
  'npx',
  ['wrangler', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', branch, '--commit-hash', commit, '--commit-dirty=false'],
  { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
process.stdout.write(deploy.stdout ?? '');
process.stderr.write(deploy.stderr ?? '');
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const url = (deploy.stdout.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/) ?? [])[0];
if (!url) {
  console.error('Deployed, but could not find the deployment URL in the output; run `npm run verify:deployment -- <url>` manually.');
  process.exit(1);
}
console.log(`\nVerifying ${url}…`);
run('node', ['scripts/verify-deployment.mjs', url, ...(target === 'production' ? [] : ['--expect-noindex'])]);
console.log(`\n${target} deployment verified: ${url}`);
if (target === 'staging') console.log('Reminder: staging must sit behind Cloudflare Access before the URL is shared (docs/deployment.md).');
