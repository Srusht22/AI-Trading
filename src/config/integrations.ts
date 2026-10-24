import type { DataFreshness } from '@/domain/freshness';

/**
 * Status of external systems the website depends on.
 *
 * Only capabilities that do not exist yet are listed here, as 'unavailable'
 * (which is different from "configured but disconnected"). The MT5 connector
 * reports real status since Phase 4 and is not part of this static list.
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
  // MT5 terminal, Windows connector and demo account status are live data since Phase 4:
  // see useConnector() / connectorState() in src/domain/mt5.ts.
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
