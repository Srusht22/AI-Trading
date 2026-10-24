# TradePilot AI — Online hosting, staging and deployment (Phase 3)

Status: **prepared and verified locally, not deployed.** Everything below was
run against the Cloudflare Pages runtime (`wrangler pages dev`, i.e. workerd)
and a local Supabase stack. No Cloudflare or hosted Supabase credentials were
available in this phase, so no hosted environment exists yet and nothing here
claims that one is secure. The checklists say what must be done and verified
on the real hosts.

## 1. Architecture

```
 Browser ──HTTPS──► Cloudflare Pages ──────────────── static SPA (dist/) + dist/_headers
    │                    │
    │                    └─ Pages Functions (functions/, only /api/*) ── server/*.ts
    │                          /api/health          public, no DB access
    │                          /api/agent/<action>  agent bearer token → SHA-256 → service-role RPC
    │                                                       │
    └──HTTPS/WSS (publishable key + user JWT)──► Supabase: Auth · PostgREST · Realtime · Postgres (RLS)
                                                            ▲
 Diagnostics agent (agent/diagnostics-worker.mjs) ──HTTPS──┘ via /api/agent/* only (own token, no DB keys)
```

| Piece | Where | Why |
| --- | --- | --- |
| Frontend | Cloudflare Pages (static) | Free plan, global CDN, `_headers` support, SPA fallback, per-branch preview URLs. |
| Server-side endpoints | Pages Functions in the same project | Same origin as the app (no CORS), Workers runtime, secrets stored encrypted by Cloudflare. Only `/api/*` invokes a Function (`public/_routes.json`), so static traffic never consumes Function quota. |
| Database, auth, realtime | Supabase (one project per environment) | Already the system of record (Phases 2–2.1). |
| Durable jobs | Postgres queue in Supabase (see [tasks.md](tasks.md)) | No extra paid queue or worker service. |
| Workers | Run by the owner on their own computer (diagnostics today, the Windows MT5 connector later) | No paid VPS or background workers in this phase. |

### Compatibility (verified)

* The SPA needs a fallback to `index.html`: Pages does this automatically when
  the build has no top-level `404.html` (ours has none). Verified: `/connections`
  and other deep links return the app, including after a reload (E2E).
* `dist/_headers` is applied by Pages to **static assets only**. Pages
  Functions responses never receive those headers, so `functions/_middleware.ts`
  → `server/middleware.ts` sets the API headers on every Function response
  (CSP `default-src 'none'`, `nosniff`, `DENY`, `no-store`, HSTS on https,
  `X-Robots-Tag` outside production). Verified on real responses from workerd.
* The production bundle runs under the strict CSP + Trusted Types with zero
  violations (`tests/e2e/csp.spec.ts`, and `tests/e2e/pages.spec.ts` on workerd).
  zod 4 is configured `jitless` because its `new Function` probe is an eval sink.
* Functions use only Web APIs (`fetch`, `crypto.subtle`), no Node built-ins.

## 2. Environments

| | development | staging | production |
| --- | --- | --- | --- |
| Frontend | `npm run dev` / `npm run pages:dev` | Pages **preview** deployment of the working branch | Pages **production** branch (`main`) |
| Supabase | local stack | separate Supabase project | separate Supabase project |
| `VITE_APP_ENV` | `development` | `staging` (visible banner, `noindex`) | `production` |
| `APP_ENV` (Functions) | `development` (`.dev.vars`) | `staging` (wrangler.toml `[env.preview.vars]`) | `production` |
| Access | localhost | Cloudflare Access + app sign-in (owner only) | app sign-in (owner only); Access recommended until Phase 4 gates |

Guards that keep them apart:

* A `staging`/`production` build refuses a non-https or localhost Supabase URL (vite.config.ts).
* `scripts/deploy-pages.mjs` refuses to deploy if `.env.staging.local` and
  `.env.production.local` point at the same Supabase project, refuses a dirty
  working tree, needs `--confirm-production` for production, runs the bundle
  secret scan before upload and verifies the live deployment afterwards.
* `scripts/db-push.mjs` pushes migrations only to the project currently
  linked **and** named for `--env` (`SUPABASE_PROJECT_REF_STAGING` /
  `_PRODUCTION`), dry-runs by default, and needs `--confirm-production`.
* Server code refuses to start talking to Supabase over plain http outside
  development and answers `503 server_misconfigured` if the key is missing or
  not a server key.
* Integration/E2E tests and `pages:dev` refuse non-local Supabase URLs.

## 3. Environment variables

| Name | Where it is set | Secret? | Used by |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` / `.env.<mode>.local` (build env) | no (ships to browsers) | browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same | no (publishable/anon key; RLS protects data) | browser |
| `VITE_APP_ENV` | same, or set by the deploy script | no | browser (banner) and build guards |
| `SUPABASE_URL` | Cloudflare → Pages → Settings → Variables (per environment) | no | Functions |
| `SUPABASE_SECRET_KEY` | Cloudflare, **encrypted** (`npx wrangler pages secret put SUPABASE_SECRET_KEY --project-name tradepilot`) | **yes** — bypasses RLS | Functions only |
| `APP_ENV` | `wrangler.toml` | no | Functions |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the deploying shell only | **yes** (token) | `deploy-pages.mjs` / wrangler |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.server.local` on the trusted machine | **yes** | owner/agent admin scripts, tests |
| `SUPABASE_PROJECT_REF_STAGING` / `_PRODUCTION` | `.env.server.local` or shell | no | `db-push.mjs` |
| `TRADEPILOT_API_URL`, `TRADEPILOT_AGENT_TOKEN` | `.env.agent.local` (mode 600) on the agent's computer | **yes** (token) | the agent |

Rules: nothing secret is ever prefixed `VITE_` (the build refuses privileged
keys); every `.env.*` file except the `*.example` templates is git-ignored, as
are `.dev.vars` and `.wrangler/`; no script prints a key or token
(`register-agent.mjs` writes the token to a 600-permission file and prints
only its path).

## 4. Setting up staging (one time)

1. **Supabase**: create a new project for staging (free plan). Note its ref.
   In Authentication settings: site URL `https://<branch>.tradepilot.pages.dev`
   (or your staging domain); redirect allow-list exactly
   `https://<staging-host>/sign-in` and `https://<staging-host>/reset-password`;
   keep "Confirm email" and "Secure password change" on; JWT expiry 900 s.
   Configure custom SMTP (§8).
2. **Migrations**: `npx supabase link --project-ref <staging-ref>`, then
   `npm run db:push -- --env staging` (dry run) and
   `npm run db:push -- --env staging --apply`. Check types:
   `DB_URL=<staging connection string> npm run db:types:check`.
   Verify `select jobname from cron.job` lists `tradepilot-recover-tasks`
   (pg_cron is enabled by the migration if the project offers it; the queue
   is correct without it).
3. **Cloudflare Pages**: create a Pages project named `tradepilot` (Direct
   Upload; no Git integration needed). Settings → Variables → *Preview*:
   `SUPABASE_URL=https://<staging-ref>.supabase.co`, and the encrypted secret
   `SUPABASE_SECRET_KEY` (the staging project's secret/service-role key).
4. **Protect it**: Cloudflare Zero Trust → Access → add a self-hosted
   application for `*.tradepilot.pages.dev` (all preview deployments) with a
   policy allowing only your email (one-time PIN). The Zero Trust free plan
   covers this. Agents then need an Access **service token**: add a Service Auth
   policy and put its id/secret in the agent's `.env.agent.local` as
   `TRADEPILOT_ACCESS_CLIENT_ID` / `TRADEPILOT_ACCESS_CLIENT_SECRET` (the
   reference agent sends them as `CF-Access-Client-Id/-Secret`).
5. **Build config**: create `.env.staging.local` with the staging
   `VITE_SUPABASE_URL` and publishable key.
6. **Deploy**: `export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…` (token
   scoped to *Cloudflare Pages: Edit*), then `npm run deploy:staging`. The
   script prints the preview URL and runs the verification (§6).
7. **Owner**: sign up on staging, confirm the email, then on the trusted
   machine (with the staging values in `.env.server.local`)
   `npm run owner:assign -- you@example.com`; then disable sign-ups in the
   staging project.
8. **Agent**: `TRADEPILOT_API_URL=https://<staging-host> npm run agent:register -- "Staging diagnostics"`,
   then `npm run agent:diagnostics`. Run a health check from Connections.
9. **MT5 connector**: follow [mt5-connector.md](mt5-connector.md) with the staging
   `https://` address. If staging is behind Cloudflare Access, set
   `TRADEPILOT_ACCESS_CLIENT_ID` / `TRADEPILOT_ACCESS_CLIENT_SECRET` in the
   Windows environment of the connector (service token).

## 5. Production checklist

Do not publish an unrestricted production workspace before Phase 4's gates
(see [security.md](security.md) §4). When the time comes:

- [ ] Separate Supabase production project; migrations applied with `db:push -- --env production --apply --confirm-production` *after* the same migrations ran on staging; `db:types:check` passes against it.
- [ ] Auth: site URL and redirect allow-list = the production origin only; custom SMTP; confirmations on; JWT 900 s; session timebox/inactivity configured (needs Supabase Pro — otherwise document the accepted risk).
- [ ] Pages production variables: `SUPABASE_URL`, encrypted `SUPABASE_SECRET_KEY` (production key, never the staging one).
- [ ] Custom domain on Pages with HTTPS; HSTS verified on both static and API responses.
- [ ] `npm run deploy:production -- --confirm-production` from a clean, reviewed `main`; verification passes without `--expect-noindex`.
- [ ] Owner assigned; sign-ups disabled; owner MFA before any trading control exists.
- [ ] Agents registered for production only; staging agent tokens are not reused.
- [ ] `npm audit --omit=dev` clean.
- [ ] Rollback rehearsed (§9).

## 6. Verifying headers and routes on real responses

```bash
npm run verify:deployment -- https://<deployment-url> --expect-noindex   # staging
npm run verify:deployment -- https://<production-domain>                 # production
npm run verify:deployment -- http://127.0.0.1:8788 --expect-noindex     # local (npm run pages:dev)
```

It checks, on live HTTP responses: CSP (script-src self, frame-ancestors none,
Trusted Types), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy,
HSTS (https), noindex (staging) on `/` and a deep link; the SPA fallback;
immutable caching and absence of source maps / privileged keys in every
bundled script; `/api/health`; the API headers on Function responses; 401 for
`/api/agent/claim` without a token and with a forged one; no CORS grant to a
foreign origin; JSON 404 for unknown API paths. Result locally: **45/45**.

## 7. Key handling

* Browser: publishable key only. Build and runtime both reject privileged keys.
* Functions: `SUPABASE_SECRET_KEY` as an encrypted Pages secret, per
  environment. Rotate in Supabase (API keys → create new secret key → update
  the Pages secret → redeploy → delete the old key).
* Agents: one token per agent, 256 bits, `tpa_` prefix; only its SHA-256 is
  stored (`private.agent_credentials`, not exposed through the API, not
  readable even by `service_role` directly). Revoke with
  `npm run agent:revoke -- <id>`; the next request is refused.
* Cloudflare API token: shell environment of the deploying machine only,
  scoped to Pages edit. Never in CI logs or files.

## 8. Email provider

Supabase's built-in sender is for testing (low hourly limit, no custom
domain). For staging/production configure custom SMTP in Authentication →
SMTP. Free-tier options exist (e.g. Resend, Brevo, Amazon SES within its free
allowance); pick one, verify a sending domain (SPF/DKIM), and set the sender
name "TradePilot". No provider was configured in this phase.

## 9. Rollback

* **Frontend/Functions**: Cloudflare dashboard → Pages → Deployments →
  *Rollback* on the previous good production deployment (instant; also
  `npx wrangler pages deployment list --project-name tradepilot`). Preview
  deployments are immutable per commit, so staging rolls back by redeploying
  an older commit.
* **Database**: prefer a forward fix (new migration). Each migration has a
  manual down script in `supabase/rollbacks/`;
  `20261025090000_task_queue.down.sql` drops the queue **and its data**
  (verified locally: down → up → full pgTAP suite). Take a backup first
  (free plan: download a `pg_dump` with `supabase db dump`).
* Code and schema are versioned together, so roll back the frontend to a
  deployment that matches the schema you restore.

## 10. Costs and free-tier limits

No paid service, VPS or always-on worker was created. Limits to watch (check
the providers' current pricing pages; they change):

| Service | Free allowance relevant here | TradePilot usage |
| --- | --- | --- |
| Cloudflare Pages | unlimited static requests/bandwidth; 500 deploys/month | static app |
| Pages Functions (Workers free) | 100,000 requests/day, ~10 ms CPU per request | `/api/*` only: one diagnostics agent ≈ 13,000/day (heartbeat 20 s, idle poll 10 s); the MT5 connector up to ≈ 68,000/day in a busy market with default intervals (quotes sent only on new ticks every ≥ 2 s), ≈ 35,000 with a 5 s price interval, near zero on weekends |
| Cloudflare Access | free for small teams (Zero Trust free plan) | staging protection |
| Supabase free | 500 MB DB, limited projects, projects pause after a period of inactivity, Realtime connection/message quotas | tasks, agents, audit; MT5 data is bounded (current state + ≤ 1000 bars/series + one equity point per minute, pruned after 180 days ≈ 260k rows max); each quote change is one Realtime message per open tab |
| pg_cron | included | one job per minute |

If a limit is reached, the free plans stop serving rather than bill
(Cloudflare Functions return errors; Supabase pauses/limits). Nothing in
this repository upgrades a plan.

## 11. Known limitations

* No hosted deployment exists yet; the steps above are untested against real
  Cloudflare/Supabase accounts (only against their local runtimes).
* Staging protection relies on configuring Cloudflare Access by hand.
* The agent API has no edge rate limiter (no free durable counter); the
  database enforces per-owner submission limits, per-agent concurrency, and
  unauthenticated requests are rejected before any database call. A
  Cloudflare rate-limiting rule (one is included in the free plan) on
  `/api/agent/*` is recommended.
* Supabase session timebox / inactivity limits need a paid Supabase plan on
  hosted projects (see security.md).
