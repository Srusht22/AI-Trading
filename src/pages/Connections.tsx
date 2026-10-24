import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  Check,
  Cloud,
  Cpu,
  Download,
  Globe,
  HeartPulse,
  History,
  Laptop,
  Minus,
  RefreshCw,
  Server,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Callout, EmptyState, SectionHeader, Term, Tooltip } from '@/components/ui';
import { ConnectionStateIcon } from '@/components/domain/ConnectionStatus';
import { DiagnosticsSection } from '@/components/domain/DiagnosticsSection';
import { PageHeader } from '@/components/layout/PageHeader';
import { connectionStateLabel, type ConnectionState } from '@/config/integrations';
import { usePreviewNotice } from '@/lib/previewNotice';

const healthRows: { label: ReactNode; state: ConnectionState; value?: string; detail: string }[] = [
  { label: 'MT5 terminal', state: 'not_connected', detail: 'No terminal has reported in.' },
  { label: 'Local Windows connector', state: 'not_configured', detail: 'Not installed on this or any computer.' },
  { label: 'VPS connector', state: 'not_configured', detail: 'No VPS has been registered.' },
  { label: 'Active agent', state: 'not_configured', value: 'None', detail: 'The connector currently in charge of MT5.' },
  { label: 'Health', state: 'not_connected', value: 'Unknown', detail: 'Health checks start after the first connection.' },
  { label: <Term k="heartbeat">Last heartbeat</Term>, state: 'not_connected', value: 'Never', detail: 'Expected every 30 seconds once connected.' },
];

export default function ConnectionsPage() {
  const showPreview = usePreviewNotice();
  const later = (title: string, body: string) =>
    showPreview({ title, body, requires: 'The Windows connector, planned for a later phase.' });

  return (
    <>
      <PageHeader
        title="Connections & VPS"
        description="Link TradePilot to MetaTrader 5. Testing and demo trading happen inside MT5 on a Windows computer — this page manages that link."
      />

      <section aria-labelledby="how-title" className="surface mb-6 overflow-hidden p-5 sm:p-6">
        <SectionHeader
          id="how-title"
          title="How the pieces fit together"
          description="The website is where you manage your research. The Windows connector communicates with the MT5 terminal that performs testing and demo execution."
        />
        <ol className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <FlowNode icon={Globe} title="TradePilot website" text="Plan, review and approve. Runs in your browser." tag="You are here" />
          <FlowArrow />
          <FlowNode icon={ArrowLeftRight} title={<Term k="connector">Windows connector</Term>} text="Passes instructions and results back and forth." />
          <FlowArrow />
          <FlowNode icon={Cpu} title="MT5 terminal" text="Runs Expert Advisors and the Strategy Tester." />
          <FlowArrow />
          <FlowNode icon={Server} title="Broker demo server" text="Provides prices and simulated trade execution." />
        </ol>
        <Callout tone="info" className="mt-5">
          A web page cannot run an Expert Advisor by itself. Anything that needs MT5 — backtests, demo trading, compiling code —
          requires a connected, running terminal.
        </Callout>
      </section>

      <section aria-labelledby="where-title" className="mb-6">
        <SectionHeader id="where-title" title="Where should MT5 run?" description="Choose one to start. You can switch later." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HostCard
            icon={Laptop}
            title="Run on My Computer"
            subtitle="Best for getting started"
            pros={['Free — uses your own Windows PC', 'Quick to set up and inspect']}
            cons={['Only works while the computer is on and awake', 'Home internet interruptions pause testing']}
            steps={['Install MetaTrader 5 and log in to a demo account', 'Download and run the TradePilot connector', 'Enter the pairing code shown on this page']}
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Tooltip content="The connector download becomes available in a later phase.">
                  <span tabIndex={0} className="inline-flex rounded-md">
                    <Button variant="primary" leadingIcon={<Download />} disabled>
                      Download connector
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-fg-3 text-xs">Available in a later phase</span>
              </div>
            }
          />
          <HostCard
            icon={Cloud}
            title="Run on a VPS"
            subtitle="Best for running around the clock"
            badge={<Term k="vps">What is a VPS?</Term>}
            pros={['Runs 24 hours a day in a data centre', 'Stable connection close to broker servers']}
            cons={['Monthly cost from your VPS provider', 'Needs a Windows VPS and remote-desktop access']}
            steps={['Rent a Windows VPS and install MetaTrader 5', 'Install the TradePilot connector on the VPS', 'Pair it with this website using a one-time code']}
            action={
              <Button variant="secondary" leadingIcon={<Server />} onClick={() => later('Set up a VPS connector', 'A guided setup will walk you through installing the connector on a Windows VPS and pairing it securely.')}>
                View VPS setup guide
              </Button>
            }
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="health-title" className="surface p-5 sm:p-6">
          <SectionHeader
            id="health-title"
            title={
              <>
                <HeartPulse className="text-fg-3 size-[18px]" aria-hidden /> Connection health
              </>
            }
            description="Live status will be reported by the connector. Nothing is connected yet."
          />
          <dl className="divide-line-soft divide-y">
            {healthRows.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <dt className="text-fg text-sm font-medium">{r.label}</dt>
                  <p className="text-fg-3 text-xs">{r.detail}</p>
                </div>
                <dd className="text-fg-2 flex shrink-0 items-center gap-1.5 text-sm">
                  <ConnectionStateIcon state={r.state} className="size-3.5" />
                  {r.value ?? connectionStateLabel[r.state]}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="reconnect-title" className="surface p-5 sm:p-6">
            <SectionHeader
              id="reconnect-title"
              as="h2"
              title={
                <>
                  <RefreshCw className="text-fg-3 size-[18px]" aria-hidden /> If the connection drops
                </>
              }
            />
            <ol className="text-fg-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed marker:text-fg-3">
              <li>Check that the Windows computer or VPS is switched on and online.</li>
              <li>Open MetaTrader 5 and confirm it is logged in to your demo account.</li>
              <li>Restart the TradePilot connector from the Windows system tray.</li>
              <li>Wait for a fresh heartbeat here — usually within a minute.</li>
            </ol>
          </section>

          <section aria-labelledby="history-title" className="surface p-5 sm:p-6">
            <SectionHeader
              id="history-title"
              as="h2"
              title={
                <>
                  <History className="text-fg-3 size-[18px]" aria-hidden /> Connection history
                </>
              }
            />
            <EmptyState size="sm" icon={History} title="No connection events" description="Connects, disconnects and switches between computer and VPS will be logged here." />
          </section>
        </div>
      </div>

      <DiagnosticsSection />
    </>
  );
}

function FlowNode({ icon: Icon, title, text, tag }: { icon: LucideIcon; title: ReactNode; text: string; tag?: string }) {
  return (
    <li className="bg-sunken border-line-soft relative flex flex-col rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="bg-raised border-line flex size-9 items-center justify-center rounded-lg border">
          <Icon className="text-accent size-[18px]" aria-hidden />
        </span>
        {tag && (
          <Badge tone="accent">
            <UserRound className="size-3" aria-hidden /> {tag}
          </Badge>
        )}
      </div>
      <p className="text-fg mt-3 text-sm font-medium">{title}</p>
      <p className="text-fg-3 mt-0.5 text-xs leading-relaxed">{text}</p>
    </li>
  );
}

function FlowArrow() {
  return (
    <li aria-hidden className="text-fg-3 flex items-center justify-center md:px-0">
      <ArrowLeftRight className="size-4 rotate-90 md:rotate-0" />
    </li>
  );
}

interface HostCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  pros: string[];
  cons: string[];
  steps: string[];
  action: ReactNode;
}

function HostCard({ icon: Icon, title, subtitle, badge, pros, cons, steps, action }: HostCardProps) {
  return (
    <article className="surface flex flex-col p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="bg-accent-soft text-accent flex size-11 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-fg text-md font-semibold">{title}</h3>
          <p className="text-fg-3 text-sm">{subtitle}</p>
        </div>
        {badge && <span className="text-fg-2 text-xs">{badge}</span>}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ul className="space-y-1.5 text-sm" aria-label="Advantages">
          {pros.map((p) => (
            <li key={p} className="text-fg-2 flex gap-2">
              <Check className="text-positive mt-0.5 size-4 shrink-0" aria-label="Advantage" /> {p}
            </li>
          ))}
        </ul>
        <ul className="space-y-1.5 text-sm" aria-label="Trade-offs">
          {cons.map((c) => (
            <li key={c} className="text-fg-2 flex gap-2">
              <Minus className="text-fg-3 mt-0.5 size-4 shrink-0" aria-label="Trade-off" /> {c}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-line-soft mt-5 border-t pt-4">
        <p className="eyebrow mb-2">Setup steps</p>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s} className="text-fg-2 flex gap-3 text-sm">
              <span className="border-line text-fg-3 num flex size-5 shrink-0 items-center justify-center rounded-full border text-xs">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-auto pt-5">{action}</div>
    </article>
  );
}
