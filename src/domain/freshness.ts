/**
 * How current a piece of displayed data is. A "connected" status alone does
 * not prove data is current, so every live-capable view carries one of these.
 */
export type DataFreshness =
  | { state: 'live'; lastUpdateAt: string }
  | { state: 'stale'; lastUpdateAt: string | null }
  | { state: 'disconnected'; lastUpdateAt: string | null }
  | { state: 'loading_history' }
  | { state: 'historical'; asOf: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'sample' };

export type FreshnessState = DataFreshness['state'];

export interface FreshnessInput {
  /** Whether the upstream source (e.g. the MT5 connector) reports a live link. */
  connected: boolean;
  /** ISO timestamp of the newest data actually received, if any. */
  lastUpdateAt: string | null;
  /** Data older than this is considered stale even while connected. */
  staleAfterMs: number;
  now: Date;
}

/** Classify freshness from facts, never from assumptions. */
export function deriveFreshness({ connected, lastUpdateAt, staleAfterMs, now }: FreshnessInput): DataFreshness {
  if (!connected) return { state: 'disconnected', lastUpdateAt };
  // Connected but nothing received yet: not live, and we do not pretend otherwise.
  if (!lastUpdateAt) return { state: 'stale', lastUpdateAt: null };
  const age = now.getTime() - new Date(lastUpdateAt).getTime();
  return age <= staleAfterMs ? { state: 'live', lastUpdateAt } : { state: 'stale', lastUpdateAt };
}

export const freshnessLabel: Record<FreshnessState, string> = {
  live: 'Live',
  stale: 'No recent data',
  disconnected: 'Disconnected',
  loading_history: 'Loading history',
  historical: 'Historical data only',
  unavailable: 'Data unavailable',
  sample: 'Sample data',
};
