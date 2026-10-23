import { CircleDot, Loader2, RefreshCw } from 'lucide-react';
import type { LiveStatus } from '@/services/types';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Truthful status of a real-time subscription to account data. */
export function LiveIndicator({ status, className }: { status: LiveStatus; className?: string }) {
  const map = {
    live: { icon: CircleDot, text: 'Live', tip: 'Updates appear here as soon as they are saved, including from other tabs and devices.', cls: 'text-positive' },
    connecting: { icon: Loader2, text: 'Connecting', tip: 'Connecting to live updates…', cls: 'text-fg-3 [&_svg]:animate-spin' },
    unavailable: {
      icon: RefreshCw,
      text: 'Auto-refresh',
      tip: 'Live updates are unavailable right now. This view refreshes after your own changes and when you return to the tab.',
      cls: 'text-fg-3',
    },
    closed: { icon: RefreshCw, text: 'Auto-refresh', tip: 'This view refreshes after your own changes and when you return to the tab.', cls: 'text-fg-3' },
  }[status];
  const Icon = map.icon;
  return (
    <Tooltip content={map.tip}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-1.5 rounded-sm text-xs font-medium', map.cls, className)}>
        <Icon className="size-3.5" aria-hidden />
        {map.text}
      </span>
    </Tooltip>
  );
}
