import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { queryKeys } from './queryKeys';

export function useRecentAuditEvents(limit = 8) {
  const { audit } = useServices();
  const user = useCurrentUser();
  return useQuery({ queryKey: queryKeys.auditRecent(user.id, limit), queryFn: () => audit.listRecent(user.id, { limit }) });
}

export interface DailyCount {
  /** The calendar day (in the display timezone) encoded as UTC midnight; format with timeZone 'UTC'. */
  t: number;
  day: string;
  count: number;
}

/** Bucket timestamps into calendar days of `timeZone`, oldest first, including empty days. */
export function bucketByDay(timestamps: string[], days: number, timeZone: string, now = new Date()): DailyCount[] {
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const key = keyFmt.format(new Date(ts));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Walk calendar dates from "today in timeZone" (DST-safe: no 24h arithmetic on instants).
  const today = Date.parse(`${keyFmt.format(now)}T00:00:00Z`);
  const out: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * 86_400_000;
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ t, day: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export function useActivityByDay(days: number, timeZone: string) {
  const { audit } = useServices();
  const user = useCurrentUser();
  return useQuery({
    queryKey: [...queryKeys.auditActivity(user.id, days), timeZone],
    queryFn: async () => {
      // One extra day of margin so timezone offsets never cut off the first bucket.
      const since = new Date(Date.now() - (days + 1) * 86_400_000).toISOString();
      const { timestamps, truncated } = await audit.listTimestampsSince(user.id, since);
      return { series: bucketByDay(timestamps, days, timeZone), truncated };
    },
  });
}
