import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
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
import { integrationStatus } from '@/config/integrations';
import { sampleDashboard, sampleEquity } from '@/data/sample';
import type { EquitySeries } from '@/domain/marketData';
import { useProfile } from '@/hooks/useAccount';
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
            Your account, settings and activity are stored for real. Trading sections stay empty until robots, backtests and the MT5
            connector exist in later phases — nothing here is invented.
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
                <UnavailableNote>Backtests run through MT5, which isn’t connected yet.</UnavailableNote>
              )
            }
          />
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
                <UnavailableNote>Balance and equity will come from MT5 via the connector.</UnavailableNote>
              )
            }
          />
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

/** Real setup state. Only account creation can be completed in this version. */
function SetupChecklist() {
  const steps = [
    { label: 'Create your account', detail: 'Signed in and protected by the database’s access rules.', done: true, to: '/account' },
    { label: 'Connect MetaTrader 5', detail: 'Needs the Windows connector — later phase.', done: false, to: '/connections' },
    { label: 'Add your first robot', detail: 'The robot library arrives in a later phase.', done: false, to: '/robots' },
    { label: 'Run a first backtest', detail: 'Runs in MT5 once it is connected.', done: false, to: '/backtesting' },
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
            description="This chart draws real equity data once a backtest has been recorded or a robot has traded on a demo account. Both need the MT5 connector, which arrives in a later phase."
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
        Backtest, robot and connector events will appear here once those systems exist.
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

/** Always real status: nothing is connected in Phase 1, and it says so. */
function ConnectionSummary() {
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
        description="TradePilot needs a Windows connector and an MT5 terminal before it can test or trade."
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to="/connections">Connect MT5</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
        {integrationStatus.map((s) => (
          <ConnectionStatus key={s.id} layout="stack" label={s.label} state={s.state} detail={s.detail} />
        ))}
        <div className="flex items-start gap-3">
          <History className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-fg text-sm font-medium">Last successful sync</p>
            <p className="text-fg-2 text-sm">Never</p>
            <p className="text-fg-3 mt-0.5 text-xs">Shown once the connector reports in.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
