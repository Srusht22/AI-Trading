import { Ban, CircleCheck, CircleDashed, CircleOff, Clock, KeyRound, Loader2, Plug, ShieldAlert, TriangleAlert, Unplug, type LucideIcon } from 'lucide-react';
import { Badge, Tooltip, type Tone } from '@/components/ui';
import { connectorStateText, type ConnectorState } from '@/domain/mt5';

const visual: Record<ConnectorState, { icon: LucideIcon; tone: Tone; spin?: boolean }> = {
  not_paired: { icon: CircleDashed, tone: 'neutral' },
  connector_unavailable: { icon: Unplug, tone: 'warning' },
  connecting: { icon: Loader2, tone: 'info', spin: true },
  verification_required: { icon: ShieldAlert, tone: 'warning' },
  unsupported_terminal: { icon: CircleOff, tone: 'negative' },
  blocked_account_type: { icon: Ban, tone: 'negative' },
  account_changed: { icon: TriangleAlert, tone: 'negative' },
  auth_error: { icon: KeyRound, tone: 'negative' },
  disconnected: { icon: Plug, tone: 'neutral' },
  stale: { icon: Clock, tone: 'warning' },
  connected: { icon: CircleCheck, tone: 'positive' },
};

/** Connection state as icon + text + colour, with a plain-English explanation. */
export function ConnectorStatusBadge({ state, size = 'sm' }: { state: ConnectorState; size?: 'sm' | 'md' }) {
  const v = visual[state];
  return (
    <Tooltip content={connectorStateText[state].description}>
      <span tabIndex={0} className="inline-flex rounded-sm" data-connector-state={state}>
        <Badge tone={v.tone} icon={v.icon} size={size} className={v.spin ? '[&_svg]:motion-safe:animate-spin' : undefined}>
          {connectorStateText[state].label}
        </Badge>
      </span>
    </Tooltip>
  );
}

const freshnessVisual = {
  live: { icon: CircleCheck, tone: 'positive' as Tone, label: 'Live' },
  stale: { icon: Clock, tone: 'warning' as Tone, label: 'Not current' },
  disconnected: { icon: Unplug, tone: 'neutral' as Tone, label: 'Last known' },
  none: { icon: CircleDashed, tone: 'neutral' as Tone, label: 'No data yet' },
};

/** Freshness of one piece of MT5 data, always paired with its timestamp elsewhere. */
export function DataFreshnessBadge({ state, tip }: { state: keyof typeof freshnessVisual; tip: string }) {
  const v = freshnessVisual[state];
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex rounded-sm" data-freshness={state}>
        <Badge tone={v.tone} icon={v.icon}>
          {v.label}
        </Badge>
      </span>
    </Tooltip>
  );
}
