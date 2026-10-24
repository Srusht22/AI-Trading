/**
 * GET /api/health — liveness of the server-side runtime. Public, cheap and
 * free of secrets: it does not touch the database (so it cannot be used to
 * run up database load) and reports only whether configuration is present.
 */
import { apiError, ok } from './http';
import { appEnvironment, resolveServerEnv, type ServerEnv } from './env';

export const API_VERSION = '1';

export function handleHealthRequest(request: Request, env: ServerEnv): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Use GET.', { Allow: 'GET, HEAD' });
  return ok({
    status: 'ok',
    service: 'tradepilot-api',
    api_version: API_VERSION,
    environment: appEnvironment(env.APP_ENV),
    agent_api_configured: resolveServerEnv(env) !== null,
    time: new Date().toISOString(),
  });
}
