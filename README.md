# TradePilot AI

A personal workspace for researching, testing and understanding Forex trading robots (MetaTrader 5 Expert Advisors).

> **Status: Phase 1 — frontend foundation.** This is a design-complete UI preview. Nothing is connected to MetaTrader 5, a
> broker, a database or an AI service yet. Every screen that shows figures is clearly labelled **Sample data** or
> **UI preview**, and every control for a future capability explains what it will do and confirms that nothing was run.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm test           # unit / interaction tests (Vitest + Testing Library)
npm run lint
```

Requires Node 20+. The app uses client-side routing, so a static host must rewrite unknown paths to `index.html`.

## Stack

React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · React Router 7 · Motion (animation) · Recharts (charts) ·
Radix primitives (accessible dialogs, popovers, menus, tabs) · Lucide icons · Inter / JetBrains Mono (self-hosted).

## Project structure

```
src/
  styles/index.css        Design tokens (colour, type, radius, elevation, motion, layering) for dark + light themes
  config/                 Navigation and the honest integration-status model (all "not connected" in Phase 1)
  content/glossary.ts     Plain-English definitions surfaced via <Term>, InfoTips, search and Settings › Glossary
  data/                   Domain types + clearly marked SAMPLE data used only for previews
  lib/                    Preferences (theme, sidebar, sample-data toggle), toasts, preview notices, motion tokens
  components/
    ui/                   Buttons, badges, cards, dialogs, tabs, forms, tables, empty states, skeletons, banners
    layout/               Application shell, sidebar, mobile drawer, top bar, search palette, notifications
    charts/               ChartContainer, legends, equity / comparison / drawdown charts
    domain/               RobotCard, ActivityItem, RiskMetric, ConnectionStatus, WorkflowSteps, LogList…
  pages/                  Dashboard + the eight section pages
  test/                   Test setup and interaction tests
```

## Design principles

- **Honesty first.** Sample figures always carry a visible label; connection states are always the real ones
  (`Not connected` / `Not configured`). Switch between sample previews and the real empty workspace from the dashboard
  banner or **Settings › Data management**.
- **Plain English.** Specialist terms (drawdown, profit factor, EA, VPS…) have one-tap explanations that work with
  mouse, keyboard and touch.
- **Status is never colour alone.** Every status pairs colour with an icon and text.
- **Restrained motion.** 150–300 ms transitions on transform/opacity; the OS *reduce motion* setting disables
  movement and chart animations.

## Phase boundary

Not implemented (later phases): authentication, database, API integrations, the Windows MT5 connector, MQL5
compilation, real backtests, demo execution, AI-provider integration, strategy generation and VPS provisioning.
Integration points are typed and isolated — `src/config/integrations.ts` for live status, `src/data/types.ts` for domain
records and `usePreviewNotice()` call sites for actions that will become real operations.
