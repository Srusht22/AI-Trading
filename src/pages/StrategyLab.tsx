import { useState, type ReactNode } from 'react';
import {
  CheckCheck,
  Code2,
  Copy,
  Cpu,
  FileText,
  FlaskConical,
  History,
  Lightbulb,
  PlayCircle,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  DataTable,
  EmptyState,
  FormField,
  PreviewTag,
  SectionHeader,
  Select,
  StatusBadge,
  Term,
  Textarea,
  type Status,
} from '@/components/ui';
import { WorkflowSteps, type WorkflowStep } from '@/components/domain/WorkflowSteps';
import { PageHeader } from '@/components/layout/PageHeader';
import { sampleMql5, sampleStrategyVersions } from '@/data/sample';
import type { StrategyVersion } from '@/data/types';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/lib/preferences';
import { usePreviewNotice } from '@/lib/previewNotice';
import { useToast } from '@/lib/toast';

const steps: WorkflowStep[] = [
  { id: 'idea', label: 'Idea', description: 'Describe the strategy in your own words.', icon: Lightbulb },
  { id: 'spec', label: 'Specification', description: 'Exact rules for entries, exits and risk.', icon: FileText },
  { id: 'code', label: 'MQL5 code', description: 'The rules written as an Expert Advisor.', icon: Code2 },
  { id: 'compile', label: 'Compile', description: 'MT5 checks the code can run.', icon: Cpu },
  { id: 'backtest', label: 'Backtest', description: 'Replay it on historical prices.', icon: History },
  { id: 'review', label: 'Review', description: 'Study risk, costs and weaknesses.', icon: ScanSearch },
  { id: 'approve', label: 'Your approval', description: 'Nothing runs until you say so.', icon: UserCheck, human: true },
  { id: 'demo', label: 'Demo trading', description: 'Trade virtual money in real time.', icon: PlayCircle },
];

const examples = [
  'Create a simple moving-average crossover strategy for EURUSD, with a configurable stop-loss and clear position-sizing rules.',
  'Trade the breakout of the Asian session range on GBPUSD during the London open, and close all trades before New York.',
  'Buy EURCHF when RSI on the 4-hour chart drops below 30 and sell when it rises above 70, risking no more than 0.5% per trade.',
];

const MIN_LENGTH = 30;

const versionStatus: Record<StrategyVersion['status'], { status: Status; label: string }> = {
  draft: { status: 'idle', label: 'Draft' },
  spec_ready: { status: 'info', label: 'Specification ready' },
  code_preview: { status: 'pending', label: 'Code awaiting test' },
  tested: { status: 'success', label: 'Backtested' },
};

export default function StrategyLabPage() {
  const { showSampleData: sample } = usePreferences();
  const showPreview = usePreviewNotice();
  const toast = useToast();
  const [idea, setIdea] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('H1');
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (idea.trim().length < MIN_LENGTH) {
      setError(`Describe your idea in a little more detail — at least ${MIN_LENGTH} characters.`);
      return;
    }
    setError(undefined);
    showPreview({
      title: 'Draft specification',
      body: 'In a later phase, the AI assistant will turn your description into a precise specification you can read, edit and approve before any code is written.',
      notDone: 'Your description was not sent anywhere and no AI service was contacted. It stays in this browser tab only.',
      requires: 'A configured AI provider (Phase 2 or later).',
    });
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(sampleMql5);
      toast({ tone: 'success', title: 'Sample code copied', description: 'Remember: this is illustrative code that has not been compiled or tested.' });
    } catch {
      toast({ tone: 'error', title: 'Could not copy', description: 'Your browser blocked clipboard access. Select the code and copy it manually.' });
    }
  };

  return (
    <>
      <PageHeader
        title="Strategy Lab"
        description={
          <>
            Describe a trading idea in your own words. Strategy Lab helps turn it into a clear written plan, then into an{' '}
            <Term k="ea">Expert Advisor</Term> that you test thoroughly before using.
          </>
        }
      />

      <section aria-labelledby="workflow-title" className="mb-10">
        <SectionHeader
          id="workflow-title"
          title="From idea to tested robot"
          description="Every strategy follows the same eight stages. You are always at stage one until you start."
        />
        <WorkflowSteps steps={steps} current={0} />
      </section>

      <Callout tone="warning" icon={TriangleAlert} className="mb-8" title="A description is a starting point, not a profitable robot">
        Writing down an idea does not create a verified strategy. AI-generated code can contain mistakes and must be compiled,
        backtested and reviewed by you before it is allowed to run, even on a demo account.
      </Callout>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="idea-title" className="surface p-5 sm:p-6">
          <SectionHeader
            id="idea-title"
            title={
              <>
                <Lightbulb className="text-accent size-[18px]" aria-hidden /> Describe your idea
              </>
            }
            description="Say what should trigger a trade, when to exit, and how much to risk. Plain English is perfect."
          />
          <form onSubmit={submit} noValidate className="space-y-5">
            <FormField
              label="Strategy description"
              error={error}
              hint={`${idea.trim().length} characters · at least ${MIN_LENGTH} needed`}
            >
              <Textarea
                value={idea}
                onChange={(e) => {
                  setIdea(e.target.value);
                  if (error && e.target.value.trim().length >= MIN_LENGTH) setError(undefined);
                }}
                rows={5}
                placeholder="For example: Buy when the 20-period average crosses above the 50-period average…"
              />
            </FormField>

            <div>
              <p className="text-fg-2 mb-2 text-sm font-medium">Need inspiration? Start from an example</p>
              <ul className="space-y-2">
                {examples.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      onClick={() => {
                        setIdea(ex);
                        setError(undefined);
                      }}
                      className="border-line-soft bg-sunken hover:border-line hover:bg-raised-hover text-fg-2 hover:text-fg flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm leading-relaxed transition-colors"
                    >
                      <Sparkles className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{ex}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={<Term k="symbol">Market (symbol)</Term>}>
                <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  {['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'EURCHF', 'USDCAD'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={<Term k="timeframe">Chart timeframe</Term>}>
                <Select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                  {[
                    ['M15', '15 minutes (M15)'],
                    ['H1', '1 hour (H1)'],
                    ['H4', '4 hours (H4)'],
                    ['D1', '1 day (D1)'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="border-line-soft flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="text-fg-3 flex items-center gap-1.5 text-xs">
                <ShieldCheck className="size-3.5" aria-hidden /> Preview only — nothing is sent to an AI service.
              </p>
              <Button type="submit" variant="primary" leadingIcon={<FlaskConical />}>
                Create Strategy
              </Button>
            </div>
          </form>
        </section>

        <SpecPreview sample={sample} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="versions-title" className="surface p-5 sm:p-6">
          <SectionHeader
            id="versions-title"
            as="h2"
            title={
              <>
                Strategy versions {sample && <PreviewTag />}
              </>
            }
            description="Each change creates a new version, so you can always compare against what came before."
          />
          {sample ? (
            <DataTable
              caption="Strategy versions (sample data)"
              rows={sampleStrategyVersions}
              rowKey={(v) => v.id}
              columns={[
                { key: 'v', header: 'Version', cell: (v) => <span className="text-fg num font-medium">{v.version}</span> },
                { key: 't', header: 'Change', cell: (v) => <span className="line-clamp-2">{v.title}</span> },
                { key: 's', header: 'Status', cell: (v) => <StatusBadge status={versionStatus[v.status].status}>{versionStatus[v.status].label}</StatusBadge> },
              ]}
            />
          ) : (
            <EmptyState size="sm" icon={History} title="No versions yet" description="Versions appear once you create your first strategy." />
          )}
        </section>

        <section aria-labelledby="code-title" className="surface flex min-w-0 flex-col p-5 sm:p-6">
          <SectionHeader
            id="code-title"
            as="h2"
            title={
              <>
                <Term k="mql5">MQL5 source code</Term> {sample && <PreviewTag />}
              </>
            }
            description="The robot’s instructions in MetaTrader’s programming language. You never need to edit this yourself."
            actions={
              sample && (
                <Button size="sm" variant="ghost" leadingIcon={<Copy />} onClick={copyCode}>
                  Copy
                </Button>
              )
            }
          />
          {sample ? (
            <>
              <CodeBlock code={sampleMql5} />
              <p className="text-fg-3 mt-3 flex items-center gap-1.5 text-xs">
                <TriangleAlert className="text-warning size-3.5" aria-hidden /> Illustrative sample — not generated, not compiled, not tested.
              </p>
            </>
          ) : (
            <EmptyState
              size="sm"
              icon={Code2}
              title="No code yet"
              description="Code is produced only after you approve a specification. It is always compiled and backtested before use."
            />
          )}
        </section>
      </div>
    </>
  );
}

function SpecPreview({ sample }: { sample: boolean }) {
  const rows: { label: ReactNode; value: ReactNode }[] = [
    { label: 'Market', value: 'EURUSD on the 1-hour chart (H1)' },
    { label: 'Entry', value: 'Buy when the 20-period average crosses above the 50-period average. Sell on the opposite cross.' },
    { label: 'Exit', value: 'Close on the opposite crossover, or when the stop-loss is hit.' },
    { label: <Term k="stopLoss" />, value: '40 pips, adjustable.' },
    { label: <Term k="positionSizing" />, value: 'Risk 1% of the balance per trade. Only one trade open at a time.' },
  ];
  return (
    <section aria-labelledby="spec-title" className="surface flex flex-col p-5 sm:p-6">
      <SectionHeader
        id="spec-title"
        title={
          <>
            <FileText className="text-fg-3 size-[18px]" aria-hidden /> Specification preview {sample && <PreviewTag />}
          </>
        }
        description="A precise, readable version of the idea. You check this before any code is written."
      />
      {sample ? (
        <div className="flex flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-fg text-md font-semibold">MA Crossover Trend</h3>
            <Badge tone="info">v1.3 draft</Badge>
          </div>
          <dl className="divide-line-soft border-line-soft divide-y border-y">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[9.5rem_1fr] sm:gap-4">
                <dt className="text-fg-3 text-sm">{r.label}</dt>
                <dd className="text-fg text-sm leading-relaxed">{r.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="bg-sunken border-line-soft rounded-lg border p-3.5">
              <p className="text-fg flex items-center gap-1.5 text-sm font-medium">
                <CheckCheck className="text-accent size-4" aria-hidden /> Assumptions
              </p>
              <ul className="text-fg-2 mt-1.5 list-disc space-y-1 pl-5 text-sm">
                <li>Spread stays below 2 pips</li>
                <li>No trading during major news</li>
              </ul>
            </div>
            <div className="bg-sunken border-line-soft rounded-lg border p-3.5">
              <p className="text-fg flex items-center gap-1.5 text-sm font-medium">
                <Lightbulb className="text-warning size-4" aria-hidden /> Open questions
              </p>
              <ul className="text-fg-2 mt-1.5 list-disc space-y-1 pl-5 text-sm">
                <li>Should the stop move to break-even?</li>
                <li>Trade on Fridays?</li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="Your specification will appear here"
          description="Once AI assistance is connected, your description becomes a set of exact rules — entries, exits, risk and assumptions — for you to review."
        />
      )}
    </section>
  );
}

const TOKENS =
  /(#\w+|\b(?:input|int|double|void|return|if|else|for|while|bool|string|CTrade|INIT_FAILED|INIT_SUCCEEDED|INVALID_HANDLE|PERIOD_H1|MODE_EMA|PRICE_CLOSE)\b)|(\b\d+(?:\.\d+)?\b)|(<[^>]+>)/g;

/** Minimal, dependency-free MQL5 highlighting for read-only previews. */
function CodeBlock({ code }: { code: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label="MQL5 sample code"
      className="bg-sunken border-line-soft text-fg-2 max-h-[22rem] min-w-0 overflow-auto rounded-lg border p-4 font-mono text-[12.5px] leading-relaxed"
    >
      <code>
        {code.split('\n').map((line, i) => (
          <div key={i} className="flex">
            <span className="text-fg-disabled w-8 shrink-0 pr-3 text-right select-none" aria-hidden>
              {i + 1}
            </span>
            <span className="whitespace-pre">{highlight(line)}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

function highlight(line: string): ReactNode {
  const commentAt = line.indexOf('//');
  const codePart = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : '';
  const parts: ReactNode[] = [];
  let last = 0;
  codePart.replace(TOKENS, (m, kw, num, inc, offset: number) => {
    parts.push(codePart.slice(last, offset));
    parts.push(
      <span key={offset} className={cn(kw ? 'text-accent-2' : num ? 'text-warning' : inc ? 'text-accent' : '')}>
        {m}
      </span>,
    );
    last = offset + m.length;
    return m;
  });
  parts.push(codePart.slice(last));
  if (comment) parts.push(<span key="c" className="text-fg-3 italic">{comment}</span>);
  return parts;
}
