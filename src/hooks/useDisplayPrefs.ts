import { useSettings } from './useAccount';
import { defaultDisplayPrefs, type DisplayPrefs } from '@/lib/datetime';

/** Display preferences from the saved settings (UTC defaults until they load). */
export function useDisplayPrefs(): DisplayPrefs & { loaded: boolean } {
  const { data } = useSettings();
  if (!data) return { ...defaultDisplayPrefs, loaded: false };
  return { timeZone: data.timezone, dateFormat: data.date_format, locale: data.number_format, loaded: true };
}
