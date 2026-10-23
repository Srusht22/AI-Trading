import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Circle,
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
  PreviewTag,
  SampleDataBanner,
  SectionHeader,
  SegmentedControl,
  Term,
} from '@/components/ui';
import { ChartContainer, ChartLegend } from '@/components/charts/ChartContainer';
import { EquityChart, equityLegend } from '@/components/charts/EquityChart';
import { dateLong } from '@/components/charts/chartTheme';
import { ActivityItem } from '@/components/domain/ActivityItem';
import { ConnectionStatus } from '@/components/domain/ConnectionStatus';
import { PageHeader } from '@/components/layout/PageHeader';
import { integrationStatus } from '@/config/integrations';
import { sampleActivity, sampleDashboard, sampleEquity } from '@/data/sample';
import { greetingFor } from '@/lib/greeting';
import { formatMoney } from '@/lib/format';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { usePreferences } from '@/lib/preferences';

type Range = '1M' | '3M' | '6M' | '1Y';
const rangeDays: Record<Range, number> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 };

export default function DashboardPage() {
  const { showSampleData: sample, setShowSampleData } = usePreferences();
  const greeting = useMemo(() => greetingFor(new Date()), []);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-8">
      <motion.div variants={staggerItem}>
        {sample ? (
          <SampleDataBanner
            actions={
              <Button size="sm" variant="secondary" onClick={() => setShowSampleData(false)}>
                Show empty workspace
              </Button>
            }
          />
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
            It is empty because nothing is connected yet. Sections fill in once robots, tests and MT5 are set up.
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
                  {greeting}. Welcome to <span className="brand-text">TradePilot AI</span>.
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
            value={sample ? sampleDashboard.robots.configured : 0}
            unit="configured"
            footer={
              sample ? (
                <span>
                  <span className="text-fg num">{sampleDashboard.robots.runningInDemo}</span> running in demo ·{' '}
                  <span className="text-warning num">{sampleDashboard.robots.needsAttention}</span> need review
                </span>
              ) : (
                <Link to="/robots" className="text-accent inline-flex items-center gap-1 font-medium hover:underline">
                  Library is empty — add a robot <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )
            }
          />
          <MetricCard
            label="Backtests"
            icon={History}
            sample={sample}
            value={sample ? sampleDashboard.backtests.total : 0}
            unit="recorded"
            footer={
              sample ? (
                <span>
                  <span className="text-fg num">{sampleDashboard.backtests.completed}</span> completed ·{' '}
                  <span className="text-fg num">{sampleDashboard.backtests.failed}</span> failed
                </span>
              ) : (
                'Historical tests appear here after you run one.'
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
                'Not connected. Balance and equity show once a demo account is linked.'
              )
            }
          />
          <MetricCard
            label="Research progress"
            icon={ListChecks}
            sample={sample}
            value={sample ? sampleDashboard.research.candidates : 0}
            unit={<Term k="strategyCandidate">candidates</Term>}
            footer={
              sample ? (
                <span className="line-clamp-2">
                  <span className="text-fg num">{sampleDashboard.research.experiments}</span> experiments · Now:{' '}
                  {sampleDashboard.research.currentTask}
                </span>
              ) : (
                'No research task is running.'
              )
            }
          />
        </div>
      </motion.section>

      <motion.div variants={staggerItem} className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <PerformanceOverview sample={sample} className="xl:col-span-2" />
        <RecentActivity sample={sample} />
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

const setupSteps = [
  { label: 'Connect MetaTrader 5', detail: 'Install the Windows connector beside MT5.', to: '/connections' },
  { label: 'Add your first robot', detail: 'Import an Expert Advisor or design your own.', to: '/robots' },
  { label: 'Run a first backtest', detail: 'Check how it behaved on historical prices.', to: '/backtesting' },
];

/** Real (not sample) setup state — in Phase 1 no step can be completed yet. */
function SetupChecklist() {
  return (
    <section aria-labelledby="setup-title" className="surface flex flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="setup-title" className="text-fg text-md font-semibold">
          Getting started
        </h2>
        <span className="text-fg-3 num text-xs">0 of 3 done</span>
      </div>
      <div className="bg-line-soft mt-3 h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={0} aria-valuemin={0} aria-valuemax={3} aria-label="Setup progress">
        <div className="brand-gradient h-full w-0" />
      </div>
      <ol className="mt-4 flex-1 space-y-1">
        {setupSteps.map((s, i) => (
          <li key={s.label}>
            <Link to={s.to} className="hover:bg-raised-hover group -mx-2 flex items-start gap-3 rounded-md p-2 transition-colors">
              <Circle className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-fg block text-sm font-medium">
                  <span className="sr-only">Step {i + 1}, not done: </span>
                  {s.label}
                </span>
                <span className="text-fg-3 block text-xs">{s.detail}</span>
              </span>
              <ArrowRight className="text-fg-3 group-hover:text-fg mt-0.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-fg-3 border-line-soft mt-3 border-t pt-3 text-xs leading-relaxed">
        Connecting MT5 arrives in a later phase. Until then, every page is a design preview you can explore freely.
      </p>
    </section>
  );
}

function PerformanceOverview({ sample, className }: { sample: boolean; className?: string }) {
  const [range, setRange] = useState<Range>('6M');
  const data = useMemo(() => sampleEquity.slice(-rangeDays[range]), [range]);
  const monthly = useMemo(() => data.filter((_, i) => i % 30 === 0 || i === data.length - 1), [data]);

  return (
    <ChartContainer
      className={className}
      title="Performance overview"
      sample={sample}
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
        sample ? undefined : (
          <EmptyState
            icon={LineChart}
            title="No performance data yet"
            description="Charts appear here after a backtest has been recorded or a robot has traded on a demo account."
            actions={
              <Button asChild variant="secondary" size="sm">
                <Link to="/backtesting">Set up a backtest</Link>
              </Button>
            }
          />
        )
      }
      height={300}
    >
      <EquityChart data={data} sample />
    </ChartContainer>
  );
}

function RecentActivity({ sample }: { sample: boolean }) {
  return (
    <section aria-labelledby="activity-title" className="surface flex flex-col p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 id="activity-title" className="text-fg text-md font-semibold">
          Recent activity
        </h2>
        {sample && <PreviewTag />}
      </div>
      {sample ? (
        <ol className="-mb-5">
          {sampleActivity.slice(0, 5).map((e, i, arr) => (
            <ActivityItem key={e.id} event={e} last={i === arr.length - 1} />
          ))}
        </ol>
      ) : (
        <EmptyState
          size="sm"
          icon={Activity}
          title="No activity yet"
          description="Completed backtests, new strategy candidates, connection changes and approval requests will be listed here."
        />
      )}
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
