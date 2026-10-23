import { Bot, ChevronRight, Code2, Library } from 'lucide-react';
import type { Compatibility, DemoStatus, RiskLevel, Robot } from '@/data/types';
import { Badge, Card, StatusBadge, type Status, type Tone } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';

export const compatibilityInfo: Record<Compatibility, { status: Status; label: string }> = {
  compatible: { status: 'success', label: 'Compatible' },
  needs_review: { status: 'pending', label: 'Needs review' },
  not_checked: { status: 'idle', label: 'Not checked' },
  incompatible: { status: 'failed', label: 'Not compatible' },
};

export const demoStatusInfo: Record<DemoStatus, { status: Status; label: string }> = {
  running: { status: 'running', label: 'Running in demo' },
  stopped: { status: 'stopped', label: 'Stopped' },
  not_deployed: { status: 'idle', label: 'Not in demo' },
};

export const riskInfo: Record<RiskLevel, { tone: Tone; label: string }> = {
  low: { tone: 'neutral', label: 'Lower risk' },
  medium: { tone: 'warning', label: 'Moderate risk' },
  high: { tone: 'negative', label: 'High risk' },
};

interface RobotCardProps {
  robot: Robot;
  onView: (robot: Robot) => void;
}

export function RobotCard({ robot, onView }: RobotCardProps) {
  const compat = compatibilityInfo[robot.compatibility];
  const demo = demoStatusInfo[robot.demoStatus];
  const risk = riskInfo[robot.risk];
  const OriginIcon = robot.origin === 'custom' ? Code2 : Library;
  return (
    <Card as="article" padding="none" interactive className="flex flex-col">
      <div className="flex items-start gap-3 p-5 pb-4">
        <span className="bg-sunken border-line-soft flex size-10 shrink-0 items-center justify-center rounded-lg border">
          <Bot className="text-accent size-5" aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-fg truncate text-md font-semibold">
            {robot.name} <span className="text-fg-3 num font-normal">v{robot.version}</span>
          </h3>
          <p className="text-fg-3 mt-0.5 flex items-center gap-1.5 text-xs">
            <OriginIcon className="size-3.5" aria-hidden />
            {robot.origin === 'custom' ? 'Custom strategy' : 'Existing robot'} · {robot.style}
          </p>
        </div>
      </div>
      <p className="text-fg-2 line-clamp-3 px-5 text-sm leading-relaxed">{robot.summary}</p>
      <div className="flex flex-wrap gap-1.5 px-5 pt-4">
        <Badge tone="neutral">{robot.symbols.join(', ')}</Badge>
        <Badge tone="neutral">{robot.timeframe}</Badge>
        <Badge tone={risk.tone}>{risk.label}</Badge>
      </div>
      <dl className="border-line-soft mt-5 grid grid-cols-2 gap-px border-t text-sm">
        <div className="p-4 pl-5">
          <dt className="text-fg-3 text-xs">Last backtest</dt>
          <dd className="mt-1">
            {robot.lastBacktest ? (
              <span className="num text-fg">
                {formatPercent(robot.lastBacktest.netProfitPct, 1, true)}
                <span className="text-fg-3"> · DD {formatPercent(robot.lastBacktest.maxDrawdownPct)}</span>
              </span>
            ) : (
              <span className="text-fg-3">Not tested yet</span>
            )}
          </dd>
        </div>
        <div className="border-line-soft border-l p-4">
          <dt className="text-fg-3 text-xs">Compatibility</dt>
          <dd className="mt-1">
            <StatusBadge status={compat.status}>{compat.label}</StatusBadge>
          </dd>
        </div>
      </dl>
      <div className="border-line-soft mt-auto flex items-center justify-between gap-2 border-t px-5 py-3">
        <StatusBadge status={demo.status}>{demo.label}</StatusBadge>
        <button
          type="button"
          onClick={() => onView(robot)}
          className={cn('text-fg-2 hover:text-fg flex items-center gap-1 rounded-md text-sm font-medium transition-colors')}
          aria-label={`View details for ${robot.name}`}
        >
          View details <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </Card>
  );
}
