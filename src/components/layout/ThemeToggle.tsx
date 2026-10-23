import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useThemeControl } from '@/lib/theme';
import { transition } from '@/lib/motion';

export function ThemeToggle() {
  const { theme, toggleTheme, saving } = useThemeControl();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      label={`Switch to ${next} theme`}
      onClick={toggleTheme}
      aria-busy={saving || undefined}
      icon={
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            initial={{ opacity: 0, rotate: -30, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1, transition: transition.fast }}
            exit={{ opacity: 0, rotate: 30, scale: 0.8, transition: { duration: 0.1 } }}
            className="flex"
          >
            {theme === 'dark' ? <Moon /> : <Sun />}
          </motion.span>
        </AnimatePresence>
      }
    />
  );
}
