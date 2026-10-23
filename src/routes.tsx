import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ApplicationShell } from '@/components/layout/AppShell';
import DashboardPage from '@/pages/Dashboard';

// The dashboard is the landing page and ships in the main bundle; other pages load on demand.
const RobotsPage = lazy(() => import('@/pages/Robots'));
const StrategyLabPage = lazy(() => import('@/pages/StrategyLab'));
const BacktestingPage = lazy(() => import('@/pages/Backtesting'));
const DemoTradingPage = lazy(() => import('@/pages/DemoTrading'));
const AnalyticsPage = lazy(() => import('@/pages/Analytics'));
const AIAnalystPage = lazy(() => import('@/pages/AIAnalyst'));
const ConnectionsPage = lazy(() => import('@/pages/Connections'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const NotFoundPage = lazy(() => import('@/pages/NotFound'));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<ApplicationShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="robots" element={<RobotsPage />} />
        <Route path="strategy-lab" element={<StrategyLabPage />} />
        <Route path="backtesting" element={<BacktestingPage />} />
        <Route path="demo-trading" element={<DemoTradingPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="ai-analyst" element={<AIAnalystPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
