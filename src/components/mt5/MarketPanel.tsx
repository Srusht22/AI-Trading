import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CandlestickChart, RefreshCw } from 'lucide-react';
import { Button, Callout, DataTable, EmptyState, SegmentedControl, Select, Skeleton, Term, Tooltip } from '@/components/ui';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { formatRelativeTime, zoneLabel, type DisplayPrefs } from '@/lib/datetime';
import { toAppError } from '@/lib/errors';
import { useBars, useQuotes, useSymbols } from '@/hooks/useMt5';
import { useMt5Task } from '@/hooks/useMt5Task';
import {
  formatPrice,
  quoteFreshness,
  spreadPoints,
  TIMEFRAME_MS,
  TIMEFRAMES,
  type Mt5Connection,
  type Quote,
  type Timeframe,
} from '@/domain/mt5';
import { DataFreshnessBadge } from './ConnectorStatusBadge';
import { PriceChart } from './PriceChart';

export function formatClock(iso: string, timeZone: string): string {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
  return `${t} ${zoneLabel(iso, timeZone)}`;
}

const freshnessTip = {
  live: 'A new tick arrived from your terminal within the last minute.',
  stale: 'No new tick for over a minute — the market may be quiet or closed. This is the last real price, with its time.',
  disconnected: 'The connector is not connected. This is the last price received, not a current one.',
  none: 'No price has been received for this symbol yet.',
};

/**
 * Prices and history for the symbols chosen on the Connections page. All
 * values come from the connected terminal; when no new tick arrives,
 * nothing on screen changes.
 */
export function MarketPanel({ connection, connected, prefs, now }: { connection: Mt5Connection; connected: boolean; prefs: DisplayPrefs; now: Date }) {
  const symbols = useSymbols(connection.id);
  const quotes = useQuotes(connection.id);
  const monitored = useMemo(() => (symbols.data ?? []).filter((s) => s.monitored), [symbols.data]);
  const [symbol, setSymbol] = useState<string | undefined>();
  const [timeframe, setTimeframe] = useState<Timeframe>('M5');
  const active = monitored.find((s) => s.name === symbol) ?? monitored[0];
  const bars = useBars(connection.id, active?.name, timeframe);
  const history = useMt5Task();
  const requested = useRef(new Set<string>());
  const quote: Quote | undefined = (quotes.data ?? []).find((q) => q.symbol === active?.name);
  const digits = active?.digits ?? 5;

  // Fetch history once per symbol/timeframe when nothing recent is stored (bounded: 200 bars).
  const lastBar = bars.data?.at(-1);
  const needsHistory = !!active && bars.isSuccess && (!lastBar || now.getTime() - Date.parse(lastBar.open_time) > 3 * TIMEFRAME_MS[timeframe]);
  const key = `${active?.name}:${timeframe}`;
  const canRequest = connection.status === 'verified' && connected;
  const runHistory = history.run;
  useEffect(() => {
    if (needsHistory && canRequest && !requested.current.has(key)) {
      requested.current.add(key);
      void runHistory('mt5.price_history', { connection_id: connection.id, symbol: active!.name, timeframe, count: 200 }).catch(() => {});
    }
  }, [needsHistory, canRequest, key, connection.id, active, timeframe, runHistory]);

  if (symbols.isPending) return <Skeleton className="h-80 w-full" />;
  if (monitored.length === 0) {
    return (
      <EmptyState
        icon={CandlestickChart}
        title="No symbols selected"
        description="Choose up to 8 symbols from your broker’s list on the Connections page. Their prices then appear here."
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to="/connections#mt5-symbols">Choose symbols</Link>
          </Button>
        }
      />
    );
  }

  const freshness = quoteFreshness(quote, connected, now);
  const refreshButton = (
    <Button
      size="sm"
      variant="secondary"
      leadingIcon={<RefreshCw />}
      loading={history.pending}
      disabled={!canRequest}
      onClick={() => void history.run('mt5.price_history', { connection_id: connection.id, symbol: active!.name, timeframe, count: 200 }).catch(() => {})}
    >
      Refresh history
    </Button>
  );
  const historyError = history.task?.status === 'failed' ? history.task.error?.message : history.error ? toAppError(history.error).userMessage : null;

  return (
    <div className="space-y-5">
      <DataTable
        dense
        caption="Latest prices from your MT5 terminal"
        rowKey={(r) => r.symbol}
        rows={(quotes.data ?? []).filter((q) => monitored.some((m) => m.name === q.symbol))}
        empty={<p className="text-fg-3 py-3 text-sm">Waiting for the first tick from the terminal…</p>}
        columns={[
          { key: 's', header: <Term k="symbol">Symbol</Term>, cell: (q) => <span className="text-fg font-medium">{q.symbol}</span> },
          { key: 'b', header: <Term k="bidAsk">Bid</Term>, align: 'right', cell: (q) => <span className="num">{formatPrice(q.bid, monitored.find((m) => m.name === q.symbol)?.digits)}</span> },
          { key: 'a', header: 'Ask', align: 'right', cell: (q) => <span className="num">{formatPrice(q.ask, monitored.find((m) => m.name === q.symbol)?.digits)}</span> },
          {
            key: 'sp',
            header: <Term k="spread">Spread</Term>,
            align: 'right',
            hideBelow: 'sm',
            cell: (q) => {
              const p = spreadPoints(q, monitored.find((m) => m.name === q.symbol)?.point);
              return <span className="num">{p === null ? '—' : `${p} pts`}</span>;
            },
          },
          {
            key: 't',
            header: <Term k="tick">Last tick</Term>,
            align: 'right',
            cell: (q) => (
              <Tooltip content={`Broker tick time ${formatClock(q.tick_time, prefs.timeZone)} · read by the connector ${formatClock(q.observed_at, prefs.timeZone)}`}>
                <time tabIndex={0} dateTime={q.tick_time} className="num rounded-sm">
                  {formatClock(q.tick_time, prefs.timeZone)}
                </time>
              </Tooltip>
            ),
          },
          {
            key: 'f',
            header: 'Status',
            align: 'right',
            cell: (q) => {
              const f = quoteFreshness(q, connected, now);
              return <DataFreshnessBadge state={f} tip={freshnessTip[f]} />;
            },
          },
        ]}
      />

      <ChartContainer
        headingLevel="h3"
        title={`${active!.name}${active!.description ? ` — ${active!.description}` : ''}`}
        badge={<DataFreshnessBadge state={freshness} tip={freshnessTip[freshness]} />}
        explanation={
          <>
            {timeframe} closing prices from MT5’s own history; the dot is the latest real <Term k="tick">tick</Term>
            {quote ? ` (${formatRelativeTime(quote.tick_time, now)})` : ''}. Prices are polled from your terminal about every{' '}
            {Math.round(connection.quote_interval_ms / 1000)} s — near-real-time, not an exchange feed.
            {connection.broker_offset_source === 'unknown' && ' Broker time zone not yet determined: times may be shown in broker server time.'}
          </>
        }
        controls={
          <>
            {monitored.length > 1 && (
              <Select aria-label="Symbol" value={active!.name} onChange={(e) => setSymbol(e.target.value)} className="h-8 text-sm">
                {monitored.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
            <SegmentedControl label="Timeframe" value={timeframe} onValueChange={setTimeframe} options={TIMEFRAMES.map((t) => ({ value: t, label: t, ariaLabel: `${t} bars` }))} />
            {refreshButton}
          </>
        }
        table={
          <DataTable
            dense
            caption={`${active!.name} ${timeframe} bars (most recent first)`}
            rowKey={(b) => b.open_time}
            rows={[...(bars.data ?? [])].reverse().slice(0, 50)}
            columns={[
              { key: 't', header: 'Opened', cell: (b) => formatClock(b.open_time, prefs.timeZone) },
              { key: 'o', header: 'Open', align: 'right', cell: (b) => formatPrice(b.open, digits) },
              { key: 'h', header: 'High', align: 'right', cell: (b) => formatPrice(b.high, digits) },
              { key: 'l', header: 'Low', align: 'right', cell: (b) => formatPrice(b.low, digits) },
              { key: 'c', header: 'Close', align: 'right', cell: (b) => formatPrice(b.close, digits) },
            ]}
          />
        }
        empty={
          bars.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (bars.data ?? []).length === 0 ? (
            history.pending ? (
              <EmptyState size="sm" icon={CandlestickChart} title="Loading price history" description="The connector is reading recent bars from MetaTrader 5…" />
            ) : historyError ? (
              <Callout tone="warning" title="Price history unavailable" actions={refreshButton}>
                {historyError}
              </Callout>
            ) : (
              <EmptyState
                size="sm"
                icon={CandlestickChart}
                title="No price history stored yet"
                description={canRequest ? 'Read recent bars from your terminal.' : 'History can be loaded while the connector is connected.'}
                actions={refreshButton}
              />
            )
          ) : undefined
        }
        height={280}
      >
        <PriceChart bars={bars.data ?? []} quote={quote} digits={digits} timeframe={timeframe} timeZone={prefs.timeZone} />
      </ChartContainer>
      {historyError && (bars.data ?? []).length > 0 && (
        <Callout tone="warning" title="Latest history refresh failed">
          {historyError} The chart shows the history stored earlier.
        </Callout>
      )}
    </div>
  );
}
