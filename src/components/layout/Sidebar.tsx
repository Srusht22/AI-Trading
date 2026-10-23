import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { primaryNav } from '@/config/navigation';
import { IconButton } from '@/components/ui';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/cn';
import { LogoMark, Wordmark } from './Logo';
import { SidebarItem } from './SidebarItem';
import { SidebarStatus } from './SidebarStatus';

/** Shared navigation list used by the desktop sidebar and mobile drawer. */
export function NavList({ collapsed, indicatorId, onNavigate }: { collapsed?: boolean; indicatorId: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {primaryNav.map((item) => (
        <li key={item.id}>
          <SidebarItem item={item} collapsed={collapsed} indicatorId={indicatorId} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, setSidebarCollapsed } = usePreferences();
  return (
    <aside
      className={cn(
        'bg-panel border-line-soft fixed inset-y-0 left-0 hidden flex-col border-r lg:flex',
        'transition-[width] duration-[220ms] ease-standard',
      )}
      style={{ width: collapsed ? 'var(--tp-sidebar-collapsed)' : 'var(--tp-sidebar-expanded)', zIndex: 'var(--z-sidebar)' }}
    >
      <div className={cn('flex h-[var(--tp-header-height)] shrink-0 items-center gap-2', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-md" aria-label="TradePilot AI — Dashboard">
          <LogoMark size={30} />
          <Wordmark className={cn('transition-opacity duration-200', collapsed ? 'sr-only' : 'opacity-100')} />
        </Link>
        {!collapsed && (
          <IconButton
            label="Collapse sidebar"
            size="sm"
            icon={<PanelLeftClose />}
            aria-expanded
            onClick={() => setSidebarCollapsed(true)}
            className="ml-auto"
            tooltipSide="right"
          />
        )}
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-4">
        <NavList collapsed={collapsed} indicatorId="sidebar-active" />
      </nav>

      <div className="border-line-soft space-y-2 border-t px-3 py-3">
        <SidebarStatus collapsed={collapsed} />
        {collapsed && (
          <div className="border-line-soft flex justify-center border-t pt-2">
            <IconButton
              label="Expand sidebar"
              size="sm"
              icon={<PanelLeftOpen />}
              aria-expanded={false}
              onClick={() => setSidebarCollapsed(false)}
              tooltipSide="right"
            />
          </div>
        )}
      </div>
    </aside>
  );
}
