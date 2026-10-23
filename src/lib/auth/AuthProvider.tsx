import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from '@/lib/services-context';
import { toAppError, type AppError, logError } from '@/lib/errors';
import type { AuthSession } from '@/services/types';

export type SignedOutReason = 'signed_out' | 'expired' | 'none';

export type AuthState =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'signed_out'; reason: SignedOutReason }
  | { status: 'signed_in'; session: AuthSession; recovery: boolean };

interface AuthContextValue {
  state: AuthState;
  /** Ends this session on the server and clears all cached private data. */
  signOut: () => Promise<void>;
  retry: () => void;
  /** Clears the password-recovery flag once a new password has been set. */
  finishRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const userId = useRef<string | null>(null);
  const signingOut = useRef(false);

  const applySession = useCallback(
    (session: AuthSession | null, recovery = false) => {
      const nextId = session?.user.id ?? null;
      // Never let one account's cached data be visible to another.
      if (userId.current !== nextId) queryClient.clear();
      if (!session) {
        const reason: SignedOutReason = userId.current && !signingOut.current ? 'expired' : signingOut.current ? 'signed_out' : 'none';
        userId.current = null;
        signingOut.current = false;
        setState({ status: 'signed_out', reason });
        return;
      }
      userId.current = nextId;
      setState((prev) => ({
        status: 'signed_in',
        session,
        recovery: recovery || (prev.status === 'signed_in' && prev.session.user.id === nextId && prev.recovery),
      }));
    },
    [queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = auth.onChange((event, session) => {
      if (cancelled || event === 'INITIAL_SESSION') return;
      applySession(session, event === 'PASSWORD_RECOVERY');
    });
    auth
      .getSession()
      .then((session) => !cancelled && applySession(session))
      .catch((e: unknown) => {
        if (cancelled) return;
        const error = toAppError(e, 'check your session');
        logError('Session restore failed', error);
        setState({ status: 'error', error });
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth, applySession, attempt]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      await auth.signOut('local');
    } finally {
      // Whatever the server said, this browser must no longer show private data.
      queryClient.clear();
      userId.current = null;
      signingOut.current = false;
      setState({ status: 'signed_out', reason: 'signed_out' });
    }
  }, [auth, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signOut,
      retry: () => {
        setState({ status: 'loading' });
        setAttempt((a) => a + 1);
      },
      finishRecovery: () => setState((s) => (s.status === 'signed_in' ? { ...s, recovery: false } : s)),
    }),
    [state, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user. Only call inside routes protected by <RequireAuth>. */
export function useCurrentUser() {
  const { state } = useAuth();
  if (state.status !== 'signed_in') throw new Error('useCurrentUser requires a signed-in user');
  return state.session.user;
}

/** Only allow same-origin, path-only redirect targets (prevents open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/^\/(sign-in|sign-up|forgot-password|reset-password)\b/.test(next)) return '/';
  return next;
}
