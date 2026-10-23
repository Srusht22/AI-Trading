import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStored, writeStored } from './storage';
import type { Theme } from '@/domain/settings';

export type { Theme };

interface Preferences {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** When true, preview screens render clearly labelled sample data instead of empty states. */
  showSampleData: boolean;
  setShowSampleData: (show: boolean) => void;
  resetPreferences: () => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

/**
 * Device-level UI state.
 *
 *  - `theme` is the theme currently applied. The account's saved theme lives
 *    in the database (user_settings.theme) and is synced in by
 *    <PersistedThemeProvider>; localStorage only caches it so the first paint
 *    does not flash.
 *  - `sidebarCollapsed` and `showSampleData` are deliberately per-device.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored('theme', ['dark', 'light'], 'dark'));
  const [sidebarCollapsed, setCollapsedState] = useState(
    () => readStored('sidebar', ['collapsed', 'expanded'], 'expanded') === 'collapsed',
  );
  const [showSampleData, setSampleState] = useState(
    () => readStored('sample-data', ['on', 'off'], 'off') === 'on',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080C12' : '#F4F6F9');
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeStored('theme', t);
  }, []);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const setSidebarCollapsed = useCallback((c: boolean) => {
    setCollapsedState(c);
    writeStored('sidebar', c ? 'collapsed' : 'expanded');
  }, []);

  const setShowSampleData = useCallback((s: boolean) => {
    setSampleState(s);
    writeStored('sample-data', s ? 'on' : 'off');
  }, []);

  const resetPreferences = useCallback(() => {
    setTheme('dark');
    setSidebarCollapsed(false);
    setShowSampleData(false);
  }, [setTheme, setSidebarCollapsed, setShowSampleData]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      sidebarCollapsed,
      setSidebarCollapsed,
      showSampleData,
      setShowSampleData,
      resetPreferences,
    }),
    [theme, setTheme, toggleTheme, sidebarCollapsed, setSidebarCollapsed, showSampleData, setShowSampleData, resetPreferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
