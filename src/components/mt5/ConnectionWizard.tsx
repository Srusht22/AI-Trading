import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, CircleAlert, CircleCheck, CircleDashed, Copy, KeyRound, Plug, PlugZap, Search, ShieldCheck, Unplug } from 'lucide-react';
import { Button, Callout, ConfirmationDialog, FormField, Input, Skeleton, Term, Tooltip } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import { cn } from '@/lib/cn';
import { toAppError } from '@/lib/errors';
import { useToast } from '@/lib/toast';
import { useCreatePairing, useMt5Actions, useSymbols } from '@/hooks/useMt5';
import {
  displayMaskedAccount,
  MAX_MONITORED_SYMBOLS,
  statusReasonText,
  type ConnectorState,
  type Mt5Connection,
} from '@/domain/mt5';
import type { Agent } from '@/domain/tasks';
import { ConnectorStatusBadge } from './ConnectorStatusBadge';

export const CONNECTOR_VERSION = '1.0.0';

type StepState = 'done' | 'current' | 'blocked' | 'todo';

function Step({
  n,
  title,
  state,
  summary,
  open,
  onToggle,
  children,
  id,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
}) {
  const icon =
    state === 'done' ? (
      <CircleCheck className="text-positive size-5" aria-hidden />
    ) : state === 'blocked' ? (
      <CircleAlert className="text-negative size-5" aria-hidden />
    ) : (
      <span aria-hidden className={cn('num flex size-5 items-center justify-center rounded-full border text-2xs font-semibold', state === 'current' ? 'border-accent text-accent' : 'border-line text-fg-3')}>
        {n}
      </span>
    );
  const stateText = { done: 'done', current: 'next step', blocked: 'needs attention', todo: 'not started' }[state];
  return (
    <li id={id} className={cn('border-line-soft rounded-lg border', state === 'current' && 'border-accent/40 bg-accent-soft/30', state === 'blocked' && 'border-negative/40')}>
      <h3>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          {icon}
          <span className="min-w-0 flex-1">
            <span className="text-fg block text-sm font-semibold">
              <span className="sr-only">Step {n}: </span>
              {title}
              <span className="sr-only"> — {stateText}</span>
            </span>
            {summary && !open && <span className="text-fg-3 block truncate text-xs">{summary}</span>}
          </span>
          <ChevronDown className={cn('text-fg-3 size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && <div className="text-fg-2 px-4 pt-0 pb-4 pl-12 text-sm leading-relaxed">{children}</div>}
    </li>
  );
}

function Command({ children, label }: { children: string; label: string }) {
  const toast = useToast();
  return (
    <div className="bg-sunken border-line-soft mt-2 flex items-start gap-2 rounded-md border px-3 py-2">
      <code className="num text-fg min-w-0 flex-1 text-xs break-all">{children}</code>
      <Tooltip content={`Copy ${label}`}>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          className="text-fg-3 hover:text-fg shrink-0 rounded p-0.5"
          onClick={() => void navigator.clipboard?.writeText(children).then(() => toast({ tone: 'success', title: 'Copied' }), () => {})}
        >
          <Copy className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-fg-3 text-xs">{label}</dt>
      <dd className="text-fg text-right text-sm">{children}</dd>
    </div>
  );
}

function SymbolPicker({ connection }: { connection: Mt5Connection }) {
  const symbols = useSymbols(connection.id);
  const { setSymbols } = useMt5Actions();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const current = useMemo(() => (symbols.data ?? []).filter((s) => s.monitored).map((s) => s.name), [symbols.data]);
  const selection = chosen ?? current;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (symbols.data ?? []).filter((s) => s.available);
    const matches = q ? list.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)) : list.filter((s) => s.visible || selection.includes(s.name));
    return matches.slice(0, 60);
  }, [symbols.data, query, selection]);

  if (symbols.isPending) return <Skeleton className="h-24 w-full" />;
  if ((symbols.data ?? []).length === 0) {
    return <p>The connector publishes your broker’s symbol list right after the account is verified. It will appear here automatically.</p>;
  }
  const toggle = (name: string) =>
    setChosen(selection.includes(name) ? selection.filter((s) => s !== name) : selection.length >= MAX_MONITORED_SYMBOLS ? selection : [...selection, name]);
  const dirty = chosen !== null && [...chosen].sort().join() !== [...current].sort().join();
  const unavailable = (symbols.data ?? []).filter((s) => s.monitored && !s.available);

  return (
    <div className="space-y-3">
      <p>
        Choose up to {MAX_MONITORED_SYMBOLS} symbols to follow. The names are exactly as your broker lists them (for example a suffix such as
        “.r” or “m” is part of the name). {(symbols.data ?? []).length} symbols available.
      </p>
      <FormField label="Search symbols" hint={query ? undefined : 'Showing symbols visible in your MT5 Market Watch. Type to search all.'}>
        <Input leading={<Search className="size-4" />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. EURUSD, gold, GER40" />
      </FormField>
      <ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2" aria-label="Broker symbols">
        {filtered.map((s) => {
          const on = selection.includes(s.name);
          return (
            <li key={s.name}>
              <label className={cn('hover:bg-raised-hover flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5', on && 'bg-accent-soft')}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && selection.length >= MAX_MONITORED_SYMBOLS}
                  onChange={() => toggle(s.name)}
                  className="accent-[var(--tp-accent)]"
                />
                <span className="min-w-0">
                  <span className="text-fg block text-sm font-medium">{s.name}</span>
                  {s.description && <span className="text-fg-3 block truncate text-xs">{s.description}</span>}
                </span>
              </label>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="text-fg-3 px-2 py-2 text-sm">No symbol matches “{query}”.</li>}
      </ul>
      {unavailable.length > 0 && (
        <Callout tone="warning">{unavailable.map((s) => s.name).join(', ')} is no longer offered by the terminal and receives no prices.</Callout>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          loading={setSymbols.isPending}
          onClick={() =>
            setSymbols.mutate(
              { connectionId: connection.id, symbols: selection },
              {
                onSuccess: () => {
                  setChosen(null);
                  toast({ tone: 'success', title: 'Symbols saved', description: 'The connector starts sending their prices within about 10 seconds.' });
                },
                onError: (e) => toast({ tone: 'error', title: 'Symbols not saved', description: toAppError(e).userMessage }),
              },
            )
          }
        >
          Save {selection.length} {selection.length === 1 ? 'symbol' : 'symbols'}
        </Button>
        <span className="text-fg-3 text-xs">
          {selection.length}/{MAX_MONITORED_SYMBOLS} selected
        </span>
      </div>
    </div>
  );
}

function IntervalSettings({ connection }: { connection: Mt5Connection }) {
  const { updateSettings } = useMt5Actions();
  const toast = useToast();
  const [values, setValues] = useState({
    quote: String(connection.quote_interval_ms / 1000),
    account: String(connection.account_interval_s),
    snapshot: String(connection.snapshot_interval_s / 60),
    history: String(connection.history_days),
  });
  const num = (v: string) => Number(v);
  const valid =
    num(values.quote) >= 1 && num(values.quote) <= 60 &&
    num(values.account) >= 5 && num(values.account) <= 300 &&
    num(values.snapshot) >= 1 && num(values.snapshot) <= 60 &&
    Number.isInteger(num(values.history)) && num(values.history) >= 1 && num(values.history) <= 30;
  const field = (key: keyof typeof values, label: string, hint: string, min: number, max: number) => (
    <FormField label={label} hint={hint}>
      <Input type="number" inputMode="decimal" min={min} max={max} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
    </FormField>
  );
  return (
    <form
      className="border-line-soft mt-2 grid max-w-xl grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        updateSettings.mutate(
          {
            connectionId: connection.id,
            settings: {
              quoteIntervalMs: Math.round(num(values.quote) * 1000),
              accountIntervalS: Math.round(num(values.account)),
              snapshotIntervalS: Math.round(num(values.snapshot) * 60),
              historyDays: num(values.history),
            },
          },
          {
            onSuccess: () => toast({ tone: 'success', title: 'Intervals saved', description: 'The connector applies them within about 10 seconds.' }),
            onError: (err) => toast({ tone: 'error', title: 'Intervals not saved', description: toAppError(err).userMessage }),
          },
        );
      }}
    >
      <p className="text-fg text-sm font-medium sm:col-span-2">Update intervals</p>
      {field('quote', 'Price checks (seconds)', '1–60. Lower = fresher prices, more requests.', 1, 60)}
      {field('account', 'Account checks (seconds)', '5–300.', 5, 300)}
      {field('snapshot', 'Equity history every (minutes)', '1–60. One stored point per interval.', 1, 60)}
      {field('history', 'Deal history (days)', '1–30 days read on request.', 1, 30)}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" variant="secondary" disabled={!valid} loading={updateSettings.isPending}>
          Save intervals
        </Button>
        {!valid && <span className="text-warning ml-3 text-xs">Check the allowed ranges.</span>}
      </div>
    </form>
  );
}

function PairingStep({ origin, paired }: { origin: string; paired: boolean }) {
  const create = useCreatePairing();
  const [name, setName] = useState('My Windows PC');
  const [now, setNow] = useState(() => Date.now());
  const code = create.data;
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);
  const remaining = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;

  return (
    <div className="space-y-3">
      <p>
        Pairing links the connector on your computer to this workspace. You create a one-time code here; the connector creates its own
        secret key on your computer and uses the code once to register it. The key never passes through this website and your MT5
        password is never needed.
      </p>
      {!code || remaining === 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Name for this computer" className="min-w-56 flex-1">
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <Button
            variant={paired ? 'secondary' : 'primary'}
            leadingIcon={<KeyRound />}
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() => create.mutate(name.trim())}
          >
            {paired ? 'Pair another computer' : 'Create pairing code'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-fg font-medium">
            Your one-time pairing code (valid for{' '}
            <span className="num">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </span>
            ):
          </p>
          <p className="num text-fg text-2xl font-semibold tracking-wider" aria-label="Pairing code">
            {code.code}
          </p>
          <p>In the connector folder on your Windows computer, run:</p>
          <Command label="pairing command">{`.\\tradepilot-connector.cmd pair --api-url ${origin} --code ${code.code}`}</Command>
          <p className="text-fg-3 text-xs">The code works once and expires after 10 minutes. This page updates when the connector has paired.</p>
        </div>
      )}
      {create.isError && <Callout tone="danger">{toAppError(create.error).userMessage}</Callout>}
    </div>
  );
}

/**
 * The connector setup and status flow. Every stage’s state is derived from
 * what the connector and server actually reported — the user cannot mark a
 * stage done, and "Demo verified" appears only after an authenticated report.
 */
export function ConnectionWizard({
  connection,
  agent,
  state,
  prefs,
  now,
}: {
  connection: Mt5Connection | null;
  agent: Agent | null;
  state: ConnectorState;
  prefs: DisplayPrefs;
  now: Date;
}) {
  const toast = useToast();
  const actions = useMt5Actions();
  const [confirm, setConfirm] = useState<null | 'disconnect' | 'accept' | 'revoke'>(null);
  const paired = !!agent && !agent.revoked_at;
  const verified = connection?.status === 'verified';
  const hasSymbols = useSymbols(connection?.id).data?.some((s) => s.monitored) ?? false;
  const blocked = state === 'blocked_account_type' || state === 'account_changed' || state === 'auth_error';

  const steps: { title: string; state: StepState; summary: string }[] = [
    { title: 'Prepare MetaTrader 5', state: verified ? 'done' : paired ? 'done' : 'current', summary: 'MT5 installed, running and logged into your demo account' },
    { title: 'Install and start the connector', state: paired ? 'done' : 'current', summary: `Connector ${CONNECTOR_VERSION} on your Windows computer` },
    { title: 'Pair the connector', state: paired ? 'done' : 'current', summary: paired ? `Paired as “${agent!.display_name}”` : 'One-time code from this page' },
    {
      title: 'Verify the demo account',
      state: verified ? 'done' : blocked ? 'blocked' : paired ? 'current' : 'todo',
      summary: verified ? `Demo verified · ${displayMaskedAccount(connection!.masked_account)} on ${connection!.server}` : 'Waiting for the connector’s report',
    },
    { title: 'Choose market symbols', state: verified ? (hasSymbols ? 'done' : 'current') : 'todo', summary: hasSymbols ? 'Symbols selected' : 'Pick up to 8 symbols' },
    { title: 'Connected', state: state === 'connected' ? 'done' : verified ? 'current' : 'todo', summary: 'Live status and data freshness' },
    { title: 'Disconnect', state: state === 'disconnected' ? 'done' : 'todo', summary: 'Stop the data feed for this connection' },
  ];
  // Steps that need action are open by default (following live data); the user's own toggles win.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const anyActive = steps.some((s) => s.state === 'current' || s.state === 'blocked');
  const isOpen = (i: number) => overrides[i] ?? (steps[i].state === 'current' || steps[i].state === 'blocked' || (!anyActive && i === 5));
  const open = { has: isOpen };
  const toggle = (i: number) => setOverrides((prev) => ({ ...prev, [i]: !isOpen(i) }));

  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn().then(
      () => toast({ tone: 'success', title: ok }),
      (e) => toast({ tone: 'error', title: 'That didn’t work', description: toAppError(e).userMessage }),
    );

  return (
    <>
      <ol className="space-y-2" aria-label="Connect MetaTrader 5">
        <Step n={1} {...steps[0]} open={open.has(0)} onToggle={() => toggle(0)}>
          <ul className="space-y-1.5">
            {[
              'MetaTrader 5 is installed on this Windows computer (from your broker or metatrader5.com).',
              'MT5 is open and logged into your DEMO account (File › Login to Trade Account). Your password stays in MT5.',
              'The bottom-right corner of MT5 shows a connection (not “No connection”).',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden /> {t}
              </li>
            ))}
          </ul>
          <p className="text-fg-3 mt-2 text-xs">
            TradePilot never asks for your broker password. It only connects to demo accounts and checks the account type that MT5 itself
            reports.
          </p>
        </Step>

        <Step n={2} {...steps[1]} open={open.has(1)} onToggle={() => toggle(1)}>
          <p>
            You need 64-bit Python 3.12 or 3.13 and the <code>connector</code> folder from the TradePilot project on the same computer as
            MT5. In that folder, run once (no administrator rights needed):
          </p>
          <Command label="setup command">powershell -ExecutionPolicy Bypass -File .\setup.ps1</Command>
          <p className="mt-2">It installs the pinned, hash-checked dependencies (including MetaQuotes’ official MetaTrader5 package) and runs a local check.</p>
          <p className="mt-2">
            Start it with <code>.\tradepilot-connector.cmd start</code> and stop it with Ctrl+C (or <code>.\tradepilot-connector.cmd stop</code>).
            Full guide: <code>docs/mt5-connector.md</code>.
          </p>
          {agent?.agent_version && (
            <p className="mt-2">
              Connector reported version <span className="num text-fg">{agent.agent_version}</span>
              {agent.agent_version !== CONNECTOR_VERSION && ` (this website expects ${CONNECTOR_VERSION})`}.
            </p>
          )}
        </Step>

        <Step n={3} {...steps[2]} open={open.has(2)} onToggle={() => toggle(2)}>
          <PairingStep origin={window.location.origin} paired={paired} />
        </Step>

        <Step n={4} {...steps[3]} open={open.has(3)} onToggle={() => toggle(3)}>
          {!paired ? (
            <p>Pair the connector first.</p>
          ) : (
            <div className="space-y-3">
              <p>
                Start the connector (<code>.\tradepilot-connector.cmd start</code>). It reads the account type from MT5 and reports it. Only
                an account that MT5 itself reports as <strong>demo</strong> is accepted; real and contest accounts are blocked.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ConnectorStatusBadge state={state} size="md" />
                {verified && (
                  <span className="text-positive inline-flex items-center gap-1 text-sm font-medium">
                    <ShieldCheck className="size-4" aria-hidden /> Demo verified
                  </span>
                )}
              </div>
              {connection?.status_reason && (
                <Callout tone={blocked ? 'danger' : 'warning'}>{statusReasonText[connection.status_reason] ?? connection.status_reason}</Callout>
              )}
              {connection && (
                <dl className="divide-line-soft max-w-md divide-y">
                  <Fact label="Broker server">{connection.server ?? '—'}</Fact>
                  <Fact label="Account">{displayMaskedAccount(connection.masked_account)}</Fact>
                  <Fact label="Account currency">{connection.currency ?? '—'}</Fact>
                  <Fact label="Detected account type">
                    {connection.detected_trade_mode ? { demo: 'Demo', real: 'Real (blocked)', contest: 'Contest (blocked)', unknown: 'Unknown (blocked)' }[connection.detected_trade_mode] : '—'}
                  </Fact>
                  <Fact label="Terminal version">{connection.terminal_build ? `Build ${connection.terminal_build}` : '—'}</Fact>
                  <Fact label="Broker connection">{connection.terminal_connected === null ? '—' : connection.terminal_connected ? 'Connected' : 'Not connected'}</Fact>
                  <Fact label="Last successful verification">
                    {connection.verified_at ? (
                      <time dateTime={connection.verified_at} title={formatDateTime(connection.verified_at, prefs)}>
                        {formatRelativeTime(connection.verified_at, now)}
                      </time>
                    ) : (
                      'Never'
                    )}
                  </Fact>
                </dl>
              )}
              {state === 'account_changed' && connection && (
                <Button size="sm" variant="secondary" onClick={() => setConfirm('accept')}>
                  Use the newly logged-in demo account instead
                </Button>
              )}
            </div>
          )}
        </Step>

        <Step n={5} {...steps[4]} open={open.has(4)} onToggle={() => toggle(4)} id="mt5-symbols">
          {verified && connection ? <SymbolPicker connection={connection} /> : <p>Available once the demo account is verified.</p>}
        </Step>

        <Step n={6} {...steps[5]} open={open.has(5)} onToggle={() => toggle(5)}>
          {connection ? (
            <div className="space-y-3">
              <ConnectorStatusBadge state={state} size="md" />
              <dl className="divide-line-soft max-w-md divide-y">
                <Fact label={<Term k="heartbeat">Last heartbeat</Term>}>
                  {agent?.last_heartbeat_at ? <time dateTime={agent.last_heartbeat_at} title={formatDateTime(agent.last_heartbeat_at, prefs)}>{formatRelativeTime(agent.last_heartbeat_at, now)}</time> : 'Never'}
                </Fact>
                <Fact label="Last status report">{connection.last_report_at ? formatRelativeTime(connection.last_report_at, now) : 'Never'}</Fact>
                <Fact label="Last account update">{connection.last_account_at ? formatRelativeTime(connection.last_account_at, now) : 'Never'}</Fact>
                <Fact label="Last price update">{connection.last_quotes_at ? formatRelativeTime(connection.last_quotes_at, now) : 'Never'}</Fact>
                <Fact label="Broker time zone">
                  {connection.broker_utc_offset_minutes === null || connection.broker_offset_source === 'unknown'
                    ? 'Not determined yet (needs live ticks)'
                    : `UTC${connection.broker_utc_offset_minutes >= 0 ? '+' : '−'}${Math.abs(connection.broker_utc_offset_minutes / 60)} (${connection.broker_offset_source})`}
                </Fact>
                <Fact label="Update intervals">
                  prices ~{connection.quote_interval_ms / 1000} s · account {connection.account_interval_s} s · history snapshot {connection.snapshot_interval_s / 60} min
                </Fact>
              </dl>
              <p className="text-fg-3 text-xs">
                “Connected” requires a status report within the last 90 seconds and a heartbeat within 45 seconds. Your computer and MT5 must be
                on: the connector does not run when your PC is off.
              </p>
              <IntervalSettings key={connection.id} connection={connection} />
            </div>
          ) : (
            <p>Nothing connected yet.</p>
          )}
        </Step>

        <Step n={7} {...steps[6]} open={open.has(6)} onToggle={() => toggle(6)}>
          <p>
            <strong>Disconnect</strong> stops this website from accepting data from the connector. It cannot stop the program on your
            computer — to do that, press Ctrl+C in its window or run <code>.\tradepilot-connector.cmd stop</code>. <strong>Revoke</strong>{' '}
            permanently invalidates the connector’s key.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connection && connection.status !== 'disconnected' && (
              <Button size="sm" variant="secondary" leadingIcon={<Unplug />} onClick={() => setConfirm('disconnect')}>
                Disconnect data feed
              </Button>
            )}
            {connection && (connection.status === 'disconnected' || connection.status === 'blocked') && paired && (
              <Button size="sm" variant="secondary" leadingIcon={<PlugZap />} loading={actions.resume.isPending} onClick={() => run(() => actions.resume.mutateAsync({ connectionId: connection.id, acceptNewAccount: false }), 'Reconnecting — the connector verifies the account again')}>
                Reconnect
              </Button>
            )}
            {paired && (
              <Button size="sm" variant="danger" leadingIcon={<KeyRound />} onClick={() => setConfirm('revoke')}>
                Revoke connector
              </Button>
            )}
            {!connection && !paired && <span className="text-fg-3 inline-flex items-center gap-1.5"><CircleDashed className="size-4" aria-hidden /> Nothing to disconnect.</span>}
          </div>
        </Step>
      </ol>

      <ConfirmationDialog
        open={confirm === 'disconnect'}
        onOpenChange={(o) => !o && setConfirm(null)}
        icon={<Plug className="text-warning size-5" />}
        title="Disconnect the data feed?"
        description="TradePilot will refuse further data from this connector until you reconnect. Stored values stay visible, marked as not current. The program on your computer keeps running until you stop it there."
        confirmLabel="Disconnect"
        onConfirm={() => {
          setConfirm(null);
          if (connection) void run(() => actions.disconnect.mutateAsync(connection.id), 'Data feed disconnected');
        }}
      />
      <ConfirmationDialog
        open={confirm === 'accept'}
        onOpenChange={(o) => !o && setConfirm(null)}
        icon={<CircleAlert className="text-warning size-5" />}
        title="Use the new account?"
        description="The stored data of the previously approved account (balances, equity history, positions, prices) is deleted, and the connector verifies the account that is logged in now. It must still be a demo account."
        confirmLabel="Use new account"
        onConfirm={() => {
          setConfirm(null);
          if (connection) void run(() => actions.resume.mutateAsync({ connectionId: connection.id, acceptNewAccount: true }), 'Waiting for the new account to be verified');
        }}
      />
      <ConfirmationDialog
        open={confirm === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        icon={<KeyRound className="text-negative size-5" />}
        title="Revoke this connector?"
        description="Its key stops working immediately and the connection is disconnected. To connect again, pair the computer with a new code (run `reset` then `pair` on the computer)."
        confirmLabel="Revoke"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirm(null);
          if (agent) void run(() => actions.revoke.mutateAsync(agent.id), 'Connector revoked');
        }}
      />
    </>
  );
}
