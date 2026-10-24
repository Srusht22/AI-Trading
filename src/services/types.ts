import type { AuditEvent } from '@/domain/audit';
import type { Profile } from '@/domain/profile';
import type { SettingsPatch, UserSettings } from '@/domain/settings';
import type { Agent, Task, TaskAttempt, TaskType } from '@/domain/tasks';
import type { AccountSnapshot, AccountState, Bar, Deal, Mt5Connection, Mt5Symbol, PendingOrder, Position, Quote, Timeframe } from '@/domain/mt5';

/**
 * Service contracts. UI code depends only on these interfaces; the Supabase
 * implementations live in ./supabase and are wired up in ./index.ts.
 * Every method either resolves with real persisted data or rejects with an
 * AppError — none of them fabricate a success.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface AuthSession {
  user: AuthUser;
  /** Epoch seconds when the access token expires. */
  expiresAt: number | null;
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

export interface SignUpResult {
  /** True when the user must click the emailed link before signing in. */
  needsEmailConfirmation: boolean;
}

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  onChange(listener: (event: AuthChangeEvent, session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, displayName?: string): Promise<SignUpResult>;
  /** 'local' ends this session; 'others' ends every other session of this account. */
  signOut(scope?: 'local' | 'others'): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  /** Reads the auth server's public settings (e.g. whether sign-up is open). */
  getRegistrationStatus(): Promise<{ signupEnabled: boolean }>;
}

export interface AccessInfo {
  isOwner: boolean;
  ownerConfigured: boolean;
}

export interface AccessService {
  getMyAccess(): Promise<AccessInfo>;
}

export interface ProfileService {
  /** Resolves null when the profile row does not exist. */
  get(userId: string): Promise<Profile | null>;
  /** Creates the profile if missing; returns the stored row either way. */
  ensure(userId: string): Promise<Profile>;
  updateDisplayName(userId: string, displayName: string | null): Promise<Profile>;
}

export interface SettingsService {
  /** Resolves null when the settings row does not exist. */
  get(userId: string): Promise<UserSettings | null>;
  /** Creates default settings if missing; returns the stored row either way. */
  ensure(userId: string): Promise<UserSettings>;
  /**
   * Applies `patch` only if the stored revision still equals
   * `expectedRevision`; otherwise rejects with kind 'conflict'.
   */
  update(userId: string, patch: SettingsPatch, expectedRevision: number): Promise<UserSettings>;
}

/** Position in the (created_at, id) ordering; exact even when timestamps tie. */
export interface AuditCursor {
  createdAt: string;
  id: string;
}

export interface AuditPage {
  events: AuditEvent[];
  hasMore: boolean;
}

export interface AuditService {
  /** Newest first, at most `limit` events, optionally strictly after `before` in that order. */
  listRecent(userId: string, options: { limit: number; before?: AuditCursor; eventPrefixes?: string[] }): Promise<AuditPage>;
  /** Event timestamps in a window, for activity charts (bounded). */
  listTimestampsSince(userId: string, sinceIso: string, cap?: number): Promise<{ timestamps: string[]; truncated: boolean }>;
}

export type LiveStatus = 'connecting' | 'live' | 'unavailable' | 'closed';

export interface RealtimeService {
  /**
   * Notify `onChange` when rows matching `filter` change. Delivery honours
   * the table's RLS select policy. Returns an unsubscribe function.
   */
  watchRows(options: {
    channel: string;
    table: 'user_settings' | 'audit_events' | 'tasks' | 'agents' | 'mt5_connections' | 'mt5_account_state' | 'mt5_quotes' | 'mt5_positions' | 'mt5_orders';
    /** PostgREST-style filter, e.g. `owner_user_id=eq.<id>`; omit to rely on RLS alone. */
    filter?: string;
    onChange: () => void;
    onStatus: (status: LiveStatus) => void;
  }): () => void;
}

export interface TaskService {
  /** Newest first, own tasks only (RLS). */
  listRecent(userId: string, limit: number): Promise<Task[]>;
  listAttempts(taskId: string): Promise<TaskAttempt[]>;
  listTypes(): Promise<TaskType[]>;
  /**
   * Submits a task. Calling again with the same idempotency key returns the
   * original task, so a retried request never creates a duplicate.
   */
  submit(taskType: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<Task>;
  cancel(taskId: string): Promise<Task>;
}

export interface AgentService {
  /** Registered agents (owner only; RLS). */
  list(): Promise<Agent[]>;
}

export interface ConnectionSettings {
  quoteIntervalMs: number;
  accountIntervalS: number;
  snapshotIntervalS: number;
  historyDays: number;
}

/**
 * Read-only MetaTrader 5 data (Phase 4). All rows are written by the paired
 * connector through restricted server functions; the browser only reads them
 * and performs the owner actions below.
 */
export interface Mt5Service {
  listConnections(): Promise<Mt5Connection[]>;
  getAccountState(connectionId: string): Promise<AccountState | null>;
  listSnapshots(connectionId: string, sinceIso: string): Promise<{ snapshots: AccountSnapshot[]; truncated: boolean }>;
  listSymbols(connectionId: string): Promise<Mt5Symbol[]>;
  listQuotes(connectionId: string): Promise<Quote[]>;
  listBars(connectionId: string, symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]>;
  listPositions(connectionId: string): Promise<Position[]>;
  listOrders(connectionId: string): Promise<PendingOrder[]>;
  listDeals(connectionId: string): Promise<Deal[]>;
  /** One-time pairing code (shown once; only its hash is stored). */
  createPairing(displayName: string): Promise<{ code: string; expiresAt: string }>;
  setMonitoredSymbols(connectionId: string, symbols: string[]): Promise<void>;
  updateSettings(connectionId: string, settings: ConnectionSettings): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  resume(connectionId: string, acceptNewAccount: boolean): Promise<void>;
  revokeAgent(agentId: string): Promise<void>;
}

export interface Services {
  auth: AuthService;
  access: AccessService;
  profiles: ProfileService;
  settings: SettingsService;
  audit: AuditService;
  realtime: RealtimeService;
  tasks: TaskService;
  agents: AgentService;
  mt5: Mt5Service;
}
