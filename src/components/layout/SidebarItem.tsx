import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import type { NavItem } from '@/config/navigation';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { transition } from '@/lib/motion';

interface SidebarItemProps {
  item: NavItem;
  collapsed?: boolean;
  /** Distinguishes animated indicators between the desktop sidebar and mobile drawer. */
  indicatorId: string;
  onNavigate?: () => void;
}

export function SidebarItem({ item, collapsed, indicatorId, onNavigate }: SidebarItemProps) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150',
          'focus-visible:outline-offset-0',
          isActive ? 'text-fg' : 'text-fg-2 hover:text-fg hover:bg-[color-mix(in_srgb,var(--tp-raised-hover)_70%,transparent)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={indicatorId}
              transition={transition.spring}
              className="bg-raised-hover border-line absolute inset-0 rounded-md border"
            >
              <span className="brand-gradient absolute top-2 bottom-2 -left-px w-[3px] rounded-r-full" />
            </motion.span>
          )}
          <Icon
            className={cn('relative size-[18px] shrink-0 transition-colors', isActive ? 'text-accent' : 'text-fg-3 group-hover:text-fg-2')}
            aria-hidden
            strokeWidth={isActive ? 2.1 : 1.85}
          />
          <span
            className={cn(
              'relative truncate transition-[opacity,transform] duration-200',
              collapsed ? 'pointer-events-none -translate-x-1 opacity-0' : 'opacity-100',
            )}
          >
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
