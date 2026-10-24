import { z } from 'zod';

/**
 * Browser configuration. Only the public project URL and the publishable
 * (anon) key belong here — both are safe to ship because Row-Level Security
 * protects the data. A privileged key is rejected outright.
 */
export interface PublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type ConfigResult = { ok: true; config: PublicConfig } | { ok: false; problems: string[] };

const schema = z.object({
  VITE_SUPABASE_URL: z.string({ error: 'VITE_SUPABASE_URL is not set.' }).url('VITE_SUPABASE_URL must be a full URL.'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: 'VITE_SUPABASE_PUBLISHABLE_KEY is not set.' })
    .min(20, 'VITE_SUPABASE_PUBLISHABLE_KEY looks incomplete.'),
});

/** Decode a JWT payload without verifying it (only to inspect the role claim). */
function jwtRole(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : undefined;
  } catch {
    return undefined;
  }
}

export function isPrivilegedKey(key: string): boolean {
  return key.startsWith('sb_secret_') || jwtRole(key) === 'service_role';
}

export function readPublicConfig(env: Record<string, unknown> = import.meta.env): ConfigResult {
  const parsed = schema.safeParse(env);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => i.message) };
  const key = parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (isPrivilegedKey(key)) {
    return {
      ok: false,
      problems: [
        'VITE_SUPABASE_PUBLISHABLE_KEY contains a privileged (service-role/secret) key. Use the publishable or anon key; privileged keys must never be shipped to a browser.',
      ],
    };
  }
  return { ok: true, config: { supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/+$/, ''), supabasePublishableKey: key } };
}
