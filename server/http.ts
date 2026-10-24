/**
 * HTTP helpers for the server-side API (Cloudflare Pages Functions).
 *
 * Pages applies `_headers` only to static assets, never to Function
 * responses, so every API response gets its security headers here.
 */

/** Headers for JSON API responses: never cached, never framed, never sniffed. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export const HSTS = 'max-age=63072000; includeSubDomains';

/** Returns a copy of `response` with the API security headers applied. */
export function withSecurityHeaders(response: Response, options: { https: boolean; noindex: boolean }): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) headers.set(k, v);
  if (options.https) headers.set('Strict-Transport-Security', HSTS);
  if (options.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow');
  // The API is not for browsers on other origins: no CORS headers, ever.
  headers.delete('Access-Control-Allow-Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'validation_failed'
  | 'heartbeat_required'
  | 'lease_lost'
  | 'invalid_state'
  | 'rate_limited'
  | 'server_misconfigured'
  | 'upstream_unavailable'
  | 'internal_error';

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function ok(data: unknown): Response {
  return json(200, { ok: true, data });
}

/** Structured error. `message` is written for operators and never echoes secrets or SQL. */
export function apiError(status: number, code: ApiErrorCode, message: string, extraHeaders: Record<string, string> = {}): Response {
  return json(status, { ok: false, error: { code, message } }, extraHeaders);
}
