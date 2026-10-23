import type { TradePilotClient } from '@/lib/supabase/client';
import type { RealtimeService } from '../types';

export function createRealtimeService(client: TradePilotClient): RealtimeService {
  return {
    watchRows({ channel, table, filter, onChange, onStatus }) {
      onStatus('connecting');
      const ch = client
        .channel(channel)
        .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange())
        // The socket subscription ("SUBSCRIBED") is confirmed before the
        // database-changes listener is. Only report "live" once Realtime says
        // the Postgres subscription is active, otherwise early changes are missed.
        .on('system', {}, (msg: { extension?: string; status?: string }) => {
          if (msg.extension === 'postgres_changes') onStatus(msg.status === 'ok' ? 'live' : 'unavailable');
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus('unavailable');
          else if (status === 'CLOSED') onStatus('closed');
        });
      return () => {
        void client.removeChannel(ch);
      };
    },
  };
}
