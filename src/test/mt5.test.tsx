import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  connectorState,
  formatAccountMoney,
  quoteFreshness,
  spreadPoints,
  type AccountState,
  type Mt5Connection,
  type Quote,
} from '@/domain/mt5';
import type { Agent } from '@/domain/tasks';
import { chartPoints } from '@/components/mt5/PriceChart';
import { createFakeBackend } from './fakeServices';
import { renderWorkspace } from './renderApp';

// ---- Test data (unit tests only; never shown as a real connection) ------------------

const NOW = new Date();
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const CONN_ID = '33333333-3333-4333-8333-333333333333';

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    display_name: 'Test PC',
    allowed_capabilities: ['mt5.read'],
    reported_capabilities: ['mt5.read'],
    agent_version: '1.0.0',
    platform: 'Windows/AMD64',
    last_heartbeat_at: iso(3_000),
    created_at: iso(3_600_000),
    revoked_at: null,
    ...over,
  };
}

function connection(over: Partial<Mt5Connection> = {}): Mt5Connection {
  return {
    id: CONN_ID,
    agent_id: AGENT_ID,
    status: 'verified',
    status_reason: null,
    masked_account: '****821',
    server: 'TEST-FIXTURE-Demo',
    company: 'Test Fixture Ltd',
    currency: 'EUR',
    currency_digits: 2,
    leverage: 100,
    detected_trade_mode: 'demo',
    terminal_build: 5200,
    terminal_connected: true,
    connector_version: '1.0.0',
    broker_utc_offset_minutes: 120,
    broker_offset_source: 'estimated',
    quote_interval_ms: 2000,
    account_interval_s: 10,
    snapshot_interval_s: 60,
    history_days: 7,
    first_verified_at: iso(600_000),
    verified_at: iso(10_000),
    last_report_at: iso(10_000),
    last_account_at: iso(5_000),
    last_quotes_at: iso(2_000),
    last_positions_at: iso(5_000),
    last_orders_at: iso(5_000),
    last_deals_at: null,
    last_symbols_at: iso(500_000),
    disconnected_at: null,
    created_at: iso(3_600_000),
    ...over,
  };
}

const account: AccountState = {
  connection_id: CONN_ID,
  balance: 10000,
  credit: 0,
  equity: 10012.34,
  profit: 12.34,
  margin: 120.5,
  margin_free: 9891.84,
  margin_level: 8309.0,
  currency: 'EUR',
  currency_digits: 2,
  leverage: 100,
  observed_at: iso(4_000),
  received_at: iso(3_900),
};

const quote = (msAgo = 1_500): Quote => ({ symbol: 'EURUSD.r', bid: 1.08412, ask: 1.08419, last: null, tick_time: iso(msAgo), observed_at: iso(msAgo - 400), received_at: iso(msAgo - 500) });

const symbols = [
  { name: 'EURUSD.r', description: 'Euro vs US Dollar', path: 'Forex', digits: 5, point: 0.00001, currency_base: 'EUR', currency_profit: 'USD', visible: true, monitored: true, available: true },
  { name: 'XAUUSD', description: 'Gold', path: 'Metals', digits: 2, point: 0.01, currency_base: 'XAU', currency_profit: 'USD', visible: false, monitored: false, available: true },
];

const bars = Array.from({ length: 12 }, (_, i) => ({
  open_time: new Date(Math.floor((NOW.getTime() - (12 - i) * 300_000) / 300_000) * 300_000).toISOString(),
  open: 1.084 + i * 0.00001,
  high: 1.0842 + i * 0.00001,
  low: 1.0838 + i * 0.00001,
  close: 1.0841 + i * 0.00001,
  tick_volume: 100,
  received_at: iso(1_000),
}));

// ---- Domain rules ---------------------------------------------------------------------

describe('connector status is derived from reports, never assumed', () => {
  it.each([
    [null, null, 'not_paired'],
    [null, agent(), 'connecting'],
    [null, agent({ last_heartbeat_at: iso(120_000) }), 'connector_unavailable'],
    [connection({ status: 'awaiting_verification', status_reason: 'not_logged_in' }), agent(), 'verification_required'],
    [connection({ status: 'blocked', status_reason: 'unsupported_account_type' }), agent(), 'blocked_account_type'],
    [connection({ status: 'blocked', status_reason: 'account_changed' }), agent(), 'account_changed'],
    [connection({ status: 'disconnected', status_reason: 'disconnected_by_owner', disconnected_at: iso(1) }), agent(), 'disconnected'],
    [connection({ last_report_at: iso(200_000) }), agent(), 'stale'],
    [connection(), agent({ last_heartbeat_at: iso(120_000) }), 'connector_unavailable'],
    [connection(), agent({ revoked_at: iso(1) }), 'auth_error'],
    [connection(), agent(), 'connected'],
  ] as const)('%#', (conn, ag, expected) => {
    expect(connectorState({ connection: conn, agent: ag, now: NOW })).toBe(expected);
  });

  it('marks quotes stale when no new tick arrived, and disconnected when the feed is down', () => {
    expect(quoteFreshness(quote(1_000), true, NOW)).toBe('live');
    expect(quoteFreshness(quote(5 * 60_000), true, NOW)).toBe('stale');
    expect(quoteFreshness(quote(1_000), false, NOW)).toBe('disconnected');
    expect(quoteFreshness(undefined, true, NOW)).toBe('none');
    // A tick time still in broker time (hours "in the future") cannot make an old price look live.
    expect(quoteFreshness({ ...quote(), tick_time: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), received_at: iso(10 * 60_000) }, true, NOW)).toBe('stale');
  });

  it('derives the spread from the quote and the symbol point size', () => {
    expect(spreadPoints({ bid: 1.08412, ask: 1.08419 }, 0.00001)).toBe(7);
    expect(spreadPoints({ bid: 1, ask: 2 }, null)).toBeNull();
  });

  it('formats money in the account currency, never assuming USD', () => {
    expect(formatAccountMoney(10012.34, 'EUR', 2)).toBe('€10,012.34');
    expect(formatAccountMoney(1234, 'JPY', 0)).toBe('¥1,234');
    expect(formatAccountMoney(5, 'USC', 2)).toMatch(/USC\s?5\.00|5\.00 USC/);
  });

  it('adds the latest real tick to the chart only when it is newer than the last bar', () => {
    const points = chartPoints(bars, quote(1_000));
    expect(points).toHaveLength(13);
    expect(points.at(-1)).toMatchObject({ close: 1.08412, live: true });
    expect(chartPoints(bars, { ...quote(), tick_time: bars[0].open_time })).toHaveLength(12);
    expect(chartPoints([], null)).toEqual([]);
  });
});

// ---- Rendered pages ----------------------------------------------------------------------

describe('Connections page', () => {
  it('starts unpaired and creates a one-time pairing code with the exact command', async () => {
    const { user } = await renderWorkspace('/connections');
    expect((await screen.findAllByText('Not paired')).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole('button', { name: 'Create pairing code' }));
    expect(await screen.findByLabelText('Pairing code')).toHaveTextContent('TEST-0000-0000-0000-0001');
    expect(screen.getByText(/tradepilot-connector\.cmd pair --api-url http:\/\/localhost(:\d+)? --code TEST-0000-0000-0000-0001/)).toBeInTheDocument();
    expect(screen.queryByText(/Demo verified/)).not.toBeInTheDocument();
  });

  it('shows "Demo verified" only for a verified connection, with a masked account', async () => {
    await renderWorkspace('/connections', { agents: [agent()], mt5: { connections: [connection()], symbols } });
    expect((await screen.findAllByText(/Demo verified/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/•••• 821/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/51234821/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
  });

  it('shows a blocked real account clearly and never as verified', async () => {
    await renderWorkspace('/connections', {
      agents: [agent()],
      mt5: { connections: [connection({ status: 'blocked', status_reason: 'unsupported_account_type', detected_trade_mode: 'real', masked_account: null, server: null })] },
    });
    expect((await screen.findAllByText('Blocked: not a demo account')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Demo verified/)).not.toBeInTheDocument();
    expect(screen.getByText('The logged-in account is not a demo account.')).toBeInTheDocument();
  });

  it('lets the owner choose broker symbols by their real names', async () => {
    const backend = createFakeBackend({ agents: [agent()], mt5: { connections: [connection()], symbols } });
    const { user } = await renderWorkspace('/connections', { backend });
    await user.click(await screen.findByRole('button', { name: /^Step 5: Choose market symbols/ }));
    const list = await screen.findByRole('list', { name: 'Broker symbols' });
    await user.type(screen.getByLabelText('Search symbols'), 'gold');
    await user.click(within(list).getByRole('checkbox', { name: /XAUUSD/ }));
    await user.click(screen.getByRole('button', { name: 'Save 2 symbols' }));
    await waitFor(() => expect(backend.mt5.symbols.filter((s) => s.monitored).map((s) => s.name)).toEqual(['EURUSD.r', 'XAUUSD']));
  });

  it('explains that disconnecting does not stop the local program', async () => {
    const backend = createFakeBackend({ agents: [agent()], mt5: { connections: [connection()], symbols } });
    const { user } = await renderWorkspace('/connections', { backend });
    await user.click(await screen.findByRole('button', { name: /^Step 7: Disconnect/ }));
    expect(screen.getByText(/It cannot stop the program on your computer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect data feed' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(backend.mt5.connections[0].status).toBe('disconnected'));
  });
});

describe('connector preferences', () => {
  it('saves update intervals only within the allowed ranges', async () => {
    const backend = createFakeBackend({ agents: [agent()], mt5: { connections: [connection()], symbols } });
    const calls: unknown[] = [];
    backend.services.mt5.updateSettings = async (_id, settings) => {
      calls.push(settings);
    };
    const { user } = await renderWorkspace('/connections', { backend });
    const quoteField = await screen.findByLabelText('Price checks (seconds)');
    await user.clear(quoteField);
    await user.type(quoteField, '0.5');
    expect(screen.getByRole('button', { name: 'Save intervals' })).toBeDisabled();
    await user.clear(quoteField);
    await user.type(quoteField, '5');
    await user.click(screen.getByRole('button', { name: 'Save intervals' }));
    await waitFor(() => expect(calls).toEqual([{ quoteIntervalMs: 5000, accountIntervalS: 10, snapshotIntervalS: 60, historyDays: 7 }]));
  });
});

describe('Dashboard with real MT5 data', () => {
  it('shows the reported account values in the account currency and the latest quote', async () => {
    await renderWorkspace('/', { agents: [agent()], mt5: { connections: [connection()], account, symbols, quotes: [quote()], bars } });
    const section = await screen.findByRole('region', { name: /Demo account & market/ });
    expect(await within(section).findByText('€10,012.34')).toBeInTheDocument();
    expect(within(section).getByText('+€12.34')).toBeInTheDocument();
    expect(within(section).getByText('1.08412')).toBeInTheDocument();
    expect(within(section).getByText('7 pts')).toBeInTheDocument();
    expect(within(section).getAllByText('Live').length).toBeGreaterThan(0);
  });

  it('marks old values as not current instead of presenting them as live', async () => {
    await renderWorkspace('/', {
      agents: [agent({ last_heartbeat_at: iso(10 * 60_000) })],
      mt5: { connections: [connection({ last_report_at: iso(10 * 60_000) })], account: { ...account, observed_at: iso(10 * 60_000) }, symbols, quotes: [quote(10 * 60_000)], bars },
    });
    const section = await screen.findByRole('region', { name: /Demo account & market/ });
    expect(await within(section).findByText('Not current')).toBeInTheDocument();
    expect(within(section).queryByText('Live')).not.toBeInTheDocument();
  });

  it('invites the user to connect instead of showing numbers when nothing is connected', async () => {
    await renderWorkspace('/');
    const section = await screen.findByRole('region', { name: /Demo account & market/ });
    expect(within(section).getByText('MetaTrader 5 is not connected')).toBeInTheDocument();
    expect(within(section).queryByText(/€|\$\d/)).not.toBeInTheDocument();
  });
});

describe('Demo Trading page (read-only)', () => {
  it('lists real positions read from MT5 and keeps every trading control disabled', async () => {
    await renderWorkspace('/demo-trading', {
      agents: [agent()],
      mt5: {
        connections: [connection()],
        account,
        positions: [{ ticket: 5001, symbol: 'EURUSD.r', side: 'buy', volume: 0.1, price_open: 1.0801, price_current: 1.0841, stop_loss: null, take_profit: null, profit: 40, swap: -0.3, opened_at: iso(86_400_000), observed_at: iso(5_000) }],
      },
    });
    const table = await screen.findByRole('table', { name: /Open positions/ });
    expect(within(table).getByText('#5001')).toBeInTheDocument();
    expect(within(table).getByText('€40.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emergency disable all' })).toBeDisabled();
    expect(screen.getByText(/connection is/)).toHaveTextContent(/read-only/);
  });

  it('shows a genuine empty state when MT5 reports no positions', async () => {
    await renderWorkspace('/demo-trading', { agents: [agent()], mt5: { connections: [connection()], account, positions: [] } });
    expect(await screen.findByText('MT5 reported no open positions in this account.')).toBeInTheDocument();
    expect(screen.getByText('No open positions')).toBeInTheDocument();
  });
});
