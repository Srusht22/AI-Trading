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
import { eligibleAgents, type Agent, type Task, type TaskAttempt, type TaskType } from '@/domain/tasks';
import type { AccountSnapshot, AccountState, Bar, Deal, Mt5Connection, Mt5Symbol, PendingOrder, Position, Quote } from '@/domain/mt5';
import type { AuthChangeEvent, AuthSession, LiveStatus, Services } from '@/services/types';

type Listener = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface FakeOptions {
  signedIn?: boolean;
  isOwner?: boolean;
  ownerConfigured?: boolean;
  signupEnabled?: boolean;
  email?: string;
  displayName?: string | null;
  agents?: Agent[];
  mt5?: Partial<FakeMt5Data>;
}

/** In-memory MT5 data for component tests. TEST DATA ONLY — never shown as a real connection. */
export interface FakeMt5Data {
  connections: Mt5Connection[];
  account: AccountState | null;
  snapshots: AccountSnapshot[];
  symbols: Mt5Symbol[];
  quotes: Quote[];
  bars: Bar[];
  positions: Position[];
  orders: PendingOrder[];
  deals: Deal[];
  pairingCodes: string[];
}

export interface FakeBackend {
  services: Services;
  userId: string;
  /** Make the next call of a method reject with the given error. */
  failNext: (
    method: 'settings.update' | 'settings.get' | 'profiles.update' | 'audit.listRecent' | 'auth.signIn' | 'access' | 'tasks.submit' | 'tasks.cancel',
    error: AppError,
  ) => void;
  /** Simulate an agent (or the queue) changing a task. */
  updateTask: (id: string, patch: Partial<Task>) => void;
  tasks: () => Task[];
  agents: () => Agent[];
  setAgents: (agents: Agent[]) => void;
  mt5: FakeMt5Data;
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
  let agents: Agent[] = opts.agents ?? [];
  const tasks: Task[] = [];
  const keys = new Map<string, string>();
  const attempts: TaskAttempt[] = [];
  const mt5: FakeMt5Data = {
    connections: [], account: null, snapshots: [], symbols: [], quotes: [], bars: [], positions: [], orders: [], deals: [], pairingCodes: [],
    ...opts.mt5,
  };
  const taskTypes: TaskType[] = [
    {
      task_type: 'system.health_check',
      label: 'Health check',
      description: 'Asks a diagnostics agent to report its runtime, clock offset and connection latency.',
      available: true,
      unavailable_reason: null,
      required_capability: 'system.health_check',
      min_agent_version: '0.1.0',
    },
    {
      task_type: 'mt5.backtest',
      label: 'Run backtest',
      description: 'Run a Strategy Tester backtest.',
      available: false,
      unavailable_reason: 'The MetaTrader 5 connector is not available yet.',
      required_capability: 'mt5.backtest',
      min_agent_version: '1.0.0',
    },
  ];

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
    updateTask: (id, patch) => {
      const i = tasks.findIndex((t) => t.id === id);
      if (i >= 0) tasks[i] = { ...tasks[i], ...patch, revision: tasks[i].revision + 1, updated_at: now() };
    },
    tasks: () => tasks,
    agents: () => agents,
    setAgents: (a) => {
      agents = a;
    },
    mt5,
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
        async listRecent(_uid, { limit, before, eventPrefixes }) {
          await tick();
          takeFailure('audit.listRecent');
          requireSession();
          const ordered = [...events].sort((x, y) => (x.created_at === y.created_at ? (x.id < y.id ? 1 : -1) : x.created_at < y.created_at ? 1 : -1));
          const scoped = eventPrefixes?.length ? ordered.filter((e) => eventPrefixes.some((p) => e.event_type.startsWith(p))) : ordered;
          const list = before
            ? scoped.filter((e) => e.created_at < before.createdAt || (e.created_at === before.createdAt && e.id < before.id))
            : scoped;
          return { events: list.slice(0, limit), hasMore: list.length > limit };
        },
        async listTimestampsSince(_uid, since) {
          await tick();
          requireSession();
          return { timestamps: events.filter((e) => e.created_at >= since).map((e) => e.created_at), truncated: false };
        },
      },
      tasks: {
        async listRecent(_uid, limit) {
          await tick();
          requireSession();
          return [...tasks].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
        },
        async listAttempts(taskId) {
          await tick();
          requireSession();
          return attempts.filter((a) => a.task_id === taskId);
        },
        async listTypes() {
          await tick();
          requireSession();
          return taskTypes;
        },
        async submit(taskType, payload, key) {
          await tick();
          takeFailure('tasks.submit');
          requireSession();
          const existing = tasks.find((t) => t.id === keys.get(key));
          if (existing) return existing;
          const type = taskTypes.find((t) => t.task_type === taskType);
          if (!type?.available) throw new AppError('unavailable', type?.unavailable_reason ?? 'Unknown task type.', { code: 'TPU01' });
          if (eligibleAgents(agents, type, new Date()).length === 0) {
            throw new AppError('unavailable', 'No agent that can run this task is online right now. Start a diagnostics agent and try again.', { code: 'TPU02' });
          }
          const t: Task = {
            id: crypto.randomUUID(),
            task_type: taskType,
            payload,
            status: 'queued',
            created_at: now(),
            updated_at: now(),
            available_at: now(),
            expires_at: new Date(Date.now() + 600_000).toISOString(),
            claimed_by_agent: null,
            claimed_at: null,
            lease_expires_at: null,
            started_at: null,
            attempt_count: 0,
            max_attempts: 3,
            progress_percent: null,
            progress_message: null,
            result: null,
            error: null,
            cancel_requested_at: null,
            completed_at: null,
            revision: 1,
          };
          tasks.push(t);
          keys.set(key, t.id);
          return t;
        },
        async cancel(taskId) {
          await tick();
          takeFailure('tasks.cancel');
          requireSession();
          const t = tasks.find((x) => x.id === taskId);
          if (!t) throw new AppError('not_found', 'That task could not be found.');
          if (t.status === 'queued') backend.updateTask(taskId, { status: 'cancelled', completed_at: now(), cancel_requested_at: now() });
          else if (t.status === 'claimed' || t.status === 'running') backend.updateTask(taskId, { status: 'cancel_requested', cancel_requested_at: now() });
          else throw new AppError('conflict', 'This task has already finished, so it can no longer be changed.', { code: 'TPS01' });
          return tasks.find((x) => x.id === taskId)!;
        },
      },
      agents: {
        async list() {
          await tick();
          requireSession();
          return agents;
        },
      },
      mt5: {
        async listConnections() {
          await tick();
          requireSession();
          return mt5.connections;
        },
        async getAccountState() {
          await tick();
          return mt5.account;
        },
        async listSnapshots() {
          await tick();
          return { snapshots: mt5.snapshots, truncated: false };
        },
        async listSymbols() {
          await tick();
          return mt5.symbols;
        },
        async listQuotes() {
          await tick();
          return mt5.quotes;
        },
        async listBars() {
          await tick();
          return mt5.bars;
        },
        async listPositions() {
          await tick();
          return mt5.positions;
        },
        async listOrders() {
          await tick();
          return mt5.orders;
        },
        async listDeals() {
          await tick();
          return mt5.deals;
        },
        async createPairing() {
          await tick();
          requireSession();
          const code = 'TEST-0000-0000-0000-0001';
          mt5.pairingCodes.push(code);
          return { code, expiresAt: new Date(Date.now() + 600_000).toISOString() };
        },
        async setMonitoredSymbols(_id, symbols) {
          await tick();
          mt5.symbols = mt5.symbols.map((x) => ({ ...x, monitored: symbols.includes(x.name) }));
        },
        async updateSettings() {
          await tick();
        },
        async disconnect(id) {
          await tick();
          mt5.connections = mt5.connections.map((c) => (c.id === id ? { ...c, status: 'disconnected', status_reason: 'disconnected_by_owner', disconnected_at: now() } : c));
        },
        async resume(id) {
          await tick();
          mt5.connections = mt5.connections.map((c) => (c.id === id ? { ...c, status: 'awaiting_verification', status_reason: null, disconnected_at: null } : c));
        },
        async revokeAgent(id) {
          await tick();
          agents = agents.map((a) => (a.id === id ? { ...a, revoked_at: now() } : a));
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
