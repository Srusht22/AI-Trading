import type { DateFormat, NumberFormat } from '@/domain/settings';

export interface DisplayPrefs {
  timeZone: string;
  dateFormat: DateFormat;
  locale: NumberFormat;
}

export const defaultDisplayPrefs: DisplayPrefs = { timeZone: 'UTC', dateFormat: 'medium', locale: 'en-US' };

function parts(iso: string, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

/** Short zone name for `iso` in `timeZone`, e.g. "UTC", "BST", "GMT+2". */
export function zoneLabel(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(iso));
  return p.find((x) => x.type === 'timeZoneName')?.value ?? timeZone;
}

/**
 * Render a stored UTC timestamp in the user's display timezone. The zone is
 * always shown so a time is never ambiguous.
 */
export function formatDateTime(iso: string, prefs: DisplayPrefs, { withZone = true } = {}): string {
  const { y, m, d, hh, mm } = parts(iso, prefs.timeZone);
  let date: string;
  switch (prefs.dateFormat) {
    case 'iso':
      date = `${y}-${m}-${d}`;
      break;
    case 'dmy':
      date = `${d}/${m}/${y}`;
      break;
    case 'mdy':
      date = `${m}/${d}/${y}`;
      break;
    default:
      date = new Intl.DateTimeFormat(prefs.locale, { timeZone: prefs.timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  }
  const time = `${hh}:${mm}`;
  return withZone ? `${date}, ${time} ${zoneLabel(iso, prefs.timeZone)}` : `${date}, ${time}`;
}

/** "3 minutes ago" etc., computed against the real current time. */
export function formatRelativeTime(iso: string, now: Date = new Date(), locale = 'en-US'): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function supportedTimeZones(): string[] {
  const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
  const zones = list && list.length ? list : ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'];
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}
