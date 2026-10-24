import { z } from 'zod';
import type { DataFreshness } from './freshness';

/**
 * Chart contracts for backtest and equity series (backtests arrive in a later
 * phase). Live MT5 account and market data (Phase 4) is modelled in mt5.ts.
 *
 * Time basis matters for MT5: terminal bar times are broker-server time,
 * while TradePilot stores and transmits UTC. Every series says which it uses.
 */
export const timeBasisSchema = z.enum(['utc', 'broker_server']);
export type TimeBasis = z.infer<typeof timeBasisSchema>;

export const equityPointSchema = z.object({
  /** Epoch milliseconds, UTC. */
  t: z.number().int().nonnegative(),
  equity: z.number().finite(),
  balance: z.number().finite(),
});
export type EquityPoint = z.infer<typeof equityPointSchema>;

export const priceBarSchema = z
  .object({
    t: z.number().int().nonnegative(),
    symbol: z.string().regex(/^[A-Z0-9._-]{3,20}$/),
    timeframe: z.enum(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']),
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    /** Number of ticks in the bar, when MT5 reports it. */
    tickVolume: z.number().int().nonnegative().optional(),
    /** Exchange volume; most Forex brokers do not provide it. */
    realVolume: z.number().nonnegative().optional(),
  })
  .refine((b) => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close), 'Inconsistent OHLC values');
export type PriceBar = z.infer<typeof priceBarSchema>;

/** Where a series came from, so every chart can show its provenance. */
export type DataSource =
  | { kind: 'backtest'; backtestId: string }
  | { kind: 'demo_account'; accountId: string }
  | { kind: 'sample' }
  | { kind: 'none' };

export interface EquitySeries {
  source: DataSource;
  /** ISO 4217 code of the account the values are denominated in. */
  currency: string;
  timeBasis: TimeBasis;
  points: EquityPoint[];
  freshness: DataFreshness;
}

/** Validate untrusted points (e.g. from the network); drop nothing silently. */
export function parseEquityPoints(input: unknown): EquityPoint[] {
  return z.array(equityPointSchema).parse(input);
}
