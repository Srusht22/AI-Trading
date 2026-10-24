import { z } from 'zod';
import type { Agent } from './tasks';
import { agentPresence } from './tasks';

/**
 * Read-only MetaTrader 5 data published by the Windows connector (Phase 4).
 * Every response is validated here; numbers arrive from PostgREST as JSON
 * numbers (numeric columns) and timestamps as ISO strings (UTC).
 */

const num = z.coerce.number().refine(Number.isFinite, 'not a finite number');
const numOrNull = num.nullable();

export const CONNECTION_STATUSES = ['awaiting_verification', 'verified', 'blocked', 'disconnected'] as const;
export const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const TIMEFRAME_MS: Record<Timeframe, number> = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000 };
export const MAX_MONITORED_SYMBOLS = 8;

export const mt5ConnectionSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  status: z.enum(CONNECTION_STATUSES),
  status_reason: z.string().nullable(),
  masked_account: z.string().nullable(),
  server: z.string().nullable(),
  company: z.string().nullable(),
  currency: z.string().nullable(),
  currency_digits: z.number().int().nullable(),
  leverage: z.number().int().nullable(),
  detected_trade_mode: z.enum(['demo', 'contest', 'real', 'unknown']).nullable(),
  terminal_build: z.number().int().nullable(),
  terminal_connected: z.boolean().nullable(),
  connector_version: z.string().nullable(),
  broker_utc_offset_minutes: z.number().int().nullable(),
  broker_offset_source: z.enum(['estimated', 'configured', 'unknown']).nullable(),
  quote_interval_ms: z.number().int(),
  account_interval_s: z.number().int(),
  snapshot_interval_s: z.number().int(),
  history_days: z.number().int(),
  first_verified_at: z.string().nullable(),
  verified_at: z.string().nullable(),
  last_report_at: z.string().nullable(),
  last_account_at: z.string().nullable(),
  last_quotes_at: z.string().nullable(),
  last_positions_at: z.string().nullable(),
  last_orders_at: z.string().nullable(),
  last_deals_at: z.string().nullable(),
  last_symbols_at: z.string().nullable(),
  disconnected_at: z.string().nullable(),
  created_at: z.string(),
});
export type Mt5Connection = z.infer<typeof mt5ConnectionSchema>;
export const MT5_CONNECTION_COLUMNS =
  'id, agent_id, status, status_reason, masked_account, server, company, currency, currency_digits, leverage, detected_trade_mode, terminal_build, terminal_connected, connector_version, broker_utc_offset_minutes, broker_offset_source, quote_interval_ms, account_interval_s, snapshot_interval_s, history_days, first_verified_at, verified_at, last_report_at, last_account_at, last_quotes_at, last_positions_at, last_orders_at, last_deals_at, last_symbols_at, disconnected_at, created_at';

export const accountStateSchema = z.object({
  connection_id: z.string().uuid(),
  balance: num,
  credit: num,
  equity: num,
  profit: num,
  margin: num,
  margin_free: num,
  margin_level: numOrNull,
  currency: z.string(),
  currency_digits: z.number().int(),
  leverage: z.number().int().nullable(),
  observed_at: z.string(),
  received_at: z.string(),
});
export type AccountState = z.infer<typeof accountStateSchema>;

export const accountSnapshotSchema = z.object({ observed_at: z.string(), balance: num, equity: num, profit: num, margin: num, margin_free: num });
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

export const symbolSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  path: z.string().nullable(),
  digits: z.number().int(),
  point: num,
  currency_base: z.string().nullable(),
  currency_profit: z.string().nullable(),
  visible: z.boolean(),
  monitored: z.boolean(),
  available: z.boolean(),
});
export type Mt5Symbol = z.infer<typeof symbolSchema>;

export const quoteSchema = z.object({
  symbol: z.string(),
  bid: num,
  ask: num,
  last: numOrNull,
  tick_time: z.string(),
  observed_at: z.string(),
  received_at: z.string(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const barSchema = z.object({
  open_time: z.string(),
  open: num,
  high: num,
  low: num,
  close: num,
  tick_volume: z.number().int().nullable(),
  received_at: z.string(),
});
export type Bar = z.infer<typeof barSchema>;

export const positionSchema = z.object({
  ticket: num,
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  volume: num,
  price_open: num,
  price_current: numOrNull,
  stop_loss: numOrNull,
  take_profit: numOrNull,
  profit: num,
  swap: num,
  opened_at: z.string(),
  observed_at: z.string(),
});
export type Position = z.infer<typeof positionSchema>;

export const orderSchema = z.object({
  ticket: num,
  symbol: z.string(),
  order_type: z.string(),
  volume_initial: num,
  volume_current: num,
  price_open: num,
  price_stoplimit: numOrNull,
  stop_loss: numOrNull,
  take_profit: numOrNull,
  placed_at: z.string(),
  observed_at: z.string(),
});
export type PendingOrder = z.infer<typeof orderSchema>;

export const dealSchema = z.object({
  ticket: num,
  symbol: z.string(),
  deal_type: z.string(),
  entry: z.string().nullable(),
  volume: num,
  price: num,
  profit: num,
  commission: num,
  swap: num,
  fee: num,
  executed_at: z.string(),
  observed_at: z.string(),
});
export type Deal = z.infer<typeof dealSchema>;

// ---------------------------------------------------------------------------
// Status: derived only from stored reports and timestamps
// ---------------------------------------------------------------------------

export type ConnectorState =
  | 'not_paired'
  | 'connector_unavailable'
  | 'connecting'
  | 'verification_required'
  | 'unsupported_terminal'
  | 'blocked_account_type'
  | 'account_changed'
  | 'auth_error'
  | 'disconnected'
  | 'stale'
  | 'connected';

/** No verification report for longer than this = the connector is not keeping the link alive. */
export const REPORT_STALE_MS = 90_000;

export interface ConnectorStatusInput {
  connection: Mt5Connection | null;
  /** The agent behind the connection, or (before the first report) the newest MT5-capable agent. */
  agent: Agent | null;
  now: Date;
}

export function connectorState({ connection, agent, now }: ConnectorStatusInput): ConnectorState {
  if (agent?.revoked_at || connection?.status_reason === 'agent_revoked') return 'auth_error';
  if (!connection) {
    if (!agent) return 'not_paired';
    return agentPresence(agent, now) === 'online' ? 'connecting' : 'connector_unavailable';
  }
  if (connection.status === 'disconnected') return 'disconnected';
  if (connection.status === 'blocked') return connection.status_reason === 'account_changed' ? 'account_changed' : 'blocked_account_type';
  const online = agent ? agentPresence(agent, now) === 'online' : false;
  if (!online) return 'connector_unavailable';
  if (connection.status === 'awaiting_verification') {
    return connection.status_reason === 'unsupported_terminal' ? 'unsupported_terminal' : 'verification_required';
  }
  const lastReport = connection.last_report_at ? Date.parse(connection.last_report_at) : 0;
  return now.getTime() - lastReport > REPORT_STALE_MS ? 'stale' : 'connected';
}

export const connectorStateText: Record<ConnectorState, { label: string; description: string }> = {
  not_paired: { label: 'Not paired', description: 'No connector has been paired with this workspace yet.' },
  connector_unavailable: {
    label: 'Connector unavailable',
    description: 'The connector on your Windows computer is not running or cannot reach TradePilot (no heartbeat for 45 seconds).',
  },
  connecting: { label: 'Connecting', description: 'The connector is online and about to report the terminal and account.' },
  verification_required: {
    label: 'Account verification required',
    description: 'The connector is running but has not verified a logged-in demo account yet.',
  },
  unsupported_terminal: { label: 'Unsupported terminal', description: 'MetaTrader 5 did not report a usable version. Update the terminal.' },
  blocked_account_type: {
    label: 'Blocked: not a demo account',
    description: 'MetaTrader 5 reports a real, contest or unknown account type. TradePilot only accepts demo accounts. No data from it is stored.',
  },
  account_changed: {
    label: 'Blocked: different account',
    description: 'The terminal switched to an account other than the one you approved. Publication stopped.',
  },
  auth_error: { label: 'Authentication error', description: 'This connector was revoked and can no longer send data. Pair a new connector.' },
  disconnected: { label: 'Disconnected', description: 'You disconnected the data feed. The connector may still be running on your computer.' },
  stale: { label: 'Stale data', description: 'The connector stopped reporting recently. Values below are the last ones received.' },
  connected: { label: 'Connected', description: 'Demo account verified; data is arriving from your terminal.' },
};

export const statusReasonText: Record<string, string> = {
  terminal_unavailable: 'MetaTrader 5 is not running on the connector’s computer, or the connector cannot attach to it.',
  not_logged_in: 'MetaTrader 5 is open but no account is logged in. Use File › Login to Trade Account in MT5.',
  account_unavailable: 'MetaTrader 5 did not return complete account information.',
  broker_disconnected: 'MetaTrader 5 is open but not connected to the broker server.',
  unsupported_terminal: 'MetaTrader 5 did not report its version.',
  unsupported_account_type: 'The logged-in account is not a demo account.',
  account_changed: 'The terminal is logged into a different account than the one you approved.',
  disconnected_by_owner: 'You disconnected the feed in TradePilot.',
  agent_revoked: 'The connector was revoked.',
};

// ---------------------------------------------------------------------------
// Freshness and formatting
// ---------------------------------------------------------------------------

/** Quotes count as live while new ticks keep arriving (market quiet or closed = stale, honestly). */
export const QUOTE_STALE_MS = 60_000;

/**
 * Staleness is judged by when the server stored the last *new* tick
 * (`received_at` only changes when the price or tick time changes). This
 * does not depend on the broker's clock, so a tick time that is still in
 * broker time (offset not yet determined) can never make a price look live.
 */
export function quoteFreshness(quote: Quote | null | undefined, connected: boolean, now: Date): 'live' | 'stale' | 'disconnected' | 'none' {
  if (!quote) return 'none';
  if (!connected) return 'disconnected';
  return now.getTime() - Date.parse(quote.received_at) <= QUOTE_STALE_MS ? 'live' : 'stale';
}

export function accountFreshness(state: AccountState | null | undefined, connection: Mt5Connection | null, connected: boolean, now: Date): 'live' | 'stale' | 'none' {
  if (!state) return 'none';
  const limit = Math.max(3 * (connection?.account_interval_s ?? 10) * 1000, 75_000);
  return connected && now.getTime() - Date.parse(state.observed_at) <= limit ? 'live' : 'stale';
}

/** Spread in points, derived from the stored quote and the symbol's point size. */
export function spreadPoints(quote: Pick<Quote, 'bid' | 'ask'>, point: number | null | undefined): number | null {
  if (!point || point <= 0) return null;
  return Math.round((quote.ask - quote.bid) / point);
}

export function formatPrice(value: number | null | undefined, digits: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(Math.min(Math.max(digits ?? 5, 0), 10));
}

/** Money in the account's own currency (never assumed to be USD). */
export function formatAccountMoney(value: number, currency: string, digits: number, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    // Not an ISO 4217 code (e.g. a broker's cent account "USC"): show the code as reported.
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${currency}`;
  }
}

export function displayMaskedAccount(masked: string | null | undefined): string {
  return masked ? `•••• ${masked.replace(/^\*+/, '')}` : '—';
}

export const orderTypeText: Record<string, string> = {
  buy_limit: 'Buy limit',
  sell_limit: 'Sell limit',
  buy_stop: 'Buy stop',
  sell_stop: 'Sell stop',
  buy_stop_limit: 'Buy stop limit',
  sell_stop_limit: 'Sell stop limit',
  other: 'Other',
};

export const dealTypeText: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  balance: 'Balance',
  credit: 'Credit',
  charge: 'Charge',
  correction: 'Correction',
  bonus: 'Bonus',
  commission: 'Commission',
  other: 'Other',
};

export const entryText: Record<string, string> = { in: 'Open', out: 'Close', inout: 'Reverse', out_by: 'Close by' };
