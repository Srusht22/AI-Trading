import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { CircleAlert, KeyRound, LogOut, RefreshCw, ShieldQuestion, WifiOff } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/layout/Logo';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAccess } from '@/hooks/useAccount';
import { toAppError, type AppError } from '@/lib/errors';
import { LiveDataProvider } from '@/lib/live';

/** Neutral full-screen state shown while identity is being established. Shows no private data. */
export function AuthSplash({ label = 'Checking your session' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5" role="status" aria-live="polite">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
        <LogoMark size={44} />
      </motion.div>
      <div className="flex items-center gap-2.5">
        <span className="bg-accent size-1.5 animate-pulse rounded-full" aria-hidden />
        <span className="text-fg-2 text-sm">{label}…</span>
      </div>
    </div>
  );
}

function FullScreenMessage({ icon: Icon, title, children, actions }: { icon: typeof CircleAlert; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2.5">
          <LogoMark size={30} />
          <Wordmark />
        </div>
        <div className="surface p-6 sm:p-8">
          <span className="bg-accent-2-soft text-accent-2 mb-4 flex size-11 items-center justify-center rounded-xl">
            <Icon className="size-5" aria-hidden />
          </span>
          <h1 className="text-fg text-xl font-semibold">{title}</h1>
          <div className="text-fg-2 mt-2 space-y-3 text-sm leading-relaxed">{children}</div>
          {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function ErrorScreen({ error, onRetry, title = 'Something went wrong' }: { error: AppError; onRetry: () => void; title?: string }) {
  return (
    <FullScreenMessage
      icon={error.kind === 'network' ? WifiOff : CircleAlert}
      title={error.kind === 'network' ? 'You appear to be offline' : title}
      actions={
        <Button variant="primary" leadingIcon={<RefreshCw />} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>{error.userMessage}</p>
    </FullScreenMessage>
  );
}

/** Requires a signed-in user; otherwise redirects to sign-in and returns here afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <AuthSplash />;
  if (state.status === 'error') return <ErrorScreen error={state.error} onRetry={retry} title="We couldn’t check your session" />;
  if (state.status === 'signed_out') {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  if (state.recovery) return <Navigate to="/reset-password" replace />;
  return <>{children}</>;
}

/**
 * Requires the deployment owner. Ownership is decided by the database
 * (private.app_owner via get_my_access); RLS enforces it independently.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const access = useAccess();
  if (access.isPending) return <AuthSplash label="Checking workspace access" />;
  if (access.isError) return <ErrorScreen error={toAppError(access.error)} onRetry={() => void access.refetch()} title="We couldn’t check your access" />;
  if (!access.data.isOwner) return <AccessPending ownerConfigured={access.data.ownerConfigured} />;
  return <LiveDataProvider>{children}</LiveDataProvider>;
}

function AccessPending({ ownerConfigured }: { ownerConfigured: boolean }) {
  const { state, signOut } = useAuth();
  const email = state.status === 'signed_in' ? state.session.user.email : null;
  return (
    <FullScreenMessage
      icon={ownerConfigured ? ShieldQuestion : KeyRound}
      title={ownerConfigured ? 'This is a private workspace' : 'Finish setting up your workspace'}
      actions={
        <Button variant="secondary" leadingIcon={<LogOut />} onClick={() => void signOut()}>
          Sign out
        </Button>
      }
    >
      <p>
        You’re signed in as <span className="text-fg">{email ?? 'this account'}</span>, but this account isn’t the owner of this TradePilot
        workspace.
      </p>
      {ownerConfigured ? (
        <p>TradePilot is a single-owner personal platform. Only its owner can open the research workspace.</p>
      ) : (
        <>
          <p>
            No owner has been assigned yet. For security, ownership can’t be claimed from the browser — it must be granted by a trusted
            administrator using the server-side command:
          </p>
          <pre className="bg-sunken border-line-soft text-fg overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs">
            npm run owner:assign -- {email ?? 'you@example.com'}
          </pre>
          <p className="text-fg-3 text-xs">See “Owner bootstrap” in docs/backend.md. Then reload this page.</p>
        </>
      )}
    </FullScreenMessage>
  );
}

export function ConfigurationRequired({ problems }: { problems: string[] }) {
  return (
    <FullScreenMessage icon={CircleAlert} title="TradePilot isn’t connected to its backend yet">
      <p>The app needs a Supabase project to store your account and settings. No data is shown until this is configured.</p>
      <ul className="text-fg list-disc space-y-1 pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p>
        Copy <code className="font-mono text-xs">.env.example</code> to <code className="font-mono text-xs">.env.local</code>, fill in your
        project URL and publishable key, then restart the dev server. See docs/backend.md.
      </p>
    </FullScreenMessage>
  );
}
