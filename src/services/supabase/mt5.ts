import { z } from 'zod';
import type { TradePilotClient } from '@/lib/supabase/client';
import { AppError, fromPostgrestError } from '@/lib/errors';
import {
  accountSnapshotSchema,
  accountStateSchema,
  barSchema,
  dealSchema,
  MT5_CONNECTION_COLUMNS,
  mt5ConnectionSchema,
  orderSchema,
  positionSchema,
  quoteSchema,
  symbolSchema,
} from '@/domain/mt5';
import type { Mt5Service } from '../types';
import { parseResponse } from './validate';

const SNAPSHOT_CAP = 5000;

interface PgError {
  code?: string;
  message?: string;
}

function fromMt5Error(error: PgError, action: string, status?: number): AppError {
  switch (error.code) {
    case 'TPV01':
      return new AppError('validation', `Unable to ${action}. ${error.message ? capitalise(error.message) + '.' : 'The request was not valid.'}`, {
        code: error.code,
        cause: error,
      });
    case 'TPR01':
      return new AppError('rate_limited', `Unable to ${action}: ${error.message ?? 'too many requests'}.`, { code: error.code, cause: error });
    case 'TPS01':
      return new AppError('conflict', `Unable to ${action}. ${capitalise(error.message ?? 'the connection is in the wrong state')}.`, {
        code: error.code,
        cause: error,
      });
    case 'P0002':
      return new AppError('not_found', `Unable to ${action}. It no longer exists.`, { code: error.code, cause: error });
  }
  return fromPostgrestError(error, action, status);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function createMt5Service(client: TradePilotClient): Mt5Service {
  return {
    async listConnections() {
      const { data, error, status } = await client.from('mt5_connections').select(MT5_CONNECTION_COLUMNS).order('created_at', { ascending: false });
      if (error) throw fromPostgrestError(error, 'load your MT5 connection', status);
      return parseResponse(z.array(mt5ConnectionSchema), data ?? [], 'the MT5 connection');
    },

    async getAccountState(connectionId) {
      const { data, error, status } = await client
        .from('mt5_account_state')
        .select('connection_id, balance, credit, equity, profit, margin, margin_free, margin_level, currency, currency_digits, leverage, observed_at, received_at')
        .eq('connection_id', connectionId)
        .maybeSingle();
      if (error) throw fromPostgrestError(error, 'load the account summary', status);
      return data ? parseResponse(accountStateSchema, data, 'the account summary') : null;
    },

    async listSnapshots(connectionId, sinceIso) {
      const { data, error, status } = await client
        .from('mt5_account_snapshots')
        .select('observed_at, balance, equity, profit, margin, margin_free')
        .eq('connection_id', connectionId)
        .gte('observed_at', sinceIso)
        .order('observed_at', { ascending: false })
        .limit(SNAPSHOT_CAP + 1);
      if (error) throw fromPostgrestError(error, 'load the equity history', status);
      const rows = parseResponse(z.array(accountSnapshotSchema), data ?? [], 'the equity history');
      return { snapshots: rows.slice(0, SNAPSHOT_CAP).reverse(), truncated: rows.length > SNAPSHOT_CAP };
    },

    async listSymbols(connectionId) {
      const { data, error, status } = await client
        .from('mt5_symbols')
        .select('name, description, path, digits, point, currency_base, currency_profit, visible, monitored, available')
        .eq('connection_id', connectionId)
        .order('name')
        .limit(5000);
      if (error) throw fromPostgrestError(error, 'load the symbol list', status);
      return parseResponse(z.array(symbolSchema), data ?? [], 'the symbol list');
    },

    async listQuotes(connectionId) {
      const { data, error, status } = await client
        .from('mt5_quotes')
        .select('symbol, bid, ask, last, tick_time, observed_at, received_at')
        .eq('connection_id', connectionId)
        .order('symbol');
      if (error) throw fromPostgrestError(error, 'load the latest prices', status);
      return parseResponse(z.array(quoteSchema), data ?? [], 'the latest prices');
    },

    async listBars(connectionId, symbol, timeframe, limit) {
      const { data, error, status } = await client
        .from('mt5_bars')
        .select('open_time, open, high, low, close, tick_volume, received_at')
        .eq('connection_id', connectionId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 1000));
      if (error) throw fromPostgrestError(error, 'load the price history', status);
      return parseResponse(z.array(barSchema), data ?? [], 'the price history').reverse();
    },

    async listPositions(connectionId) {
      const { data, error, status } = await client
        .from('mt5_positions')
        .select('ticket, symbol, side, volume, price_open, price_current, stop_loss, take_profit, profit, swap, opened_at, observed_at')
        .eq('connection_id', connectionId)
        .order('opened_at', { ascending: false });
      if (error) throw fromPostgrestError(error, 'load open positions', status);
      return parseResponse(z.array(positionSchema), data ?? [], 'open positions');
    },

    async listOrders(connectionId) {
      const { data, error, status } = await client
        .from('mt5_orders')
        .select('ticket, symbol, order_type, volume_initial, volume_current, price_open, price_stoplimit, stop_loss, take_profit, placed_at, observed_at')
        .eq('connection_id', connectionId)
        .order('placed_at', { ascending: false });
      if (error) throw fromPostgrestError(error, 'load pending orders', status);
      return parseResponse(z.array(orderSchema), data ?? [], 'pending orders');
    },

    async listDeals(connectionId) {
      const { data, error, status } = await client
        .from('mt5_deals')
        .select('ticket, symbol, deal_type, entry, volume, price, profit, commission, swap, fee, executed_at, observed_at')
        .eq('connection_id', connectionId)
        .order('executed_at', { ascending: false })
        .limit(500);
      if (error) throw fromPostgrestError(error, 'load the deal history', status);
      return parseResponse(z.array(dealSchema), data ?? [], 'the deal history');
    },

    async createPairing(displayName) {
      const { data, error, status } = await client.rpc('create_agent_pairing', { p_display_name: displayName });
      if (error) throw fromMt5Error(error, 'create a pairing code', status);
      const parsed = parseResponse(z.object({ code: z.string(), expires_at: z.string() }), data, 'the pairing code');
      return { code: parsed.code, expiresAt: parsed.expires_at };
    },

    async setMonitoredSymbols(connectionId, symbols) {
      const { error, status } = await client.rpc('set_mt5_monitored_symbols', { p_connection_id: connectionId, p_symbols: symbols });
      if (error) throw fromMt5Error(error, 'save the symbols', status);
    },

    async updateSettings(connectionId, s) {
      const { error, status } = await client.rpc('update_mt5_connection_settings', {
        p_connection_id: connectionId,
        p_quote_interval_ms: s.quoteIntervalMs,
        p_account_interval_s: s.accountIntervalS,
        p_snapshot_interval_s: s.snapshotIntervalS,
        p_history_days: s.historyDays,
      });
      if (error) throw fromMt5Error(error, 'save the update intervals', status);
    },

    async disconnect(connectionId) {
      const { error, status } = await client.rpc('disconnect_mt5_connection', { p_connection_id: connectionId });
      if (error) throw fromMt5Error(error, 'disconnect the data feed', status);
    },

    async resume(connectionId, acceptNewAccount) {
      const { error, status } = await client.rpc('resume_mt5_connection', { p_connection_id: connectionId, p_accept_new_account: acceptNewAccount });
      if (error) throw fromMt5Error(error, 'resume the connection', status);
    },

    async revokeAgent(agentId) {
      const { error, status } = await client.rpc('revoke_agent', { p_agent_id: agentId });
      if (error) throw fromMt5Error(error, 'revoke the connector', status);
    },
  };
}
