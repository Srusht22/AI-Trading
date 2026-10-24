import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarRange, FileBarChart2, History, Play, ScrollText, SlidersHorizontal } from 'lucide-react';
import {
  Button,
  Callout,
  EmptyState,
  FormField,
  InfoTip,
  Input,
  PreviewTag,
  SampleDataBanner,
  SectionHeader,
  Select,
  TabPanel,
  Tabs,
  Term,
} from '@/components/ui';
import { ChartLegend } from '@/components/charts/ChartContainer';
import { EquityChart, equityLegend } from '@/components/charts/EquityChart';
import { RiskMetric } from '@/components/domain/RiskMetric';
import { LogList } from '@/components/domain/LogList';
import { PageHeader } from '@/components/layout/PageHeader';
import { glossary } from '@/content/glossary';
import { maxDrawdownPct, sampleBacktestEquity, sampleBacktestLog, sampleRobots } from '@/data/sample';
import { formatMoney, formatPercent } from '@/lib/format';
import { usePreferences } from '@/lib/preferences';
import { usePreviewNotice } from '@/lib/previewNotice';

const testModels = [
  { value: 'real-ticks', label: 'Every tick based on real ticks', hint: 'Most realistic, slowest. Recommended for final checks.' },
  { value: 'every-tick', label: 'Every tick (generated)', hint: 'Simulates price movement inside each bar. Good balance.' },
  { value: 'ohlc-m1', label: '1-minute OHLC', hint: 'Faster, uses 4 prices per minute. Fine for early exploration.' },
  { value: 'open-prices', label: 'Open prices only', hint: 'Fastest and roughest. Only for robots that act at bar open.' },
];

const defaultParams = [
  { id: 'fast', label: 'Fast average length', value: '20', suffix: 'bars', help: 'How many recent bars the quick-reacting average uses.' },
  { id: 'slow', label: 'Slow average length', value: '50', suffix: 'bars', help: 'How many bars the slower, smoother average uses.' },
  { id: 'sl', label: 'Stop-loss distance', value: '40', suffix: 'pips', help: glossary.stopLoss.definition },
  { id: 'risk', label: 'Risk per trade', value: '1.0', suffix: '%', help: 'Share of the balance the robot may lose on a single trade.' },
];

interface Errors {
  robot?: string;
  dates?: string;
  deposit?: string;
}

export default function BacktestingPage() {
  const { showSampleData: sample } = usePreferences();
  const showPreview = usePreviewNotice();
  const [params] = useSearchParams();
  const robots = sample ? sampleRobots : [];
  const [robotId, setRobotId] = useState(() => params.get('robot') ?? (sample ? sampleRobots[0].id : ''));
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('H1');
  const [from, setFrom] = useState('2025-10-01');
  const [to, setTo] = useState('2026-09-30');
  const [deposit, setDeposit] = useState('10000');
  const [model, setModel] = useState(testModels[0].value);
  const [values, setValues] = useState(() => Object.fromEntries(defaultParams.map((p) => [p.id, p.value])));
  const [errors, setErrors] = useState<Errors>({});
  const [tab, setTab] = useState<'summary' | 'equity' | 'logs'>('summary');

  const validRobot = robots.some((r) => r.id === robotId);

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!validRobot) next.robot = 'Choose a robot to test.';
    if (!from || !to || from >= to) next.dates = 'The start date must be before the end date.';
    const dep = Number(deposit);
    if (!Number.isFinite(dep) || dep < 100) next.deposit = 'Enter a virtual deposit of at least 100.';
    setErrors(next);
    if (Object.keys(next).length) return;
    showPreview({
      title: 'Run Backtest',
      body: 'Backtests will run in the MetaTrader 5 Strategy Tester on your computer or VPS. Results will appear in the report on this page.',
      notDone: 'No backtest was started. Your settings were checked in the browser only.',
      requires: 'Backtest execution through the connector (later phase — today it only reads your demo account and prices).',
    });
  };

  return (
    <>
      <PageHeader
        title="Backtesting"
        description={
          <>
            A <Term k="backtest">backtest</Term> replays historical prices to show how a robot would have traded in the past. It is
            useful evidence — but past results never guarantee future ones.
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <form onSubmit={run} noValidate className="surface p-5 sm:p-6 xl:sticky xl:top-[calc(var(--tp-header-height)+24px)]" aria-labelledby="config-title">
          <SectionHeader
            id="config-title"
            title={
              <>
                <SlidersHorizontal className="text-fg-3 size-[18px]" aria-hidden /> Test setup
              </>
            }
            description="Choose what to test and under which conditions."
          />
          <div className="space-y-4">
            <FormField label="Robot" error={errors.robot} hint={!robots.length ? 'Your library is empty — add a robot first.' : undefined}>
              <Select value={validRobot ? robotId : ''} onChange={(e) => setRobotId(e.target.value)} disabled={!robots.length}>
                <option value="" disabled>
                  {robots.length ? 'Select a robot' : 'No robots available'}
                </option>
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} v{r.version} (sample)
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Symbol" labelAddon={<InfoTip title="Symbol">{glossary.symbol.definition}</InfoTip>}>
                <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  {['EURUSD', 'GBPUSD', 'USDJPY', 'EURCHF', 'AUDCAD'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Timeframe" labelAddon={<InfoTip title="Timeframe">{glossary.timeframe.definition}</InfoTip>}>
                <Select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                  {['M15', 'M30', 'H1', 'H4', 'D1'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </FormField>
            </div>
            <fieldset>
              <legend className="text-fg mb-1.5 flex items-center gap-1 text-sm font-medium">
                <CalendarRange className="text-fg-3 size-4" aria-hidden /> Historical date range
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Input type="date" aria-label="Start date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!errors.dates || undefined} />
                <Input type="date" aria-label="End date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.dates || undefined} />
              </div>
              {errors.dates && (
                <p role="alert" className="text-negative mt-1.5 text-xs font-medium">
                  {errors.dates}
                </p>
              )}
            </fieldset>
            <FormField label="Initial virtual deposit" error={errors.deposit} hint="Pretend money the test starts with.">
              <Input type="number" inputMode="decimal" min={100} step={100} value={deposit} onChange={(e) => setDeposit(e.target.value)} trailing="USD" />
            </FormField>
            <FormField
              label="Test model"
              labelAddon={<InfoTip title={glossary.testModel.term} more={glossary.testModel.more}>{glossary.testModel.definition}</InfoTip>}
              hint={testModels.find((m) => m.value === model)?.hint}
            >
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {testModels.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <details className="border-line-soft group rounded-lg border" open={validRobot}>
              <summary className="text-fg flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Strategy parameters
                <span className="text-fg-3 text-xs font-normal group-open:hidden">Show</span>
                <span className="text-fg-3 hidden text-xs font-normal group-open:inline">Hide</span>
              </summary>
              <div className="border-line-soft space-y-3 border-t p-3.5">
                {validRobot ? (
                  defaultParams.map((p) => (
                    <FormField key={p.id} label={p.label} labelAddon={<InfoTip title={p.label}>{p.help}</InfoTip>}>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={values[p.id]}
                        onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                        trailing={p.suffix}
                      />
                    </FormField>
                  ))
                ) : (
                  <p className="text-fg-3 text-sm">Select a robot to see its settings.</p>
                )}
              </div>
            </details>

            <Button type="submit" variant="primary" size="lg" className="w-full" leadingIcon={<Play />}>
              Run Backtest
            </Button>
            <p className="text-fg-3 text-center text-xs">Runs in MT5 once connected · preview only for now</p>
          </div>
        </form>

        <Report sample={sample} tab={tab} setTab={setTab} />
      </div>
    </>
  );
}

function Report({ sample, tab, setTab }: { sample: boolean; tab: 'summary' | 'equity' | 'logs'; setTab: (t: 'summary' | 'equity' | 'logs') => void }) {
  const equity = sampleBacktestEquity;
  if (!sample) {
    return (
      <section className="surface" aria-label="Backtest report">
        <EmptyState
          size="lg"
          icon={History}
          title="No backtests yet"
          description="Backtesting lets you see how a trading strategy would have performed using historical market data. Select a robot and configure your first test to get started."
          actions={
            <Button asChild variant="secondary">
              <Link to="/robots">Explore Robots</Link>
            </Button>
          }
        />
      </section>
    );
  }
  const start = equity[0].equity;
  const end = equity[equity.length - 1].equity;
  const dd = maxDrawdownPct(equity);
  return (
    <section className="surface min-w-0 p-5 sm:p-6" aria-labelledby="report-title">
      <SampleDataBanner className="mb-5">This report is an invented example of what a finished backtest will look like.</SampleDataBanner>
      <SectionHeader
        id="report-title"
        eyebrow={<span className="eyebrow">Latest report</span>}
        title={
          <>
            <FileBarChart2 className="text-fg-3 size-[18px]" aria-hidden /> MA Crossover Trend v1.2 <PreviewTag />
          </>
        }
        description="EURUSD · H1 · Oct 1, 2025 – Sep 30, 2026 · Every tick based on real ticks · $10,000 virtual deposit"
      />
      <Tabs
        label="Report sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'summary', label: 'Summary' },
          { value: 'equity', label: 'Equity curve' },
          { value: 'logs', label: 'Test log', count: sampleBacktestLog.length },
        ]}
      >
        <TabPanel value="summary" className="pt-6 outline-none">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <RiskMetric term="netProfit" value={formatMoney(end - start)} reading={`${formatPercent(((end - start) / start) * 100, 1, true)} on the deposit`} />
            <RiskMetric term="drawdown" value={formatPercent(dd)} reading={`At worst, ${formatPercent(dd)} below its previous high.`} tone="warning" />
            <RiskMetric term="profitFactor" value="1.38" reading="$1.38 won for every $1 lost." />
            <RiskMetric label="Total trades" value="212" reading="Enough trades for a first impression." />
          </dl>
          <div className="mt-6 h-56">
            <EquityChart data={equity} showBalance={false} sample />
          </div>
          <Callout tone="info" className="mt-6" title="Before you trust this result">
            Check that the test period includes different market conditions, that trading costs were realistic, and that the
            settings were not tuned to fit this exact period. A <Term k="forwardTest">forward test</Term> is the next step.
          </Callout>
        </TabPanel>
        <TabPanel value="equity" className="pt-6 outline-none">
          <ChartLegend items={equityLegend()} className="mb-4" />
          <div className="h-80">
            <EquityChart data={equity} sample />
          </div>
        </TabPanel>
        <TabPanel value="logs" className="pt-6 outline-none">
          <div className="mb-3 flex items-center gap-2">
            <ScrollText className="text-fg-3 size-4" aria-hidden />
            <p className="text-fg-2 text-sm">Messages from the Strategy Tester while the test ran.</p>
          </div>
          <LogList lines={sampleBacktestLog} label="Backtest log (sample data)" />
        </TabPanel>
      </Tabs>
    </section>
  );
}
