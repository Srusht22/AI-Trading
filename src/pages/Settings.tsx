import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  BookOpen,
  CircleAlert,
  Coins,
  Database,
  Globe2,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  RotateCcw,
  Settings2,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Callout, ConfirmationDialog, FormField, PageSkeleton, Select, Switch } from '@/components/ui';
import { FormAlert } from '@/components/auth/FormAlert';
import { LiveIndicator } from '@/components/domain/LiveIndicator';
import { PageHeader } from '@/components/layout/PageHeader';
import { glossary, type GlossaryKey } from '@/content/glossary';
import {
  DATE_FORMATS,
  DISPLAY_CURRENCIES,
  NUMBER_FORMATS,
  type NotificationPreferences,
  type SettingsPatch,
  type Theme,
  type UserSettings,
} from '@/domain/settings';
import { useSettings, useUpdateSettings } from '@/hooks/useAccount';
import { cn } from '@/lib/cn';
import { deviceTimeZone, formatDateTime, supportedTimeZones } from '@/lib/datetime';
import { isAppError, toAppError } from '@/lib/errors';
import { useLiveStatus } from '@/lib/live';
import { usePreferences } from '@/lib/preferences';
import { clearStoredPreferences } from '@/lib/storage';
import { useThemeControl } from '@/lib/theme';
import { useToast } from '@/lib/toast';

const sections: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'currency', label: 'Currency display', icon: Coins },
  { id: 'timezone', label: 'Date & time', icon: Globe2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'ai', label: 'AI preferences', icon: Sparkles },
  { id: 'connector', label: 'Connector', icon: PlugZap },
  { id: 'security', label: 'Security', icon: KeyRound },
  { id: 'data', label: 'Data management', icon: Database },
  { id: 'glossary', label: 'Glossary', icon: BookOpen },
];

const dateFormatLabel: Record<(typeof DATE_FORMATS)[number], string> = {
  medium: 'Readable (Sep 30, 2026)',
  iso: 'ISO (2026-09-30)',
  dmy: 'Day first (30/09/2026)',
  mdy: 'Month first (09/30/2026)',
};

const numberFormatLabel: Record<(typeof NUMBER_FORMATS)[number], string> = {
  'en-US': '1,234.56 (US)',
  'en-GB': '1,234.56 (UK)',
  'de-DE': '1.234,56 (Germany)',
  'fr-FR': '1 234,56 (France)',
};

type Editable = Omit<UserSettings, 'user_id' | 'revision' | 'created_at' | 'updated_at' | 'theme'>;
const editableKeys = ['display_currency', 'timezone', 'date_format', 'number_format', 'show_beginner_help', 'notification_preferences'] as const;

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <PageSkeleton />;
  if (settings.isError) {
    const error = toAppError(settings.error, 'load your settings');
    return (
      <>
        <PageHeader title="Settings" />
        <Callout
          tone="danger"
          title="Your settings couldn’t be loaded"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void settings.refetch()}>
              Try again
            </Button>
          }
        >
          {error.userMessage}
        </Callout>
      </>
    );
  }
  return <SettingsForm stored={settings.data} />;
}

function SettingsForm({ stored }: { stored: UserSettings }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const live = useLiveStatus();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const highlightTerm = params.get('term') as GlossaryKey | null;
  // Only the fields the user has changed; everything else shows the stored value.
  const [draft, setDraft] = useState<Partial<Editable>>({});
  const [saveError, setSaveError] = useState<ReturnType<typeof toAppError> | null>(null);

  const value = <K extends keyof Editable>(k: K): Editable[K] => (k in draft ? (draft[k] as Editable[K]) : stored[k]);
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => {
    setSaveError(null);
    setDraft((d) => {
      const next = { ...d, [k]: v };
      if (sameValue(v, stored[k])) delete next[k];
      return next;
    });
  };

  const changed = useMemo(() => editableKeys.filter((k) => k in draft && !sameValue(draft[k], stored[k])), [draft, stored]);
  const dirty = changed.length > 0;

  useEffect(() => {
    const target = highlightTerm ? `term-${highlightTerm}` : hash.slice(1);
    if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
  }, [hash, highlightTerm]);

  const save = () => {
    const patch: SettingsPatch = Object.fromEntries(changed.map((k) => [k, draft[k]]));
    update.mutate(patch, {
      onSuccess: () => {
        setDraft({});
        toast({ tone: 'success', title: 'Settings saved', description: 'Your preferences are stored in your account.' });
      },
      onError: (error) => {
        const appError = toAppError(error, 'save your settings');
        if (isAppError(error) && error.kind === 'conflict') setDraft({});
        setSaveError(appError);
      },
    });
  };

  const device = deviceTimeZone();
  const zones = useMemo(() => supportedTimeZones(), []);
  const notify = value('notification_preferences');
  const setNotify = (k: keyof NotificationPreferences, v: boolean) => set('notification_preferences', { ...notify, [k]: v });
  const exampleIso = useMemo(() => new Date().toISOString(), []);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Preferences saved to your account. Sections marked “Later phase” describe features that don’t exist yet."
        actions={<LiveIndicator status={live.settings} />}
      />

      <div className="grid grid-cols-1 gap-8 pb-24 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-[calc(var(--tp-header-height)+24px)] lg:self-start">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
            {sections.map((s) => {
              const Icon = s.icon;
              const active = hash === `#${s.id}`;
              return (
                <li key={s.id} className="shrink-0">
                  <a
                    href={`#${s.id}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors',
                      active ? 'bg-raised-hover text-fg' : 'text-fg-2 hover:text-fg hover:bg-raised-hover',
                    )}
                  >
                    <Icon className="text-fg-3 size-4" aria-hidden /> {s.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Group id="general" title="General" description="How TradePilot explains things.">
            <Switch
              checked={value('show_beginner_help')}
              onCheckedChange={(v) => set('show_beginner_help', v)}
              label="Show beginner explanations"
              description="Keep the plain-English help buttons next to specialist terms such as drawdown and profit factor."
            />
          </Group>

          <AppearanceGroup />

          <Group id="currency" title="Currency display" description="How money is shown in summaries.">
            <FormField label="Display currency" hint="Display preference only. It never changes the base currency of a trading account.">
              <Select value={value('display_currency')} onChange={(e) => set('display_currency', e.target.value as Editable['display_currency'])}>
                {DISPLAY_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Number format">
              <Select value={value('number_format')} onChange={(e) => set('number_format', e.target.value as Editable['number_format'])}>
                {NUMBER_FORMATS.map((n) => (
                  <option key={n} value={n}>
                    {numberFormatLabel[n]}
                  </option>
                ))}
              </Select>
            </FormField>
          </Group>

          <Group id="timezone" title="Date & time" description="All times are stored in UTC and shown in the timezone you choose here.">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Display timezone">
                <Select value={value('timezone')} onChange={(e) => set('timezone', e.target.value)}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Date format">
                <Select value={value('date_format')} onChange={(e) => set('date_format', e.target.value as Editable['date_format'])}>
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {dateFormatLabel[f]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            {value('timezone') !== device && (
              <Callout
                tone="info"
                actions={
                  <Button size="sm" variant="secondary" onClick={() => set('timezone', device)}>
                    Use {device}
                  </Button>
                }
              >
                This device uses <span className="text-fg">{device}</span>.
              </Callout>
            )}
            <p className="text-fg-3 text-xs">
              Preview: now is{' '}
              <span className="text-fg num">
                {formatDateTime(exampleIso, { timeZone: value('timezone'), dateFormat: value('date_format'), locale: value('number_format') })}
              </span>
              . Broker-server times from MT5 will be labelled separately when that data exists.
            </p>
          </Group>

          <Group id="notifications" title="Notifications" description="Which alerts you want. Saved now; TradePilot will start sending them once backtests and the connector exist.">
            <Switch checked={notify.backtests} onCheckedChange={(v) => setNotify('backtests', v)} label="Backtest finished or failed" />
            <Switch
              checked={notify.connection}
              onCheckedChange={(v) => setNotify('connection', v)}
              label="MT5 connection lost"
              description="Recommended: you’ll know when demo robots stop being monitored."
            />
            <Switch checked={notify.approvals} onCheckedChange={(v) => setNotify('approvals', v)} label="Approval requested" />
            <Switch checked={notify.research} onCheckedChange={(v) => setNotify('research', v)} label="New AI research proposal" />
          </Group>

          <Group id="ai" title="AI preferences" description="Explanation style, citation rules and provider choice." later>
            <p className="text-fg-2 text-sm">No AI provider is integrated yet, so there is nothing to configure. These options arrive with the AI Analyst.</p>
          </Group>

          <Group id="connector" title="Connector" description="Reconnection behaviour and preferred host (computer or VPS)." later>
            <p className="text-fg-2 text-sm">
              The Windows connector doesn’t exist yet. See{' '}
              <Link to="/connections" className="text-accent hover:underline">
                Connections & VPS
              </Link>{' '}
              for how it will work.
            </p>
          </Group>

          <Group id="security" title="Security" description="Password, sessions and your security activity log.">
            <Button asChild variant="secondary">
              <Link to="/account">
                <KeyRound aria-hidden /> Open account security
              </Link>
            </Button>
          </Group>

          <DataGroup />

          <Group id="glossary" title="Glossary" description="Every specialist term used in TradePilot, in plain English.">
            <dl className="divide-line-soft -my-2 divide-y">
              {(Object.keys(glossary) as GlossaryKey[]).map((k) => {
                const g = glossary[k];
                return (
                  <div
                    key={k}
                    id={`term-${k}`}
                    className={cn('scroll-mt-24 rounded-md py-3 transition-colors', highlightTerm === k && 'bg-accent-soft -mx-3 px-3')}
                  >
                    <dt className="text-fg text-sm font-medium">{g.term}</dt>
                    <dd className="text-fg-2 mt-0.5 text-sm leading-relaxed">{g.definition}</dd>
                    {'more' in g && <dd className="text-fg-3 mt-1 text-xs leading-relaxed">{g.more}</dd>}
                  </div>
                );
              })}
            </dl>
          </Group>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        count={changed.length}
        saving={update.isPending}
        error={saveError}
        onSave={save}
        onDiscard={() => {
          setDraft({});
          setSaveError(null);
        }}
      />
    </>
  );
}

function SaveBar(props: { dirty: boolean; count: number; saving: boolean; error: ReturnType<typeof toAppError> | null; onSave: () => void; onDiscard: () => void }) {
  const visible = props.dirty || !!props.error;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-4 pb-4 lg:pl-[calc(var(--tp-shell-offset)+16px)]"
          style={{ zIndex: 'var(--z-header)' }}
        >
          <div
            role="region"
            aria-label="Unsaved settings"
            className="bg-raised border-line shadow-lg pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-xl border p-3 pl-4"
          >
            {props.error ? (
              <div className="min-w-0 flex-1 basis-64">
                <FormAlert
                  error={props.error}
                  className="border-0 bg-transparent p-0"
                />
                {props.error.kind !== 'conflict' && (
                  <p className="text-fg-3 mt-1 pl-6.5 text-xs">Your previous preferences have been retained. Your edits are still here.</p>
                )}
              </div>
            ) : (
              <p className="text-fg flex flex-1 basis-48 items-center gap-2 text-sm">
                <CircleAlert className="text-warning size-4 shrink-0" aria-hidden />
                {props.count === 1 ? '1 unsaved change' : `${props.count} unsaved changes`}
              </p>
            )}
            <div className="flex gap-2">
              {!props.dirty && (
                <Button variant="ghost" size="sm" onClick={props.onDiscard}>
                  Dismiss
                </Button>
              )}
              {props.dirty && (
                <Button variant="ghost" size="sm" onClick={props.onDiscard} disabled={props.saving}>
                  Discard
                </Button>
              )}
              {props.dirty && (
                <Button variant="primary" size="sm" onClick={props.onSave} loading={props.saving}>
                  {props.error ? 'Try again' : 'Save changes'}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AppearanceGroup() {
  const { theme, setTheme, saving } = useThemeControl();
  const { sidebarCollapsed, setSidebarCollapsed } = usePreferences();
  return (
    <Group id="appearance" title="Appearance" description="The theme is saved to your account as soon as you pick it.">
      <fieldset>
        <legend className="text-fg mb-2 flex items-center gap-2 text-sm font-medium">
          Theme {saving && <span className="text-fg-3 text-xs font-normal">Saving…</span>}
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
          <ThemeOption value="dark" current={theme} onSelect={setTheme} icon={Moon} label="Dark" hint="Default. Easy on the eyes for long sessions." />
          <ThemeOption value="light" current={theme} onSelect={setTheme} icon={Sun} label="Light" hint="Better in bright rooms." />
        </div>
      </fieldset>
      <Switch
        checked={sidebarCollapsed}
        onCheckedChange={setSidebarCollapsed}
        label="Compact sidebar"
        description="This device only. Shows just icons in the desktop navigation."
      />
      <div className="bg-sunken border-line-soft flex items-start gap-3 rounded-lg border p-3.5">
        <Monitor className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-fg-2 text-sm">
          Animations follow your operating system’s <span className="text-fg">reduce motion</span> setting automatically.
        </p>
      </div>
    </Group>
  );
}

function DataGroup() {
  const { showSampleData, setShowSampleData, resetPreferences } = usePreferences();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <Group id="data" title="Data management" description="What this browser remembers on top of your account.">
      <Switch
        checked={showSampleData}
        onCheckedChange={setShowSampleData}
        label="Preview pages with sample data"
        description="This device only. Fills sections that have no real data source yet with clearly labelled, invented examples."
      />
      <div className="border-line-soft flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div>
          <p className="text-fg text-sm font-medium">Reset this device’s preferences</p>
          <p className="text-fg-3 text-xs">Sidebar layout and sample-data preview. Your account settings are not affected.</p>
        </div>
        <Button variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
          Reset device preferences
        </Button>
      </div>
      <ConfirmationDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset this device’s preferences?"
        description="The sidebar layout and sample-data preview on this device return to their defaults. Settings saved to your account stay as they are."
        confirmLabel="Reset device preferences"
        onConfirm={() => {
          clearStoredPreferences();
          resetPreferences();
          toast({ tone: 'success', title: 'Device preferences reset' });
        }}
      />
    </Group>
  );
}

function Group({ id, title, description, later, children }: { id: string; title: string; description?: string; later?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('surface scroll-mt-24 p-5 sm:p-6', later && 'opacity-90')}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="text-fg text-md font-semibold">
            {title}
          </h2>
          {description && <p className="text-fg-3 mt-0.5 text-sm">{description}</p>}
        </div>
        {later && <Badge>Later phase</Badge>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function ThemeOption({
  value,
  current,
  onSelect,
  icon: Icon,
  label,
  hint,
}: {
  value: Theme;
  current: Theme;
  onSelect: (t: Theme) => void;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  const checked = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => onSelect(value)}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-left transition-[border-color,background-color]',
        checked ? 'bg-accent-soft border-[color-mix(in_srgb,var(--tp-accent)_45%,transparent)]' : 'border-line hover:border-line-strong bg-sunken',
      )}
    >
      <Icon className={cn('mt-0.5 size-4', checked ? 'text-accent' : 'text-fg-3')} aria-hidden />
      <span className="flex-1">
        <span className="text-fg block text-sm font-medium">{label}</span>
        <span className="text-fg-3 block text-xs">{hint}</span>
      </span>
      <span className={cn('mt-0.5 flex size-4 items-center justify-center rounded-full border', checked ? 'border-accent' : 'border-line-strong')} aria-hidden>
        {checked && <span className="bg-accent size-2 rounded-full" />}
      </span>
    </button>
  );
}
