#!/usr/bin/env node
/**
 * Trusted owner bootstrap for a single-owner TradePilot deployment.
 *
 *   npm run owner:assign -- you@example.com            assign the first owner
 *   npm run owner:assign -- you@example.com --replace  reassign ownership
 *
 * Runs on a trusted machine with the service-role key. The database function
 * public.admin_assign_owner() is executable only by service_role, so this
 * cannot be done from the browser. The account must already exist.
 */
import { createClient } from '@supabase/supabase-js';
import { loadServerEnv, requireEnv } from './load-server-env.mjs';

loadServerEnv();
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const replace = args.includes('--replace');
if (!email) {
  console.error('Usage: npm run owner:assign -- <email> [--replace]');
  process.exit(2);
}

const url = requireEnv('SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.rpc('admin_assign_owner', { p_email: email, p_replace: replace });
if (error) {
  const hint =
    error.code === 'P0002'
      ? 'No account exists for that email. Sign up first, confirm the email, then run this again.'
      : error.code === '23505'
        ? 'An owner is already assigned. Re-run with --replace to transfer ownership.'
        : error.message;
  console.error(`Owner not assigned: ${hint}`);
  process.exit(1);
}
console.log(`Owner assigned: ${email} (user id ${data}).`);
console.log('Recommended next step: disable public sign-ups (see docs/backend.md › Closing registration).');
