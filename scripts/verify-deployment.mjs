#!/usr/bin/env node
/**
 * Verify a running deployment from the outside, using real HTTP responses:
 *
 *   npm run verify:deployment -- https://<branch>.tradepilot.pages.dev [--expect-noindex]
 *   npm run verify:deployment -- http://127.0.0.1:8788            (local `npm run pages:dev`)
 *
 * Checks static-asset headers (from dist/_headers), Function response headers
 * (set in code, because _headers does not apply to Functions), SPA deep-link
 * fallback, that the agent API refuses unauthenticated callers, that no CORS
 * is granted, that no source maps are served and that the JavaScript carries
 * no privileged keys. Prints only check names and results — never response
 * bodies or credentials. Exit code 1 if anything fails.
 */
const base = process.argv[2]?.replace(/\/+$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Usage: npm run verify:deployment -- <base-url> [--expect-noindex]');
  process.exit(2);
}
const expectNoindex = process.argv.includes('--expect-noindex');
const https = base.startsWith('https://');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

/** True if the text embeds a JWT whose role claim is service_role (the claim is decoded, never printed). */
function embeddedServiceRoleJwt(text) {
  for (const [jwt] of text.matchAll(/eyJ[\w-]+\.([\w-]+)\.[\w-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role === 'service_role') return true;
    } catch {
      /* not a JWT */
    }
  }
  return false;
}

async function get(path, init = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  const text = await res.text();
  return { res, text, h: (k) => res.headers.get(k) ?? '' };
}

function staticHeaderChecks(label, r) {
  const csp = r.h('content-security-policy');
  check(`${label}: CSP restricts scripts to self`, /script-src 'self'(;|$)/.test(csp));
  check(`${label}: CSP forbids framing`, csp.includes("frame-ancestors 'none'"));
  check(`${label}: CSP requires Trusted Types`, csp.includes("require-trusted-types-for 'script'"));
  check(`${label}: X-Content-Type-Options nosniff`, r.h('x-content-type-options') === 'nosniff');
  check(`${label}: X-Frame-Options DENY`, r.h('x-frame-options') === 'DENY');
  check(`${label}: Referrer-Policy`, r.h('referrer-policy') === 'strict-origin-when-cross-origin');
  check(`${label}: Permissions-Policy`, r.h('permissions-policy').includes('camera=()'));
  if (https) check(`${label}: HSTS`, r.h('strict-transport-security').includes('max-age='));
  if (expectNoindex) check(`${label}: X-Robots-Tag noindex`, r.h('x-robots-tag').includes('noindex'));
}

function apiHeaderChecks(label, r) {
  check(`${label}: JSON content type`, r.h('content-type').startsWith('application/json'));
  check(`${label}: CSP default-src 'none'`, r.h('content-security-policy').includes("default-src 'none'"));
  check(`${label}: no-store`, r.h('cache-control').includes('no-store'));
  check(`${label}: nosniff`, r.h('x-content-type-options') === 'nosniff');
  check(`${label}: X-Frame-Options DENY`, r.h('x-frame-options') === 'DENY');
  check(`${label}: no CORS grant`, !r.h('access-control-allow-origin'));
  if (https) check(`${label}: HSTS`, r.h('strict-transport-security').includes('max-age='));
  if (expectNoindex) check(`${label}: X-Robots-Tag noindex`, r.h('x-robots-tag').includes('noindex'));
}

try {
  const home = await get('/');
  check('GET / answers 200 HTML', home.res.status === 200 && home.h('content-type').includes('text/html'));
  staticHeaderChecks('GET /', home);

  const deep = await get('/connections');
  check('Deep link /connections falls back to the app (200 HTML)', deep.res.status === 200 && deep.text.includes('<div id="root"'));
  staticHeaderChecks('GET /connections', deep);

  const scripts = [...home.text.matchAll(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  check('index.html loads bundled scripts from /assets', scripts.length > 0);
  for (const src of scripts) {
    const js = await get(src);
    check(`${src}: 200`, js.res.status === 200);
    check(`${src}: long-lived immutable cache`, js.h('cache-control').includes('immutable'));
    check(`${src}: no source map reference`, !/sourceMappingURL=/.test(js.text));
    check(`${src}: no privileged Supabase key`, !/sb_secret_[A-Za-z0-9_-]{10,}/.test(js.text) && !embeddedServiceRoleJwt(js.text));
    const map = await get(`${src}.map`);
    check(`${src}.map is not served`, !(map.res.status === 200 && /"mappings"/.test(map.text)));
  }

  const health = await get('/api/health');
  check('GET /api/health answers 200', health.res.status === 200 && JSON.parse(health.text)?.data?.status === 'ok');
  check('/api/health reports the agent API as configured', JSON.parse(health.text)?.data?.agent_api_configured === true);
  apiHeaderChecks('GET /api/health', health);

  const claim = await get('/api/agent/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('POST /api/agent/claim without a token is refused (401)', claim.res.status === 401);
  check('…with a structured error', JSON.parse(claim.text)?.error?.code === 'unauthorized');
  apiHeaderChecks('POST /api/agent/claim', claim);

  const forged = await get('/api/agent/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer tpa_${'A'.repeat(43)}` },
    body: '{}',
  });
  check('POST /api/agent/claim with an unknown token is refused (401)', forged.res.status === 401);

  const preflight = await get('/api/agent/claim', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check('CORS preflight from another origin is not granted', !preflight.h('access-control-allow-origin'));

  const unknown = await get('/api/does-not-exist');
  check('Unknown /api path answers 404 JSON', unknown.res.status === 404 && unknown.h('content-type').startsWith('application/json'));
} catch (e) {
  check('Deployment reachable', false, e.message);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed for ${base}`);
process.exit(failed.length ? 1 : 0);
