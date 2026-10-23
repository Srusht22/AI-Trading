import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthSplash, RequireAuth, RequireOwner } from '@/components/auth/Gates';
import { ApplicationShell } from '@/components/layout/AppShell';
import { BeginnerHelpProvider } from '@/lib/help';
import { PersistedThemeProvider } from '@/lib/theme';
import DashboardPage from '@/pages/Dashboard';
import SignInPage from '@/pages/auth/SignInPage';

const SignUpPage = lazy(() => import('@/pages/auth/SignUpPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));

// The dashboard is the landing page and ships in the main bundle; other pages load on demand.
const RobotsPage = lazy(() => import('@/pages/Robots'));
const StrategyLabPage = lazy(() => import('@/pages/StrategyLab'));
const BacktestingPage = lazy(() => import('@/pages/Backtesting'));
const DemoTradingPage = lazy(() => import('@/pages/DemoTrading'));
const AnalyticsPage = lazy(() => import('@/pages/Analytics'));
const AIAnalystPage = lazy(() => import('@/pages/AIAnalyst'));
const ConnectionsPage = lazy(() => import('@/pages/Connections'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const AccountPage = lazy(() => import('@/pages/Account'));
const NotFoundPage = lazy(() => import('@/pages/NotFound'));

/** The private workspace: signed in, owner, theme synced from the account. */
function Workspace() {
  return (
    <RequireAuth>
      <RequireOwner>
        <PersistedThemeProvider>
          <BeginnerHelpProvider>
            <ApplicationShell />
          </BeginnerHelpProvider>
        </PersistedThemeProvider>
      </RequireOwner>
    </RequireAuth>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<AuthSplash label="Loading" />}>
      <Routes>
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="sign-up" element={<SignUpPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route element={<Workspace />}>
          <Route index element={<DashboardPage />} />
          <Route path="robots" element={<RobotsPage />} />
          <Route path="strategy-lab" element={<StrategyLabPage />} />
          <Route path="backtesting" element={<BacktestingPage />} />
          <Route path="demo-trading" element={<DemoTradingPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="ai-analyst" element={<AIAnalystPage />} />
          <Route path="connections" element={<ConnectionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
