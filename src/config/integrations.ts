import type { DataFreshness } from '@/domain/freshness';

/**
 * Status of external systems the website depends on.
 *
 * Phase 2 has no MT5 connector, broker link or AI provider, so every entry is
 * 'unavailable' — the capability does not exist yet, which is different from
 * "configured but disconnected". Later phases replace this module with status
 * reported by the backend/connector; the UI already renders every state.
 */
export type ConnectionState =
  | 'unavailable' // capability not implemented in this version
  | 'not_configured'
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'error';

export interface IntegrationStatus {
  id: 'mt5' | 'connector' | 'demo-account' | 'ai';
  label: string;
  state: ConnectionState;
  detail: string;
  /** Last heartbeat / sync actually received, or null if there has never been one. */
  lastSyncAt: string | null;
  freshness: DataFreshness;
}

const notYet = (reason: string): DataFreshness => ({ state: 'unavailable', reason });

export const integrationStatus: IntegrationStatus[] = [
  {
    id: 'mt5',
    label: 'MT5 terminal',
    state: 'unavailable',
    detail: 'MetaTrader 5 integration arrives with the Windows connector in a later phase.',
    lastSyncAt: null,
    freshness: notYet('No MT5 connector exists yet.'),
  },
  {
    id: 'connector',
    label: 'Windows connector',
    state: 'unavailable',
    detail: 'The connector program has not been built yet, so nothing can be installed.',
    lastSyncAt: null,
    freshness: notYet('No connector exists yet.'),
  },
  {
    id: 'demo-account',
    label: 'Demo account',
    state: 'unavailable',
    detail: 'Demo account data will come from MT5 through the connector.',
    lastSyncAt: null,
    freshness: notYet('No account data source exists yet.'),
  },
  {
    id: 'ai',
    label: 'AI service',
    state: 'unavailable',
    detail: 'No AI provider is integrated yet. The AI Analyst is a design preview.',
    lastSyncAt: null,
    freshness: notYet('No AI provider is integrated yet.'),
  },
];

export const connectionStateLabel: Record<ConnectionState, string> = {
  unavailable: 'Not available yet',
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  degraded: 'Unstable',
  error: 'Error',
};
