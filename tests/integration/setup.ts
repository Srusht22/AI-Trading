// @ts-expect-error — plain ESM helper shared with the CLI scripts
import { loadServerEnv } from '../../scripts/load-server-env.mjs';
// @ts-expect-error — plain ESM helper shared with the CLI scripts
import { assertLocalTarget } from '../../scripts/assert-local-target.mjs';

loadServerEnv();
for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[name] || process.env[name]!.startsWith('paste-')) {
    throw new Error(`Integration tests need ${name}. Start the stack (npm run db:start) and fill in .env.server.local.`);
  }
}

assertLocalTarget(process.env.SUPABASE_URL!);
