import { z } from 'zod';
import type { TradePilotClient } from '@/lib/supabase/client';
import { fromPostgrestError } from '@/lib/errors';
import { AUDIT_COLUMNS, auditEventSchema } from '@/domain/audit';
import type { AuditService } from '../types';
import { parseResponse } from './validate';

const MAX_PAGE = 50;

export function createAuditService(client: TradePilotClient): AuditService {
  return {
    async listRecent(userId, { limit, before, eventPrefixes }) {
      const size = Math.min(Math.max(1, limit), MAX_PAGE);
      // Fetch one extra row to know whether another page exists.
      let query = client
        .from('audit_events')
        .select(AUDIT_COLUMNS)
        .eq('actor_user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(size + 1);
      if (eventPrefixes?.length) {
        query = query.or(eventPrefixes.map((p) => `event_type.like.${p.replace(/[^a-z_.]/g, '')}%`).join(','));
      }
      if (before) {
        // (created_at, id) < (cursor.createdAt, cursor.id), expressed for PostgREST.
        const ts = before.createdAt;
        query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${before.id})`);
      }
      const { data, error, status } = await query;
      if (error) throw fromPostgrestError(error, 'load your activity', status);
      const rows = parseResponse(z.array(auditEventSchema), data ?? [], 'your activity');
      return { events: rows.slice(0, size), hasMore: rows.length > size };
    },

    async listTimestampsSince(userId, sinceIso, cap = 2000) {
      const { data, error, status } = await client
        .from('audit_events')
        .select('created_at')
        .eq('actor_user_id', userId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(cap + 1);
      if (error) throw fromPostgrestError(error, 'load your activity history', status);
      const rows = parseResponse(z.array(z.object({ created_at: z.string() })), data ?? [], 'your activity history');
      return { timestamps: rows.slice(0, cap).map((r) => r.created_at), truncated: rows.length > cap };
    },
  };
}
