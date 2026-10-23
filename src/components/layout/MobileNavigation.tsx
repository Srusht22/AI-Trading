import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { transition } from '@/lib/motion';
import { LogoMark, Wordmark } from './Logo';
import { NavList } from './Sidebar';
import { SidebarStatus } from './SidebarStatus';

/** Slide-in navigation drawer for tablet and mobile. */
export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <IconButton label="Open navigation menu" icon={<Menu />} className="lg:hidden" tooltip={false} />
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="bg-overlay fixed inset-0 lg:hidden"
                style={{ zIndex: 'var(--z-overlay)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: transition.base }}
                exit={{ opacity: 0, transition: transition.fast }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="bg-panel border-line fixed inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r shadow-lg lg:hidden"
                style={{ zIndex: 'var(--z-overlay)' }}
                initial={{ x: '-100%' }}
                animate={{ x: 0, transition: transition.slow }}
                exit={{ x: '-100%', transition: transition.base }}
              >
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <div className="flex h-[var(--tp-header-height)] shrink-0 items-center gap-2.5 px-4">
                  <LogoMark size={30} />
                  <Wordmark />
                  <Dialog.Close asChild>
                    <IconButton label="Close navigation menu" icon={<X />} className="ml-auto" tooltip={false} />
                  </Dialog.Close>
                </div>
                <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
                  <NavList indicatorId="drawer-active" onNavigate={() => setOpen(false)} />
                </nav>
                <div className="border-line-soft border-t px-3 py-3">
                  <SidebarStatus />
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
