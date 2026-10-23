import { useLocation } from 'react-router-dom';
import { navItemForPath } from '@/config/navigation';
import { Breadcrumbs } from './Breadcrumbs';
import { DemoEnvironmentBadge } from './DemoEnvironmentBadge';
import { LogoMark } from './Logo';
import { MobileNavigation } from './MobileNavigation';
import { NotificationPopover } from './NotificationPopover';
import { SearchControl } from './SearchControl';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

export function TopBar() {
  const { pathname } = useLocation();
  const current = navItemForPath(pathname);
  const crumbs = [{ label: 'Workspace', to: '/' }, { label: current?.label ?? 'Not found' }];

  return (
    <header
      className="bg-[color-mix(in_srgb,var(--tp-canvas)_82%,transparent)] border-line-soft sticky top-0 flex h-[var(--tp-header-height)] items-center gap-2 border-b px-3 backdrop-blur-md sm:px-5 lg:px-8"
      style={{ zIndex: 'var(--z-header)' }}
    >
      <MobileNavigation />
      <LogoMark size={28} className="mr-1 lg:hidden" />
      <Breadcrumbs items={crumbs} className="hidden sm:block" />

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1.5">
        <DemoEnvironmentBadge className="mr-1 hidden md:inline-flex" />
        <DemoEnvironmentBadge compact className="mr-0.5 md:hidden" />
        <SearchControl />
        <NotificationPopover />
        {/* On phones the theme switch lives in the workspace menu to keep the bar uncluttered. */}
        <div className="hidden sm:flex">
          <ThemeToggle />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
