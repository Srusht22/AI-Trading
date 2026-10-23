import type { AuditEvent } from '@/domain/audit';
import type { Profile } from '@/domain/profile';
import type { SettingsPatch, UserSettings } from '@/domain/settings';

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
  listRecent(userId: string, options: { limit: number; before?: AuditCursor }): Promise<AuditPage>;
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
    table: 'user_settings' | 'audit_events';
    filter: string;
    onChange: () => void;
    onStatus: (status: LiveStatus) => void;
  }): () => void;
}

export interface Services {
  auth: AuthService;
  access: AccessService;
  profiles: ProfileService;
  settings: SettingsService;
  audit: AuditService;
  realtime: RealtimeService;
}
