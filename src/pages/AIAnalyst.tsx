import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, Database, FileBarChart2, Lightbulb, Paperclip, SendHorizontal, Sparkles, UserRound } from 'lucide-react';
import { Badge, Button, IconButton, PreviewTag, StatusBadge } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/cn';
import { transition } from '@/lib/motion';
import { usePreferences } from '@/lib/preferences';
import { usePreviewNotice } from '@/lib/previewNotice';

const exampleQuestions = [
  'Explain the results of my latest backtest.',
  'Why did this strategy experience a large drawdown?',
  'Compare these two robot versions.',
  'Explain profit factor in simple English.',
  'What should I investigate before trusting this result?',
];

type Message =
  | { id: string; role: 'user'; text: string; attachment?: string; sample?: boolean }
  | { id: string; role: 'assistant'; content: ReactNode; sample?: boolean }
  | { id: string; role: 'undelivered'; text: string };

const sampleConversation: Message[] = [
  {
    id: 's1',
    role: 'user',
    sample: true,
    text: 'Why did MA Crossover Trend v1.2 have its biggest drawdown?',
    attachment: 'Backtest report · MA Crossover Trend v1.2',
  },
  {
    id: 's2',
    role: 'assistant',
    sample: true,
    content: (
      <div className="space-y-4">
        <AnswerSection kind="fact" title="From your recorded data">
          <ul className="list-disc space-y-1 pl-5">
            <li>The largest fall from a peak happened between late spring and early summer of the test period.</li>
            <li>Seven losing trades in a row occurred during that stretch — the longest streak in the test.</li>
            <li>Average spread was higher than in the rest of the test.</li>
          </ul>
        </AnswerSection>
        <AnswerSection kind="hypothesis" title="Possible explanations (not yet verified)">
          <p>
            Moving-average crossovers struggle when price moves sideways: averages cross often and each signal is quickly reversed.
            That period may have been a sideways market.
          </p>
        </AnswerSection>
        <AnswerSection kind="suggestion" title="What you could test next">
          <p>Run a backtest that skips trades when the market is ranging, and compare its drawdown with this version.</p>
        </AnswerSection>
      </div>
    ),
  },
];

export default function AIAnalystPage() {
  const { showSampleData: sample } = usePreferences();
  const showPreview = usePreviewNotice();
  const [draft, setDraft] = useState('');
  const [local, setLocal] = useState<Message[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = [...(sample ? sampleConversation : []), ...local];

  useEffect(() => {
    if (local.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [local.length]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const id = String(Date.now());
    // Phase 1: the message is kept locally and never sent to any service.
    setLocal((m) => [...m, { id, role: 'user', text }, { id: `${id}-u`, role: 'undelivered', text }]);
    setDraft('');
  };

  const attach = () =>
    showPreview({
      title: 'Attach a report',
      body: 'You will be able to attach a backtest report, robot version or demo period so the analyst answers from your actual data.',
      requires: 'Recorded backtests and a configured AI service.',
    });

  return (
    <>
      <PageHeader
        title="AI Analyst"
        description="Ask questions about your results in plain English. The analyst separates facts from your data from its own suggestions, so you always know what is proven."
        actions={<StatusBadge status="not_configured" size="md">AI service not configured</StatusBadge>}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Conversation" className="surface flex min-h-[36rem] min-w-0 flex-col xl:h-[calc(100dvh-var(--tp-header-height)-220px)]">
          <div className="border-line-soft flex items-center justify-between gap-3 border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="brand-gradient flex size-7 items-center justify-center rounded-md">
                <Sparkles className="text-accent-ink size-3.5" aria-hidden />
              </span>
              <span className="text-fg text-sm font-medium">TradePilot Analyst</span>
            </div>
            {sample ? <PreviewTag kind="preview" /> : <Badge>Not connected</Badge>}
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6" role="log" aria-live="polite" aria-label="Messages">
            <AssistantBubble>
              <p className="text-fg">Hello — I’m your research analyst.</p>
              <p className="mt-1.5">
                Once connected, I will explain backtest results, investigate drawdowns and compare robot versions. I only state facts
                that come from your recorded data, and I label everything else as a suggestion.
              </p>
              <p className="text-fg-3 mt-3 text-xs">This greeting is part of the interface. No AI is connected yet.</p>
            </AssistantBubble>

            {sample && (
              <div className="flex items-center gap-3" aria-hidden>
                <span className="bg-line-soft h-px flex-1" />
                <span className="text-accent-2 text-2xs font-semibold tracking-wider uppercase">UI preview conversation</span>
                <span className="bg-line-soft h-px flex-1" />
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.base }}>
                  {m.role === 'user' ? (
                    <UserBubble text={m.text} attachment={m.attachment} sample={m.sample} />
                  ) : m.role === 'assistant' ? (
                    <AssistantBubble sample={m.sample}>{m.content}</AssistantBubble>
                  ) : (
                    <UndeliveredNotice
                      onRetry={() =>
                        showPreview({
                          title: 'Send to AI Analyst',
                          body: 'Questions will be answered by your configured AI provider using your recorded TradePilot data.',
                          notDone: 'Your message was not sent anywhere. It exists only in this browser tab and disappears on reload.',
                          requires: 'An AI provider configured in a later phase.',
                        })
                      }
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="border-line-soft border-t p-3 sm:p-4">
            <div className="bg-sunken border-line focus-within:border-accent focus-within:ring-[color-mix(in_srgb,var(--tp-accent)_18%,transparent)] flex items-end gap-2 rounded-lg border p-2 transition-[border-color,box-shadow] focus-within:ring-3">
              <IconButton label="Attach a report" icon={<Paperclip />} onClick={attach} size="md" tooltipSide="top" />
              <label htmlFor="analyst-input" className="sr-only">
                Ask a question about your results
              </label>
              <textarea
                id="analyst-input"
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) send(e);
                }}
                placeholder="Ask about a backtest, a drawdown or a robot…"
                className="text-fg placeholder:text-fg-3 max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none focus-visible:outline-none"
              />
              <Button type="submit" variant="primary" disabled={!draft.trim()} aria-label="Send message" className="px-3">
                <SendHorizontal />
              </Button>
            </div>
            <p className="text-fg-3 mt-2 px-1 text-xs">Enter to send · Shift + Enter for a new line · Messages are not sent anywhere in this preview.</p>
          </form>
        </section>

        <aside className="space-y-6" aria-label="Analyst help">
          <section className="surface p-5">
            <h2 className="text-fg text-sm font-semibold">Try asking</h2>
            <ul className="mt-3 space-y-1.5">
              {exampleQuestions.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(q);
                      inputRef.current?.focus();
                    }}
                    className="text-fg-2 hover:text-fg hover:bg-raised-hover border-line-soft w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="surface p-5">
            <h2 className="text-fg text-sm font-semibold">How answers are labelled</h2>
            <ul className="mt-3 space-y-3 text-sm">
              <LabelExplainer kind="fact" text="Taken directly from your recorded tests and trades." />
              <LabelExplainer kind="hypothesis" text="A possible explanation that still needs checking." />
              <LabelExplainer kind="suggestion" text="An idea for what to test next. You decide." />
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

const kinds = {
  fact: { icon: Database, label: 'Fact', className: 'text-info' },
  hypothesis: { icon: Lightbulb, label: 'Hypothesis', className: 'text-warning' },
  suggestion: { icon: Sparkles, label: 'Suggestion', className: 'text-accent' },
} as const;

function AnswerSection({ kind, title, children }: { kind: keyof typeof kinds; title: string; children: ReactNode }) {
  const k = kinds[kind];
  const Icon = k.icon;
  return (
    <div className="border-line-soft border-l-2 pl-3.5">
      <p className={cn('mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase', k.className)}>
        <Icon className="size-3.5" aria-hidden /> {k.label} · <span className="text-fg-2 normal-case tracking-normal">{title}</span>
      </p>
      <div className="text-fg-2 leading-relaxed">{children}</div>
    </div>
  );
}

function LabelExplainer({ kind, text }: { kind: keyof typeof kinds; text: string }) {
  const k = kinds[kind];
  const Icon = k.icon;
  return (
    <li className="flex gap-2.5">
      <Icon className={cn('mt-0.5 size-4 shrink-0', k.className)} aria-hidden />
      <span>
        <span className="text-fg font-medium">{k.label}</span>
        <span className="text-fg-3 block text-xs">{text}</span>
      </span>
    </li>
  );
}

function AssistantBubble({ children, sample }: { children: ReactNode; sample?: boolean }) {
  return (
    <div className="flex max-w-3xl gap-3">
      <span className="bg-accent-soft text-accent flex size-8 shrink-0 items-center justify-center rounded-full">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg-3 mb-1 flex items-center gap-2 text-xs">
          Analyst {sample && <PreviewTag kind="preview" compact />}
        </p>
        <div className="text-fg-2 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function UserBubble({ text, attachment, sample }: { text: string; attachment?: string; sample?: boolean }) {
  return (
    <div className="ml-auto flex max-w-2xl flex-row-reverse gap-3">
      <span className="bg-raised-hover border-line flex size-8 shrink-0 items-center justify-center rounded-full border">
        <UserRound className="text-fg-2 size-4" aria-hidden />
      </span>
      <div className="min-w-0 text-right">
        <p className="text-fg-3 mb-1 flex items-center justify-end gap-2 text-xs">
          {sample && <PreviewTag kind="preview" compact />} You
        </p>
        <div className="bg-raised-hover border-line inline-block rounded-lg rounded-tr-sm border px-3.5 py-2.5 text-left text-sm text-fg">
          {text}
        </div>
        {attachment && (
          <div className="mt-2 flex justify-end">
            <span className="bg-sunken border-line-soft text-fg-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
              <FileBarChart2 className="text-fg-3 size-3.5" aria-hidden /> {attachment}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function UndeliveredNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-negative-soft ml-auto flex max-w-2xl items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--tp-negative)_25%,transparent)] px-3.5 py-3" role="alert">
      <CircleAlert className="text-negative mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg font-medium">Not sent — the AI service isn’t configured</p>
        <p className="text-fg-2 mt-0.5">Your message stayed in this browser. Nothing was shared with any provider.</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
