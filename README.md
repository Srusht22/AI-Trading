# TradePilot AI

A personal workspace for researching, testing and understanding Forex trading robots (MetaTrader 5 Expert Advisors).

> **Status: Phase 3 — hosting foundation and durable jobs.** Real authentication (Supabase Auth), Postgres with
> Row-Level Security, persisted profile/settings, a server-written audit log, and now a durable Postgres task queue
> with authenticated worker agents. The one runnable task is a harmless **health check** run by a diagnostics agent on
> your own computer (Connections › Diagnostics). The app is prepared for Cloudflare Pages + Pages Functions and verified
> on Cloudflare's local runtime; **no hosted deployment exists yet**. Nothing is connected to MetaTrader 5, a broker or an
> AI service: those task types are registered but refused, those views show "unavailable", and invented figures appear
> only in an opt-in, labelled **Sample data** preview. See [docs/backend.md](docs/backend.md), [docs/tasks.md](docs/tasks.md),
> [docs/deployment.md](docs/deployment.md) and [docs/security.md](docs/security.md).

## Quick start

```bash
npm install
npx supabase start                         # local Postgres, Auth, Realtime, Mailpit (Docker)
cp .env.example .env.local                 # fill in URL + publishable key from `supabase status`
cp .env.server.example .env.server.local   # server tooling only (service-role key)
npm run dev                                # http://localhost:5173 — sign up, confirm via Mailpit
npm run owner:assign -- you@example.com    # trusted owner bootstrap, then reload

npm run verify            # lint, typecheck, unit tests, build, bundle secret scan
npm run test:db           # pgTAP database/RLS tests
npm run test:integration  # services against the local stack
npm run test:e2e          # Playwright: dev server + production build under its CSP
npm run db:types          # regenerate database types (db:types:check detects drift)

npm run build && npm run pages:dev          # production build + Pages Functions locally (http://127.0.0.1:8788)
npm run agent:register -- "My laptop"       # trusted machine: registers a diagnostics agent (.env.agent.local)
npm run agent:diagnostics                   # run the agent; then Connections › Run health check
npm run verify:deployment -- <url>          # check headers/routes/API auth on a running deployment
```

Requires Node 20+ and Docker. Without `.env.local` the app shows a configuration screen instead of any data. The app
uses client-side routing, so a static host must rewrite unknown paths to `index.html`.

## Stack

React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · React Router 7 · Motion (animation) · Recharts (charts) ·
Radix primitives (accessible dialogs, popovers, menus, tabs) · Lucide icons · Inter / JetBrains Mono (self-hosted) ·
Supabase (Auth, Postgres + RLS, Realtime) · TanStack Query · zod.

## Project structure

```
src/
  styles/index.css        Design tokens (colour, type, radius, elevation, motion, layering) for dark + light themes
  config/                 Navigation and the integration-status model (MT5/AI "not available yet")
  content/glossary.ts     Plain-English definitions surfaced via <Term>, InfoTips, search and Settings › Glossary
  domain/                 Typed models + zod schemas (settings, profile, audit, freshness, market-data contracts)
  services/               Service interfaces and their Supabase implementations (the only code that talks to the backend)
  hooks/                  TanStack Query hooks (user-scoped query keys, no automatic write retries)
  data/                   Clearly marked SAMPLE data used only for the opt-in preview
  lib/                    Auth provider, env validation, error taxonomy, realtime, theme sync, preferences, toasts
  pages/auth/             Sign in, sign up, forgot / reset password
  components/
    ui/                   Buttons, badges, cards, dialogs, tabs, forms, tables, empty states, skeletons, banners
    layout/               Application shell, sidebar, mobile drawer, top bar, search palette, notifications
    charts/               ChartContainer, legends, equity / comparison / drawdown / activity charts
    domain/               RobotCard, AuditEventList, FreshnessBadge, LiveIndicator, RiskMetric, ConnectionStatus…
  pages/                  Dashboard + the eight section pages
  test/                   Unit/component tests and the in-memory service double
supabase/
  migrations/             Versioned SQL: schema, constraints, triggers, grants, RLS policies
  tests/database/         pgTAP tests for constraints and RLS
  rollbacks/              Manual down-migrations
functions/                Cloudflare Pages Functions (routing only) — /api/health, /api/agent/<action>
server/                   Server-side handlers used by the Functions (agent protocol, headers, config)
agent/                    Reference diagnostics agent (Node, talks only to the agent API)
scripts/                  Owner/agent admin, deploy + guarded migration push, deployment verification, secret scan
tests/integration/        Real services against the local stack
tests/e2e/                Playwright browser tests
docs/backend.md           Architecture, data flow, security model, setup, verification
docs/security.md          Security review, accepted risks, pre-deployment checklist
docs/tasks.md             Task queue schema, state machine, agent protocol, leases/retries, troubleshooting
docs/deployment.md        Hosting architecture, environments, staging, deploy/verify/rollback, costs
```

## Design principles

- **Honesty first.** Account data is real and persisted; trading data that has no source yet is shown as unavailable.
  Sample figures appear only when the preview is switched on (dashboard banner or **Settings › Data management**) and
  always carry a visible label.
- **Plain English.** Specialist terms (drawdown, profit factor, EA, VPS…) have one-tap explanations that work with
  mouse, keyboard and touch.
- **Status is never colour alone.** Every status pairs colour with an icon and text.
- **Restrained motion.** 150–300 ms transitions on transform/opacity; the OS *reduce motion* setting disables
  movement and chart animations.

## Phase boundary

Implemented: authentication, owner model, profile/settings persistence, audit log, realtime, the durable task queue
with agent dispatch (health check only), hosting/deployment tooling for Cloudflare Pages.
Not implemented (later phases): the Windows MT5 connector, market/account data ingestion, robot library, MQL5
compilation, backtests, demo execution, AI-provider integration, strategy generation and VPS provisioning. Integration points are typed and isolated — `src/config/integrations.ts` for status,
`src/domain/marketData.ts` and `src/domain/freshness.ts` for future data, and `usePreviewNotice()` call sites for actions
that will become real operations.
