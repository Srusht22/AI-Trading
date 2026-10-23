import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bot, FlaskConical, OctagonX, Play, PlugZap, Square, TriangleAlert, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  DataTable,
  EmptyState,
  PreviewTag,
  SampleDataBanner,
  SectionHeader,
  StatusBadge,
  TabPanel,
  Tabs,
  Term,
} from '@/components/ui';
import { RiskMetric } from '@/components/domain/RiskMetric';
import { LogList } from '@/components/domain/LogList';
import { demoStatusInfo } from '@/components/domain/RobotCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { sampleDashboard, samplePendingOrders, samplePositions, sampleRobots, sampleTerminalLog, sampleTradeHistory } from '@/data/sample';
import type { Robot } from '@/data/types';
import { formatMoney, formatSigned } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/lib/preferences';
import { usePreviewNotice } from '@/lib/previewNotice';

type TabId = 'positions' | 'orders' | 'history' | 'log';

const notConnectedNotice = {
  requires: 'A connected MT5 terminal logged in to a demo account, via the Windows connector.',
  notDone: 'No instruction was sent. No robot was started or stopped and no trade was opened or closed.',
};

function Money({ value }: { value: number }) {
  return (
    <span className={cn('num font-medium', value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-fg-2')}>
      {value > 0 ? '▲ ' : value < 0 ? '▼ ' : ''}
      {formatSigned(value)}
    </span>
  );
}

export default function DemoTradingPage() {
  const { showSampleData: sample } = usePreferences();
  const showPreview = usePreviewNotice();
  const [tab, setTab] = useState<TabId>('positions');
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const deployed = sample ? sampleRobots.filter((r) => r.demoStatus !== 'not_deployed') : [];
  const floating = samplePositions.reduce((s, p) => s + p.profit, 0);

  const robotAction = (action: 'Start' | 'Stop', robot: Robot) =>
    showPreview({
      title: `${action} Demo Robot`,
      body: `Once connected, this will ${action === 'Start' ? 'start' : 'stop'} “${robot.name}” on your demo account inside MetaTrader 5.`,
      ...notConnectedNotice,
    });

  return (
    <>
      <PageHeader
        title="Demo Trading"
        description={
          <>
            Watch robots trade on a <Term k="demoAccount">demo account</Term> — a simulated broker account with virtual money. It is the
            last check before you would ever consider real money.
          </>
        }
        actions={
          <Button variant="danger" leadingIcon={<OctagonX />} onClick={() => setConfirmEmergency(true)}>
            Emergency disable all
          </Button>
        }
      />

      <div className="border-warning bg-warning-soft mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed px-4 py-3 [border-color:color-mix(in_srgb,var(--tp-warning)_45%,transparent)]">
        <FlaskConical className="text-warning size-5 shrink-0" aria-hidden />
        <p className="text-fg flex-1 basis-64 text-sm">
          <strong className="text-warning font-semibold tracking-wide uppercase">Demo environment</strong> · Virtual money only. Live
          connectivity and demo execution are not implemented yet, so no robot on this page is actually trading.
        </p>
        <Button asChild size="sm" variant="secondary">
          <Link to="/connections">
            <PlugZap aria-hidden /> Connect MT5
          </Link>
        </Button>
      </div>

      {sample && <SampleDataBanner className="mb-6">Positions, orders and logs below are invented to preview the layout. No trades exist.</SampleDataBanner>}

      <section aria-labelledby="account-title" className="surface mb-6 p-5 sm:p-6">
        <SectionHeader
          id="account-title"
          title={
            <>
              <Wallet className="text-fg-3 size-[18px]" aria-hidden /> Demo account {sample && <PreviewTag />}
            </>
          }
          description={sample ? 'Sample Broker Ltd. · Demo server · USD account' : 'No demo account is connected.'}
          actions={sample ? <Badge tone="warning">Virtual money</Badge> : <StatusBadge status="not_connected">Not connected</StatusBadge>}
        />
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <RiskMetric term="balance" value={sample ? formatMoney(sampleDashboard.account.balance) : '—'} />
          <RiskMetric term="equity" value={sample ? formatMoney(sampleDashboard.account.equity) : '—'} />
          <RiskMetric
            label="Open profit / loss"
            value={sample ? <Money value={floating} /> : '—'}
            reading={sample ? 'From trades that are still open.' : undefined}
          />
          <RiskMetric term="exposure" value={sample ? '1.0%' : '—'} reading={sample ? 'Of the balance at risk right now.' : undefined} />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="activity-title" className="surface min-w-0 p-5 sm:p-6">
          <h2 id="activity-title" className="sr-only">
            Trading activity
          </h2>
          <Tabs
            label="Trading activity"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'positions', label: 'Open positions', count: sample ? samplePositions.length : 0 },
              { value: 'orders', label: 'Pending orders', count: sample ? samplePendingOrders.length : 0 },
              { value: 'history', label: 'Trade history' },
              { value: 'log', label: 'Terminal log' },
            ]}
          >
            <TabPanel value="positions" className="pt-4 outline-none">
              <DataTable
                caption="Open positions (sample data)"
                rows={sample ? samplePositions : []}
                rowKey={(p) => p.id}
                empty={<EmptyState size="sm" icon={Activity} title="No open positions" description="Trades a demo robot opens will appear here with their live profit or loss." />}
                columns={[
                  { key: 's', header: 'Symbol', cell: (p) => <span className="text-fg font-medium">{p.symbol}</span> },
                  { key: 'd', header: 'Side', cell: (p) => <Badge tone={p.side === 'buy' ? 'info' : 'neutral'}>{p.side === 'buy' ? 'Buy' : 'Sell'}</Badge> },
                  { key: 'l', header: <Term k="lotSize">Lots</Term>, align: 'right', hideBelow: 'sm', cell: (p) => p.lots.toFixed(2) },
                  { key: 'o', header: 'Open price', align: 'right', hideBelow: 'md', cell: (p) => p.openPrice.toFixed(4) },
                  { key: 'c', header: 'Current', align: 'right', hideBelow: 'md', cell: (p) => p.currentPrice.toFixed(4) },
                  { key: 'r', header: 'Robot', hideBelow: 'lg', cell: (p) => p.robot },
                  { key: 'p', header: 'Profit', align: 'right', cell: (p) => <Money value={p.profit} /> },
                ]}
              />
            </TabPanel>
            <TabPanel value="orders" className="pt-4 outline-none">
              <DataTable
                caption="Pending orders (sample data)"
                rows={sample ? samplePendingOrders : []}
                rowKey={(o) => o.id}
                empty={<EmptyState size="sm" icon={Activity} title="No pending orders" description="Orders waiting for a price level will appear here." />}
                columns={[
                  { key: 's', header: 'Symbol', cell: (o) => <span className="text-fg font-medium">{o.symbol}</span> },
                  { key: 't', header: <Term k="pendingOrder">Type</Term>, cell: (o) => o.type },
                  { key: 'l', header: 'Lots', align: 'right', cell: (o) => o.lots.toFixed(2) },
                  { key: 'p', header: 'Trigger price', align: 'right', cell: (o) => o.price.toFixed(4) },
                  { key: 'r', header: 'Robot', hideBelow: 'md', cell: (o) => o.robot },
                ]}
              />
            </TabPanel>
            <TabPanel value="history" className="pt-4 outline-none">
              <DataTable
                caption="Trade history (sample data)"
                rows={sample ? sampleTradeHistory : []}
                rowKey={(t) => t.id}
                empty={<EmptyState size="sm" icon={Activity} title="No closed trades" description="Completed demo trades will be kept here for review." />}
                columns={[
                  {
                    key: 'd',
                    header: 'Closed',
                    cell: (t) => new Date(t.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                  },
                  { key: 's', header: 'Symbol', cell: (t) => <span className="text-fg font-medium">{t.symbol}</span> },
                  { key: 'side', header: 'Side', hideBelow: 'sm', cell: (t) => (t.side === 'buy' ? 'Buy' : 'Sell') },
                  { key: 'r', header: 'Robot', hideBelow: 'md', cell: (t) => t.robot },
                  { key: 'p', header: 'Result', align: 'right', cell: (t) => <Money value={t.profit} /> },
                ]}
              />
            </TabPanel>
            <TabPanel value="log" className="pt-4 outline-none">
              {sample ? (
                <LogList lines={sampleTerminalLog} label="Terminal log (sample data)" />
              ) : (
                <EmptyState size="sm" icon={Activity} title="No terminal messages" description="Messages from MT5 and the connector appear here once connected." />
              )}
            </TabPanel>
          </Tabs>
        </section>

        <section aria-labelledby="robots-title" className="surface p-5 sm:p-6">
          <SectionHeader
            id="robots-title"
            as="h2"
            title={
              <>
                <Bot className="text-fg-3 size-[18px]" aria-hidden /> Demo robots {sample && <PreviewTag />}
              </>
            }
            description="Robots you have approved for demo trading."
          />
          {deployed.length ? (
            <ul className="space-y-3">
              {deployed.map((r) => {
                const st = demoStatusInfo[r.demoStatus];
                const running = r.demoStatus === 'running';
                return (
                  <li key={r.id} className="bg-sunken border-line-soft rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-fg truncate text-sm font-medium">{r.name}</p>
                        <p className="text-fg-3 text-xs">
                          {r.symbols.join(', ')} · {r.timeframe} · v{r.version}
                        </p>
                      </div>
                      <StatusBadge status={st.status}>{running ? 'Running (sample)' : st.label}</StatusBadge>
                    </div>
                    <div className="mt-3 flex gap-2">
                      {running ? (
                        <Button size="sm" variant="secondary" leadingIcon={<Square />} onClick={() => robotAction('Stop', r)}>
                          Stop Demo Robot
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" leadingIcon={<Play />} onClick={() => robotAction('Start', r)}>
                          Start Demo Robot
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              size="sm"
              icon={Bot}
              title="No robots in demo"
              description="After a robot passes its backtests and you approve it, you can run it here on virtual money."
              actions={
                <Button asChild size="sm" variant="secondary">
                  <Link to="/robots">Go to My Robots</Link>
                </Button>
              }
            />
          )}
          <Callout tone="info" className="mt-5">
            Robots only start after your explicit approval. The emergency control will stop every demo robot and close its trades at
            once.
          </Callout>
        </section>
      </div>

      <ConfirmationDialog
        open={confirmEmergency}
        onOpenChange={setConfirmEmergency}
        icon={
          <span className="bg-negative-soft text-negative flex size-9 items-center justify-center rounded-lg">
            <TriangleAlert className="size-[18px]" aria-hidden />
          </span>
        }
        title="Disable all demo robots?"
        description="When connected, this immediately stops every robot on the demo account and closes their open trades. Use it if something looks wrong."
        confirmLabel="Disable all robots"
        confirmVariant="danger"
        onConfirm={() =>
          showPreview({
            title: 'Emergency disable',
            body: 'Once MT5 is connected, this control will stop all demo robots within seconds, even if the website loses its connection afterwards.',
            ...notConnectedNotice,
          })
        }
      />
    </>
  );
}
