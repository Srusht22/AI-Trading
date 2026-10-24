import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { queryKeys } from '@/hooks/queryKeys';
import type { LiveStatus, RealtimeService } from '@/services/types';

interface LiveContextValue {
  settings: LiveStatus;
  activity: LiveStatus;
  tasks: LiveStatus;
  agents: LiveStatus;
  mt5Connection: LiveStatus;
  mt5Account: LiveStatus;
  mt5Quotes: LiveStatus;
  mt5Positions: LiveStatus;
  mt5Orders: LiveStatus;
}

const closed: LiveContextValue = {
  settings: 'closed', activity: 'closed', tasks: 'closed', agents: 'closed',
  mt5Connection: 'closed', mt5Account: 'closed', mt5Quotes: 'closed', mt5Positions: 'closed', mt5Orders: 'closed',
};
const LiveContext = createContext<LiveContextValue>(closed);

type Source = { key: keyof LiveContextValue; table: Parameters<RealtimeService['watchRows']>[0]['table']; filter?: string; invalidate: QueryKey };

/**
 * Subscribes once per signed-in owner session to the real-time sources that
 * exist: the user's settings row, their audit events, their tasks and the
 * registered agents. Changes invalidate the matching queries.
 *
 * Every time a subscription (re)becomes live — including after a dropped
 * connection — the matching queries are refetched, because changes made
 * while disconnected are not replayed by Realtime.
 */
export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { realtime } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveContextValue>(
    () => Object.fromEntries(Object.keys(closed).map((k) => [k, 'connecting'])) as unknown as LiveContextValue,
  );

  useEffect(() => {
    const sources: Source[] = [
      { key: 'settings', table: 'user_settings', filter: `user_id=eq.${user.id}`, invalidate: queryKeys.settings(user.id) },
      { key: 'activity', table: 'audit_events', filter: `actor_user_id=eq.${user.id}`, invalidate: queryKeys.audit(user.id) },
      { key: 'tasks', table: 'tasks', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.tasks(user.id) },
      // Agents are not per-user; RLS limits delivery to the owner.
      { key: 'agents', table: 'agents', invalidate: queryKeys.agents(user.id) },
      // Phase 4: read-only MT5 data published by the connector (owner's rows only, RLS applies).
      { key: 'mt5Connection', table: 'mt5_connections', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.mt5Connections(user.id) },
      { key: 'mt5Account', table: 'mt5_account_state', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.mt5Account(user.id) },
      { key: 'mt5Quotes', table: 'mt5_quotes', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.mt5Quotes(user.id) },
      { key: 'mt5Positions', table: 'mt5_positions', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.mt5Trades(user.id) },
      { key: 'mt5Orders', table: 'mt5_orders', filter: `owner_user_id=eq.${user.id}`, invalidate: queryKeys.mt5Trades(user.id) },
    ];
    const stops = sources.map((s) => {
      let last: LiveStatus = 'connecting';
      return realtime.watchRows({
        channel: `${s.key}:${user.id}`,
        table: s.table,
        filter: s.filter,
        onChange: () => void qc.invalidateQueries({ queryKey: s.invalidate }),
        onStatus: (next) => {
          // Becoming live (first time or after a reconnect): catch up on anything missed.
          if (next === 'live' && last !== 'live') void qc.invalidateQueries({ queryKey: s.invalidate });
          last = next;
          setStatus((prev) => (prev[s.key] === next ? prev : { ...prev, [s.key]: next }));
        },
      });
    });
    return () => stops.forEach((stop) => stop());
  }, [realtime, user.id, qc]);

  const value = useMemo(() => status, [status]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveStatus() {
  return useContext(LiveContext);
}
