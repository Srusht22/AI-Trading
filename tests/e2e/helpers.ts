import { createClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
// @ts-expect-error — plain ESM helper shared with the CLI scripts
import { loadServerEnv } from '../../scripts/load-server-env.mjs';
// @ts-expect-error — plain ESM helper shared with the CLI scripts
import { assertLocalTarget } from '../../scripts/assert-local-target.mjs';

loadServerEnv();
assertLocalTarget(process.env.SUPABASE_URL!);

export const PASSWORD = 'E2e-Strong-Pass-42';
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

export async function emailLink(email: string, timeoutMs = 10_000): Promise<string> {
  const base = process.env.MAILPIT_URL!;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
    if (list.messages.length) {
      const msg = (await (await fetch(`${base}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      const m = msg.Text.match(/https?:\/\/\S+\/verify\?\S+/);
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No email received for ${email}`);
}

/** A confirmed owner account created through trusted tooling. */
export async function createOwner(tag = 'owner') {
  const email = uniqueEmail(tag);
  const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: 'E2E Owner' } });
  if (error) throw error;
  const assigned = await admin.rpc('admin_assign_owner', { p_email: email, p_replace: true });
  if (assigned.error) throw assigned.error;
  return email;
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Present at every screen size once the gated workspace has rendered.
  await expect(page.getByRole('button', { name: 'Personal workspace menu' })).toBeVisible();
}

export async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
