/**
 * In-memory implementation of the service interfaces — FOR TESTS ONLY.
 *
 * Component tests use it to drive authentication states and inject failures
 * deterministically. It mirrors the database rules that matter to the UI
 * (one profile/settings row per user, revision-checked updates). Real
 * behaviour against Postgres/GoTrue is covered by tests/integration and the
 * pgTAP suite in supabase/tests.
 */
import { AppError } from '@/lib/errors';
import type { AuditEvent } from '@/domain/audit';
import type { Profile } from '@/domain/profile';
import type { UserSettings } from '@/domain/settings';
import type { AuthChangeEvent, AuthSession, LiveStatus, Services } from '@/services/types';

type Listener = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface FakeOptions {
  signedIn?: boolean;
  isOwner?: boolean;
  ownerConfigured?: boolean;
  signupEnabled?: boolean;
  email?: string;
  displayName?: string | null;
}

export interface FakeBackend {
  services: Services;
  userId: string;
  /** Make the next call of a method reject with the given error. */
  failNext: (method: 'settings.update' | 'settings.get' | 'profiles.update' | 'audit.listRecent' | 'auth.signIn' | 'access', error: AppError) => void;
  /** Simulate a change made in another tab (bumps revision). */
  externalSettingsChange: (patch: Partial<UserSettings>) => void;
  /** Simulate the server ending the session (e.g. refresh token expired). */
  expireSession: () => void;
  settings: () => UserSettings;
  events: () => AuditEvent[];
  calls: string[];
  liveStatus: LiveStatus;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

export function createFakeBackend(opts: FakeOptions = {}): FakeBackend {
  const email = opts.email ?? 'owner@example.test';
  const password = 'Correct-Horse-42';
  const now = () => new Date().toISOString();
  let session: AuthSession | null = opts.signedIn === false ? null : makeSession();
  const listeners = new Set<Listener>();
  const failures = new Map<string, AppError>();
  const calls: string[] = [];

  let profile: Profile = { id: USER_ID, display_name: opts.displayName ?? 'Ana', created_at: now(), updated_at: now() };
  let settings: UserSettings = {
    user_id: USER_ID,
    theme: 'dark',
    display_currency: 'USD',
    timezone: 'UTC',
    date_format: 'medium',
    number_format: 'en-US',
    show_beginner_help: true,
    notification_preferences: { backtests: true, connection: true, approvals: true, research: false },
    revision: 1,
    created_at: now(),
    updated_at: now(),
  };
  const events: AuditEvent[] = [event('account.created'), event('auth.session_started')];

  function makeSession(): AuthSession {
    return {
      user: { id: USER_ID, email, emailConfirmedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastSignInAt: null },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  function event(type: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return {
      id: crypto.randomUUID(),
      actor_user_id: USER_ID,
      event_type: type,
      resource_type: 'account',
      resource_id: USER_ID,
      metadata,
      created_at: new Date().toISOString(),
    };
  }

  const emit = (e: AuthChangeEvent) => listeners.forEach((l) => l(e, session));
  const takeFailure = (key: string) => {
    calls.push(key);
    const f = failures.get(key);
    if (f) {
      failures.delete(key);
      throw f;
    }
  };
  const requireSession = () => {
    if (!session) throw new AppError('session_expired', 'Your session has expired. Please sign in again.');
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const backend: FakeBackend = {
    userId: USER_ID,
    calls,
    liveStatus: 'live',
    failNext: (method, error) => failures.set(method, error),
    externalSettingsChange: (patch) => {
      settings = { ...settings, ...patch, revision: settings.revision + 1, updated_at: now() };
    },
    expireSession: () => {
      session = null;
      emit('SIGNED_OUT');
    },
    settings: () => settings,
    events: () => events,
    services: {
      auth: {
        async getSession() {
          await tick();
          return session;
        },
        onChange(l) {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        async signIn(e, p) {
          await tick();
          takeFailure('auth.signIn');
          if (e.trim().toLowerCase() !== email || p !== password) {
            throw new AppError('auth', 'The email or password is incorrect.', { code: 'invalid_credentials' });
          }
          session = makeSession();
          events.unshift(event('auth.session_started'));
          emit('SIGNED_IN');
          return session;
        },
        async signUp() {
          await tick();
          return { needsEmailConfirmation: true };
        },
        async signOut() {
          await tick();
          session = null;
          emit('SIGNED_OUT');
        },
        async requestPasswordReset() {
          await tick();
        },
        async updatePassword() {
          await tick();
          requireSession();
        },
        async getRegistrationStatus() {
          await tick();
          return { signupEnabled: opts.signupEnabled ?? true };
        },
      },
      access: {
        async getMyAccess() {
          await tick();
          takeFailure('access');
          requireSession();
          return { isOwner: opts.isOwner ?? true, ownerConfigured: opts.ownerConfigured ?? true };
        },
      },
      profiles: {
        async get() {
          await tick();
          requireSession();
          return profile;
        },
        async ensure() {
          await tick();
          requireSession();
          return profile;
        },
        async updateDisplayName(_uid, displayName) {
          await tick();
          takeFailure('profiles.update');
          requireSession();
          profile = { ...profile, display_name: displayName, updated_at: now() };
          events.unshift(event('profile.updated', { fields: ['display_name'] }));
          return profile;
        },
      },
      settings: {
        async get() {
          await tick();
          takeFailure('settings.get');
          requireSession();
          return settings;
        },
        async ensure() {
          await tick();
          takeFailure('settings.get');
          requireSession();
          return settings;
        },
        async update(_uid, patch, expectedRevision) {
          await tick();
          takeFailure('settings.update');
          requireSession();
          if (expectedRevision !== settings.revision) {
            throw new AppError('conflict', 'Your settings were changed in another tab or device. We’ve loaded the latest version — review it and save again.', {
              code: 'revision_mismatch',
            });
          }
          settings = { ...settings, ...patch, revision: settings.revision + 1, updated_at: now() } as UserSettings;
          events.unshift(event('settings.updated', { fields: Object.keys(patch).sort() }));
          return settings;
        },
      },
      audit: {
        async listRecent(_uid, { limit, before }) {
          await tick();
          takeFailure('audit.listRecent');
          requireSession();
          const ordered = [...events].sort((x, y) => (x.created_at === y.created_at ? (x.id < y.id ? 1 : -1) : x.created_at < y.created_at ? 1 : -1));
          const list = before
            ? ordered.filter((e) => e.created_at < before.createdAt || (e.created_at === before.createdAt && e.id < before.id))
            : ordered;
          return { events: list.slice(0, limit), hasMore: list.length > limit };
        },
        async listTimestampsSince(_uid, since) {
          await tick();
          requireSession();
          return { timestamps: events.filter((e) => e.created_at >= since).map((e) => e.created_at), truncated: false };
        },
      },
      realtime: {
        watchRows({ onStatus }) {
          onStatus(backend.liveStatus);
          return () => onStatus('closed');
        },
      },
    },
  };
  return backend;
}

export const FAKE_PASSWORD = 'Correct-Horse-42';
