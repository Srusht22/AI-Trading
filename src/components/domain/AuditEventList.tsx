import { CircleCheck, KeyRound, LogIn, LogOut, type LucideIcon, Settings2, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import type { AuditEvent } from '@/domain/audit';
import { describeAuditEvent } from '@/domain/audit';
import { Tooltip } from '@/components/ui';
import { formatDateTime, formatRelativeTime, type DisplayPrefs } from '@/lib/datetime';
import { cn } from '@/lib/cn';

const icons: Record<string, { icon: LucideIcon; className: string }> = {
  'account.created': { icon: UserPlus, className: 'text-accent bg-accent-soft' },
  'account.email_confirmed': { icon: CircleCheck, className: 'text-positive bg-positive-soft' },
  'auth.session_started': { icon: LogIn, className: 'text-info bg-info-soft' },
  'auth.session_ended': { icon: LogOut, className: 'text-fg-2 bg-line-soft' },
  'auth.password_changed': { icon: KeyRound, className: 'text-warning bg-warning-soft' },
  'profile.updated': { icon: UserRound, className: 'text-fg-2 bg-line-soft' },
  'settings.updated': { icon: Settings2, className: 'text-fg-2 bg-line-soft' },
  'owner.assigned': { icon: ShieldCheck, className: 'text-accent bg-accent-soft' },
};

/** Timeline of recorded account events (real audit records, newest first). */
export function AuditEventList({ events, prefs, now = new Date() }: { events: AuditEvent[]; prefs: DisplayPrefs; now?: Date }) {
  return (
    <ol className="-mb-5">
      {events.map((e, i) => {
        const v = icons[e.event_type] ?? { icon: Settings2, className: 'text-fg-2 bg-line-soft' };
        const Icon = v.icon;
        const { title, detail } = describeAuditEvent(e);
        return (
          <li key={e.id} className="relative flex gap-3.5 pb-5">
            {i < events.length - 1 && <span aria-hidden className="bg-line-soft absolute top-9 bottom-0 left-[15px] w-px" />}
            <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full', v.className)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-fg text-sm font-medium">{title}</p>
                <Tooltip content={formatDateTime(e.created_at, prefs)}>
                  <time tabIndex={0} dateTime={e.created_at} className="text-fg-3 shrink-0 rounded-sm text-xs">
                    {formatRelativeTime(e.created_at, now)}
                  </time>
                </Tooltip>
              </div>
              <p className="text-fg-2 mt-0.5 text-sm leading-relaxed">{detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
