import { FlaskRound } from 'lucide-react';
import { APP_ENV, type AppEnvironment } from '@/lib/appEnv';

/** Unmissable marker on non-production deployments so staging is never mistaken for the real workspace. */
export function EnvironmentBanner({ env = APP_ENV }: { env?: AppEnvironment }) {
  if (env !== 'staging') return null;
  return (
    <div role="note" className="bg-info-soft text-info border-[color-mix(in_srgb,var(--tp-info)_30%,transparent)] flex items-center justify-center gap-2 border-b px-4 py-1.5 text-xs font-medium">
      <FlaskRound className="size-3.5" aria-hidden />
      Staging — a protected test deployment with its own database. Nothing here affects production.
    </div>
  );
}
