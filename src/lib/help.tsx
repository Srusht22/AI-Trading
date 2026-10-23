import { createContext, useContext, type ReactNode } from 'react';
import { useSettings } from '@/hooks/useAccount';

const BeginnerHelpContext = createContext(true);

/** Applies the saved "show beginner explanations" preference to every InfoTip/Term. */
export function BeginnerHelpProvider({ children }: { children: ReactNode }) {
  const { data } = useSettings();
  return <BeginnerHelpContext.Provider value={data?.show_beginner_help ?? true}>{children}</BeginnerHelpContext.Provider>;
}

export function useBeginnerHelp() {
  return useContext(BeginnerHelpContext);
}
