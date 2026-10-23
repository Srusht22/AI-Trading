import type { TradePilotClient } from '@/lib/supabase/client';
import { AppError, fromPostgrestError } from '@/lib/errors';
import { PROFILE_COLUMNS, profileSchema } from '@/domain/profile';
import type { ProfileService } from '../types';
import { parseResponse } from './validate';

export function createProfileService(client: TradePilotClient): ProfileService {
  const get: ProfileService['get'] = async (userId) => {
    const { data, error, status } = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
    if (error) throw fromPostgrestError(error, 'load your profile', status);
    return data ? parseResponse(profileSchema, data, 'your profile') : null;
  };

  return {
    get,

    async ensure(userId) {
      const existing = await get(userId);
      if (existing) return existing;
      // Normally created at sign-up by a database trigger; recover if it is missing.
      const { data, error, status } = await client.from('profiles').insert({ id: userId }).select(PROFILE_COLUMNS).single();
      if (error && error.code === '23505') {
        const raced = await get(userId);
        if (raced) return raced;
      }
      if (error) throw fromPostgrestError(error, 'create your profile', status);
      return parseResponse(profileSchema, data, 'your profile');
    },

    async updateDisplayName(userId, displayName) {
      const { data, error, status } = await client
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (error) throw fromPostgrestError(error, 'save your profile', status);
      if (!data) throw new AppError('not_found', 'Unable to save your profile because it could not be found. Reload the page and try again.');
      return parseResponse(profileSchema, data, 'your profile');
    },
  };
}
