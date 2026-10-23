import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { TradePilotClient } from '@/lib/supabase/client';
import { createSupabaseServices } from '@/services';

export const env = {
  url: process.env.SUPABASE_URL!,
  anonKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  mailpit: process.env.MAILPIT_URL,
};

export const PASSWORD = 'Integration-Pass-42';

/** A fresh, isolated browser-like client (publishable key, in-memory session). */
export function browserClient(): TradePilotClient {
  return createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Trusted server-side client. Never used by application code. */
export function adminClient() {
  return createClient<Database>(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Create a confirmed user via the admin API and return signed-in services for it. */
export async function signedInUser(tag: string) {
  const email = uniqueEmail(tag);
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = browserClient();
  const services = createSupabaseServices({ supabaseUrl: env.url, supabasePublishableKey: env.anonKey }, 'http://localhost:5173', client);
  await services.auth.signIn(email, PASSWORD);
  return { email, id: data.user.id, client, services };
}

export async function mailpitLink(email: string, pattern: RegExp, timeoutMs = 8000): Promise<string> {
  if (!env.mailpit) throw new Error('MAILPIT_URL not set');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${env.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
      messages: { ID: string }[];
    };
    if (list.messages.length) {
      const msg = (await (await fetch(`${env.mailpit}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      const m = msg.Text.match(pattern);
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No matching email for ${email}`);
}
