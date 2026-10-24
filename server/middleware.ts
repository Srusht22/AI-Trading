import { apiError, withSecurityHeaders } from './http';
import { appEnvironment, type ServerEnv } from './env';

/**
 * Wraps every Function response: applies the API security headers (the
 * static `_headers` file does not reach Functions) and turns unexpected
 * exceptions into a generic 500 without leaking stack traces.
 */
export async function applyApiMiddleware(request: Request, env: ServerEnv, next: () => Promise<Response>): Promise<Response> {
  const https = new URL(request.url).protocol === 'https:';
  const noindex = appEnvironment(env.APP_ENV) !== 'production';
  let response: Response;
  try {
    response = await next();
  } catch {
    response = apiError(500, 'internal_error', 'Unexpected server error.');
  }
  return withSecurityHeaders(response, { https, noindex });
}
