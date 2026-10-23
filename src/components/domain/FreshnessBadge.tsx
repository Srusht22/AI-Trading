import { CircleDashed, CircleDot, Clock, Eye, History, Loader2, type LucideIcon, Unplug } from 'lucide-react';
import type { DataFreshness, FreshnessState } from '@/domain/freshness';
import { freshnessLabel } from '@/domain/freshness';
import { Badge, Tooltip, type Tone } from '@/components/ui';

const visual: Record<FreshnessState, { icon: LucideIcon; tone: Tone }> = {
  live: { icon: CircleDot, tone: 'positive' },
  stale: { icon: Clock, tone: 'warning' },
  disconnected: { icon: Unplug, tone: 'negative' },
  loading_history: { icon: Loader2, tone: 'info' },
  historical: { icon: History, tone: 'neutral' },
  unavailable: { icon: CircleDashed, tone: 'neutral' },
  sample: { icon: Eye, tone: 'info' },
};

function explain(f: DataFreshness): string {
  switch (f.state) {
    case 'live':
      return `Receiving current updates. Last update ${new Date(f.lastUpdateAt).toISOString().replace('T', ' ').slice(0, 19)} UTC.`;
    case 'stale':
      return f.lastUpdateAt ? 'Connected, but no recent data has arrived. Figures may be out of date.' : 'Connected, but no data has arrived yet.';
    case 'disconnected':
      return 'The data source is disconnected. Figures shown are the last ones received.';
    case 'loading_history':
      return 'Loading historical data.';
    case 'historical':
      return 'Historical data only — this view does not update.';
    case 'unavailable':
      return f.reason;
    case 'sample':
      return 'Invented sample data for previewing the layout. Not a real result.';
  }
}

/** States how current the displayed data is — "connected" alone never implies "current". */
export function FreshnessBadge({ freshness }: { freshness: DataFreshness }) {
  const v = visual[freshness.state];
  return (
    <Tooltip content={explain(freshness)}>
      <span tabIndex={0} className="inline-flex rounded-sm">
        <Badge tone={v.tone} icon={v.icon}>
          {freshnessLabel[freshness.state]}
        </Badge>
      </span>
    </Tooltip>
  );
}
