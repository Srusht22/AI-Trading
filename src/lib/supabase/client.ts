import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PublicConfig } from '@/lib/env';
import type { Database } from './database.types';

export type TradePilotClient = SupabaseClient<Database>;

/**
 * Browser client. Sessions use supabase-js's supported storage (the PKCE
 * flow with automatic token refresh); the app never reads or writes tokens
 * itself. Only the publishable key is used — RLS enforces authorization.
 */
export function createBrowserClient(config: PublicConfig): TradePilotClient {
  return createClient<Database>(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'tradepilot-auth',
    },
    global: { headers: { 'x-client-info': 'tradepilot-web' } },
  });
}
