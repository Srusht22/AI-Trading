import type { PublicConfig } from '@/lib/env';
import { createBrowserClient, type TradePilotClient } from '@/lib/supabase/client';
import type { Services } from './types';
import { createAccessService } from './supabase/access';
import { createAuditService } from './supabase/audit';
import { createAuthService } from './supabase/auth';
import { createProfileService } from './supabase/profiles';
import { createRealtimeService } from './supabase/realtime';
import { createSettingsService } from './supabase/settings';

export type { Services } from './types';

export function createSupabaseServices(config: PublicConfig, origin: string, client?: TradePilotClient): Services {
  const c = client ?? createBrowserClient(config);
  return {
    auth: createAuthService(c, config, origin),
    access: createAccessService(c),
    profiles: createProfileService(c),
    settings: createSettingsService(c),
    audit: createAuditService(c),
    realtime: createRealtimeService(c),
  };
}
