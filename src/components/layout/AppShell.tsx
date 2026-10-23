import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { PageSkeleton, TooltipProvider } from '@/components/ui';
import { usePreferences } from '@/lib/preferences';
import { pageVariants } from '@/lib/motion';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function ApplicationShell() {
  const { pathname, hash } = useLocation();
  const { sidebarCollapsed } = usePreferences();

  // Start each page at the top, unless the link targets a section.
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <TooltipProvider>
      <a
        href="#main"
        className="bg-accent text-accent-ink fixed top-2 left-2 -translate-y-20 rounded-md px-3 py-2 text-sm font-medium focus:translate-y-0"
        style={{ zIndex: 'var(--z-tooltip)' }}
      >
        Skip to content
      </a>
      <Sidebar />
      <div
        className="min-h-dvh transition-[padding] duration-[220ms] ease-standard lg:pl-[var(--tp-shell-offset)]"
        style={{ ['--tp-shell-offset' as string]: sidebarCollapsed ? 'var(--tp-sidebar-collapsed)' : 'var(--tp-sidebar-expanded)' }}
      >
        <TopBar />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1480px] px-4 pt-7 pb-16 outline-none sm:px-6 lg:px-8 lg:pt-9">
          <Suspense fallback={<PageSkeleton />}>
            <motion.div key={pathname} variants={pageVariants} initial="initial" animate="animate">
              <Outlet />
            </motion.div>
          </Suspense>
        </main>
      </div>
    </TooltipProvider>
  );
}
