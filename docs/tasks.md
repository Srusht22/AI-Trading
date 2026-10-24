# TradePilot AI — Durable tasks and agent protocol (Phase 3)

A Postgres-backed queue (migration `supabase/migrations/20261025090000_task_queue.sql`)
for work that must happen outside the browser. Runnable today: the harmless
`system.health_check` and, since Phase 4, seven **read-only** MetaTrader 5
tasks (§10). MT5 execution types (`mt5.compile_ea`, `mt5.backtest`,
`mt5.collect_report`) and `strategy.evaluate` stay registered but
**unavailable**: submission is refused with the reason and no agent is ever
offered them.

## 1. Schema

| Object | Purpose |
| --- | --- |
| `public.task_types` | Registry: label, `available` + reason, required capability, minimum agent version, max attempts, lease length, queue deadline, retry base delay, payload size limit. |
| `public.tasks` | One row per task: `origin` (user/system), `owner_user_id`, `task_type`, validated `payload`, `idempotency_key`, `status`, `created_at`/`updated_at`, `available_at` (next eligible time), `expires_at` (queue deadline), `claimed_by_agent`, `claimed_at`, `lease_expires_at`, `started_at`, `attempt_count`/`max_attempts`, `progress_percent`/`progress_message` (only when an agent reports them), `result` (safe JSON), `error` (`{code, message, retryable}`), `cancel_requested_at`, `completed_at`, `revision`. |
| `public.task_attempts` | History: attempt number, agent, claimed/started/ended, outcome (`succeeded`, `failed`, `retry_scheduled`, `lease_expired`, `cancelled`), error. |
| `public.agents` | Registered agents: name, capabilities allowed by the owner, capabilities/version/platform the agent reports, heartbeat, revoked. |
| `private.agent_credentials` | SHA-256 of each agent token. Not in the API schema; no role but the definer functions can read it. |
| `private.task_leases` | The lease token of the current attempt. Kept out of `public.tasks` so it never appears in API responses or Realtime payloads. |

Constraints enforce the invariants: a lease exists exactly in `claimed`,
`running`, `cancel_requested`; terminal states have `completed_at`;
`succeeded` has a result and no error; `failed` has an error; queued tasks
carry no result/progress; payloads and results are objects ≤ 4 KB whose keys
cannot look like credentials (`password`, `token`, `secret`, `apikey`,
`session`, `login`, …) at any depth; each type has an allow-listed payload
contract (`system.health_check`: `{}` or `{ "note": "<= 80 chars" }`).

Nobody — not `authenticated`, not `service_role` — has INSERT/UPDATE/DELETE
on these tables. All changes go through SECURITY DEFINER functions.

## 2. State machine

```
            submit_task
                │
                ▼
  ┌───────── queued ─────────┐──── deadline passed ───► expired
  │  cancel     │ claim      │
  ▼             ▼            │
cancelled ◄── claimed ───────┤ lease expired / retryable failure (attempts left)
  ▲             │ start      │        └──► queued (available_at = now + backoff)
  │             ▼            │
  │          running ────────┘
  │             │  └── complete ──► succeeded
  │             │  └── fail (final) ──► failed
  │   cancel    ▼
  └──── cancel_requested ── complete/fail ──► succeeded / failed
         (agent acks or lease expires → cancelled)
```

`private.guard_task_update` (BEFORE UPDATE trigger) rejects any other
transition (`TPS01`), any change to a finished task, and any change to
identity, payload, limits or deadline — for every role, including the table
owner. Deletes are refused except by the cascade from a deleted account.

## 3. Owner functions (browser, via PostgREST RPC)

`submit_task(type, payload, idempotency_key)` and `cancel_task(task_id)`
require a live session (`28000` otherwise) and the owner (`42501`).

`submit_task` checks, in order: key format (8–64 `[A-Za-z0-9_-]`); **replay**
— the same `(owner, key)` returns the original task, a different request with
the same key is `TPI01`; type exists (`TPV01`) and is available (`TPU01` with
the reason); payload contract and size (`TPV01`); then under a per-owner
advisory lock: re-check the key, at most 10 submissions/minute and 5
unfinished tasks (`TPR01`), and that an eligible agent is online (`TPU02`).
It writes `task.submitted` to the audit log.

The UI generates one idempotency key per user action and reuses it when the
outcome of a request is unknown (network error), so a retry can never create
a second task.

## 4. Agent protocol

Agents call `POST /api/agent/<action>` with `Authorization: Bearer tpa_…` and
a JSON body (≤ 8 KB, strict schema per action). The Function rejects bad
input before touching the database, hashes the token and calls the matching
`agent_*` function (executable by `service_role` only). Responses are
`{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

| Action | Body | Effect |
| --- | --- | --- |
| `heartbeat` | `agent_version`, `capabilities[]`, `platform?` | marks the agent online for 45 s; returns effective capabilities (reported ∩ allowed) |
| `claim` | `{}` | runs lease recovery, then hands out at most one eligible task (`FOR UPDATE SKIP LOCKED`) with a fresh `lease_token`; `null` if none or at the agent's concurrency limit |
| `start` | `task_id`, `lease_token` | `claimed → running` |
| `renew` | + `progress_percent?`, `progress_message?` | extends the lease, records monotonic progress, returns `cancel_requested` |
| `complete` | + `result` | `→ succeeded` (result must pass the safety checks) |
| `fail` | + `error {code, message, retryable}` | retry with backoff or `→ failed` |
| `ack-cancel` | lease | `cancel_requested → cancelled` |

HTTP errors: 400 bad JSON, 401 unknown/revoked token, 404 unknown action,
405 not POST, 409 `heartbeat_required` / `lease_lost` / `invalid_state`, 413
too large, 415 not JSON, 422 validation, 429/502/503 retry with backoff.

**Eligibility** for a claim: task `queued`, `available_at` reached, deadline
not passed, type available, capability allowed by the owner *and* reported by
the agent, agent version ≥ the type's minimum, agent online, below its
`max_concurrent_tasks`.

## 5. Leases, retries, stale workers

* Each claim creates a new random lease token tied to the agent and attempt.
  Every later call must present it and the lease must be unexpired — otherwise
  `lease_lost` (`TPL01`). A worker that stalled, lost its lease and comes back
  cannot overwrite the result of the worker that took over (tested).
* Lease length per type (health check: 30 s); `renew` extends it.
* Recovery (`private.recover_tasks()`), run by pg_cron every minute and at the
  start of every claim: expired leases end the attempt as `lease_expired`;
  the task is re-queued with backoff if attempts and deadline remain, else
  `failed`; `cancel_requested` tasks become `cancelled`; queued tasks past
  their deadline become `expired`.
* Backoff: `retry_base_seconds × 2^(attempt−1)`, capped at 5 minutes.
* Non-retryable failures, or the last attempt, end in `failed` with the error.

## 6. Realtime

`tasks` and `agents` are in the `supabase_realtime` publication; delivery
honours RLS (owner's own tasks; agents to the owner only). The UI shows
**Live** only after Realtime confirms the Postgres subscription. Whenever a
subscription becomes live again after a disconnect, the matching queries are
refetched, because Realtime does not replay missed changes. While not live,
active tasks poll every 5 s and agents every 15 s, labelled *Auto-refresh*.

## 7. Running the reference agent

```bash
npm run agent:register -- "My laptop"      # writes .env.agent.local (mode 600)
npm run agent:diagnostics                  # Ctrl+C to stop; --once for one task
npm run agent:revoke -- <agent-id>         # lost or leaked token
```

The agent measures only what it can observe: Node runtime/platform, free
memory, uptime, three round trips to `/api/health` (min/median/max) and the
clock offset against the server's timestamp. It never prints its token and
has no database or Supabase credentials.

## 8. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Run health check" disabled, agent *Never connected* | The agent is registered but not running, or cannot reach `TRADEPILOT_API_URL`. Start it; check its log. |
| Agent *Not responding* | No heartbeat for 45 s: process stopped, computer asleep, network down. |
| Agent log `unauthorized` | Token revoked, wrong environment, or `.env.agent.local` from another deployment. Register a new agent. |
| Agent log `heartbeat_required` | Clock/heartbeat gap > 45 s before claiming; it retries automatically. |
| Task stays *Queued* | No eligible agent (capability/version), or backoff after a failure (see "retrying in …"). It expires at its deadline. |
| `lease_lost` in the agent log | Expected after a pause longer than the lease; the task was recovered and may run again elsewhere. |
| Submission says "too many tasks" | 5 unfinished or 10 per minute per owner. Wait or cancel. |
| `/api/agent/*` returns 503 `server_misconfigured` | `SUPABASE_URL`/`SUPABASE_SECRET_KEY` missing or not a server key in that Pages environment. |
| Queue never recovers expired leases | pg_cron not enabled — recovery still runs on every claim; enable pg_cron for idle periods. |

## 9. Limits and what is not built

* One runnable type. MT5 compile/backtest/report and strategy evaluation are
  rejected (`TPU01`) until a connector exists and their payload contracts are
  written.
* No result storage beyond 4 KB JSON (reports/files belong in Storage later).
* No priority or per-type concurrency yet; FIFO by `available_at`.
* Task history is not pruned yet.

## 10. Read-only MT5 tasks (Phase 4)

Migration `20261026090000_mt5_connector.sql`. Every type below requires the
capability `mt5.read`, connector version ≥ 1.0.0, a payload ≤ 256 bytes with
exactly the listed keys, and a connection that belongs to the submitting owner
and is **verified as a demo account** (`mt5.terminal_status` may also run
while verification is pending). The task is **targeted** at that connection's
agent (`tasks.target_agent_id`): no other agent can claim it. Lease 60 s
(120 s for symbol list and history), 2 attempts, 5-minute queue deadline.

| Type | Payload | Connector does (read-only) | Result (≤ 4 KB) | Failure codes |
| --- | --- | --- | --- | --- |
| `mt5.terminal_status` | `connection_id` | `terminal_info`, `version`, `account_info`; sends a verification report | `state`, `trade_mode`, `terminal_build`, `terminal_connected`, `demo_verified` | — |
| `mt5.account_snapshot` | `connection_id` | `account_info` → publishes `account` | `published` | `account_not_verified`, `account_unavailable` |
| `mt5.symbol_list` | `connection_id` | `symbols_get` → publishes `symbols` in pages of 500 | `symbols` (count) | `symbols_unavailable`, `publish_failed` |
| `mt5.price_history` | `connection_id`, `symbol`, `timeframe` (M1/M5/M15/H1), `count` (10–500) | `symbol_info` (+`symbol_select` if hidden), `copy_rates_from_pos` → publishes `bars` | `bars`, `first_bar_at`, `last_bar_at` | `symbol_unavailable`, `history_unavailable`, `malformed_mt5_data` |
| `mt5.positions_read` | `connection_id` | `positions_get` → publishes `positions` | `positions` (count) | `positions_unavailable`, `malformed_mt5_data` |
| `mt5.pending_orders_read` | `connection_id` | `orders_get` → publishes `orders` | `orders` (count) | `orders_unavailable` |
| `mt5.recent_history_read` | `connection_id`, `days` (1–30) | `history_deals_get` for the window → publishes newest 500 `deals` | `deals`, `days` | `history_unavailable` |

Every data task re-verifies the demo account first and fails with
`account_not_verified` (not retried) otherwise. Unknown types fail with
`unsupported_task`. Results never contain account numbers or names.

There is no task type, API action or database function that sends, modifies,
cancels or closes an order, or starts an Expert Advisor. The connector reaches
MT5 only through an allow-list wrapper (`connector/tradepilot_connector/terminal.py`),
and `connector/tests/test_readonly.py` fails the build if the source references
`order_send`, `order_check`, `Buy`, `Sell`, `Close`, `login` or trade-action
constants.

### Continuous data (telemetry) — why not the queue

Quotes and the account summary change every few seconds; one queued task per
tick would flood the queue. They use two extra agent actions on the same
authenticated endpoint, with the same token and capability model:

* `POST /api/agent/mt5-connection` — the verification report (state, account
  type code, account fingerprint, masked account, server, currency, terminal
  build). The server decides `verified` / `blocked` / `awaiting_verification`
  and answers with the owner's symbol choice and intervals.
* `POST /api/agent/mt5-publish` — `{connection_id, account_fingerprint, kind, data}`
  for kind `account | quotes | symbols | bars | positions | orders | deals`.
  Accepted only for the agent's own connection, only while it is `verified`,
  only with the bound account fingerprint (a different one blocks the
  connection), at most once per 0.8 s (quotes), 4 s (account), 2 s
  (positions/orders), 5 s (deals); strict schemas and list limits (8 quotes,
  1000 symbols per page, 1000 bars, 200 positions/orders, 500 deals); 512 KB
  body limit.

`POST /api/agent/pair` registers a new connector from an owner-issued one-time
code (see security.md §7).
