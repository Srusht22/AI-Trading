import { z } from 'zod';
import type { TradePilotClient } from '@/lib/supabase/client';
import { AppError, fromPostgrestError } from '@/lib/errors';
import type { AccessService } from '../types';
import { parseResponse } from './validate';

const accessRows = z.array(z.object({ is_owner: z.boolean(), owner_configured: z.boolean() })).length(1);

export function createAccessService(client: TradePilotClient): AccessService {
  return {
    async getMyAccess() {
      const { data, error, status } = await client.rpc('get_my_access');
      if (error) throw fromPostgrestError(error, 'check your workspace access', status);
      if (!data) throw new AppError('database', 'Unable to check your workspace access. Please try again.');
      const [row] = parseResponse(accessRows, data, 'access information');
      return { isOwner: row.is_owner, ownerConfigured: row.owner_configured };
    },
  };
}
