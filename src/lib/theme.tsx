import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { usePreferences } from './preferences';
import { useSettings, useUpdateSettings } from '@/hooks/useAccount';
import { useToast } from './toast';
import { isAppError, logError } from './errors';
import type { Theme } from '@/domain/settings';

interface ThemeControl {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** True while a theme change is being saved to the account. */
  saving: boolean;
  persisted: boolean;
}

const ThemeControlContext = createContext<ThemeControl | null>(null);

/**
 * Inside the signed-in workspace: the saved theme is applied when settings
 * load (and when they change in another tab), and changes are written to the
 * database. The new theme is shown immediately; if saving fails it is
 * reverted and the user is told.
 */
export function PersistedThemeProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme: applyTheme } = usePreferences();
  const settings = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const saved = settings.data?.theme;

  useEffect(() => {
    if (saved && !update.isPending) applyTheme(saved);
  }, [saved, update.isPending, applyTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      // One save at a time: a second write would race on the same revision.
      if (next === theme || update.isPending) return;
      const previous = theme;
      applyTheme(next);
      update.mutate(
        { theme: next },
        {
          onError: (error) => {
            applyTheme(previous);
            logError('Saving theme failed', error);
            toast({
              tone: 'error',
              title: 'Theme not saved',
              description: isAppError(error) ? error.userMessage : 'Your previous theme has been kept. Please try again.',
            });
          },
        },
      );
    },
    [theme, applyTheme, update, toast],
  );

  const value = useMemo<ThemeControl>(
    () => ({ theme, setTheme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'), saving: update.isPending, persisted: true }),
    [theme, setTheme, update.isPending],
  );
  return <ThemeControlContext.Provider value={value}>{children}</ThemeControlContext.Provider>;
}

/** Theme control; persists to the account inside the workspace, device-only elsewhere. */
export function useThemeControl(): ThemeControl {
  const ctx = useContext(ThemeControlContext);
  const prefs = usePreferences();
  if (ctx) return ctx;
  return { theme: prefs.theme, setTheme: prefs.setTheme, toggleTheme: prefs.toggleTheme, saving: false, persisted: false };
}
