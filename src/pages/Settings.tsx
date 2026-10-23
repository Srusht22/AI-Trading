import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Bell,
  BookOpen,
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
import { Badge, Button, ConfirmationDialog, FormField, PreviewTag, Select, Switch } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { glossary, type GlossaryKey } from '@/content/glossary';
import { cn } from '@/lib/cn';
import { usePreferences, type Theme } from '@/lib/preferences';
import { clearStoredPreferences } from '@/lib/storage';
import { useToast } from '@/lib/toast';

const sections: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'currency', label: 'Currency display', icon: Coins },
  { id: 'timezone', label: 'Timezone', icon: Globe2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'ai', label: 'AI preferences', icon: Sparkles },
  { id: 'connector', label: 'Connector', icon: PlugZap },
  { id: 'security', label: 'Security', icon: KeyRound },
  { id: 'data', label: 'Data management', icon: Database },
  { id: 'glossary', label: 'Glossary', icon: BookOpen },
];

export default function SettingsPage() {
  const { theme, setTheme, sidebarCollapsed, setSidebarCollapsed, showSampleData, setShowSampleData, resetPreferences } = usePreferences();
  const toast = useToast();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const highlightTerm = params.get('term') as GlossaryKey | null;
  const [confirmReset, setConfirmReset] = useState(false);

  // Preview-only settings: held in component state, never persisted.
  const [startPage, setStartPage] = useState('dashboard');
  const [explainTerms, setExplainTerms] = useState(true);
  const [currency, setCurrency] = useState('USD');
  const [decimals, setDecimals] = useState('2');
  const [timezone, setTimezone] = useState('local');
  const [notify, setNotify] = useState({ backtests: true, connection: true, approvals: true, research: false });
  const [aiDepth, setAiDepth] = useState('beginner');
  const [aiCite, setAiCite] = useState(true);
  const [autoReconnect, setAutoReconnect] = useState(true);

  useEffect(() => {
    const target = highlightTerm ? `term-${highlightTerm}` : hash.slice(1);
    if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
  }, [hash, highlightTerm]);

  return (
    <>
      <PageHeader title="Settings" description="Preferences for this workspace. Some settings are design previews and are labelled as such." />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
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
          <Group id="general" title="General" description="How TradePilot behaves when you open it." preview>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Start page">
                <Select value={startPage} onChange={(e) => setStartPage(e.target.value)}>
                  <option value="dashboard">Dashboard</option>
                  <option value="robots">My Robots</option>
                  <option value="strategy-lab">Strategy Lab</option>
                </Select>
              </FormField>
              <FormField label="Language">
                <Select defaultValue="en">
                  <option value="en">English</option>
                </Select>
              </FormField>
            </div>
            <Switch
              checked={explainTerms}
              onCheckedChange={setExplainTerms}
              label="Show beginner explanations"
              description="Keep plain-English help icons next to specialist terms."
            />
          </Group>

          <Group id="appearance" title="Appearance" description="Saved on this device.">
            <fieldset>
              <legend className="text-fg mb-2 text-sm font-medium">Theme</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
                <ThemeOption value="dark" current={theme} onSelect={setTheme} icon={Moon} label="Dark" hint="Default. Easy on the eyes for long sessions." />
                <ThemeOption value="light" current={theme} onSelect={setTheme} icon={Sun} label="Light" hint="Better in bright rooms." />
              </div>
            </fieldset>
            <Switch
              checked={sidebarCollapsed}
              onCheckedChange={setSidebarCollapsed}
              label="Compact sidebar"
              description="Show only icons in the desktop navigation."
            />
            <div className="bg-sunken border-line-soft flex items-start gap-3 rounded-lg border p-3.5">
              <Monitor className="text-fg-3 mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-fg-2 text-sm">
                Animations follow your operating system’s <span className="text-fg">reduce motion</span> setting automatically.
              </p>
            </div>
          </Group>

          <Group id="currency" title="Currency display" description="How money is shown across the workspace." preview>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Display currency" hint="Accounts keep their own currency; this only affects summaries.">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Decimal places">
                <Select value={decimals} onChange={(e) => setDecimals(e.target.value)}>
                  <option value="0">0 — $10,842</option>
                  <option value="2">2 — $10,842.15</option>
                </Select>
              </FormField>
            </div>
          </Group>

          <Group id="timezone" title="Timezone" description="Which clock dates and times use." preview>
            <FormField label="Show times in" hint="Broker server time is often different from your local time.">
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="local">My local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                <option value="utc">UTC</option>
                <option value="broker">Broker server time</option>
              </Select>
            </FormField>
          </Group>

          <Group id="notifications" title="Notifications" description="Which events should alert you once services are connected." preview>
            <Switch checked={notify.backtests} onCheckedChange={(v) => setNotify((n) => ({ ...n, backtests: v }))} label="Backtest finished or failed" />
            <Switch checked={notify.connection} onCheckedChange={(v) => setNotify((n) => ({ ...n, connection: v }))} label="MT5 connection lost" description="Recommended. You’ll know when demo robots stop being monitored." />
            <Switch checked={notify.approvals} onCheckedChange={(v) => setNotify((n) => ({ ...n, approvals: v }))} label="Approval requested" />
            <Switch checked={notify.research} onCheckedChange={(v) => setNotify((n) => ({ ...n, research: v }))} label="New AI research proposal" />
          </Group>

          <Group id="ai" title="AI preferences" description="How the AI Analyst explains things." preview>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-fg-2 text-sm">AI provider</p>
              <Badge>Not configured</Badge>
            </div>
            <FormField label="Explanation style">
              <Select value={aiDepth} onChange={(e) => setAiDepth(e.target.value)}>
                <option value="beginner">Beginner — plain English, define every term</option>
                <option value="standard">Standard — some trading vocabulary</option>
                <option value="expert">Expert — concise and technical</option>
              </Select>
            </FormField>
            <Switch checked={aiCite} onCheckedChange={setAiCite} label="Always cite the data behind an answer" description="Facts link to the backtest or trade they came from." />
          </Group>

          <Group id="connector" title="Connector" description="Behaviour of the Windows connector once installed." preview>
            <Switch checked={autoReconnect} onCheckedChange={setAutoReconnect} label="Reconnect automatically" description="Try to restore the MT5 link after a network drop." />
            <FormField label="Preferred host">
              <Select defaultValue="local">
                <option value="local">My computer</option>
                <option value="vps">VPS</option>
              </Select>
            </FormField>
          </Group>

          <Group id="security" title="Security" description="Sign-in and credential storage arrive with accounts in a later phase." preview>
            <div className="bg-sunken border-line-soft space-y-3 rounded-lg border p-4 text-sm">
              <Row label="Account sign-in" value={<Badge>Later phase</Badge>} />
              <Row label="Two-step verification" value={<Badge>Later phase</Badge>} />
              <Row label="Stored broker passwords" value={<span className="text-fg-2">None — TradePilot never asks for them here</span>} />
            </div>
          </Group>

          <Group id="data" title="Data management" description="What this browser remembers.">
            <Switch
              checked={showSampleData}
              onCheckedChange={setShowSampleData}
              label="Show sample data"
              description="Fill preview screens with clearly labelled, invented examples. Turn off to see the real (empty) workspace."
            />
            <div className="border-line-soft flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <div>
                <p className="text-fg text-sm font-medium">Reset local preferences</p>
                <p className="text-fg-3 text-xs">Restores theme, sidebar and sample-data settings on this device.</p>
              </div>
              <Button variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
                Reset preferences
              </Button>
            </div>
          </Group>

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

      <ConfirmationDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset local preferences?"
        description="Theme, sidebar layout and sample-data settings on this device return to their defaults. Nothing else is affected."
        confirmLabel="Reset preferences"
        onConfirm={() => {
          clearStoredPreferences();
          resetPreferences();
          toast({ tone: 'success', title: 'Preferences reset', description: 'Local settings are back to their defaults.' });
        }}
      />
    </>
  );
}

function Group({ id, title, description, preview, children }: { id: string; title: string; description?: string; preview?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="surface scroll-mt-24 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="text-fg text-md font-semibold">
            {title}
          </h2>
          {description && <p className="text-fg-3 mt-0.5 text-sm">{description}</p>}
        </div>
        {preview && (
          <span className="flex items-center gap-2">
            <span className="text-fg-3 text-xs">Not saved yet</span>
            <PreviewTag kind="preview" />
          </span>
        )}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-fg">{label}</span>
      {value}
    </div>
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
