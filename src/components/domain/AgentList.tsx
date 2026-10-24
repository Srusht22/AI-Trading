import { Bot, CircleDashed, CircleDot, ShieldOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge, Tooltip, type Tone } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import { agentPresence, type Agent, type AgentPresence } from '@/domain/tasks';

const presence: Record<AgentPresence, { label: string; icon: LucideIcon; tone: Tone; tip: string }> = {
  online: { label: 'Online', icon: CircleDot, tone: 'positive', tip: 'Sent a heartbeat within the last 45 seconds.' },
  not_responding: { label: 'Not responding', icon: TriangleAlert, tone: 'warning', tip: 'No heartbeat for more than 45 seconds. The agent may be stopped or offline.' },
  never_connected: { label: 'Never connected', icon: CircleDashed, tone: 'neutral', tip: 'Registered, but it has not reported in yet.' },
  revoked: { label: 'Revoked', icon: ShieldOff, tone: 'negative', tip: 'Its credentials were revoked; it can no longer receive work.' },
};

export function AgentPresenceBadge({ agent, now }: { agent: Agent; now: Date }) {
  const p = presence[agentPresence(agent, now)];
  return (
    <Tooltip content={p.tip}>
      <span tabIndex={0} className="inline-flex rounded-sm">
        <Badge tone={p.tone} icon={p.icon}>
          {p.label}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** Registered agents with heartbeat freshness computed against the real clock. */
export function AgentList({ agents, prefs, now }: { agents: Agent[]; prefs: DisplayPrefs; now: Date }) {
  return (
    <ul className="divide-line-soft divide-y" aria-label="Registered agents">
      {agents.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-3">
          <span className="bg-raised border-line flex size-8 shrink-0 items-center justify-center rounded-lg border">
            <Bot className="text-fg-2 size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-fg text-sm font-medium">{a.display_name}</span>
              <AgentPresenceBadge agent={a} now={now} />
            </div>
            <p className="text-fg-3 mt-0.5 text-xs">
              {[a.agent_version && `v${a.agent_version}`, a.platform, a.allowed_capabilities.join(', ')].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-fg-3 shrink-0 text-right text-xs">
            {a.last_heartbeat_at ? (
              <Tooltip content={`Last heartbeat ${formatDateTime(a.last_heartbeat_at, prefs)}`}>
                <time tabIndex={0} dateTime={a.last_heartbeat_at} className="rounded-sm">
                  {formatRelativeTime(a.last_heartbeat_at, now)}
                </time>
              </Tooltip>
            ) : (
              'No heartbeat'
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
