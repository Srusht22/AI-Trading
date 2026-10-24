#!/usr/bin/env node
/**
 * Run the production build and Pages Functions locally with Cloudflare's own
 * runtime (workerd), exactly as Pages serves them:
 *
 *   npm run build && npm run pages:dev     → http://127.0.0.1:8788
 *
 * Writes .dev.vars (git-ignored, mode 600) from .env.server.local and refuses
 * to point the local Functions at a non-local Supabase project.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { loadServerEnv, requireEnv } from './load-server-env.mjs';
import { assertLocalTarget } from './assert-local-target.mjs';

loadServerEnv();
const url = requireEnv('SUPABASE_URL');
assertLocalTarget(url);
const dirFlag = process.argv.indexOf('--dir');
const dir = dirFlag >= 0 ? process.argv[dirFlag + 1] : 'dist';
if (!existsSync(`${dir}/index.html`)) {
  console.error(`${dir}/ is missing. Run \`npm run build\` first.`);
  process.exit(2);
}
writeFileSync(
  '.dev.vars',
  `SUPABASE_URL=${url}\nSUPABASE_SECRET_KEY=${requireEnv('SUPABASE_SERVICE_ROLE_KEY')}\nAPP_ENV=development\n`,
  { mode: 0o600 },
);
const port = process.env.PAGES_PORT ?? '8788';
const child = spawn('npx', ['wrangler', 'pages', 'dev', dir, '--port', port, '--ip', '127.0.0.1', '--log-level', 'warn'], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
