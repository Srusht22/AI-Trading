/**
 * ─────────────────────────────────────────────────────────────────────────
 *  SAMPLE DATA — FOR UI PREVIEW ONLY
 *  Everything in this file is invented to show what finished screens will
 *  look like. None of it comes from a broker, MT5, a backtest or an AI
 *  service, and it must always be rendered with a visible sample label.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { EquityPoint } from '@/domain/marketData';
import type {
  ClosedTrade,
  LogLine,
  PendingOrder,
  Position,
  Robot,
  StrategyMetrics,
  StrategyVersion,
} from './types';

/** Small deterministic PRNG so sample charts look identical on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
/** Fixed end date keeps sample data stable and obviously not "live". */
export const SAMPLE_END = Date.UTC(2026, 8, 30);

export function sampleEquitySeries(seed: number, days = 365, drift = 0.0006, vol = 0.006, start = 10_000): EquityPoint[] {
  const rnd = mulberry32(seed);
  const points: EquityPoint[] = [];
  let balance = start;
  let floating = 0;
  for (let i = days - 1; i >= 0; i--) {
    const shock = (rnd() + rnd() + rnd() - 1.5) * 2 * vol;
    const regime = Math.sin((days - i) / 47) * vol * 0.35;
    balance *= 1 + drift + shock + regime;
    floating = (rnd() - 0.5) * balance * vol * 1.2;
    points.push({ t: SAMPLE_END - i * DAY, balance: round2(balance), equity: round2(balance + floating) });
  }
  return points;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Rescale a series so it starts and ends at chosen values (keeps sample figures consistent). */
export function anchor(points: EquityPoint[], from: number, to: number): EquityPoint[] {
  const n = points.length - 1;
  const first = points[0].equity;
  const last = points[n].equity * (from / first);
  return points.map((p, i) => {
    const f = (from / first) * Math.pow(to / last, i / n);
    return { ...p, equity: round2(p.equity * f), balance: round2(p.balance * f) };
  });
}

/** Ends at the sample demo-account equity shown on the dashboard. */
export const sampleEquity = anchor(sampleEquitySeries(7, 365, 0.0002, 0.005), 10_000, 10_825.65);

export const sampleRobots: Robot[] = [
  {
    id: 'ma-trend',
    name: 'MA Crossover Trend',
    version: '1.2',
    origin: 'custom',
    style: 'Trend following',
    summary:
      'Buys when the fast moving average crosses above the slow one and sells on the opposite cross. Every trade uses a fixed stop-loss.',
    symbols: ['EURUSD'],
    timeframe: 'H1',
    risk: 'medium',
    compatibility: 'compatible',
    lastBacktest: { date: '2026-09-28', netProfitPct: 14.2, maxDrawdownPct: 9.8, profitFactor: 1.38, trades: 212 },
    demoStatus: 'running',
    traits: ['Fixed stop-loss', '1% risk per trade', 'One trade at a time'],
  },
  {
    id: 'london-breakout',
    name: 'London Session Breakout',
    version: '2.0',
    origin: 'existing',
    style: 'Breakout',
    summary:
      'Marks the high and low of the quiet Asian session, then trades in the direction price breaks out once London opens.',
    symbols: ['GBPUSD', 'EURUSD'],
    timeframe: 'M15',
    risk: 'medium',
    compatibility: 'needs_review',
    lastBacktest: { date: '2026-09-21', netProfitPct: 6.1, maxDrawdownPct: 12.4, profitFactor: 1.17, trades: 148 },
    demoStatus: 'stopped',
    traits: ['Trades once per day', 'Closes before New York', 'Time-based filter'],
  },
  {
    id: 'rsi-reversion',
    name: 'RSI Mean Reversion',
    version: '0.4',
    origin: 'custom',
    style: 'Mean reversion',
    summary:
      'Looks for moments when price has moved unusually far in one direction and bets on a partial return toward the average.',
    symbols: ['EURCHF'],
    timeframe: 'H4',
    risk: 'low',
    compatibility: 'not_checked',
    lastBacktest: null,
    demoStatus: 'not_deployed',
    traits: ['Draft strategy', 'Not yet tested'],
  },
  {
    id: 'grid-recovery',
    name: 'Grid Recovery',
    version: '3.1',
    origin: 'existing',
    style: 'Grid / averaging',
    summary:
      'Opens additional trades at fixed distances when price moves against it, hoping to exit everything at a small overall profit.',
    symbols: ['AUDCAD'],
    timeframe: 'M30',
    risk: 'high',
    compatibility: 'incompatible',
    lastBacktest: { date: '2026-08-30', netProfitPct: 22.7, maxDrawdownPct: 41.5, profitFactor: 1.09, trades: 1260 },
    demoStatus: 'not_deployed',
    traits: ['No fixed stop-loss', 'Adds to losing trades', 'High drawdown risk'],
  },
];

export const sampleDashboard = {
  robots: { configured: 4, runningInDemo: 1, needsAttention: 2 },
  backtests: { total: 18, completed: 15, failed: 3 },
  // Equity = balance + open profit/loss of the sample positions (−16.50).
  account: { balance: 10_842.15, equity: 10_825.65, currency: 'USD' },
  research: { candidates: 3, experiments: 11, currentTask: 'Comparing stop-loss distances for MA Crossover Trend' },
};

export const samplePositions: Position[] = [
  { id: 'p1', symbol: 'EURUSD', side: 'buy', lots: 0.1, openPrice: 1.0842, currentPrice: 1.0819, profit: -23.0, robot: 'MA Crossover Trend', openedAt: '2026-09-30T07:00:00Z' },
  { id: 'p2', symbol: 'EURUSD', side: 'buy', lots: 0.05, openPrice: 1.0806, currentPrice: 1.0819, profit: 6.5, robot: 'MA Crossover Trend', openedAt: '2026-09-29T14:00:00Z' },
];

export const samplePendingOrders: PendingOrder[] = [
  { id: 'o1', symbol: 'GBPUSD', type: 'Buy stop', lots: 0.08, price: 1.2715, robot: 'London Session Breakout' },
];

export const sampleTradeHistory: ClosedTrade[] = [
  { id: 't1', symbol: 'EURUSD', side: 'sell', lots: 0.1, profit: 41.2, closedAt: '2026-09-29T10:00:00Z', robot: 'MA Crossover Trend' },
  { id: 't2', symbol: 'EURUSD', side: 'buy', lots: 0.1, profit: -18.6, closedAt: '2026-09-27T15:00:00Z', robot: 'MA Crossover Trend' },
  { id: 't3', symbol: 'GBPUSD', side: 'buy', lots: 0.08, profit: 27.9, closedAt: '2026-09-26T09:45:00Z', robot: 'London Session Breakout' },
  { id: 't4', symbol: 'EURUSD', side: 'sell', lots: 0.1, profit: -20.1, closedAt: '2026-09-24T12:00:00Z', robot: 'MA Crossover Trend' },
];

export const sampleTerminalLog: LogLine[] = [
  { at: '2026-09-30T07:00:02Z', level: 'info', source: 'MA Crossover Trend', message: 'Fast MA crossed above slow MA — buy signal on EURUSD H1.' },
  { at: '2026-09-30T07:00:03Z', level: 'info', source: 'MA Crossover Trend', message: 'Order filled: buy 0.10 EURUSD at 1.0842, stop-loss 1.0802.' },
  { at: '2026-09-30T06:15:40Z', level: 'warn', source: 'Connector', message: 'Spread widened to 2.4 pips; entry delayed by one bar.' },
  { at: '2026-09-29T23:59:00Z', level: 'info', source: 'Connector', message: 'Daily summary sent: 2 trades, net +$22.60.' },
];

export const sampleBacktestLog: LogLine[] = [
  { at: '2026-09-28T16:31:10Z', level: 'info', source: 'Tester', message: 'Loading EURUSD H1 history: 2025.10.01 – 2026.09.30.' },
  { at: '2026-09-28T16:31:12Z', level: 'info', source: 'Tester', message: 'Model: every tick based on real ticks. Initial deposit 10,000 USD.' },
  { at: '2026-09-28T16:38:55Z', level: 'warn', source: 'Tester', message: '14 bars with missing ticks were reconstructed.' },
  { at: '2026-09-28T16:40:01Z', level: 'info', source: 'Tester', message: 'Test finished: 212 trades, net profit 1,420.00 USD.' },
];

export const sampleComparison: StrategyMetrics[] = [
  {
    id: 'ma-trend',
    name: 'MA Crossover Trend v1.2',
    netProfitPct: 14.2,
    maxDrawdownPct: 9.8,
    profitFactor: 1.38,
    winRate: 41,
    avgWin: 62.4,
    avgLoss: -31.8,
    trades: 212,
    costs: 318.4,
    longestLosingStreak: 7,
    exposurePct: 1.0,
    color: 'var(--tp-chart-1)',
  },
  {
    id: 'london-breakout',
    name: 'London Session Breakout v2.0',
    netProfitPct: 6.1,
    maxDrawdownPct: 12.4,
    profitFactor: 1.17,
    winRate: 52,
    avgWin: 38.1,
    avgLoss: -35.5,
    trades: 148,
    costs: 244.9,
    longestLosingStreak: 6,
    exposurePct: 1.5,
    color: 'var(--tp-chart-2)',
  },
  {
    id: 'grid-recovery',
    name: 'Grid Recovery v3.1',
    netProfitPct: 22.7,
    maxDrawdownPct: 41.5,
    profitFactor: 1.09,
    winRate: 88,
    avgWin: 9.2,
    avgLoss: -61.7,
    trades: 1260,
    costs: 905.3,
    longestLosingStreak: 3,
    exposurePct: 18.0,
    color: 'var(--tp-chart-3)',
  },
];

const gridCurve = sampleEquitySeries(41, 365, 0.0007, 0.0035).map((p, i) =>
  // Grid systems look smooth until a sharp collapse — illustrate that risk.
  i > 250 && i < 290 ? { ...p, equity: p.equity * (1 - Math.sin(((i - 250) / 40) * Math.PI) * 0.36) } : p,
);

export const sampleComparisonEquity: Record<string, EquityPoint[]> = {
  'ma-trend': anchor(sampleEquitySeries(7, 365, 0.00038, 0.005), 10_000, 11_420),
  'london-breakout': anchor(sampleEquitySeries(19, 365, 0.00018, 0.0055), 10_000, 10_610),
  'grid-recovery': anchor(gridCurve, 10_000, 12_270),
};

// Keep every displayed drawdown consistent with the curve that is actually plotted.
for (const m of sampleComparison) {
  m.maxDrawdownPct = Math.round(maxDrawdownPct(sampleComparisonEquity[m.id]) * 10) / 10;
  const robot = sampleRobots.find((r) => r.id === m.id);
  if (robot?.lastBacktest) robot.lastBacktest.maxDrawdownPct = m.maxDrawdownPct;
}

export const sampleStrategyVersions: StrategyVersion[] = [
  { id: 'v3', version: 'v1.3', title: 'MA Crossover Trend — wider stop in news hours', status: 'code_preview', updated: '2026-09-30' },
  { id: 'v2', version: 'v1.2', title: 'MA Crossover Trend — 1% risk sizing', status: 'tested', updated: '2026-09-18' },
  { id: 'v1', version: 'v0.4', title: 'RSI Mean Reversion — first draft', status: 'spec_ready', updated: '2026-09-20' },
];

export const sampleMql5 = `//+------------------------------------------------------------------+
//| MA Crossover Trend — SAMPLE CODE (not generated, not compiled)    |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>

input int    FastPeriod   = 20;     // Fast moving average length
input int    SlowPeriod   = 50;     // Slow moving average length
input double RiskPercent  = 1.0;    // % of balance risked per trade
input int    StopLossPips = 40;     // Fixed stop-loss distance

CTrade trade;
int fastHandle, slowHandle;

int OnInit()
{
   fastHandle = iMA(_Symbol, PERIOD_H1, FastPeriod, 0, MODE_EMA, PRICE_CLOSE);
   slowHandle = iMA(_Symbol, PERIOD_H1, SlowPeriod, 0, MODE_EMA, PRICE_CLOSE);
   return (fastHandle == INVALID_HANDLE || slowHandle == INVALID_HANDLE)
          ? INIT_FAILED : INIT_SUCCEEDED;
}

void OnTick()
{
   if (PositionsTotal() > 0) return;   // one trade at a time
   // ... crossover detection and risk-based lot sizing ...
}`;

/** Equity for the sample MA Crossover backtest report (same curve as the comparison view). */
export const sampleBacktestEquity = sampleComparisonEquity['ma-trend'];

export function maxDrawdownPct(points: EquityPoint[]) {
  let peak = -Infinity;
  let worst = 0;
  for (const p of points) {
    peak = Math.max(peak, p.equity);
    worst = Math.min(worst, (p.equity - peak) / peak);
  }
  return Math.abs(worst) * 100;
}
