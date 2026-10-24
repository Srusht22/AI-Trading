/**
 * Which deployment this build belongs to. Set at build time with
 * VITE_APP_ENV (development | staging | production); anything else is
 * treated as development. Purely informational in the browser — the server
 * and database never trust it.
 */
export type AppEnvironment = 'development' | 'staging' | 'production';

export function parseAppEnvironment(value: unknown): AppEnvironment {
  return value === 'staging' || value === 'production' ? value : 'development';
}

export const APP_ENV: AppEnvironment = parseAppEnvironment(import.meta.env.VITE_APP_ENV);
