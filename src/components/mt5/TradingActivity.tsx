import { useState } from 'react';
import { History, ListOrdered, Layers, RefreshCw } from 'lucide-react';
import { Badge, Button, Callout, DataTable, EmptyState, Skeleton, Tabs, Term, Tooltip } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import { cn } from '@/lib/cn';
import { toAppError } from '@/lib/errors';
import { useDeals, usePendingOrders, usePositions } from '@/hooks/useMt5';
import { useMt5Task } from '@/hooks/useMt5Task';
import { dealTypeText, entryText, formatAccountMoney, orderTypeText, type Mt5Connection } from '@/domain/mt5';

type Tab = 'positions' | 'orders' | 'deals';

function Snapshot({ at, prefs, now }: { at: string | null | undefined; prefs: DisplayPrefs; now: Date }) {
  if (!at) return <span className="text-fg-3 text-xs">Not read from MT5 yet</span>;
  return (
    <Tooltip content={`Read from MT5 at ${formatDateTime(at, prefs)}`}>
      <time tabIndex={0} dateTime={at} className="text-fg-3 rounded-sm text-xs">
        Snapshot {formatRelativeTime(at, now)}
      </time>
    </Tooltip>
  );
}

/**
 * Read-only view of the account's activity as MT5 reports it. A position
 * appearing here is a snapshot of the account, not something TradePilot
 * executed — TradePilot cannot place, modify or close orders.
 */
export function TradingActivity({ connection, connected, prefs, now }: { connection: Mt5Connection; connected: boolean; prefs: DisplayPrefs; now: Date }) {
  const [tab, setTab] = useState<Tab>('positions');
  const positions = usePositions(connection.id);
  const orders = usePendingOrders(connection.id);
  const deals = useDeals(connection.id);
  const refresh = useMt5Task();
  const currency = connection.currency ?? 'USD';
  const digits = connection.currency_digits ?? 2;
  const money = (v: number) => formatAccountMoney(v, currency, digits, prefs.locale);
  const canRequest = connection.status === 'verified' && connected;
  const taskFor: Record<Tab, [string, Record<string, unknown>]> = {
    positions: ['mt5.positions_read', { connection_id: connection.id }],
    orders: ['mt5.pending_orders_read', { connection_id: connection.id }],
    deals: ['mt5.recent_history_read', { connection_id: connection.id, days: connection.history_days }],
  };
  const lastRead = { positions: connection.last_positions_at, orders: connection.last_orders_at, deals: connection.last_deals_at }[tab];
  const failed = refresh.task?.status === 'failed' ? refresh.task.error?.message : refresh.error ? toAppError(refresh.error).userMessage : null;
  const query = { positions, orders, deals }[tab];

  return (
    <div>
      <Tabs
        label="Account activity"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'positions', label: <Term k="position">Open positions</Term>, count: positions.data?.length },
          { value: 'orders', label: <Term k="pendingOrder">Pending orders</Term>, count: orders.data?.length },
          { value: 'deals', label: <Term k="deal">Recent deals</Term>, count: deals.data?.length },
        ]}
      />
      <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
        <Snapshot at={lastRead} prefs={prefs} now={now} />
        {tab === 'deals' && <span className="text-fg-3 text-xs">Last {connection.history_days} days, newest 500 at most</span>}
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          leadingIcon={<RefreshCw />}
          loading={refresh.pending}
          disabled={!canRequest}
          onClick={() => void refresh.run(...taskFor[tab]).catch(() => {})}
        >
          Read again from MT5
        </Button>
      </div>
      {failed && (
        <Callout tone="warning" className="mb-3" title="The last read from MT5 failed">
          {failed} Showing the most recent stored snapshot.
        </Callout>
      )}
      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <Callout tone="danger" title="Couldn’t load this list">
          {toAppError(query.error).userMessage}
        </Callout>
      ) : tab === 'positions' ? (
        <DataTable
          caption="Open positions (read-only snapshot from MT5)"
          rowKey={(p) => String(p.ticket)}
          rows={positions.data ?? []}
          empty={
            <EmptyState size="sm" icon={Layers} title={lastRead ? 'No open positions' : 'Not read yet'} description={lastRead ? 'MT5 reported no open positions in this account.' : 'Open positions appear after the connector reads them.'} />
          }
          columns={[
            { key: 'sym', header: 'Symbol', cell: (p) => <span className="text-fg font-medium">{p.symbol}</span> },
            { key: 'side', header: 'Direction', cell: (p) => <Badge tone={p.side === 'buy' ? 'info' : 'accent'}>{p.side === 'buy' ? 'Buy' : 'Sell'}</Badge> },
            { key: 'vol', header: 'Volume', align: 'right', cell: (p) => <span className="num">{p.volume}</span> },
            { key: 'open', header: 'Open price', align: 'right', hideBelow: 'sm', cell: (p) => <span className="num">{p.price_open}</span> },
            { key: 'cur', header: 'Current', align: 'right', hideBelow: 'md', cell: (p) => <span className="num">{p.price_current ?? '—'}</span> },
            {
              key: 'pl',
              header: 'Profit/loss',
              align: 'right',
              cell: (p) => <span className={cn('num', p.profit > 0 ? 'text-positive' : p.profit < 0 ? 'text-negative' : '')}>{money(p.profit)}</span>,
            },
            { key: 'time', header: 'Opened', hideBelow: 'lg', cell: (p) => formatDateTime(p.opened_at, prefs) },
            { key: 'tk', header: 'Ticket', hideBelow: 'lg', cell: (p) => <span className="num text-fg-3">#{p.ticket}</span> },
          ]}
        />
      ) : tab === 'orders' ? (
        <DataTable
          caption="Pending orders (read-only snapshot from MT5)"
          rowKey={(o) => String(o.ticket)}
          rows={orders.data ?? []}
          empty={
            <EmptyState size="sm" icon={ListOrdered} title={lastRead ? 'No pending orders' : 'Not read yet'} description={lastRead ? 'MT5 reported no pending orders.' : 'Pending orders appear after the connector reads them.'} />
          }
          columns={[
            { key: 'sym', header: 'Symbol', cell: (o) => <span className="text-fg font-medium">{o.symbol}</span> },
            { key: 'type', header: 'Type', cell: (o) => orderTypeText[o.order_type] ?? o.order_type },
            { key: 'vol', header: 'Volume', align: 'right', cell: (o) => <span className="num">{o.volume_current}</span> },
            { key: 'price', header: 'Price', align: 'right', cell: (o) => <span className="num">{o.price_open}</span> },
            { key: 'sl', header: 'SL / TP', align: 'right', hideBelow: 'md', cell: (o) => <span className="num">{o.stop_loss ?? '—'} / {o.take_profit ?? '—'}</span> },
            { key: 'time', header: 'Placed', hideBelow: 'lg', cell: (o) => formatDateTime(o.placed_at, prefs) },
            { key: 'tk', header: 'Ticket', hideBelow: 'lg', cell: (o) => <span className="num text-fg-3">#{o.ticket}</span> },
          ]}
        />
      ) : (
        <DataTable
          caption="Completed deals (read-only history from MT5)"
          rowKey={(d) => String(d.ticket)}
          rows={deals.data ?? []}
          empty={
            <EmptyState size="sm" icon={History} title={lastRead ? 'No deals in this period' : 'History not read yet'} description={lastRead ? `MT5 reported no deals in the last ${connection.history_days} days.` : 'Use “Read again from MT5” to load the recent deal history.'} />
          }
          columns={[
            { key: 'time', header: 'Time', cell: (d) => formatDateTime(d.executed_at, prefs) },
            { key: 'sym', header: 'Symbol', cell: (d) => <span className="text-fg font-medium">{d.symbol || '—'}</span> },
            { key: 'type', header: 'Type', cell: (d) => `${dealTypeText[d.deal_type] ?? d.deal_type}${d.entry ? ` · ${entryText[d.entry] ?? d.entry}` : ''}` },
            { key: 'vol', header: 'Volume', align: 'right', hideBelow: 'sm', cell: (d) => <span className="num">{d.volume || '—'}</span> },
            { key: 'price', header: 'Price', align: 'right', hideBelow: 'md', cell: (d) => <span className="num">{d.price || '—'}</span> },
            {
              key: 'pl',
              header: 'Profit',
              align: 'right',
              cell: (d) => <span className={cn('num', d.profit > 0 ? 'text-positive' : d.profit < 0 ? 'text-negative' : '')}>{money(d.profit)}</span>,
            },
            { key: 'tk', header: 'Ticket', hideBelow: 'lg', cell: (d) => <span className="num text-fg-3">#{d.ticket}</span> },
          ]}
        />
      )}
    </div>
  );
}
