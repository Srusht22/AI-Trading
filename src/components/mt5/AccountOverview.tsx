import { CircleDashed, Coins, Gauge, Landmark, PiggyBank, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { Callout, Skeleton, Term, Tooltip } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import { cn } from '@/lib/cn';
import {
  accountFreshness,
  displayMaskedAccount,
  formatAccountMoney,
  type AccountState,
  type Mt5Connection,
} from '@/domain/mt5';
import { DataFreshnessBadge } from './ConnectorStatusBadge';

function Figure({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: React.ReactNode; value: string; hint?: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="bg-sunken border-line-soft rounded-lg border p-3.5">
      <dt className="text-fg-3 flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" aria-hidden /> {label}
      </dt>
      <dd className={cn('num mt-1.5 text-lg font-semibold tracking-tight', tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-fg')}>
        {value}
      </dd>
      {hint && <p className="text-fg-3 mt-0.5 text-2xs">{hint}</p>}
    </div>
  );
}

/**
 * The account summary exactly as MT5 reported it. Values are never derived
 * or filled in: when the connector is offline they are shown as last known,
 * with their age, and never presented as current.
 */
export function AccountOverview({
  connection,
  account,
  loading,
  connected,
  prefs,
  now,
}: {
  connection: Mt5Connection;
  account: AccountState | null | undefined;
  loading: boolean;
  connected: boolean;
  prefs: DisplayPrefs;
  now: Date;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!account) {
    return (
      <Callout tone="info" icon={CircleDashed} title="No account data received yet">
        The connector sends the first account summary a few seconds after the demo account is verified.
      </Callout>
    );
  }
  const money = (v: number) => formatAccountMoney(v, account.currency, account.currency_digits, prefs.locale);
  const freshness = accountFreshness(account, connection, connected, now);
  const pl = account.profit;
  return (
    <section aria-label="Demo account summary">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <DataFreshnessBadge
          state={freshness}
          tip={
            freshness === 'live'
              ? 'Values come from your MT5 terminal and are updated every few seconds while it is connected.'
              : 'The connector has not sent new values recently. These are the last values received — not necessarily current.'
          }
        />
        <span className="text-fg-2">
          {displayMaskedAccount(connection.masked_account)} · {connection.server ?? 'Unknown server'} · {account.currency}
          {account.leverage ? ` · 1:${account.leverage}` : ''}
        </span>
        <Tooltip content={`Read from MT5 at ${formatDateTime(account.observed_at, prefs)}`}>
          <time tabIndex={0} dateTime={account.observed_at} className="text-fg-3 ml-auto rounded-sm text-xs">
            Updated {formatRelativeTime(account.observed_at, now)}
          </time>
        </Tooltip>
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Figure icon={Landmark} label="Balance" value={money(account.balance)} hint="Closed trades only" />
        <Figure icon={Wallet} label={<Term k="equity">Equity</Term>} value={money(account.equity)} hint="As reported by MT5" />
        <Figure
          icon={TrendingUp}
          label="Floating P/L"
          value={`${pl > 0 ? '+' : ''}${money(pl)}`}
          tone={pl > 0 ? 'positive' : pl < 0 ? 'negative' : undefined}
          hint="Open positions"
        />
        <Figure icon={Coins} label={<Term k="margin">Used margin</Term>} value={money(account.margin)} />
        <Figure icon={PiggyBank} label="Free margin" value={money(account.margin_free)} />
        <Figure
          icon={Gauge}
          label="Margin level"
          value={account.margin_level === null ? 'Not applicable' : `${account.margin_level.toFixed(2)} %`}
          hint={account.margin_level === null ? 'No margin in use' : undefined}
        />
      </dl>
      {account.credit !== 0 && <p className="text-fg-3 mt-2 text-xs">Includes broker credit of {money(account.credit)} as reported by MT5.</p>}
    </section>
  );
}
