import type { ReactNode } from 'react';
import { ArrowLeftRight, Cpu, Globe, HeartPulse, History, PlugZap, RefreshCw, Server, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { Badge, Button, Callout, EmptyState, SectionHeader, Skeleton, Term } from '@/components/ui';
import { AgentPresenceBadge } from '@/components/domain/AgentList';
import { AuditEventList } from '@/components/domain/AuditEventList';
import { DiagnosticsSection } from '@/components/domain/DiagnosticsSection';
import { LiveIndicator } from '@/components/domain/LiveIndicator';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConnectionWizard } from '@/components/mt5/ConnectionWizard';
import { ConnectorStatusBadge } from '@/components/mt5/ConnectorStatusBadge';
import { displayMaskedAccount } from '@/domain/mt5';
import { useConnectorEvents } from '@/hooks/useAudit';
import { useDisplayPrefs } from '@/hooks/useDisplayPrefs';
import { useConnector } from '@/hooks/useMt5';
import { formatDateTime, formatRelativeTime } from '@/lib/datetime';
import { toAppError } from '@/lib/errors';
import { useLiveStatus } from '@/lib/live';


export default function ConnectionsPage() {
  const connector = useConnector();
  const prefs = useDisplayPrefs();
  const live = useLiveStatus();

  return (
    <>
      <PageHeader
        title="Connections & VPS"
        description="Link TradePilot to MetaTrader 5 on your Windows computer. In this version the link is read-only: TradePilot reads your demo account and market prices — it cannot place or change trades."
      />

      <section aria-labelledby="how-title" className="surface mb-6 overflow-hidden p-5 sm:p-6">
        <SectionHeader
          id="how-title"
          title="How the pieces fit together"
          description="The connector runs next to MT5 on your computer and sends read-only data out to TradePilot over HTTPS. Nothing connects into your computer, and no port needs to be opened."
        />
        <ol className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <FlowNode icon={Globe} title="TradePilot website" text="Shows your account and prices. Runs in your browser." tag="You are here" />
          <FlowArrow />
          <FlowNode icon={ArrowLeftRight} title={<Term k="connector">Windows connector</Term>} text="Reads MT5 and sends verified data to TradePilot." />
          <FlowArrow />
          <FlowNode icon={Cpu} title="MT5 terminal" text="Logged into your demo account. Your password stays here." />
          <FlowArrow />
          <FlowNode icon={Server} title="Broker demo server" text="Provides prices and the simulated account." />
        </ol>
        <Callout tone="info" className="mt-5">
          Read-only in this version: no orders, no Expert Advisors, no automated trading. Running the connector on a VPS uses the same
          program; a guided VPS setup arrives in a later phase.
        </Callout>
      </section>

      <section aria-labelledby="mt5-title" className="surface mb-6 p-5 sm:p-6">
        <SectionHeader
          id="mt5-title"
          title={
            <>
              <PlugZap className="text-fg-3 size-[18px]" aria-hidden /> Connect MetaTrader 5
            </>
          }
          description="Seven steps, each confirmed by what the connector actually reports."
          actions={
            <div className="flex items-center gap-3">
              <LiveIndicator status={live.mt5Connection} />
              {!connector.loading && <ConnectorStatusBadge state={connector.state} size="md" />}
            </div>
          }
        />
        {connector.loading ? (
          <Skeleton className="h-64 w-full" />
        ) : connector.error ? (
          <Callout tone="danger" title="Connection status couldn’t be loaded" actions={<Button size="sm" variant="secondary" onClick={() => void connector.refetch()}>Retry</Button>}>
            {toAppError(connector.error).userMessage}
          </Callout>
        ) : (
          <ConnectionWizard connection={connector.connection} agent={connector.agent} state={connector.state} prefs={prefs} now={connector.now} />
        )}
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
            description="Reported by the connector and the server — never assumed."
          />
          <ConnectionHealth connector={connector} prefs={prefs} />
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
              <li>Check that the Windows computer is on, awake and online.</li>
              <li>Open MetaTrader 5 and confirm it is logged into your demo account and connected to the broker.</li>
              <li>
                In the connector folder run <code>.\tradepilot-connector.cmd check</code> — it explains what is wrong in plain English.
              </li>
              <li>
                Restart the connector with <code>.\tradepilot-connector.cmd start</code>; see recent messages with{' '}
                <code>.\tradepilot-connector.cmd logs</code>.
              </li>
              <li>Wait for a fresh status report here — usually within 30 seconds.</li>
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
            <ConnectionHistory prefs={prefs} />
          </section>
        </div>
      </div>

      <DiagnosticsSection />
    </>
  );
}

function HealthRow({ label, detail, children }: { label: ReactNode; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-fg text-sm font-medium">{label}</dt>
        <p className="text-fg-3 text-xs">{detail}</p>
      </div>
      <dd className="text-fg-2 flex shrink-0 items-center gap-1.5 text-right text-sm">{children}</dd>
    </div>
  );
}

function ConnectionHealth({ connector, prefs }: { connector: ReturnType<typeof useConnector>; prefs: ReturnType<typeof useDisplayPrefs> }) {
  const { connection: c, agent, now } = connector;
  const ago = (iso: string | null | undefined) =>
    iso ? (
      <time dateTime={iso} title={formatDateTime(iso, prefs)}>
        {formatRelativeTime(iso, now)}
      </time>
    ) : (
      'Never'
    );
  return (
    <dl className="divide-line-soft divide-y">
      <HealthRow label="Connector" detail="The program on your Windows computer.">
        {agent ? (
          <>
            <AgentPresenceBadge agent={agent} now={now} /> {agent.agent_version ? `v${agent.agent_version}` : ''}
          </>
        ) : (
          'Not paired'
        )}
      </HealthRow>
      <HealthRow label="MT5 terminal" detail="Reported by the connector at its last check.">
        {!c ? '—' : c.terminal_connected === null ? 'Not reported' : c.terminal_connected ? `Connected to broker · build ${c.terminal_build ?? '?'}` : 'Not connected to broker'}
      </HealthRow>
      <HealthRow label="Demo account" detail="Verified from MT5’s own account-type value.">
        {c?.status === 'verified' ? (
          <span className="text-positive inline-flex items-center gap-1">
            <ShieldCheck className="size-4" aria-hidden /> {displayMaskedAccount(c.masked_account)}
          </span>
        ) : c ? (
          <ConnectorStatusBadge state={connector.state} />
        ) : (
          'Not verified'
        )}
      </HealthRow>
      <HealthRow label={<Term k="heartbeat">Last heartbeat</Term>} detail="Sent every 20 seconds while the connector runs.">
        {ago(agent?.last_heartbeat_at)}
      </HealthRow>
      <HealthRow label="Last price update" detail="Only sent when a new tick arrives.">
        {ago(c?.last_quotes_at)}
      </HealthRow>
      <HealthRow label="Last account update" detail="Balance, equity and margin.">
        {ago(c?.last_account_at)}
      </HealthRow>
    </dl>
  );
}

function ConnectionHistory({ prefs }: { prefs: ReturnType<typeof useDisplayPrefs> }) {
  const events = useConnectorEvents(6);
  if (events.isPending) return <Skeleton className="h-24 w-full" />;
  if (events.isError) return <Callout tone="danger">{toAppError(events.error).userMessage}</Callout>;
  if (events.data.events.length === 0) {
    return <EmptyState size="sm" icon={History} title="No connection events" description="Pairing, verification, blocks and disconnects are recorded here." />;
  }
  return <AuditEventList events={events.data.events} prefs={prefs} />;
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
