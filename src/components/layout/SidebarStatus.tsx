import { Link } from 'react-router-dom';
import { Cpu, FlaskConical, Settings2, Sparkles, type LucideIcon } from 'lucide-react';
import { integrationStatus, connectionStateLabel, type ConnectionState } from '@/config/integrations';
import { ConnectionStateIcon } from '@/components/domain/ConnectionStatus';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useConnector } from '@/hooks/useMt5';
import { connectorStateText, type ConnectorState } from '@/domain/mt5';

interface Row {
  id: string;
  label: string;
  icon: LucideIcon;
  state: ConnectionState;
  text: string;
  href: string;
}

/** Compact wording for the narrow sidebar; full wording is used elsewhere. */
const shortLabel = (s: ConnectionState) => (s === 'unavailable' ? 'Later phase' : connectionStateLabel[s]);

const ai = integrationStatus.find((s) => s.id === 'ai')!;

const mt5State: Record<ConnectorState, ConnectionState> = {
  not_paired: 'not_configured',
  connector_unavailable: 'not_connected',
  connecting: 'connecting',
  verification_required: 'connecting',
  unsupported_terminal: 'error',
  blocked_account_type: 'error',
  account_changed: 'error',
  auth_error: 'error',
  disconnected: 'not_connected',
  stale: 'degraded',
  connected: 'connected',
};

/** Compact system status at the foot of the sidebar, from real reports. */
export function SidebarStatus({ collapsed }: { collapsed?: boolean }) {
  const connector = useConnector();
  const state = connector.loading ? 'connecting' : mt5State[connector.state];
  const rows: Row[] = [
    { id: 'mt5', label: 'MT5', icon: Cpu, state, text: connector.loading ? 'Checking' : connectorStateText[connector.state].label.replace(/^Blocked: .*/, 'Blocked'), href: '/connections' },
    { id: 'ai', label: 'AI service', icon: Sparkles, state: ai.state, text: shortLabel(ai.state), href: '/ai-analyst' },
    { id: 'env', label: 'Mode', icon: FlaskConical, state: 'unavailable', text: 'Demo only', href: '/demo-trading' },
  ];
  return (
    <div className="space-y-0.5" aria-label="System status" role="group">
      {!collapsed && <p className="eyebrow mb-2 px-3">System status</p>}
      {rows.map((r) => {
        const Icon = r.icon;
        const content = (
          <Link
            to={r.href}
            aria-label={`${r.label}: ${r.text}`}
            className="text-fg-2 hover:text-fg hover:bg-raised-hover flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors"
          >
            <span className="relative">
              <Icon className="text-fg-3 size-4" aria-hidden />
              {collapsed && (
                <span className="bg-panel absolute -right-1.5 -bottom-1.5 rounded-full">
                  <ConnectionStateIcon state={r.state} className="size-3" />
                </span>
              )}
            </span>
            <span className={cn('flex min-w-0 flex-1 items-center justify-between gap-2', collapsed && 'sr-only')}>
              <span className="truncate">{r.label}</span>
              <span className="text-fg-3 flex items-center gap-1 text-xs whitespace-nowrap">
                {r.id === 'env' ? (
                  <FlaskConical className="text-warning size-3" aria-hidden />
                ) : (
                  <ConnectionStateIcon state={r.state} className="size-3" />
                )}
                {r.text}
              </span>
            </span>
          </Link>
        );
        return collapsed ? (
          <Tooltip key={r.id} side="right" content={`${r.label}: ${r.text}`}>
            {content}
          </Tooltip>
        ) : (
          <div key={r.id}>{content}</div>
        );
      })}
      <SettingsLink collapsed={collapsed} />
    </div>
  );
}

function SettingsLink({ collapsed }: { collapsed?: boolean }) {
  const link = (
    <Link
      to="/settings#appearance"
      aria-label="Preferences"
      className="text-fg-2 hover:text-fg hover:bg-raised-hover flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors"
    >
      <Settings2 className="text-fg-3 size-4" aria-hidden />
      <span className={cn(collapsed && 'sr-only')}>Preferences</span>
    </Link>
  );
  return collapsed ? (
    <Tooltip side="right" content="Preferences">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
