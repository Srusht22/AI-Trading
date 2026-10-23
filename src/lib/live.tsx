import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { queryKeys } from '@/hooks/queryKeys';
import type { LiveStatus } from '@/services/types';

interface LiveContextValue {
  settings: LiveStatus;
  activity: LiveStatus;
}

const LiveContext = createContext<LiveContextValue>({ settings: 'closed', activity: 'closed' });

/**
 * Subscribes once per signed-in session to the only two real-time sources
 * that exist in Phase 2: the user's own settings row and their audit events.
 * Changes invalidate the matching queries; channels close on unmount/sign-out.
 */
export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { realtime } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<LiveStatus>('connecting');
  const [activity, setActivity] = useState<LiveStatus>('connecting');

  useEffect(() => {
    const stopSettings = realtime.watchRows({
      channel: `settings:${user.id}`,
      table: 'user_settings',
      filter: `user_id=eq.${user.id}`,
      onChange: () => void qc.invalidateQueries({ queryKey: queryKeys.settings(user.id) }),
      onStatus: setSettings,
    });
    const stopActivity = realtime.watchRows({
      channel: `activity:${user.id}`,
      table: 'audit_events',
      filter: `actor_user_id=eq.${user.id}`,
      onChange: () => void qc.invalidateQueries({ queryKey: queryKeys.audit(user.id) }),
      onStatus: setActivity,
    });
    return () => {
      stopSettings();
      stopActivity();
    };
  }, [realtime, user.id, qc]);

  const value = useMemo(() => ({ settings, activity }), [settings, activity]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveStatus() {
  return useContext(LiveContext);
}
