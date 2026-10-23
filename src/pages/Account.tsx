import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, BarChart3, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
import { Badge, Button, EmptyState, FormField, Input, SectionHeader, SegmentedControl, Skeleton } from '@/components/ui';
import { FormAlert } from '@/components/auth/FormAlert';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { firstIssue, newPasswordSchema } from '@/components/auth/validation';
import { ActivityChart } from '@/components/charts/ActivityChart';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { AuditEventList } from '@/components/domain/AuditEventList';
import { LiveIndicator } from '@/components/domain/LiveIndicator';
import { PageHeader } from '@/components/layout/PageHeader';
import { displayNameSchema } from '@/domain/profile';
import { useAccess, useProfile, useUpdateDisplayName } from '@/hooks/useAccount';
import { useActivityByDay } from '@/hooks/useAudit';
import { useDisplayPrefs } from '@/hooks/useDisplayPrefs';
import { queryKeys } from '@/hooks/queryKeys';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { formatDateTime } from '@/lib/datetime';
import { toAppError, type AppError } from '@/lib/errors';
import { useLiveStatus } from '@/lib/live';
import { useServices } from '@/lib/services-context';
import type { AuditCursor } from '@/services/types';
import { useToast } from '@/lib/toast';

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" description="Your profile, password and sessions, plus a record of security-relevant activity on this account." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ProfileSection />
          <PasswordSection />
          <SessionsSection />
        </div>
        <div className="space-y-6">
          <ActivityChartSection />
          <ActivityLogSection />
        </div>
      </div>
    </>
  );
}

function ProfileSection() {
  const user = useCurrentUser();
  const profile = useProfile();
  const access = useAccess();
  const update = useUpdateDisplayName();
  const toast = useToast();
  const prefs = useDisplayPrefs();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  // Start from the stored value whenever it (re)loads.
  const stored = profile.data?.display_name ?? '';
  useEffect(() => setName(stored), [stored]);

  const dirty = name.trim() !== stored;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let value: string | null = null;
    if (name.trim()) {
      const parsed = displayNameSchema.safeParse(name);
      if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message);
      value = parsed.data;
    }
    setFieldError(undefined);
    update.mutate(value, { onSuccess: () => toast({ tone: 'success', title: 'Profile saved' }) });
  };

  return (
    <section aria-labelledby="profile-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="profile-title"
        title={
          <>
            <UserRound className="text-fg-3 size-[18px]" aria-hidden /> Profile
          </>
        }
        actions={access.data?.isOwner ? <Badge tone="accent" icon={ShieldCheck}>Workspace owner</Badge> : undefined}
      />
      {profile.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading profile">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10" />
        </div>
      ) : profile.isError ? (
        <FormAlert error={toAppError(profile.error, 'load your profile')} />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <FormAlert error={update.isError ? toAppError(update.error, 'save your profile') : null} />
          <FormField label="Display name" error={fieldError} hint="Shown in greetings. Leave empty to remove it.">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="nickname" />
          </FormField>
          <dl className="bg-sunken border-line-soft grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-fg-3 text-xs">Email</dt>
              <dd className="text-fg mt-0.5 truncate">{user.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-fg-3 text-xs">Member since</dt>
              <dd className="text-fg mt-0.5">{formatDateTime(user.createdAt, prefs)}</dd>
            </div>
          </dl>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
              Save profile
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function PasswordSection() {
  const { auth } = useServices();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = {
      password: firstIssue(newPasswordSchema.safeParse(password)),
      confirm: password === confirm ? undefined : 'The passwords don’t match.',
    };
    setErrors(errs);
    if (errs.password || errs.confirm) return;
    setSaving(true);
    setError(null);
    try {
      await auth.updatePassword(password);
      setPassword('');
      setConfirm('');
      toast({ tone: 'success', title: 'Password changed', description: 'Use your new password next time you sign in.' });
    } catch (err) {
      setError(toAppError(err, 'change your password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="password-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="password-title"
        title={
          <>
            <KeyRound className="text-fg-3 size-[18px]" aria-hidden /> Change password
          </>
        }
        description="At least 10 characters, with upper- and lower-case letters and a number."
      />
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert error={error} />
        <FormField label="New password" error={errors.password}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm}>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={saving} disabled={!password}>
            Change password
          </Button>
        </div>
      </form>
    </section>
  );
}

function SessionsSection() {
  const { auth } = useServices();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const signOutOthers = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signOut('others');
      toast({ tone: 'success', title: 'Other sessions signed out', description: 'Only this browser remains signed in.' });
    } catch (err) {
      setError(toAppError(err, 'sign out your other sessions'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="sessions-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="sessions-title"
        title={
          <>
            <MonitorSmartphone className="text-fg-3 size-[18px]" aria-hidden /> Sessions
          </>
        }
        description="If you signed in on a device you no longer use, end those sessions here. This browser stays signed in."
      />
      <FormAlert error={error} className="mb-4" />
      <Button variant="secondary" leadingIcon={<LogOut />} loading={busy} onClick={() => void signOutOthers()}>
        Sign out other devices
      </Button>
    </section>
  );
}

type Range = '7' | '14' | '30';

function ActivityChartSection() {
  const prefs = useDisplayPrefs();
  const live = useLiveStatus();
  const [range, setRange] = useState<Range>('14');
  const activity = useActivityByDay(Number(range), prefs.timeZone);
  const total = activity.data?.series.reduce((s, d) => s + d.count, 0) ?? 0;

  return (
    <ChartContainer
      headingLevel="h2"
      title="Account activity"
      explanation={`Security-relevant events recorded per day, in your display timezone (${prefs.timeZone}).`}
      controls={
        <>
          <LiveIndicator status={live.activity} />
          <SegmentedControl
            label="Time range"
            value={range}
            onValueChange={setRange}
            options={[
              { value: '7', label: '7D', ariaLabel: 'Last 7 days' },
              { value: '14', label: '14D', ariaLabel: 'Last 14 days' },
              { value: '30', label: '30D', ariaLabel: 'Last 30 days' },
            ]}
          />
        </>
      }
      height={200}
      empty={
        activity.isPending ? (
          <Skeleton className="h-[200px]" />
        ) : activity.isError ? (
          <FormAlert error={toAppError(activity.error, 'load your activity history')} />
        ) : total === 0 ? (
          <EmptyState size="sm" icon={BarChart3} title="No activity in this period" description="Sign-ins and changes to your profile or settings will appear here." />
        ) : undefined
      }
    >
      {activity.data && <ActivityChart data={activity.data.series} />}
    </ChartContainer>
  );
}

const PAGE_SIZE = 10;

function ActivityLogSection() {
  const { audit } = useServices();
  const user = useCurrentUser();
  const prefs = useDisplayPrefs();
  const live = useLiveStatus();
  const log = useInfiniteQuery({
    queryKey: [...queryKeys.audit(user.id), 'log', PAGE_SIZE],
    initialPageParam: undefined as AuditCursor | undefined,
    queryFn: ({ pageParam }) => audit.listRecent(user.id, { limit: PAGE_SIZE, before: pageParam }),
    getNextPageParam: (last): AuditCursor | undefined => {
      const tail = last.events[last.events.length - 1];
      return last.hasMore && tail ? { createdAt: tail.created_at, id: tail.id } : undefined;
    },
  });
  const events = log.data?.pages.flatMap((p) => p.events) ?? [];
  const olderPageError = log.isFetchNextPageError ? toAppError(log.error, 'load older activity') : null;

  return (
    <section aria-labelledby="log-title" className="surface p-5 sm:p-6">
      <SectionHeader
        id="log-title"
        title={
          <>
            <Activity className="text-fg-3 size-[18px]" aria-hidden /> Security activity
          </>
        }
        description="Recorded by the server. Entries cannot be edited or deleted from the app."
        actions={<LiveIndicator status={live.activity} />}
      />
      {log.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading activity">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : log.isError ? (
        <FormAlert error={toAppError(log.error, 'load your activity')} />
      ) : events.length === 0 ? (
        <EmptyState size="sm" icon={Activity} title="No recorded activity" description="Sign-ins and account changes will be listed here." />
      ) : (
        <>
          <AuditEventList events={events} prefs={prefs} />
          {log.hasNextPage && (
            <div className="border-line-soft mt-5 flex justify-center border-t pt-4">
              <Button variant="ghost" size="sm" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                Show older activity
              </Button>
            </div>
          )}
          <FormAlert className="mt-3" error={olderPageError} />
        </>
      )}
    </section>
  );
}
