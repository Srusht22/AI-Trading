import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CandlestickChart,
  Circle,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  History,
  LineChart,
  ListChecks,
  PlugZap,
  Scale,
  ShieldCheck,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  MetricCard,
  SampleDataBanner,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  Term,
} from '@/components/ui';
import { ChartContainer, ChartLegend } from '@/components/charts/ChartContainer';
import { EquityChart, equityLegend } from '@/components/charts/EquityChart';
import { dateLong } from '@/components/charts/chartTheme';
import { AuditEventList } from '@/components/domain/AuditEventList';
import { FreshnessBadge } from '@/components/domain/FreshnessBadge';
import { LiveIndicator } from '@/components/domain/LiveIndicator';
import { ConnectionStatus } from '@/components/domain/ConnectionStatus';
import { PageHeader } from '@/components/layout/PageHeader';
import { integrationStatus, type ConnectionState } from '@/config/integrations';
import { sampleDashboard, sampleEquity } from '@/data/sample';
import type { EquitySeries } from '@/domain/marketData';
import { useProfile } from '@/hooks/useAccount';
import { useAccountSnapshots, useAccountState, useConnector } from '@/hooks/useMt5';
import { AccountOverview } from '@/components/mt5/AccountOverview';
import { AccountEquityChart } from '@/components/mt5/AccountEquityChart';
import { ConnectorStatusBadge } from '@/components/mt5/ConnectorStatusBadge';
import { MarketPanel } from '@/components/mt5/MarketPanel';
import { accountFreshness, displayMaskedAccount, formatAccountMoney } from '@/domain/mt5';
import { formatRelativeTime } from '@/lib/datetime';
import { useRecentAuditEvents } from '@/hooks/useAudit';
import { useDisplayPrefs } from '@/hooks/useDisplayPrefs';
import { cn } from '@/lib/cn';
import { toAppError } from '@/lib/errors';
import { useLiveStatus } from '@/lib/live';
import { greetingFor } from '@/lib/greeting';
import { formatMoney } from '@/lib/format';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { usePreferences } from '@/lib/preferences';

type Range = '1M' | '3M' | '6M' | '1Y';
const rangeDays: Record<Range, number> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 };

export default function DashboardPage() {
  const { showSampleData: sample, setShowSampleData } = usePreferences();
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const profile = useProfile();
  const name = profile.data?.display_name;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-8">
      <motion.div variants={staggerItem}>
        {sample ? (
          <SampleDataBanner
            actions={
              <Button size="sm" variant="secondary" onClick={() => setShowSampleData(false)}>
                Hide sample data
              </Button>
            }
          >
            Sections without a real data source yet are filled with invented examples. Your account activity and settings are always
            real.
          </SampleDataBanner>
        ) : (
          <Callout
            tone="info"
            title="This is your real workspace"
            actions={
              <Button size="sm" variant="secondary" onClick={() => setShowSampleData(true)}>
                Preview with sample data
              </Button>
            }
          >
            Your account, settings, activity and — once the MT5 connector is paired — your demo account and prices are real. Robots,
            backtests and research arrive in later phases and stay empty until then — nothing here is invented.
          </Callout>
        )}
      </motion.div>

      <motion.section variants={staggerItem} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]" aria-labelledby="welcome-title">
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-line-soft bg-panel p-6 sm:p-8">
          <div aria-hidden className="grid-texture pointer-events-none absolute inset-0 opacity-70" />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-50 blur-3xl"
            style={{ background: 'radial-gradient(circle, var(--tp-accent-soft), transparent 70%)' }}
          />
          <div className="relative flex flex-1 flex-col">
            <p className="eyebrow">Personal research workspace</p>
            <PageHeader
              className="mt-3 mb-0"
              documentTitle="Dashboard"
              title={
                <span id="welcome-title">
                  {greeting}
                  {name ? `, ${name}` : ''}. Welcome to <span className="brand-text">TradePilot AI</span>.
                </span>
              }
              description="Your personal workspace for researching, testing, and understanding Forex trading robots."
            />
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="primary" size="lg">
                <Link to="/strategy-lab">
                  <FlaskConical aria-hidden /> Explore Strategy Lab
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link to="/robots">
                  <Bot aria-hidden /> View Robot Library
                </Link>
              </Button>
            </div>
            <ul className="border-line-soft mt-8 grid grid-cols-1 gap-4 border-t pt-5 sm:mt-auto sm:grid-cols-3">
              {principles.map((p) => (
                <li key={p.title} className="flex gap-2.5">
                  <p.icon className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="text-fg block text-sm font-medium">{p.title}</span>
                    <span className="text-fg-3 block text-xs leading-relaxed">{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <SetupChecklist />
      </motion.section>

      <motion.section variants={staggerItem} aria-labelledby="overview-title">
        <h2 id="overview-title" className="sr-only">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Robots"
            icon={Bot}
            sample={sample}
            value={sample ? sampleDashboard.robots.configured : '—'}
            unit={sample ? 'configured' : undefined}
            footer={
              sample ? (
                <span>
                  <span className="text-fg num">{sampleDashboard.robots.runningInDemo}</span> running in demo ·{' '}
                  <span className="text-warning num">{sampleDashboard.robots.needsAttention}</span> need review
                </span>
              ) : (
                <UnavailableNote>The robot library arrives in a later phase.</UnavailableNote>
              )
            }
          />
          <MetricCard
            label="Backtests"
            icon={History}
            sample={sample}
            value={sample ? sampleDashboard.backtests.total : '—'}
            unit={sample ? 'recorded' : undefined}
            footer={
              sample ? (
                <span>
                  <span className="text-fg num">{sampleDashboard.backtests.completed}</span> completed ·{' '}
                  <span className="text-fg num">{sampleDashboard.backtests.failed}</span> failed
                </span>
              ) : (
                <UnavailableNote>Backtesting arrives in a later phase; the MT5 link is read-only for now.</UnavailableNote>
              )
            }
          />
          <DemoAccountCard sample={sample} />
          <MetricCard
            label="Research progress"
            icon={ListChecks}
            sample={sample}
            value={sample ? sampleDashboard.research.candidates : '—'}
            unit={sample ? <Term k="strategyCandidate">candidates</Term> : undefined}
            footer={
              sample ? (
                <span className="line-clamp-2">
                  <span className="text-fg num">{sampleDashboard.research.experiments}</span> experiments · Now:{' '}
                  {sampleDashboard.research.currentTask}
                </span>
              ) : (
                <UnavailableNote>AI research tasks arrive in a later phase.</UnavailableNote>
              )
            }
          />
        </div>
      </motion.section>

      <motion.div variants={staggerItem}>
        <AccountAndMarket />
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <PerformanceOverview sample={sample} className="xl:col-span-2" />
        <RecentActivity />
      </motion.div>

      <motion.div variants={staggerItem}>
        <ResearchWorkspace />
      </motion.div>

      <motion.div variants={staggerItem}>
        <ConnectionSummary />
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */

const principles = [
  { icon: ShieldCheck, title: 'Demo money only', text: 'Built for simulated trading and research.' },
  { icon: UserCheck, title: 'You approve changes', text: 'No new or modified robot runs without you.' },
  { icon: Scale, title: 'Risk before profit', text: 'Every result shows drawdown and assumptions.' },
];

/** Real setup state, derived from stored data. */
function SetupChecklist() {
  const connector = useConnector();
  const steps = [
    { label: 'Create your account', detail: 'Signed in and protected by the database’s access rules.', done: true, to: '/account' },
    {
      label: 'Connect MetaTrader 5',
      detail: connector.verified ? 'Demo account verified through the connector.' : 'Pair the read-only Windows connector with your demo account.',
      done: connector.verified,
      to: '/connections',
    },
    { label: 'Add your first robot', detail: 'The robot library arrives in a later phase.', done: false, to: '/robots' },
    { label: 'Run a first backtest', detail: 'Backtesting arrives in a later phase.', done: false, to: '/backtesting' },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <section aria-labelledby="setup-title" className="surface flex flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="setup-title" className="text-fg text-md font-semibold">
          Getting started
        </h2>
        <span className="text-fg-3 num text-xs">
          {done} of {steps.length} done
        </span>
      </div>
      <div
        className="bg-line-soft mt-3 h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="Setup progress"
      >
        <div className="brand-gradient h-full transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 flex-1 space-y-1">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link to={s.to} className="hover:bg-raised-hover group -mx-2 flex items-start gap-3 rounded-md p-2 transition-colors">
              {s.done ? (
                <CircleCheck className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <Circle className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', s.done ? 'text-fg-2' : 'text-fg')}>
                  <span className="sr-only">
                    Step {i + 1}, {s.done ? 'done' : 'not done'}:{' '}
                  </span>
                  {s.label}
                </span>
                <span className="text-fg-3 block text-xs">{s.detail}</span>
              </span>
              <ArrowRight className="text-fg-3 group-hover:text-fg mt-0.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UnavailableNote({ children }: { children: ReactNode }) {
  return (
    <span className="text-fg-3 flex items-start gap-1.5">
      <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">Not available yet. </span>
        {children}
      </span>
    </span>
  );
}

/** Performance series. No real equity source exists in this version, so real mode is honestly empty. */
function usePerformanceSeries(sample: boolean, days: number): EquitySeries {
  return useMemo(
    () =>
      sample
        ? { source: { kind: 'sample' }, currency: 'USD', timeBasis: 'utc', points: sampleEquity.slice(-days), freshness: { state: 'sample' } }
        : {
            source: { kind: 'none' },
            currency: 'USD',
            timeBasis: 'utc',
            points: [],
            freshness: { state: 'unavailable', reason: 'No backtest or demo-account data source exists yet. Equity data will come from MT5 in a later phase.' },
          },
    [sample, days],
  );
}

function PerformanceOverview({ sample, className }: { sample: boolean; className?: string }) {
  return sample ? <SamplePerformance className={className} /> : <AccountPerformance className={className} />;
}

type RealRange = '1D' | '1W' | '1M' | '6M';
const realRangeDays: Record<RealRange, number> = { '1D': 1, '1W': 7, '1M': 30, '6M': 182 };

/** Real equity history: timestamped snapshots recorded by the connector. Never back-filled. */
function AccountPerformance({ className }: { className?: string }) {
  const connector = useConnector();
  const prefs = useDisplayPrefs();
  const [range, setRange] = useState<RealRange>('1W');
  const conn = connector.connection?.status === 'verified' || connector.connection?.first_verified_at ? connector.connection : null;
  const snapshots = useAccountSnapshots(conn?.id, realRangeDays[range]);
  const points = snapshots.data?.snapshots ?? [];
  const currency = conn?.currency ?? '';
  const digits = conn?.currency_digits ?? 2;
  const first = points[0]?.observed_at;
  return (
    <ChartContainer
      className={className}
      title="Demo account equity"
      badge={conn ? <ConnectorStatusBadge state={connector.state} /> : undefined}
      explanation={
        <>
          <Term k="equity">Equity</Term> and <Term k="balance">balance</Term> of your demo account as MT5 reported them, recorded about every{' '}
          {Math.round((conn?.snapshot_interval_s ?? 60) / 60)} minute{(conn?.snapshot_interval_s ?? 60) >= 120 ? 's' : ''} while the connector runs.
          {first && ` This range starts ${formatRelativeTime(first, connector.now)}; nothing before the connector began recording is shown, because it was never recorded.`}
          {points.length > 0 && points.length < 5 && ` Only ${points.length} snapshot${points.length === 1 ? '' : 's'} so far — history grows while the connector runs.`}
        </>
      }
      controls={
        <SegmentedControl
          label="Time range"
          value={range}
          onValueChange={setRange}
          options={(Object.keys(realRangeDays) as RealRange[]).map((r) => ({ value: r, label: r, ariaLabel: `Last ${r}` }))}
        />
      }
      legend={<ChartLegend items={[{ label: 'Equity', color: 'var(--tp-accent)' }, { label: 'Balance (closed trades)', color: 'var(--tp-fg-3)', dashed: true }]} />}
      table={
        <DataTable
          dense
          caption="Equity snapshots recorded by the connector"
          rowKey={(r) => r.observed_at}
          rows={[...points].reverse().slice(0, 100)}
          columns={[
            { key: 'd', header: 'Recorded', cell: (r) => new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.observed_at)) },
            { key: 'e', header: 'Equity', align: 'right', cell: (r) => formatAccountMoney(r.equity, currency, digits) },
            { key: 'b', header: 'Balance', align: 'right', cell: (r) => formatAccountMoney(r.balance, currency, digits) },
          ]}
        />
      }
      empty={
        !conn ? (
          <EmptyState
            icon={LineChart}
            title="No account connected"
            description="Connect your MT5 demo account through the read-only connector. Equity is recorded from that moment on — earlier history cannot be invented."
            actions={
              <Button asChild variant="secondary" size="sm">
                <Link to="/connections">Connect MT5</Link>
              </Button>
            }
          />
        ) : snapshots.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : points.length === 0 ? (
          <EmptyState icon={LineChart} title="No snapshots in this range yet" description="The connector records a snapshot every few minutes while it runs. More history accumulates over time." />
        ) : undefined
      }
      height={300}
    >
      <AccountEquityChart snapshots={points} currency={currency} digits={digits} timeZone={prefs.timeZone} />
    </ChartContainer>
  );
}

function SamplePerformance({ className }: { className?: string }) {
  const sample = true;
  const { setShowSampleData } = usePreferences();
  const [range, setRange] = useState<Range>('6M');
  const series = usePerformanceSeries(sample, rangeDays[range]);
  const monthly = useMemo(() => series.points.filter((_, i) => i % 30 === 0 || i === series.points.length - 1), [series]);

  return (
    <ChartContainer
      className={className}
      title="Performance overview"
      sample={series.source.kind === 'sample'}
      badge={series.source.kind === 'sample' ? undefined : <FreshnessBadge freshness={series.freshness} />}
      explanation={
        <>
          The <Term k="equityCurve">equity curve</Term> shows how the account value changed over time. A steadier line usually means a
          more consistent strategy.
        </>
      }
      controls={
        <SegmentedControl
          label="Time range"
          value={range}
          onValueChange={setRange}
          options={(Object.keys(rangeDays) as Range[]).map((r) => ({ value: r, label: r, ariaLabel: `Last ${r}` }))}
        />
      }
      legend={<ChartLegend items={equityLegend()} />}
      table={
        <DataTable
          dense
          caption="Equity by date (sample data)"
          rowKey={(r) => String(r.t)}
          rows={monthly}
          columns={[
            { key: 'd', header: 'Date', cell: (r) => dateLong(r.t) },
            { key: 'e', header: 'Equity', align: 'right', cell: (r) => formatMoney(r.equity) },
            { key: 'b', header: 'Balance', align: 'right', cell: (r) => formatMoney(r.balance) },
          ]}
        />
      }
      empty={
        series.points.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title="No performance data yet"
            description="This chart draws real equity data once a backtest has been recorded or a robot has traded on a demo account. Robots and backtests arrive in a later phase."
            actions={
              <Button variant="secondary" size="sm" onClick={() => setShowSampleData(true)}>
                Preview with sample data
              </Button>
            }
          />
        ) : undefined
      }
      height={300}
    >
      <EquityChart data={series.points} sample={series.source.kind === 'sample'} />
    </ChartContainer>
  );
}

/** Real account events from the audit log, updated live when Realtime is available. */
function RecentActivity() {
  const events = useRecentAuditEvents(5);
  const prefs = useDisplayPrefs();
  const live = useLiveStatus();
  return (
    <section aria-labelledby="activity-title" className="surface flex flex-col p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 id="activity-title" className="text-fg text-md font-semibold">
          Recent activity
        </h2>
        <LiveIndicator status={live.activity} />
      </div>
      {events.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading activity">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : events.isError ? (
        <Callout
          tone="danger"
          title="Activity couldn’t be loaded"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void events.refetch()}>
              Retry
            </Button>
          }
        >
          {toAppError(events.error).userMessage}
        </Callout>
      ) : events.data.events.length === 0 ? (
        <EmptyState size="sm" icon={Activity} title="No activity yet" description="Sign-ins and changes to your profile or settings are recorded here." />
      ) : (
        <>
          <AuditEventList events={events.data.events} prefs={prefs} />
          <Link to="/account" className="text-accent border-line-soft mt-5 border-t pt-4 text-sm font-medium hover:underline">
            View all account activity
          </Link>
        </>
      )}
      <p className="text-fg-3 mt-4 text-xs">
        Connector pairing and verification appear here too. Backtest and robot events arrive with those features.
      </p>
    </section>
  );
}

const activities = [
  {
    icon: Bot,
    title: 'Test Existing Robots',
    text: 'Review compatible robots and investigate their historical performance before trusting them.',
    to: '/robots',
    cta: 'Browse robots',
  },
  {
    icon: FlaskConical,
    title: 'Build a Strategy',
    text: 'Describe a strategy idea in plain English. Later, AI assistance will help turn it into a custom Expert Advisor.',
    to: '/strategy-lab',
    cta: 'Open Strategy Lab',
  },
  {
    icon: BarChart3,
    title: 'Understand Performance',
    text: 'Review test results, risks, drawdown and the assumptions behind a strategy — not just its profit.',
    to: '/analytics',
    cta: 'View analytics',
  },
];

function ResearchWorkspace() {
  return (
    <section aria-labelledby="workspace-title">
      <SectionHeader
        id="workspace-title"
        title="What you can do here"
        description="TradePilot is organised around three activities. Start with whichever matches what you want to learn."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {activities.map((a, i) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.title}
              to={a.to}
              className="surface group hover:border-line flex flex-col p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-lg">
                  <Icon className="size-5" aria-hidden strokeWidth={1.75} />
                </span>
                <span className="text-fg-3 num text-xs font-medium">0{i + 1}</span>
              </div>
              <h3 className="text-fg mt-4 text-md font-semibold">{a.title}</h3>
              <p className="text-fg-2 mt-1.5 flex-1 text-sm leading-relaxed">{a.text}</p>
              <span className="text-accent mt-4 inline-flex items-center gap-1.5 text-sm font-medium">
                {a.cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Real status of each integration, derived from the connector's reports. */
function ConnectionSummary() {
  const connector = useConnector();
  const { connection: c, agent, state, now } = connector;
  const agentOnline = !!agent && !agent.revoked_at && !!agent.last_heartbeat_at && now.getTime() - Date.parse(agent.last_heartbeat_at) < 45_000;
  const items: { label: string; state: ConnectionState; detail: string }[] = [
    {
      label: 'MT5 terminal',
      state: !c ? 'not_configured' : !agentOnline ? 'not_connected' : c.terminal_connected ? 'connected' : 'error',
      detail: !c ? 'Reported by the connector once it is paired.' : !agentOnline ? 'Unknown while the connector is offline.' : c.terminal_connected ? `Connected to the broker (build ${c.terminal_build ?? '?'}).` : 'Not connected to the broker.',
    },
    {
      label: 'Windows connector',
      state: !agent ? 'not_configured' : agent.revoked_at ? 'error' : agentOnline ? 'connected' : 'not_connected',
      detail: !agent ? 'Not paired yet.' : agent.revoked_at ? 'Revoked — pair a new connector.' : agentOnline ? `Online · v${agent.agent_version ?? '?'}` : 'No heartbeat in the last 45 seconds.',
    },
    {
      label: 'Demo account',
      state: state === 'connected' ? 'connected' : state === 'blocked_account_type' || state === 'account_changed' ? 'error' : c?.status === 'verified' ? 'degraded' : c ? 'connecting' : 'not_configured',
      detail: c?.status === 'verified' ? `Verified demo · ${displayMaskedAccount(c.masked_account)}` : c?.status === 'blocked' ? 'Blocked — not the approved demo account.' : 'Not verified yet.',
    },
    ...integrationStatus.filter((s) => s.id === 'ai').map((s) => ({ label: s.label, state: s.state, detail: s.detail })),
  ];
  const lastSync = c?.last_account_at ?? c?.last_report_at ?? null;
  return (
    <section aria-labelledby="connections-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="connections-title"
        as="h2"
        className="mb-5"
        title={
          <>
            <PlugZap className="text-fg-3 size-[18px]" aria-hidden /> Connections
          </>
        }
        description="The read-only MT5 connector links TradePilot to your demo account. AI features arrive later."
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to="/connections">{c ? 'Manage connection' : 'Connect MT5'}</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((s) => (
          <ConnectionStatus key={s.label} layout="stack" label={s.label} state={s.state} detail={s.detail} />
        ))}
        <div className="flex items-start gap-3">
          <History className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-fg text-sm font-medium">Last successful sync</p>
            <p className="text-fg-2 text-sm">{lastSync ? formatRelativeTime(lastSync, now) : 'Never'}</p>
            <p className="text-fg-3 mt-0.5 text-xs">{lastSync ? 'Most recent data received from the connector.' : 'Shown once the connector reports in.'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The demo account card: real values from MT5 when connected, an honest note otherwise. */
function DemoAccountCard({ sample }: { sample: boolean }) {
  const connector = useConnector();
  const conn = connector.connection;
  const account = useAccountState(conn?.status === 'verified' || conn?.first_verified_at ? conn.id : undefined);
  const prefs = useDisplayPrefs();
  if (account.data && conn) {
    const a = account.data;
    const fresh = accountFreshness(a, conn, connector.connected, connector.now);
    return (
      <MetricCard
        label={<Term k="demoAccount">Demo account</Term>}
        icon={Wallet}
        value={formatAccountMoney(a.balance, a.currency, a.currency_digits, prefs.locale)}
        unit="balance"
        footer={
          <span>
            Equity <span className="text-fg num">{formatAccountMoney(a.equity, a.currency, a.currency_digits, prefs.locale)}</span> · {displayMaskedAccount(conn.masked_account)}
            <span className={cn('block text-xs', fresh === 'live' ? 'text-fg-3' : 'text-warning')}>
              {fresh === 'live' ? 'Live from MT5' : 'Last known'} · updated {formatRelativeTime(a.observed_at, connector.now)}
            </span>
          </span>
        }
      />
    );
  }
  return (
    <MetricCard
      label={<Term k="demoAccount">Demo account</Term>}
      icon={Wallet}
      sample={sample}
      value={sample ? formatMoney(sampleDashboard.account.balance) : '—'}
      unit={sample ? 'balance' : undefined}
      footer={
        sample ? (
          <span>
            Equity <span className="text-fg num">{formatMoney(sampleDashboard.account.equity)}</span> · virtual money
          </span>
        ) : (
          <UnavailableNote>
            {conn ? 'Waiting for the first account summary from the connector.' : 'Connect MT5 on the Connections page to see your real demo balance.'}
          </UnavailableNote>
        )
      }
    />
  );
}

/** Real account summary and prices — or a clear invitation to connect. Never sample data. */
function AccountAndMarket() {
  const connector = useConnector();
  const prefs = useDisplayPrefs();
  const conn = connector.connection;
  const everVerified = !!conn && (conn.status === 'verified' || !!conn.first_verified_at);
  const account = useAccountState(everVerified ? conn!.id : undefined);
  return (
    <section aria-labelledby="market-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="market-title"
        title={
          <>
            <CandlestickChart className="text-fg-3 size-[18px]" aria-hidden /> Demo account & market
          </>
        }
        description={everVerified ? 'Read-only data from your MetaTrader 5 terminal, delivered by the connector.' : 'Shows your real demo account and prices once MetaTrader 5 is connected.'}
        actions={!connector.loading ? <ConnectorStatusBadge state={connector.state} size="md" /> : undefined}
      />
      {connector.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !everVerified ? (
        <EmptyState
          size="sm"
          icon={PlugZap}
          title={conn || connector.agent ? 'Waiting for a verified demo account' : 'MetaTrader 5 is not connected'}
          description="Pair the read-only Windows connector and log MT5 into your demo account. No prices or balances are shown until real data arrives."
          actions={
            <Button asChild size="sm" variant="primary">
              <Link to="/connections">Open connection setup</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {connector.state !== 'connected' && (
            <Callout tone="warning" title="Not current">
              The connection is {connector.state === 'disconnected' ? 'disconnected' : 'not live'} — the values below are the last ones received, with their times.
            </Callout>
          )}
          <AccountOverview connection={conn!} account={account.data} loading={account.isPending} connected={connector.connected} prefs={prefs} now={connector.now} />
          <MarketPanel connection={conn!} connected={connector.connected} prefs={prefs} now={connector.now} />
        </div>
      )}
    </section>
  );
}
