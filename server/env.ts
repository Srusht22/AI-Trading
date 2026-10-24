/**
 * Server-side configuration for Pages Functions. Set as encrypted
 * environment variables in the Cloudflare dashboard (or `.dev.vars` locally,
 * written by scripts/pages-dev.mjs). Never prefixed with VITE_, never bundled
 * into the browser build.
 */
export interface ServerEnv {
  SUPABASE_URL?: string;
  /** sb_secret_… key (or a legacy service_role JWT). Server-only. */
  SUPABASE_SECRET_KEY?: string;
  /** development | staging | production */
  APP_ENV?: string;
}

export type AppEnvironment = 'development' | 'staging' | 'production';

export interface ResolvedServerEnv {
  supabaseUrl: string;
  secretKey: string;
  appEnv: AppEnvironment;
}

function jwtRole(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const role = (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }).role;
    return typeof role === 'string' ? role : undefined;
  } catch {
    return undefined;
  }
}

export function isJwt(key: string): boolean {
  return key.split('.').length === 3;
}

export function appEnvironment(value: string | undefined): AppEnvironment {
  return value === 'production' || value === 'staging' ? value : 'development';
}

/**
 * Validates the configuration without ever including a value in the error.
 * Returns null when misconfigured so the API answers 503 instead of guessing.
 */
export function resolveServerEnv(env: ServerEnv): ResolvedServerEnv | null {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const appEnv = appEnvironment(env.APP_ENV);
  // Hosted environments must talk to Supabase over TLS.
  if (appEnv !== 'development' && parsed.protocol !== 'https:') return null;
  // The agent protocol needs the privileged key; a publishable key would only produce confusing 401s.
  const privileged = key.startsWith('sb_secret_') || (isJwt(key) && jwtRole(key) === 'service_role');
  if (!privileged) return null;
  return { supabaseUrl: parsed.origin, secretKey: key, appEnv };
}
