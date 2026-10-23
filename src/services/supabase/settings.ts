import type { TradePilotClient } from '@/lib/supabase/client';
import { AppError, fromPostgrestError } from '@/lib/errors';
import { SETTINGS_COLUMNS, settingsPatchSchema, userSettingsSchema } from '@/domain/settings';
import type { SettingsService } from '../types';
import { parseResponse } from './validate';

export function createSettingsService(client: TradePilotClient): SettingsService {
  const get: SettingsService['get'] = async (userId) => {
    const { data, error, status } = await client.from('user_settings').select(SETTINGS_COLUMNS).eq('user_id', userId).maybeSingle();
    if (error) throw fromPostgrestError(error, 'load your settings', status);
    return data ? parseResponse(userSettingsSchema, data, 'your settings') : null;
  };

  return {
    get,

    async ensure(userId) {
      const existing = await get(userId);
      if (existing) return existing;
      const { data, error, status } = await client.from('user_settings').insert({ user_id: userId }).select(SETTINGS_COLUMNS).single();
      if (error && error.code === '23505') {
        const raced = await get(userId);
        if (raced) return raced;
      }
      if (error) throw fromPostgrestError(error, 'create your settings', status);
      return parseResponse(userSettingsSchema, data, 'your settings');
    },

    async update(userId, patch, expectedRevision) {
      const parsed = settingsPatchSchema.safeParse(patch);
      if (!parsed.success) {
        throw new AppError('validation', parsed.error.issues[0]?.message ?? 'One of the settings isn’t valid.', { cause: parsed.error });
      }
      const { data, error, status } = await client
        .from('user_settings')
        .update(parsed.data)
        .eq('user_id', userId)
        .eq('revision', expectedRevision)
        .select(SETTINGS_COLUMNS)
        .maybeSingle();
      if (error) throw fromPostgrestError(error, 'save your settings', status);
      if (data) return parseResponse(userSettingsSchema, data, 'your settings');

      // No row matched: either it changed elsewhere (conflict) or it is gone.
      const current = await get(userId);
      if (current) {
        throw new AppError(
          'conflict',
          'Your settings were changed in another tab or device. We’ve loaded the latest version — review it and save again.',
          { code: 'revision_mismatch' },
        );
      }
      throw new AppError('not_found', 'Unable to save your settings because they could not be found. Reload the page and try again.');
    },
  };
}
