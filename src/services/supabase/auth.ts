import type { AuthError, Session, User } from '@supabase/supabase-js';
import type { TradePilotClient } from '@/lib/supabase/client';
import type { PublicConfig } from '@/lib/env';
import { AppError, fromAuthError, toAppError } from '@/lib/errors';
import type { AuthService, AuthSession, AuthUser } from '../types';

function toUser(u: User): AuthUser {
  return {
    id: u.id,
    email: u.email ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
  };
}

function toSession(s: Session | null): AuthSession | null {
  return s ? { user: toUser(s.user), expiresAt: s.expires_at ?? null } : null;
}

function fail(error: AuthError): never {
  throw fromAuthError(error);
}

export function createAuthService(client: TradePilotClient, config: PublicConfig, origin: string): AuthService {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) fail(error);
      return toSession(data.session);
    },

    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Defer so listeners may call back into supabase-js safely.
        queueMicrotask(() => listener(event as Parameters<typeof listener>[0], toSession(session)));
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) fail(error);
      const session = toSession(data.session);
      if (!session) throw new AppError('auth', 'Sign-in did not return a session. Please try again.');
      return session;
    },

    async signUp(email, password, displayName) {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/sign-in?confirmed=1`,
          data: displayName ? { display_name: displayName } : undefined,
        },
      });
      if (error) fail(error);
      return { needsEmailConfirmation: !data.session };
    },

    async signOut(scope = 'local') {
      const { error } = await client.auth.signOut({ scope });
      // A missing/expired session still leaves the browser signed out locally.
      if (error && error.code !== 'session_not_found') fail(error);
    },

    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/reset-password` });
      if (error) fail(error);
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) fail(error);
    },

    async getRegistrationStatus() {
      let res: Response;
      try {
        res = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabasePublishableKey } });
      } catch (e) {
        throw toAppError(e, 'check whether registration is open');
      }
      if (!res.ok) throw new AppError('unavailable', 'The sign-in service is temporarily unavailable.', { code: String(res.status) });
      const body = (await res.json()) as { disable_signup?: unknown; external?: { email?: unknown } };
      return { signupEnabled: body.disable_signup === false && body.external?.email !== false };
    },
  };
}
