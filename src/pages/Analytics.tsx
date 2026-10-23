import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CircleCheck, Scale, ShieldAlert, TrendingDown, TriangleAlert } from 'lucide-react';
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  InfoTip,
  PreviewTag,
  SampleDataBanner,
  SectionHeader,
  Select,
  Term,
} from '@/components/ui';
import { ChartContainer, ChartLegend } from '@/components/charts/ChartContainer';
import { ComparisonChart } from '@/components/charts/ComparisonChart';
import { DrawdownChart } from '@/components/charts/DrawdownChart';
import { RiskMetric } from '@/components/domain/RiskMetric';
import { PageHeader } from '@/components/layout/PageHeader';
import { glossary, type GlossaryKey } from '@/content/glossary';
import { sampleComparison, sampleComparisonEquity } from '@/data/sample';
import type { StrategyMetrics } from '@/data/types';
import { formatMoney, formatPercent } from '@/lib/format';
import { usePreferences } from '@/lib/preferences';

interface Warning {
  severity: 'high' | 'medium';
  title: string;
  text: string;
}

/** Plain-language risk checks. Thresholds are deliberately simple and explainable. */
function riskWarnings(m: StrategyMetrics): Warning[] {
  const w: Warning[] = [];
  if (m.maxDrawdownPct > 25)
    w.push({ severity: 'high', title: 'Very deep drawdown', text: `At its worst the account fell ${formatPercent(m.maxDrawdownPct)} from its peak. Few people can sit through that calmly.` });
  if (Math.abs(m.avgLoss) > 3 * m.avgWin)
    w.push({ severity: 'high', title: 'Losses dwarf wins', text: `An average loss is ${(Math.abs(m.avgLoss) / m.avgWin).toFixed(1)}× an average win. The high win rate hides this.` });
  if (m.exposurePct > 5)
    w.push({ severity: 'medium', title: 'High exposure', text: `Up to ${m.exposurePct}% of the balance is at risk at once, often in several trades.` });
  if (m.profitFactor < 1.2)
    w.push({ severity: 'medium', title: 'Thin profit margin', text: `A profit factor of ${m.profitFactor.toFixed(2)} leaves little room for higher costs or worse market conditions.` });
  if (m.longestLosingStreak >= 7)
    w.push({ severity: 'medium', title: 'Long losing streaks', text: `Expect runs of up to ${m.longestLosingStreak} losing trades in a row.` });
  return w;
}

const metricRows: { key: string; term: GlossaryKey; label: string; render: (m: StrategyMetrics) => string }[] = [
  { key: 'np', term: 'netProfit', label: 'Net profit', render: (m) => formatPercent(m.netProfitPct, 1, true) },
  { key: 'dd', term: 'drawdown', label: 'Maximum drawdown', render: (m) => formatPercent(m.maxDrawdownPct) },
  { key: 'pf', term: 'profitFactor', label: 'Profit factor', render: (m) => m.profitFactor.toFixed(2) },
  { key: 'wr', term: 'winRate', label: 'Win rate', render: (m) => `${m.winRate}%` },
  { key: 'aw', term: 'avgWinLoss', label: 'Average win / loss', render: (m) => `${formatMoney(m.avgWin)} / ${formatMoney(m.avgLoss)}` },
  { key: 'tc', term: 'tradingCosts', label: 'Trading costs', render: (m) => formatMoney(m.costs, 'USD', { maximumFractionDigits: 0, minimumFractionDigits: 0 }) },
  { key: 'ex', term: 'exposure', label: 'Peak exposure', render: (m) => `${m.exposurePct.toFixed(1)}%` },
  { key: 'ls', term: 'losingStreak', label: 'Longest losing streak', render: (m) => `${m.longestLosingStreak} trades` },
];

export default function AnalyticsPage() {
  const { showSampleData: sample } = usePreferences();
  const [selectedId, setSelectedId] = useState(sampleComparison[0].id);
  const selected = sampleComparison.find((s) => s.id === selectedId)!;
  const warnings = useMemo(() => riskWarnings(selected), [selected]);
  const series = sampleComparison.map((s) => ({ id: s.id, name: s.name, color: s.color, points: sampleComparisonEquity[s.id] }));

  const header = (
    <PageHeader
      title="Analytics & Risk"
      description="Judge a strategy by how it makes money, not just how much. Risk, costs and consistency tell you far more than profit alone."
    />
  );

  if (!sample) {
    return (
      <>
        {header}
        <div className="surface">
          <EmptyState
            size="lg"
            icon={BarChart3}
            title="No test results to analyse yet"
            description="Analytics compares robots once at least one backtest or demo period has been recorded. You will see drawdown, costs, losing streaks and plain-language risk warnings here."
            actions={
              <Button asChild variant="primary">
                <Link to="/backtesting">Set up a backtest</Link>
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <SampleDataBanner className="mb-6">The three strategies below are invented to show how comparison and risk warnings will work.</SampleDataBanner>

      <Callout tone="info" icon={Scale} className="mb-6" title="Why win rate is not enough">
        Grid Recovery wins 88% of its trades, yet it carries by far the largest drawdown. A few large losses can erase many small
        wins — always read win rate alongside <Term k="drawdown">maximum drawdown</Term> and <Term k="avgWinLoss">average win / loss</Term>.
      </Callout>

      <ChartContainer
        className="mb-6"
        title="Strategy comparison"
        sample
        explanation="Return over the same year, starting from zero for each strategy so they can be compared fairly."
        legend={<ChartLegend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
        height={320}
        table={
          <DataTable
            dense
            caption="Total return by strategy (sample data)"
            rows={sampleComparison}
            rowKey={(m) => m.id}
            columns={[
              { key: 'n', header: 'Strategy', cell: (m) => <span className="text-fg">{m.name}</span> },
              { key: 'r', header: 'Net profit', align: 'right', cell: (m) => formatPercent(m.netProfitPct, 1, true) },
              { key: 'd', header: 'Max drawdown', align: 'right', cell: (m) => formatPercent(m.maxDrawdownPct) },
            ]}
          />
        }
      >
        <ComparisonChart series={series} />
      </ChartContainer>

      <section aria-labelledby="metrics-title" className="surface mb-6 p-5 sm:p-6">
        <SectionHeader
          id="metrics-title"
          title={
            <>
              Side-by-side metrics <PreviewTag />
            </>
          }
          description="Tap the information icon beside any measure for a plain-English explanation."
        />
        <DataTable
          caption="Strategy metrics comparison (sample data)"
          rows={metricRows}
          rowKey={(r) => r.key}
          columns={[
            {
              key: 'metric',
              header: 'Measure',
              cell: (r) => (
                <span className="text-fg flex items-center gap-1 whitespace-nowrap">
                  {r.label}
                  <InfoTip title={glossary[r.term].term}>{glossary[r.term].definition}</InfoTip>
                </span>
              ),
            },
            ...sampleComparison.map((s) => ({
              key: s.id,
              align: 'right' as const,
              header: (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.name.replace(/ v[\d.]+$/, '')}
                </span>
              ),
              cell: (r: (typeof metricRows)[number]) => <span className="text-fg-2">{r.render(s)}</span>,
            })),
          ]}
        />
      </section>

      <section aria-labelledby="deep-title">
        <SectionHeader
          id="deep-title"
          title="Risk profile"
          description="A closer look at one strategy: how deep it fell, how long it suffered and what to watch out for."
          actions={
            <div className="w-64">
              <Select aria-label="Strategy to inspect" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {sampleComparison.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="surface min-w-0 p-5 sm:p-6">
            <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <RiskMetric term="drawdown" value={formatPercent(selected.maxDrawdownPct)} tone={selected.maxDrawdownPct > 25 ? 'negative' : 'neutral'} />
              <RiskMetric term="profitFactor" value={selected.profitFactor.toFixed(2)} />
              <RiskMetric term="winRate" value={`${selected.winRate}%`} />
              <RiskMetric term="losingStreak" value={selected.longestLosingStreak} reading="trades in a row" />
              <RiskMetric term="avgWinLoss" label="Average win" value={formatMoney(selected.avgWin)} />
              <RiskMetric label="Average loss" value={formatMoney(selected.avgLoss)} />
              <RiskMetric term="tradingCosts" value={formatMoney(selected.costs, 'USD', { maximumFractionDigits: 0, minimumFractionDigits: 0 })} reading={`over ${selected.trades} trades`} />
              <RiskMetric term="exposure" value={`${selected.exposurePct.toFixed(1)}%`} reading="peak share of balance at risk" />
            </dl>
            <div className="border-line-soft mt-6 border-t pt-5">
              <h3 className="text-fg flex items-center gap-2 text-sm font-semibold">
                <TrendingDown className="text-fg-3 size-4" aria-hidden /> Drawdown over time
              </h3>
              <p className="text-fg-3 mt-0.5 text-xs">How far below its previous best the account was on each day. Zero means a new high.</p>
              <div className="mt-4 h-52">
                <DrawdownChart points={sampleComparisonEquity[selected.id]} />
              </div>
            </div>
          </div>

          <div className="surface p-5 sm:p-6">
            <h3 className="text-fg flex items-center gap-2 text-md font-semibold">
              <ShieldAlert className="text-fg-3 size-[18px]" aria-hidden /> Risk warnings
            </h3>
            <p className="text-fg-3 mt-1 text-xs">Automatic checks against simple, transparent rules.</p>
            {warnings.length ? (
              <ul className="mt-4 space-y-3">
                {warnings.map((w) => (
                  <li key={w.title} className="bg-sunken border-line-soft flex gap-3 rounded-lg border p-3.5">
                    <TriangleAlert className={w.severity === 'high' ? 'text-negative mt-0.5 size-4 shrink-0' : 'text-warning mt-0.5 size-4 shrink-0'} aria-hidden />
                    <div>
                      <p className="text-fg text-sm font-medium">
                        <span className="sr-only">{w.severity === 'high' ? 'High severity: ' : 'Medium severity: '}</span>
                        {w.title}
                        <span className={w.severity === 'high' ? 'text-negative ml-2 text-xs' : 'text-warning ml-2 text-xs'} aria-hidden>
                          {w.severity === 'high' ? 'High' : 'Medium'}
                        </span>
                      </p>
                      <p className="text-fg-2 mt-0.5 text-sm leading-relaxed">{w.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="bg-sunken border-line-soft mt-4 flex gap-3 rounded-lg border p-3.5">
                <CircleCheck className="text-positive mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="text-fg-2 text-sm">No rule-based warnings for this strategy. That does not make it safe — keep testing.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
