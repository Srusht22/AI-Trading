/**
 * Honest status model for external systems.
 *
 * In Phase 1 nothing is connected, so every status below is static and
 * states that plainly. Later phases will replace these constants with data
 * reported by the backend and the Windows connector — the UI components
 * already accept every state in `ConnectionState`.
 */
export type ConnectionState = 'not_configured' | 'not_connected' | 'connecting' | 'connected' | 'degraded' | 'error';

export interface IntegrationStatus {
  id: 'mt5' | 'connector' | 'demo-account' | 'ai';
  label: string;
  state: ConnectionState;
  detail: string;
  /** ISO timestamp of the last successful sync, or null if there has never been one. */
  lastSync: string | null;
}

export const integrationStatus: IntegrationStatus[] = [
  {
    id: 'mt5',
    label: 'MT5 terminal',
    state: 'not_connected',
    detail: 'No MetaTrader 5 terminal has been linked yet.',
    lastSync: null,
  },
  {
    id: 'connector',
    label: 'Windows connector',
    state: 'not_configured',
    detail: 'The connector program is not installed on a computer or VPS yet.',
    lastSync: null,
  },
  {
    id: 'demo-account',
    label: 'Demo account',
    state: 'not_connected',
    detail: 'A demo broker account becomes available once MT5 is connected.',
    lastSync: null,
  },
  {
    id: 'ai',
    label: 'AI service',
    state: 'not_configured',
    detail: 'No AI provider is configured. The AI Analyst is a design preview.',
    lastSync: null,
  },
];

export const connectionStateLabel: Record<ConnectionState, string> = {
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  degraded: 'Unstable',
  error: 'Error',
};

/** Phase boundary marker used in preview messages. */
export const PHASE = 1;
