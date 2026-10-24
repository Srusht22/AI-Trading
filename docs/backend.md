# TradePilot AI — Backend, authentication and data architecture (Phases 2–4)

This document describes what is implemented in Phase 2, how data flows, how
to set it up, and how it is verified. It is deliberately precise about what
does **not** exist yet.

Phase 3 adds a durable task queue with agent dispatch
([tasks.md](tasks.md)) and the online-hosting foundation — Cloudflare Pages +
Pages Functions, environment separation, deployment and verification tooling
([deployment.md](deployment.md)). The sections below are updated where Phase 3
changed them.

Phase 4 adds the read-only MetaTrader 5 connector: a Python program on the
owner's Windows computer that uses the same agent protocol, plus data tables
for the verified demo account and market data ([mt5-connector.md](mt5-connector.md),
[tasks.md](tasks.md) §10, [security.md](security.md) §7).

## 1. Decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Auth | Supabase Auth (GoTrue), email + password, PKCE flow | Provider-managed hashing, sessions, refresh-token rotation, email confirmation and recovery. No custom auth code. |
| Database | Supabase Postgres, SQL migrations in `supabase/migrations` | Version-controlled schema, constraints and Row-Level Security. |
| Authorization | RLS policies + column-level grants + SECURITY DEFINER functions | Enforced by the database regardless of what the browser does. |
| Real-time | Supabase Realtime `postgres_changes`, two tables only | Delivery respects RLS; no custom socket server. |
| Client data access | Typed service layer (`src/services`) + TanStack Query hooks (`src/hooks`) | Pages never build queries; every response is validated with zod. |
| Server-side privileged work | Node scripts run with the service-role key (`scripts/`); Pages Functions (`functions/`, `server/`) | Owner bootstrap and agent registration (scripts); the agent protocol (Functions, Phase 3). |
| Background work | Postgres task queue + agents that run outside the browser (Phase 3) | Durable, transactional, no extra paid service. |

No second database, auth system or state library was introduced. Device-only UI
state (sidebar layout, sample-data preview) stays in `localStorage`; everything
that belongs to the account is in Postgres.

## 2. Data flow

```
 UI component ──► hook (src/hooks)            validates input (zod), owns loading/error state
                    │
                    ▼
                 service (src/services/supabase)  builds the request, validates the response,
                    │                              maps failures to AppError (src/lib/errors.ts)
                    ▼
                 supabase-js ── HTTPS + user JWT ──► PostgREST / GoTrue
                                                        │
                                                        ▼
                                                     Postgres: grants → RLS → constraints → triggers
                                                        │            (audit rows written here)
                    ◄────────── stored row or explicit error ─────────┘
                 hook updates the cache only with the stored row; UI shows saved state or the error
```

* Writes resolve only after the database confirms them. There are no
  optimistic "Saved!" messages (the theme switch applies immediately for
  feedback but is reverted, with an explanation, if saving fails).
* Writes are never retried automatically. Reads retry only on network /
  unavailable errors.
* Every query key includes the user id, and the cache is cleared whenever the
  signed-in user changes or signs out.
* Settings use optimistic concurrency: each update sends the `revision` it
  edited; a stale revision is rejected as a conflict and the latest values are
  reloaded instead of being overwritten.

## 3. Schema (migration `20261023120000_foundation.sql`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `public.profiles` | Display name only (credentials stay in `auth.users`) | 1 row per user (PK = FK to `auth.users`), trimmed 1–80 chars, no control characters, `id` immutable |
| `public.user_settings` | Theme, display currency, display timezone, date/number format, beginner help, notification preferences | Enumerated CHECKs, IANA timezone validated by trigger, notification JSON must have exactly four boolean keys, `revision` server-incremented, `user_id`/`created_at` immutable |
| `public.audit_events` | Append-only security log | Written only by triggers; metadata must be a small flat object whose keys never look like secrets; UPDATE/DELETE blocked for every role (except the FK detaching a deleted user) |
| `private.app_owner` | The single deployment owner | Not exposed through the API at all; written only by `admin_assign_owner()` |

Audit events currently recorded (all server-side): `account.created`,
`account.email_confirmed`, `auth.session_started` (sign-in),
`auth.session_ended` (sign-out), `auth.password_changed`, `profile.updated`,
`settings.updated` (field **names** only, never values), `owner.assigned`.

All timestamps are `timestamptz` (UTC). Audit times use `clock_timestamp()` so
events within one transaction keep their order; pagination is a keyset on
`(created_at, id)`. The client converts to the user's chosen display timezone
and always prints the zone. Broker-server time (MT5) will be labelled
separately when that data exists (`TimeBasis` in `src/domain/marketData.ts`).

Rollback script: `supabase/rollbacks/20261023120000_foundation.down.sql`
(destroys Phase 2 data; run manually).

Migration `20261024090000_session_bound_access.sql` (Phase 2.1) adds
`public.has_active_session()` and requires it in every policy, `is_owner()` and
`get_my_access()`, so revoking a session (sign-out, "sign out other devices",
admin revoke) revokes database and Realtime access immediately rather than when
the access token expires. A revoked token calling `get_my_access()` gets
SQLSTATE `28000`, shown to the user as "session expired". See
[security.md](security.md).

### TypeScript types

* `src/lib/supabase/database.generated.ts` — output of `supabase gen types`,
  never edited by hand. `npm run db:types` regenerates it (from the
  `supabase start` stack, or any database via `DB_URL=…`), and writes only
  if generation succeeded. `npm run db:types:check` fails on schema drift.
* `src/lib/supabase/database.types.ts` — the type the client uses: the
  generated schema with Insert/Update narrowed to the columns `authenticated`
  is actually granted (`WRITABLE_COLUMNS`). Writing an ownership, revision or
  timestamp column, or any audit event, fails to compile
  (`database.types.check.ts`), and `tests/integration/types.test.ts` proves the
  list equals `information_schema.column_privileges`.

### Task queue (migration `20261025090000_task_queue.sql`, Phase 3)

`task_types`, `tasks`, `task_attempts`, `agents` (public, read-only for the
owner under RLS) and `private.agent_credentials` / `private.task_leases`.
Writes only through `submit_task` / `cancel_task` (owner, live session) and
the service-role `agent_*` / `admin_*` functions; a trigger enforces the
state machine for every role. New audit events: `task.submitted`,
`task.cancel_requested`, `task.succeeded`, `task.failed`, `agent.registered`,
`agent.revoked`. Details: [tasks.md](tasks.md). Rollback:
`supabase/rollbacks/20261025090000_task_queue.down.sql`.

### MT5 connector data (migration `20261026090000_mt5_connector.sql`, Phase 4)

| Table | Contents | Bounds |
| --- | --- | --- |
| `mt5_connections` | one per agent: status (`awaiting_verification`/`verified`/`blocked`/`disconnected`) + reason, account fingerprint (HMAC), masked account, server, company, currency, leverage, detected account type, terminal build, broker UTC offset, intervals, last-update times | — |
| `mt5_account_state` | current balance, credit, equity, profit, margin, free margin, margin level, `observed_at` | 1 row per connection |
| `mt5_account_snapshots` | equity history | one per `snapshot_interval_s` (≥ 60 s); pruned after 180 days (pg_cron) |
| `mt5_symbols` | broker symbols, digits, point, `monitored` flag | ≤ 5000 per connection; ≤ 8 monitored |
| `mt5_quotes` | latest bid/ask per monitored symbol: `tick_time` (broker, UTC), `observed_at` (connector), `received_at` (server; changes only on a new tick) | 1 row per symbol |
| `mt5_bars` | OHLC + tick volume for M1/M5/M15/H1 | newest 1000 per series |
| `mt5_positions`, `mt5_orders` | current snapshot (replaced on each read) | ≤ 200 each |
| `mt5_deals` | the last requested history window | ≤ 500 |

All carry `owner_user_id` and `connection_id`; RLS lets only the owning user
(with a live session) read them; nobody — `service_role` included — may write
them directly. The connector writes through `mt5_report_connection` /
`mt5_publish` (service role, via the agent API); the owner acts through
`create_agent_pairing`, `set_mt5_monitored_symbols`,
`update_mt5_connection_settings`, `disconnect_mt5_connection`,
`resume_mt5_connection`, `revoke_agent`. New audit events: `agent.pairing_created`,
`agent.paired`, `connector.verified`, `connector.blocked`,
`connector.symbols_selected`, `connector.disconnected`, `connector.resumed`.
Realtime publishes `mt5_connections`, `mt5_account_state`, `mt5_quotes`,
`mt5_positions`, `mt5_orders`. Rollback:
`supabase/rollbacks/20261026090000_mt5_connector.down.sql`.

### Planned domain tables (not created yet)

Robots and versions, strategy specifications and source versions, backtest
configurations and reports, demo accounts and trades, research experiments,
approval requests, demo trade execution. (Connector registration, heartbeats
and read-only account data now exist.) They will follow
the same pattern: `user_id` FK, RLS restricted to the owner via
`public.is_owner()`, audit triggers. None are created in Phase 2 because no
code would populate them.

## 4. Security model

* **Browser key**: only the publishable/anon key. `src/lib/env.ts` rejects a
  service-role/secret key at runtime, `vite.config.ts` refuses to build if a
  `VITE_` variable holds one, and `npm run check:secrets` scans `dist/` for
  privileged keys and source maps.
* **Grants**: `anon` has no table privileges. `authenticated` may select its
  rows, insert its own missing profile/settings row, and update only the
  user-editable columns. Ownership columns, revision and timestamps are not
  updatable.
* **RLS**: every table has RLS enabled. Users see and change only rows where
  the id equals `auth.uid()`. The owner may additionally read all audit events.
* **Owner**: `public.admin_assign_owner()` is executable only by
  `service_role`. Registration never grants ownership; there is no "first
  user wins" and no browser path to claim it. Non-owners who sign in see an
  "access" screen and nothing else.
* **Sessions**: managed by supabase-js (PKCE, auto refresh, refresh-token
  rotation). The app never reads, writes or logs tokens; dev logging redacts
  anything resembling a credential. Sign-out ends the server session;
  "Sign out other devices" revokes the other refresh tokens.
* **Password policy**: ≥ 10 characters with upper, lower and digit (server
  config in `supabase/config.toml`, mirrored in the UI for early feedback).
  Email confirmation is required before first sign-in.
* **Enumeration**: sign-in, sign-up and password-reset responses never reveal
  whether an email is registered.
* **Redirects**: `next=` targets are restricted to same-origin paths.
* **Session binding**: data access requires a live `auth.sessions` row for the
  token's `session_id` (Phase 2.1).
* **Browser hardening**: strict CSP with Trusted Types, `frame-ancestors
  'none'`, `connect-src` limited to the Supabase project, plus standard
  security headers — injected into every build and emitted as `dist/_headers`
  (Phase 2.1, [security.md](security.md)).

Session storage: supabase-js keeps the session (including the refresh token)
in `localStorage`. The risks, the mitigations in place and the recommended
path to server-managed `HttpOnly` cookies before trading controls are hosted
are documented in [security.md](security.md).

## 5. Real-time scope

Live subscriptions exist only for real sources:

* `user_settings` (own row) → settings and theme update across tabs/devices;
* `audit_events` (own events) → the dashboard and account activity update;
* `tasks` (own tasks) and `agents` (owner only) → Connections › Diagnostics (Phase 3);
* `mt5_connections`, `mt5_account_state`, `mt5_quotes`, `mt5_positions`, `mt5_orders`
  (own rows) → connection wizard, Dashboard, Demo Trading (Phase 4). While a
  subscription is not live the views refresh every 5–15 s and say
  "Auto-refresh", never "Live".

When a subscription becomes live again after a disconnect, its queries are
refetched (Realtime does not replay missed changes).

The UI shows **Live** only after Realtime confirms the database subscription,
and otherwise **Auto-refresh** (data refreshes after the user's own changes and
on tab focus). Channels are removed on unmount and sign-out.

Robot, backtest and research data does not exist yet. Those views show
explicit `unavailable` states (`src/domain/freshness.ts`,
`src/config/integrations.ts`) and empty charts — never generated values. The
chart components accept typed series (`EquitySeries`, `PriceBar`) with
provenance and freshness, ready for real sources in later phases.

## 6. Setup

### Local development

```bash
npm install
npx supabase start                 # Docker required; prints API URL and keys
cp .env.example .env.local         # browser: URL + publishable/anon key
cp .env.server.example .env.server.local   # tooling: URL + service-role key (+ Mailpit URL)
npm run dev
```

Migrations in `supabase/migrations` are applied automatically by
`supabase start` / `npm run db:reset`. Confirmation and reset emails are caught
by the local Mailpit inbox (`http://127.0.0.1:54324`).

### Owner bootstrap

1. Sign up in the app with the owner's email and confirm it.
2. On a trusted machine with `.env.server.local` configured:
   `npm run owner:assign -- you@example.com`
3. Reload the app. To transfer ownership later add `--replace`.

Equivalent SQL (Supabase SQL editor, which runs as a privileged role):
`select public.admin_assign_owner('you@example.com');`

### Closing registration

After the owner exists, turn off public sign-ups:
hosted — Dashboard › Authentication › Sign In / Providers › disable "Allow new
users to sign up"; local — set `enable_signup = false` under `[auth]` in
`supabase/config.toml` and restart. The sign-up page reads the auth server's
public settings and shows "registrations are closed".

### Hosted deployment

Phase 3 replaces the outline below with a full procedure — environments,
guarded migrations, Cloudflare Pages deploy, staging protection, verification
and rollback: **[deployment.md](deployment.md)**. Summary:

1. Create a Supabase project per environment; push migrations with the guarded `npm run db:push`.
2. In Auth settings: site URL = your domain; redirect URLs exactly
   `https://your-domain/sign-in` and `https://your-domain/reset-password`;
   configure SMTP (the built-in sender is rate-limited); keep "Confirm email"
   and "Secure password change" on; JWT expiry 900 s; session timebox and
   inactivity timeout as in `supabase/config.toml`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the static
   host's build environment; configure SPA fallback to `index.html`; serve the
   headers in `dist/_headers` (see the checklist in [security.md](security.md)).
4. Bootstrap the owner and close registration as above.

## 7. Verification

| Command | What it runs |
| --- | --- |
| `npm test` | Unit + component tests (jsdom) using an in-memory service double for deterministic auth states and failure injection |
| `npm run test:db` | pgTAP suite in `supabase/tests/database` — constraints, RLS matrix (anon / user A / user B / owner / service_role), audit immutability |
| `npm run test:integration` | Real services against the local stack: auth, persistence, conflicts, RLS over REST, Realtime delivery under RLS, Mailpit email flows |
| `npm run test:e2e` | Playwright in a real browser against the local stack: sign-up → email confirmation → owner gate, reset password, persistence across reload, cross-tab Realtime, honest dashboard, mobile layout; plus the **production build** under its CSP/headers (no violations, injected script blocked, framing refused) |
| `npm run db:types:check` | Generated types match the live schema |
| `npm run verify` | lint, typecheck, unit tests, build, bundle secret scan |
| `npm run test:db:local` | the pgTAP suite with plain `psql` against `DATABASE_URL` (stacks not started by the Supabase CLI) |
| `npm run pages:dev` | production build + Pages Functions on Cloudflare's local runtime (port 8788) |
| `npm run verify:deployment -- <url>` | headers, routes, API auth and bundle checks on a running deployment's real responses |
| `npx playwright test --project=pages` | E2E on the Pages runtime: Function headers, deep links, a real agent running a health check requested from the browser |

Integration and E2E tests create users and reassign the owner, so they refuse
to run against non-local URLs unless `ALLOW_REMOTE_TESTS=1`.
