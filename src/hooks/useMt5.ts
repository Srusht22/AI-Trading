import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { useLiveStatus } from '@/lib/live';
import { connectorState, type Mt5Connection, type Timeframe } from '@/domain/mt5';
import type { ConnectionSettings } from '@/services/types';
import { queryKeys } from './queryKeys';
import { useAgents, useNow } from './useTasks';

/** Fallback refresh while Realtime is not confirmed live (shown as "Auto-refresh", never as "Live"). */
const FALLBACK_POLL_MS = 5_000;

export function useMt5Connections() {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  const live = useLiveStatus().mt5Connection;
  return useQuery({
    queryKey: queryKeys.mt5Connections(user.id),
    queryFn: () => mt5.listConnections(),
    refetchInterval: live === 'live' ? false : 15_000,
  });
}

/**
 * The workspace's MT5 connection and its truthful status. The status is
 * derived from stored reports and heartbeats, re-evaluated against the clock.
 */
export function useConnector() {
  const connections = useMt5Connections();
  const agents = useAgents();
  const now = useNow(5_000);
  return useMemo(() => {
    const allAgents = agents.data ?? [];
    const list = connections.data ?? [];
    const activeIds = new Set(allAgents.filter((a) => !a.revoked_at).map((a) => a.id));
    const connection: Mt5Connection | null = list.find((c) => activeIds.has(c.agent_id)) ?? list[0] ?? null;
    const mt5Agents = allAgents.filter((a) => a.allowed_capabilities.includes('mt5.read'));
    const agent = connection
      ? (allAgents.find((a) => a.id === connection.agent_id) ?? null)
      : (mt5Agents.filter((a) => !a.revoked_at).at(-1) ?? null);
    const state = connectorState({ connection, agent, now });
    return {
      loading: connections.isPending || agents.isPending,
      error: connections.error ?? agents.error,
      refetch: () => Promise.all([connections.refetch(), agents.refetch()]),
      connection,
      agent,
      state,
      verified: connection?.status === 'verified',
      connected: state === 'connected',
      now,
    };
  }, [connections, agents, now]);
}

export function useAccountState(connectionId: string | undefined) {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  const live = useLiveStatus().mt5Account;
  return useQuery({
    queryKey: [...queryKeys.mt5Account(user.id), connectionId],
    queryFn: () => mt5.getAccountState(connectionId!),
    enabled: !!connectionId,
    refetchInterval: live === 'live' ? false : FALLBACK_POLL_MS,
  });
}

export function useAccountSnapshots(connectionId: string | undefined, days: number) {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.mt5Snapshots(user.id, connectionId ?? 'none', days),
    queryFn: () => mt5.listSnapshots(connectionId!, new Date(Date.now() - days * 86_400_000).toISOString()),
    enabled: !!connectionId,
    refetchInterval: 60_000,
  });
}

export function useSymbols(connectionId: string | undefined) {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.mt5Symbols(user.id, connectionId ?? 'none'),
    queryFn: () => mt5.listSymbols(connectionId!),
    enabled: !!connectionId,
  });
}

export function useQuotes(connectionId: string | undefined) {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  const live = useLiveStatus().mt5Quotes;
  return useQuery({
    queryKey: [...queryKeys.mt5Quotes(user.id), connectionId],
    queryFn: () => mt5.listQuotes(connectionId!),
    enabled: !!connectionId,
    refetchInterval: live === 'live' ? false : FALLBACK_POLL_MS,
  });
}

export function useBars(connectionId: string | undefined, symbol: string | undefined, timeframe: Timeframe) {
  const { mt5 } = useServices();
  const user = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.mt5Bars(user.id, connectionId ?? 'none', symbol ?? 'none', timeframe),
    queryFn: () => mt5.listBars(connectionId!, symbol!, timeframe, 300),
    enabled: !!connectionId && !!symbol,
  });
}

function useTrades<T>(kind: 'positions' | 'orders' | 'deals', connectionId: string | undefined, load: (id: string) => Promise<T[]>) {
  const user = useCurrentUser();
  const live = useLiveStatus();
  const isLive = kind === 'positions' ? live.mt5Positions === 'live' : kind === 'orders' ? live.mt5Orders === 'live' : false;
  return useQuery({
    queryKey: [...queryKeys.mt5Trades(user.id), kind, connectionId],
    queryFn: () => load(connectionId!),
    enabled: !!connectionId,
    refetchInterval: isLive ? false : 15_000,
  });
}

export function usePositions(connectionId: string | undefined) {
  const { mt5 } = useServices();
  return useTrades('positions', connectionId, (id) => mt5.listPositions(id));
}
export function usePendingOrders(connectionId: string | undefined) {
  const { mt5 } = useServices();
  return useTrades('orders', connectionId, (id) => mt5.listOrders(id));
}
export function useDeals(connectionId: string | undefined) {
  const { mt5 } = useServices();
  return useTrades('deals', connectionId, (id) => mt5.listDeals(id));
}

function useInvalidateMt5() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.mt5(user.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.agents(user.id) });
  };
}

export function useCreatePairing() {
  const { mt5 } = useServices();
  return useMutation({ mutationFn: (name: string) => mt5.createPairing(name) });
}

export function useMt5Actions() {
  const { mt5 } = useServices();
  const invalidate = useInvalidateMt5();
  return {
    setSymbols: useMutation({
      mutationFn: ({ connectionId, symbols }: { connectionId: string; symbols: string[] }) => mt5.setMonitoredSymbols(connectionId, symbols),
      onSettled: invalidate,
    }),
    updateSettings: useMutation({
      mutationFn: ({ connectionId, settings }: { connectionId: string; settings: ConnectionSettings }) => mt5.updateSettings(connectionId, settings),
      onSettled: invalidate,
    }),
    disconnect: useMutation({ mutationFn: (connectionId: string) => mt5.disconnect(connectionId), onSettled: invalidate }),
    resume: useMutation({
      mutationFn: ({ connectionId, acceptNewAccount }: { connectionId: string; acceptNewAccount: boolean }) => mt5.resume(connectionId, acceptNewAccount),
      onSettled: invalidate,
    }),
    revoke: useMutation({ mutationFn: (agentId: string) => mt5.revokeAgent(agentId), onSettled: invalidate }),
  };
}
