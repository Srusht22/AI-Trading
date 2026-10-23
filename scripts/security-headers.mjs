/**
 * HTTP security headers for TradePilot AI, derived from the configured
 * Supabase URL. Used by the build (CSP <meta> + dist/_headers) and by
 * `vite preview`, so local production previews enforce the same policy.
 */
export function contentSecurityPolicy(supabaseUrl, { forMeta = false, trustedTypes = true } = {}) {
  const api = new URL(supabaseUrl);
  const ws = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`;
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // Radix's scroll-lock injects small <style> elements; inline styles cannot run script.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", api.origin, ws],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
  };
  if (trustedTypes) directives['require-trusted-types-for'] = ["'script'"];
  if (!forMeta) directives['frame-ancestors'] = ["'none'"]; // ignored in <meta>; header only
  if (api.protocol === 'https:') directives['upgrade-insecure-requests'] = [];
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

export function securityHeaders(supabaseUrl) {
  const https = new URL(supabaseUrl).protocol === 'https:';
  return {
    'Content-Security-Policy': contentSecurityPolicy(supabaseUrl),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(https ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
  };
}

/** Netlify / Cloudflare Pages `_headers` format. */
export function headersFile(supabaseUrl) {
  const lines = Object.entries(securityHeaders(supabaseUrl)).map(([k, v]) => `  ${k}: ${v}`);
  return ['/*', ...lines, '', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', ''].join('\n');
}
