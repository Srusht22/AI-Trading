import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bot, Code2, LayoutGrid, Library, List, Plus, SearchX, ShieldAlert, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  DataTable,
  Dialog,
  EmptyState,
  PreviewTag,
  SampleDataBanner,
  SegmentedControl,
  Select,
  StatusBadge,
  Term,
} from '@/components/ui';
import { compatibilityInfo, demoStatusInfo, riskInfo, RobotCard } from '@/components/domain/RobotCard';
import { FilterBar } from '@/components/domain/FilterBar';
import { RiskMetric } from '@/components/domain/RiskMetric';
import { PageHeader } from '@/components/layout/PageHeader';
import { sampleRobots } from '@/data/sample';
import type { Compatibility, Robot, RobotOrigin } from '@/data/types';
import { formatPercent } from '@/lib/format';
import { transition } from '@/lib/motion';
import { usePreferences } from '@/lib/preferences';
import { usePreviewNotice } from '@/lib/previewNotice';

type OriginFilter = 'all' | RobotOrigin;

export default function RobotsPage() {
  const { showSampleData: sample, setShowSampleData } = usePreferences();
  const showPreview = usePreviewNotice();
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [compat, setCompat] = useState<'all' | Compatibility>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<Robot | null>(null);

  const robots = useMemo(() => (sample ? sampleRobots : []), [sample]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return robots.filter(
      (r) =>
        (origin === 'all' || r.origin === origin) &&
        (compat === 'all' || r.compatibility === compat) &&
        (!q || `${r.name} ${r.style} ${r.symbols.join(' ')} ${r.summary}`.toLowerCase().includes(q)),
    );
  }, [robots, query, origin, compat]);

  const importRobot = () =>
    showPreview({
      title: 'Import robot',
      body: 'Importing will let you add an Expert Advisor file (.ex5 or .mq5) to your library. TradePilot will then check whether it can be tested safely.',
      requires: 'Robot storage and EA execution through the connector, planned for later phases (the connector is read-only today).',
    });

  return (
    <>
      <PageHeader
        title="My Robots"
        description={
          <>
            Your library of trading robots — also called <Term k="ea">Expert Advisors</Term>. Keep existing robots and your own custom
            strategies in one place, and see at a glance which have been tested.
          </>
        }
        actions={
          <>
            <Button variant="secondary" leadingIcon={<Upload />} onClick={importRobot}>
              Import robot
            </Button>
            <Button asChild variant="primary">
              <Link to="/strategy-lab">
                <Plus aria-hidden /> Create Strategy
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Ways to add a robot" className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <EntryCard
          icon={Library}
          title="Browse Existing Robots"
          text="Bring in a compatible Expert Advisor, including free ones you already have, and test it before trusting it."
          action={
            <Button variant="secondary" size="sm" onClick={importRobot}>
              Browse existing robots
            </Button>
          }
        />
        <EntryCard
          icon={Code2}
          title="Create a Custom Strategy"
          text="Describe your idea in plain English. Strategy Lab turns it into a written plan and, later, into robot code."
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/strategy-lab">
                Open Strategy Lab <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        />
      </section>

      {sample && (
        <SampleDataBanner className="mb-5">
          These four robots are invented examples. Nothing has been downloaded, installed, inspected or verified.
        </SampleDataBanner>
      )}

      <section aria-labelledby="library-title">
        <div className="mb-4 flex items-center gap-2">
          <h2 id="library-title" className="text-fg text-lg font-semibold">
            Library
          </h2>
          <span className="text-fg-3 num text-sm">{robots.length}</span>
          {sample && <PreviewTag />}
        </div>

        {robots.length > 0 && (
          <FilterBar
            className="mb-5"
            query={query}
            onQueryChange={setQuery}
            placeholder="Search robots by name, symbol or style"
            trailing={
              <SegmentedControl
                label="Layout"
                size="md"
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'grid', label: <LayoutGrid />, ariaLabel: 'Card view' },
                  { value: 'list', label: <List />, ariaLabel: 'List view' },
                ]}
              />
            }
          >
            <SegmentedControl
              label="Robot type"
              size="md"
              value={origin}
              onValueChange={setOrigin}
              options={[
                { value: 'all', label: 'All' },
                { value: 'existing', label: 'Existing' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <div className="w-44">
              <Select aria-label="Compatibility" value={compat} onChange={(e) => setCompat(e.target.value as typeof compat)}>
                <option value="all">Any compatibility</option>
                {(Object.keys(compatibilityInfo) as Compatibility[]).map((c) => (
                  <option key={c} value={c}>
                    {compatibilityInfo[c].label}
                  </option>
                ))}
              </Select>
            </div>
          </FilterBar>
        )}

        {robots.length === 0 ? (
          <div className="surface">
            <EmptyState
              size="lg"
              icon={Bot}
              title="Your robot library is empty"
              description="Robots you import or create will be listed here with their test results and demo status. A good first step is to describe a simple strategy in Strategy Lab."
              actions={
                <>
                  <Button asChild variant="primary">
                    <Link to="/strategy-lab">Create a Custom Strategy</Link>
                  </Button>
                  <Button variant="secondary" onClick={() => setShowSampleData(true)}>
                    Preview with sample robots
                  </Button>
                </>
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="surface">
            <EmptyState
              icon={SearchX}
              title="No robots match these filters"
              description="Try a different search term or clear the filters to see the full library."
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setOrigin('all');
                    setCompat('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : view === 'grid' ? (
          <motion.ul layout className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {filtered.map((r) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1, transition: transition.base }}
                  exit={{ opacity: 0, scale: 0.98, transition: transition.fast }}
                  className="flex"
                >
                  <div className="flex w-full flex-col [&>article]:flex-1">
                    <RobotCard robot={r} onView={setSelected} />
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        ) : (
          <div className="surface px-5 py-2">
            <DataTable
              caption="Robot library (sample data)"
              rows={filtered}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'name',
                  header: 'Robot',
                  cell: (r) => (
                    <button type="button" onClick={() => setSelected(r)} className="text-fg text-left font-medium hover:underline">
                      {r.name} <span className="text-fg-3 num font-normal">v{r.version}</span>
                    </button>
                  ),
                },
                { key: 'type', header: 'Type', hideBelow: 'md', cell: (r) => (r.origin === 'custom' ? 'Custom' : 'Existing') },
                { key: 'market', header: 'Market', hideBelow: 'lg', cell: (r) => `${r.symbols.join(', ')} · ${r.timeframe}` },
                {
                  key: 'compat',
                  header: 'Compatibility',
                  cell: (r) => <StatusBadge status={compatibilityInfo[r.compatibility].status}>{compatibilityInfo[r.compatibility].label}</StatusBadge>,
                },
                {
                  key: 'bt',
                  header: 'Last backtest',
                  align: 'right',
                  hideBelow: 'sm',
                  cell: (r) => (r.lastBacktest ? formatPercent(r.lastBacktest.netProfitPct, 1, true) : <span className="text-fg-3">—</span>),
                },
                {
                  key: 'demo',
                  header: 'Demo',
                  hideBelow: 'md',
                  cell: (r) => <StatusBadge status={demoStatusInfo[r.demoStatus].status}>{demoStatusInfo[r.demoStatus].label}</StatusBadge>,
                },
              ]}
            />
          </div>
        )}
      </section>

      <Callout tone="info" className="mt-8" title="How robots get into your library">
        TradePilot never downloads robots from the internet by itself. You choose what to add, and every robot is tested in the
        Strategy Tester before it can run on a demo account.
      </Callout>

      <RobotDetails robot={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function EntryCard({ icon: Icon, title, text, action }: { icon: typeof Bot; title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="border-line-soft bg-panel relative flex flex-col gap-4 overflow-hidden rounded-xl border p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="bg-accent-soft text-accent flex size-11 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-5" aria-hidden strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-fg text-md font-semibold">{title}</h2>
        <p className="text-fg-2 mt-1 text-sm leading-relaxed">{text}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function RobotDetails({ robot, onClose }: { robot: Robot | null; onClose: () => void }) {
  const navigate = useNavigate();
  const bt = robot?.lastBacktest;
  return (
    <Dialog
      open={!!robot}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        robot ? (
          <span className="flex flex-wrap items-center gap-2">
            {robot.name} <span className="text-fg-3 num font-normal">v{robot.version}</span> <PreviewTag />
          </span>
        ) : (
          ''
        )
      }
      description={robot ? `${robot.origin === 'custom' ? 'Custom strategy' : 'Existing robot'} · ${robot.style} · ${robot.symbols.join(', ')} ${robot.timeframe}` : undefined}
      footer={
        robot && (
          <>
            <Button variant="secondary" onClick={() => navigate('/ai-analyst')}>
              Ask the AI Analyst
            </Button>
            <Button variant="primary" onClick={() => navigate(`/backtesting?robot=${robot.id}`)}>
              Set up a backtest
            </Button>
          </>
        )
      }
    >
      {robot && (
        <div className="space-y-5">
          <div>
            <h3 className="eyebrow mb-1.5">How it trades, in plain English</h3>
            <p className="text-fg text-base leading-relaxed">{robot.summary}</p>
          </div>
          <div>
            <h3 className="eyebrow mb-2">Key characteristics</h3>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={riskInfo[robot.risk].tone} size="md">
                {riskInfo[robot.risk].label}
              </Badge>
              {robot.traits.map((t) => (
                <Badge key={t} size="md">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
          {robot.risk === 'high' && (
            <Callout tone="danger" icon={ShieldAlert} title="Why this robot is marked high risk">
              It adds to losing trades instead of closing them. This often looks smooth for months, then causes a very large loss in
              one bad market move.
            </Callout>
          )}
          <div>
            <h3 className="eyebrow mb-3">Last backtest</h3>
            {bt ? (
              <dl className="bg-sunken border-line-soft grid grid-cols-2 gap-5 rounded-lg border p-4 sm:grid-cols-4">
                <RiskMetric term="netProfit" value={formatPercent(bt.netProfitPct, 1, true)} />
                <RiskMetric term="drawdown" value={formatPercent(bt.maxDrawdownPct)} tone={bt.maxDrawdownPct > 25 ? 'negative' : 'neutral'} />
                <RiskMetric term="profitFactor" value={bt.profitFactor.toFixed(2)} />
                <RiskMetric label="Trades" value={bt.trades} />
              </dl>
            ) : (
              <p className="text-fg-3">This robot has not been tested yet.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
