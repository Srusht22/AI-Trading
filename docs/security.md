# TradePilot AI — Security review (Phase 2.1, updated in Phase 3)

Scope: how authentication sessions work today, what was measured, which risks
are accepted for now, and what must change before TradePilot is hosted online
with sensitive controls (robot approval, demo start/stop, connector pairing).

## 1. Current architecture (verified, not assumed)

The browser talks to Supabase directly with the publishable key
(`src/lib/supabase/client.ts`): PKCE flow, `persistSession`, `autoRefreshToken`.

Observed in a real browser after sign-in:

| Where | Key | Contents |
| --- | --- | --- |
| `localStorage` | `tradepilot-auth` | access token (JWT, 15 min), **refresh token**, expiry, user object (id, email, metadata) |
| `localStorage` | `tradepilot-auth-code-verifier` | PKCE verifier, only between sign-up/reset request and the email link |
| `localStorage` | `tp-theme`, `tp-sidebar`, `tp-sample-data` | non-sensitive UI preferences |
| cookies / `sessionStorage` | — | nothing |

* **Refresh**: supabase-js refreshes shortly before expiry. Refresh-token
  rotation is on; a reused refresh token is rejected (10 s grace interval).
* **Sign-out**: calls GoTrue `/logout`, which deletes the `auth.sessions` row
  and its refresh tokens, then clears `localStorage`. "Sign out other
  devices" deletes every other session of the user.
* **Lifetimes** (`supabase/config.toml`): access token 900 s; session timebox
  168 h; inactivity timeout 12 h (both enforced by GoTrue at refresh time).

## 2. Measured risks

| Test | Before Phase 2.1 | Now |
| --- | --- | --- |
| Page JavaScript can read the refresh token | yes | **yes** (inherent to browser storage) |
| A copied refresh token works elsewhere while the user is signed in | yes | **yes** (until rotated or the session ends) |
| Refresh token works after the user signs out | no | no |
| **Access token copied before sign-out still reads data** | **yes, up to 1 h** | **no** — rejected immediately |
| Realtime subscription with a revoked token keeps receiving rows | **yes** | **no** |
| Access token after timebox/inactivity expiry | up to 1 h | up to **15 min** (GoTrue enforces those limits only at refresh) |

The decisive risk of browser-held tokens is **cross-site scripting** (or a
compromised dependency): script running on the TradePilot origin can read the
refresh token and replay it from another machine for as long as the session
lives. Network attackers are not the concern (HTTPS); other sites cannot read
the storage (same-origin policy).

For TradePilot specifically: today a stolen session exposes a profile,
display preferences and an audit log. Once later phases add robot approval,
demo start/stop and connector pairing, the same token would authorise
actions that drive an MT5 terminal. The architecture must be hardened before
those actions exist online.

## 3. Options evaluated

### A. Keep browser-held Supabase sessions, harden everything around them

What it requires and its status:

* **Make revocation real** — every RLS policy, `is_owner()` and
  `get_my_access()` require the token's `session_id` to be a live session
  (`supabase/migrations/20261024090000_session_bound_access.sql`).
  ✅ implemented, tested (pgTAP + API + Realtime).
* **Short access tokens** — 15 min. ✅ (`jwt_expiry = 900`)
* **Session timebox / inactivity limits** — ✅ configured (hosted: Pro plan).
* **Strict CSP + Trusted Types** — `script-src 'self'` (no inline, no eval),
  `require-trusted-types-for 'script'`, `connect-src` limited to the app and
  the Supabase project, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri`/`form-action 'self'`. Delivered as a `<meta>` tag in every build
  and as full headers in `dist/_headers` / `vite preview`.
  ✅ implemented; the production build is E2E-tested under it with zero
  violations, and injected HTML/script and foreign `fetch` are proven blocked.
* **Other headers** — `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS on HTTPS. ✅
* **Safe rendering** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `javascript:` URLs or user-built links in `src/`; all user content renders as
  escaped React text. ✅ verified (Trusted Types would also block regressions).
* **Dependency hygiene** — `npm audit`: 0 vulnerabilities (production and dev)
  after upgrading Vitest. Lockfile committed. ⚠️ needs CI enforcement.

Residual risk: script that does run on the origin (a future XSS bug that
bypasses the CSP, a malicious dependency in the bundle, a malicious browser
extension) can still read and exfiltrate the refresh token. CSP `connect-src`
blocks `fetch`/XHR/WebSocket to foreign hosts, but not every channel
(e.g. top-level navigation).

### B. Server-managed sessions (backend-for-frontend)

A small same-origin server (Node/Hono, or an edge function on the same
domain) performs sign-in with GoTrue, keeps the refresh token in a
`__Host-` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`), and proxies or
mints short-lived tokens for API calls. JavaScript never sees a refresh token.

Requirements for this codebase:

* A server runtime and same-origin deployment (no longer pure static hosting).
* Replace the auth service (`src/services/supabase/auth.ts`) with calls to BFF
  endpoints; data services either go through a BFF proxy or receive a
  short-lived, memory-only access token. The service-interface boundary means
  pages and hooks do not change.
* CSRF defence for cookie-authenticated endpoints: `SameSite=Strict`, an
  `Origin` allow-list check, and a custom request header.
* Realtime: issue a short-lived token for the socket (memory only) or proxy it.
* Email links (confirmation, recovery) terminate at the BFF.

What it buys: tokens cannot be exfiltrated and replayed later from another
machine. What it does not buy: script running in the page can still act as
the user *while the page is open* (calls go through with the cookie), so CSP
and safe rendering remain necessary.

Note: `@supabase/ssr` cookie storage alone is **not** option B — those
cookies are set from JavaScript and are therefore not `HttpOnly`.

## 4. Recommendation

1. **Now (local, personal, no trading controls): Option A, as implemented.**
   The data currently at stake is low, revocation is now immediate, tokens
   are short-lived and the CSP blocks the usual script-injection paths. A full
   BFF today would add a server, a proxy and CSRF handling with little
   immediate gain.
2. **Before hosting online with sensitive controls: add a narrow BFF for
   privileged actions.** Robot approval, demo start/stop, emergency disable and
   connector pairing should be executed by server-side endpoints that require
   a recent re-authentication (fresh session `iat`/`aal`, or a re-auth nonce)
   and are themselves audited — never by direct table writes from the browser.
   Moving the session itself into an `HttpOnly` cookie (full option B) is the
   preferred end state for a hosted deployment; it can be done behind the
   existing service interfaces without touching the UI.
3. **Enable MFA (TOTP) for the owner** before trading controls ship, and
   require `aal2` in the policies/endpoints that guard them.

## 5. Pre-deployment checklist (hosted)

Must be done and verified in the hosted environment — local tests passing
does not make a deployment secure.

- [ ] Serve over HTTPS only; HSTS enabled (emitted automatically for https Supabase URLs).
- [ ] Host sends the headers from `dist/_headers` (Cloudflare Pages reads it for static assets; Functions set their own). Verify with `npm run verify:deployment -- <url>`.
- [ ] `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` set in the build environment; no other `VITE_` secrets (the build refuses privileged keys).
- [ ] Service-role key stored only in the trusted tooling environment, never in CI logs or the host's public env.
- [ ] Auth: site URL = production origin; redirect allow-list contains exactly `https://<domain>/sign-in` and `https://<domain>/reset-password`; custom SMTP configured; email confirmation on; secure password change on; `jwt_expiry` 900; timebox/inactivity configured.
- [ ] Migrations applied with `supabase db push`; `npm run db:types:check` passes against the hosted schema.
- [ ] Owner assigned with `npm run owner:assign`; public sign-up **disabled** afterwards.
- [ ] `npm audit --omit=dev` clean; dependency updates reviewed (consider Dependabot/Renovate).
- [ ] Before trading controls: server-side endpoints with step-up re-auth for privileged actions; owner MFA.

## 6. Phase 3: task queue, agents and hosting

New attack surface and how it is contained:

| Surface | Control |
| --- | --- |
| `POST /api/agent/*` (public URL) | Requires an agent bearer token (256-bit, `tpa_` prefix). Malformed/unauthenticated requests are rejected before any database call; the token is hashed (SHA-256) before it leaves the Function; the database re-checks the agent, revocation, capability, version and lease. There is **no** endpoint that hands out work without a valid token. No CORS headers, JSON only, 8 KB body limit, strict per-action schemas, generic 5xx messages. |
| Agent credentials | Only the hash is stored, in `private.agent_credentials` (not exposed by the API; not selectable even by `service_role`). Tokens are generated by `npm run agent:register` and written to a mode-600 file, never printed. Revocation takes effect on the next request. |
| Lease tokens | Random per attempt, kept in `private.task_leases` — never in API responses or Realtime payloads to the browser. A stale or rogue worker without the current lease cannot change a task. |
| `submit_task` / `cancel_task` | Owner + live session only; idempotency, payload allow-lists, 4 KB limits, credential-like keys refused at any depth, 10/min and 5-unfinished limits, audited. |
| Task data | No trading credentials can be stored: payload contracts allow only known keys; results are scanned for credential-like keys; MT5 task types are rejected until their contracts exist. |
| Service-role key in Functions | Encrypted Pages secret per environment; validated as a server key; never sent to browsers (`/api/health` reports only whether it is configured). |
| Function responses | Own security headers (Pages `_headers` does not apply to Functions); verified on real workerd responses. |
| Staging | `noindex`, visible banner, separate Supabase project, Cloudflare Access in front (manual setup), owner-only app access. |

Dependency changes in Phase 3: zod upgraded to 4.6.7 (a new advisory affects
all zod < 4.6.6) and configured `jitless` so it never probes `new Function`
under the CSP; wrangler 4.149.0 (dev only) with `undici` pinned to 7.30.1 via
`overrides` for advisories in miniflare's copy. `npm audit`: 0 vulnerabilities.

Still required before trading controls (unchanged): step-up re-auth for
privileged actions, owner MFA, preferably HttpOnly server-managed sessions.
The agent protocol is designed so a future MT5 connector uses the same
token/lease model; its task types must get explicit payload contracts and a
human approval step before they are made available.
