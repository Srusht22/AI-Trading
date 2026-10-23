/**
 * Domain types shared by preview screens. Later phases populate these from
 * the backend / connector; Phase 1 only fills them with labelled sample data.
 */
export type RobotOrigin = 'existing' | 'custom';
export type Compatibility = 'compatible' | 'needs_review' | 'not_checked' | 'incompatible';
export type DemoStatus = 'running' | 'stopped' | 'not_deployed';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface BacktestSummary {
  date: string;
  netProfitPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  trades: number;
}

export interface Robot {
  id: string;
  name: string;
  version: string;
  origin: RobotOrigin;
  style: string;
  summary: string;
  symbols: string[];
  timeframe: string;
  risk: RiskLevel;
  compatibility: Compatibility;
  lastBacktest: BacktestSummary | null;
  demoStatus: DemoStatus;
  traits: string[];
}

export type { EquityPoint } from '@/domain/marketData';

export interface Position {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  lots: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  robot: string;
  openedAt: string;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  type: 'Buy limit' | 'Sell limit' | 'Buy stop' | 'Sell stop';
  lots: number;
  price: number;
  robot: string;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  lots: number;
  profit: number;
  closedAt: string;
  robot: string;
}

export interface LogLine {
  at: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface StrategyMetrics {
  id: string;
  name: string;
  netProfitPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  trades: number;
  costs: number;
  longestLosingStreak: number;
  exposurePct: number;
  color: string;
}

export interface StrategyVersion {
  id: string;
  version: string;
  title: string;
  status: 'draft' | 'spec_ready' | 'code_preview' | 'tested';
  updated: string;
}
