"""The connector's main loop.

Single-threaded and schedule-driven. Each step:

1. keeps the terminal attached (re-initialising with backoff when MT5 closes);
2. re-verifies the logged-in account (cheap local call) and ends the
   publication session the moment it is no longer the verified demo account;
3. sends heartbeats and verification reports to the TradePilot server;
4. while the server says "verified" for the same account, publishes changed
   quotes, the account summary and open positions/pending orders;
5. claims and runs read-only mt5.* tasks.

Nothing is published when nothing changed, and nothing is ever invented: if
MT5 returns no data, no update is sent.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import timedelta
from typing import Any, Callable

from . import VERSION
from . import convert
from .api import AgentApi, ApiError, LeaseLost
from .terminal import Terminal
from .timebase import BrokerClock, iso, utc_now
from .verification import Verification, verify

CAPABILITIES = ["mt5.read"]
REPORT_INTERVAL_S = 30
HEARTBEAT_INTERVAL_S = 20
CLAIM_INTERVAL_S = 10
VERIFY_INTERVAL_S = 1
ACCOUNT_REFRESH_S = 60  # publish an unchanged account summary at most this often
TRADES_REFRESH_S = 300
SYMBOLS_REFRESH_S = 6 * 3600
SYMBOL_PAGE = 500
MAX_BACKOFF_S = 60
# Hold quotes this long after a session starts while the broker's UTC offset is
# estimated from live ticks, so tick times are not published hours off.
OFFSET_GRACE_S = 30


class AuthorizationLost(Exception):
    """The agent token was revoked or is unknown: stop everything, do not retry."""


class TaskFailure(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class Connector:
    def __init__(
        self,
        api: AgentApi,
        terminal: Terminal,
        install_secret: bytes,
        clock: BrokerClock,
        log: logging.Logger,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], Any] = utc_now,
        sleep: Callable[[float], None] = time.sleep,
        on_state: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.api = api
        self.terminal = terminal
        self.secret = install_secret
        self.clock = clock
        self.log = log
        self.monotonic = monotonic
        self.now = now
        self.sleep = sleep
        self.on_state = on_state or (lambda _s: None)

        self.terminal_attached = False
        self.verification: Verification | None = None
        self.server: dict[str, Any] | None = None
        self.session_fingerprint: str | None = None
        self.due: dict[str, float] = {}
        self.api_backoff_s = 1.0
        self.api_blocked_until = 0.0
        self.terminal_backoff_s = 2.0
        self.force_report = True
        self.reported_offset: tuple[int | None, str] | None = None
        self.visible: set[str] = set()
        self.unavailable_symbols: set[str] = set()
        self._reset_session_caches()

    # ------------------------------------------------------------------ helpers

    def _reset_session_caches(self) -> None:
        self.last_quotes: dict[str, tuple[Any, ...]] = {}
        self.last_account: tuple[Any, ...] | None = None
        self.last_account_at = -1e9
        self.last_trades: dict[str, tuple[str, float]] = {}
        self.symbols_published_at = -1e9
        self.session_started_at = self.monotonic()

    def _is_due(self, key: str, now: float) -> bool:
        return now >= self.due.get(key, 0.0)

    def _schedule(self, key: str, now: float, seconds: float) -> None:
        self.due[key] = now + seconds

    @property
    def settings(self) -> dict[str, Any]:
        return (self.server or {}).get("settings") or {}

    @property
    def publishing_allowed(self) -> bool:
        return bool(
            self.server
            and self.server.get("status") == "verified"
            and self.verification
            and self.verification.is_demo
            and self.session_fingerprint
            and self.verification.fingerprint == self.session_fingerprint
        )

    def status_summary(self) -> dict[str, Any]:
        v = self.verification
        return {
            "connector_version": VERSION,
            "terminal_attached": self.terminal_attached,
            "local_state": v.state if v else "starting",
            "local_message": v.message if v else "Starting…",
            "account": v.masked_account if v and v.is_demo else None,
            "server_status": (self.server or {}).get("status"),
            "server_reason": (self.server or {}).get("reason"),
            "publishing": self.publishing_allowed,
            "monitored_symbols": (self.server or {}).get("monitored_symbols", []),
            "broker_utc_offset_minutes": self.clock.offset_minutes,
            "broker_offset_source": self.clock.source,
            "updated_at": iso(self.now()),
        }

    def _end_session(self, why: str) -> None:
        if self.session_fingerprint:
            self.log.warning("Publication stopped: %s", why)
        self.session_fingerprint = None
        self._reset_session_caches()
        self.force_report = True

    def _call(self, action: str, body: dict[str, Any] | None = None) -> Any:
        """API call with uniform error handling. Returns None when the call did not succeed."""
        now = self.monotonic()
        if now < self.api_blocked_until:
            return None
        try:
            result = self.api.call(action, body)
        except LeaseLost:
            raise
        except ApiError as e:
            if e.auth_lost:
                raise AuthorizationLost(e.message) from None
            if e.code in ("connection_disconnected", "connection_blocked", "verification_required"):
                if self.server is not None:
                    self.server["status"] = {"connection_disconnected": "disconnected", "connection_blocked": "blocked"}.get(
                        e.code, "awaiting_verification"
                    )
                self._end_session(e.message)
                self._schedule("report", now, 5)
            elif e.code == "rate_limited":
                self.log.debug("rate limited on %s", action)
            elif e.retryable:
                self.api_blocked_until = now + self.api_backoff_s
                self.log.warning("TradePilot server unavailable (%s); retrying in %.0fs", e.code, self.api_backoff_s)
                self.api_backoff_s = min(self.api_backoff_s * 2, MAX_BACKOFF_S)
            else:
                self.log.warning("%s refused: %s", action, e.message)
            return None
        self.api_backoff_s = 1.0
        return result

    def _publish(self, kind: str, data: dict[str, Any]) -> bool:
        if not self.publishing_allowed or not self.server:
            return False
        result = self._call(
            "mt5-publish",
            {"connection_id": self.server["connection_id"], "account_fingerprint": self.session_fingerprint, "kind": kind, "data": data},
        )
        if isinstance(result, dict) and result.get("accepted") is True and "monitored_symbols" in result:
            # The server shares the owner's latest symbol choice and intervals with account updates.
            self.server["monitored_symbols"] = result["monitored_symbols"]
            self.server["settings"] = result.get("settings", self.server.get("settings"))
        if isinstance(result, dict) and result.get("accepted") is False:
            self.server["status"] = result.get("status", "blocked")
            self._end_session(f"server refused data ({result.get('reason')})")
            return False
        return isinstance(result, dict) and result.get("accepted") is True

    # ------------------------------------------------------------------ steps

    def _ensure_terminal(self, now: float) -> None:
        if self.terminal_attached or not self._is_due("terminal", now):
            return
        ok, error = self.terminal.connect()
        if ok:
            self.terminal_attached = True
            self.terminal_backoff_s = 2.0
            self.log.info("Attached to the running MetaTrader 5 terminal.")
            self.force_report = True
            return
        self.verification = Verification(state="terminal_unavailable")
        self._end_session("MetaTrader 5 is not available")
        self.log.warning("Cannot attach to MetaTrader 5 (%s); retrying in %.0fs", error, self.terminal_backoff_s)
        self._schedule("terminal", now, self.terminal_backoff_s)
        self.terminal_backoff_s = min(self.terminal_backoff_s * 2, MAX_BACKOFF_S)

    def _verify(self, now: float) -> None:
        if not self.terminal_attached or not self._is_due("verify", now):
            return
        self._schedule("verify", now, VERIFY_INTERVAL_S)
        previous = self.verification
        current = verify(self.terminal, self.secret)
        self.verification = current
        if current.state == "terminal_unavailable":
            self.terminal_attached = False
            self._schedule("terminal", now, 2)
        changed = (
            previous is None
            or previous.state != current.state
            or previous.is_demo != current.is_demo
            or previous.fingerprint != current.fingerprint
        )
        if changed:
            self.log.info(current.message)
            self.force_report = True
        if self.session_fingerprint and (not current.is_demo or current.fingerprint != self.session_fingerprint):
            self._end_session(current.message if not current.is_demo else "the terminal switched to a different account")

    def _heartbeat(self, now: float) -> None:
        if not self._is_due("heartbeat", now):
            return
        self._schedule("heartbeat", now, HEARTBEAT_INTERVAL_S)
        import platform  # noqa: PLC0415

        self._call("heartbeat", {"agent_version": VERSION, "capabilities": CAPABILITIES, "platform": f"{platform.system()}/{platform.machine()}"[:60]})

    def _report(self, now: float) -> None:
        offset = (self.clock.offset_minutes, self.clock.source)
        if offset != self.reported_offset:
            self.force_report = True
        if not (self.force_report or self._is_due("report", now)):
            return
        v = self.verification or Verification(state="terminal_unavailable")
        result = self._call("mt5-connection", v.report(self.clock.offset_minutes, self.clock.source))
        self._schedule("report", now, REPORT_INTERVAL_S)
        if not isinstance(result, dict):
            return
        self.force_report = False
        self.reported_offset = offset
        was = (self.server or {}).get("status")
        self.server = result
        if result.get("status") == "verified" and v.is_demo:
            if self.session_fingerprint != v.fingerprint:
                self._reset_session_caches()
                self.session_fingerprint = v.fingerprint
                self.log.info("Publishing live data for %s (%s).", v.masked_account, v.server)
        else:
            if self.session_fingerprint:
                self._end_session(f"server status is {result.get('status')} ({result.get('reason')})")
                self.force_report = False
            if was != result.get("status"):
                self.log.info("TradePilot connection status: %s%s", result.get("status"),
                              f" ({result.get('reason')})" if result.get("reason") else "")
        self.on_state(self.status_summary())

    def _publish_symbols(self, now: float, force: bool = False) -> int:
        if not force and now - self.symbols_published_at < SYMBOLS_REFRESH_S:
            return 0
        raw = self.terminal.symbols()
        if raw is None:
            raise TaskFailure("symbols_unavailable", "MetaTrader 5 did not return the symbol list.", retryable=True)
        items = convert.symbols(raw)
        batch = str(uuid.uuid4())
        pages = [items[i : i + SYMBOL_PAGE] for i in range(0, len(items), SYMBOL_PAGE)] or [[]]
        for page_no, page in enumerate(pages):
            ok = self._publish("symbols", {"batch_id": batch, "page": page_no, "final": page_no == len(pages) - 1, "symbols": page})
            if not ok:
                raise TaskFailure("publish_failed", "The symbol list could not be delivered.", retryable=True)
            self.sleep(0.25)
        self.symbols_published_at = now
        self.log.info("Published %d symbols offered by the broker.", len(items))
        return len(items)

    def _publish_quotes(self, now: float) -> None:
        interval = max(1.0, (self.settings.get("quote_interval_ms") or 2000) / 1000)
        if not self._is_due("quotes", now):
            return
        self._schedule("quotes", now, interval)
        changed = []
        wall = self.now().timestamp()
        for symbol in (self.server or {}).get("monitored_symbols", [])[:8]:
            if symbol not in self.visible:
                if not self.terminal.ensure_visible(symbol):
                    if symbol not in self.unavailable_symbols:
                        self.log.warning("Symbol %s is not available in this terminal.", symbol)
                        self.unavailable_symbols.add(symbol)
                    continue
                self.visible.add(symbol)
                self.unavailable_symbols.discard(symbol)
            tick = self.terminal.tick(symbol)
            if tick and isinstance(tick.get("time_msc"), int):
                self.clock.observe(tick["time_msc"], wall)
            q = convert.quote(symbol, tick, self.clock)
            if q is None:
                continue
            key = (q["tick_time"], q["bid"], q["ask"], q["last"])
            if self.last_quotes.get(symbol) != key:
                changed.append(q)
        if self.clock.source == "unknown" and now - self.session_started_at < OFFSET_GRACE_S:
            return  # broker time zone not known yet; times would be wrong by the broker's offset
        if not changed:
            return  # no new tick: nothing is sent, the website keeps showing the real last quote and its age
        if self._publish("quotes", {"observed_at": iso(self.now()), "quotes": changed}):
            for q in changed:
                self.last_quotes[q["symbol"]] = (q["tick_time"], q["bid"], q["ask"], q["last"])

    def _publish_account(self, now: float, force: bool = False) -> bool:
        info = self.terminal.account_info()
        if info is None:
            return False
        record = convert.account(info, self.now())
        key = tuple(record[k] for k in ("balance", "credit", "equity", "profit", "margin", "margin_free", "margin_level"))
        if not force and key == self.last_account and now - self.last_account_at < ACCOUNT_REFRESH_S:
            return True
        if self._publish("account", record):
            self.last_account = key
            self.last_account_at = now
            return True
        return False

    def _publish_trades(self, now: float, kinds: tuple[str, ...] = ("positions", "orders"), force: bool = False) -> dict[str, int]:
        counts = {}
        for kind in kinds:
            raw = self.terminal.positions() if kind == "positions" else self.terminal.orders()
            if raw is None:
                if force:
                    raise TaskFailure(f"{kind}_unavailable", f"MetaTrader 5 did not return {kind}.", retryable=True)
                continue
            items = convert.positions(raw, self.clock) if kind == "positions" else convert.orders(raw, self.clock)
            digest = json.dumps(items, sort_keys=True)
            last = self.last_trades.get(kind)
            counts[kind] = len(items)
            if not force and last and last[0] == digest and now - last[1] < TRADES_REFRESH_S:
                continue
            if self._publish(kind, {"observed_at": iso(self.now()), kind: items}):
                self.last_trades[kind] = (digest, now)
            elif force:
                raise TaskFailure("publish_failed", f"The {kind} could not be delivered.", retryable=True)
        return counts

    def _periodic_publication(self, now: float) -> None:
        if not self.publishing_allowed:
            return
        if self.symbols_published_at < 0:
            try:
                self._publish_symbols(now, force=True)
            except TaskFailure as e:
                self.log.warning(e.message)
        self._publish_quotes(now)
        if self._is_due("account", now):
            self._schedule("account", now, self.settings.get("account_interval_s") or 10)
            self._publish_account(now)
            self._publish_trades(now)

    # ------------------------------------------------------------------ tasks

    def _claim(self, now: float) -> None:
        if not self.server or not self._is_due("claim", now):
            return
        self._schedule("claim", now, CLAIM_INTERVAL_S)
        task = self._call("claim")
        if isinstance(task, dict) and task.get("task_id"):
            self.run_task(task)

    def run_task(self, task: dict[str, Any]) -> str:
        lease = {"task_id": task["task_id"], "lease_token": task["lease_token"]}
        self.log.info("Running %s (attempt %s).", task.get("task_type"), task.get("attempt"))
        try:
            self.api.call("start", lease)
            result = self._handle(task["task_type"], task.get("payload") or {})
            self.api.call("complete", {**lease, "result": result})
            return "succeeded"
        except LeaseLost:
            self.log.warning("Lost the lease for task %s; another attempt owns it now.", task["task_id"])
            return "lease_lost"
        except TaskFailure as e:
            self._fail(lease, e.code, e.message, e.retryable)
            return "failed"
        except convert.ConversionError as e:
            self._fail(lease, "malformed_mt5_data", f"MetaTrader 5 returned data that failed validation ({e}).", False)
            return "failed"
        except ApiError as e:
            if e.auth_lost:
                raise AuthorizationLost(e.message) from None
            self._fail(lease, "server_error", "The TradePilot server refused an update.", True)
            return "failed"

    def _fail(self, lease: dict[str, str], code: str, message: str, retryable: bool) -> None:
        self.log.warning("Task failed: %s", message)
        try:
            self.api.call("fail", {**lease, "error": {"code": code, "message": message[:300], "retryable": retryable}})
        except ApiError:
            pass

    def _handle(self, task_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        now = self.monotonic()
        if not self.server or payload.get("connection_id") != self.server.get("connection_id"):
            raise TaskFailure("wrong_connection", "This task is for a different MT5 connection.")
        if task_type == "mt5.terminal_status":
            self.due["verify"] = 0
            self._verify(now)
            self.force_report = True
            self._report(now)
            v = self.verification or Verification(state="terminal_unavailable")
            return {"state": v.state, "trade_mode": v.trade_mode, "terminal_build": v.terminal_build,
                    "terminal_connected": v.terminal_connected, "demo_verified": v.is_demo}

        # Every data task re-checks the account first and fails closed.
        self.due["verify"] = 0
        self._verify(now)
        if not self.publishing_allowed:
            raise TaskFailure("account_not_verified", (self.verification.message if self.verification else "MetaTrader 5 is not available."))

        if task_type == "mt5.account_snapshot":
            wait = 5 - (now - self.last_account_at)
            if wait > 0:
                self.sleep(wait)
            if not self._publish_account(self.monotonic(), force=True):
                raise TaskFailure("account_unavailable", "The account summary could not be read or delivered.", retryable=True)
            return {"published": True}
        if task_type == "mt5.symbol_list":
            return {"symbols": self._publish_symbols(now, force=True)}
        if task_type == "mt5.price_history":
            symbol, timeframe, count = payload["symbol"], payload["timeframe"], int(payload["count"])
            if not self.terminal.ensure_visible(symbol):
                raise TaskFailure("symbol_unavailable", f"{symbol} is not available in this terminal.")
            raw = self.terminal.rates(symbol, timeframe, count)
            if raw is None:
                raise TaskFailure("history_unavailable", f"MetaTrader 5 has no {timeframe} history for {symbol} yet.", retryable=True)
            bars = convert.bars(raw, self.clock)
            if bars and not self._publish("bars", {"symbol": symbol, "timeframe": timeframe, "bars": bars}):
                raise TaskFailure("publish_failed", "The price history could not be delivered.", retryable=True)
            return {"bars": len(bars), "first_bar_at": bars[0]["open_time"] if bars else None,
                    "last_bar_at": bars[-1]["open_time"] if bars else None}
        if task_type == "mt5.positions_read":
            self.sleep(2.1)
            return {"positions": self._publish_trades(now, ("positions",), force=True).get("positions", 0)}
        if task_type == "mt5.pending_orders_read":
            self.sleep(2.1)
            return {"orders": self._publish_trades(now, ("orders",), force=True).get("orders", 0)}
        if task_type == "mt5.recent_history_read":
            days = int(payload["days"])
            end = self.now() + timedelta(hours=1)
            start = self.now() - timedelta(days=days)
            raw = self.terminal.deals(self.clock.to_broker(start), self.clock.to_broker(end))
            if raw is None:
                raise TaskFailure("history_unavailable", "MetaTrader 5 did not return the deal history.", retryable=True)
            deals = convert.deals(raw, self.clock)
            if not self._publish("deals", {"observed_at": iso(self.now()), "deals": deals}):
                raise TaskFailure("publish_failed", "The deal history could not be delivered.", retryable=True)
            return {"deals": len(deals), "days": days}
        raise TaskFailure("unsupported_task", f"{task_type} is not supported by this read-only connector.")

    # ------------------------------------------------------------------ loop

    def step(self) -> None:
        now = self.monotonic()
        self._ensure_terminal(now)
        self._verify(now)
        self._heartbeat(now)
        self._report(now)
        self._periodic_publication(now)
        self._claim(now)

    def run(self, should_stop: Callable[[], bool]) -> None:
        try:
            while not should_stop():
                try:
                    self.step()
                except convert.ConversionError as e:
                    self.log.warning("Skipped malformed MetaTrader 5 data: %s", e)
                except (AuthorizationLost, KeyboardInterrupt):
                    raise
                except Exception as e:  # noqa: BLE001 - keep running; treat as a terminal hiccup
                    self.log.warning("Unexpected problem (%s); re-attaching to MetaTrader 5.", type(e).__name__)
                    self.terminal_attached = False
                    self._end_session("unexpected error while reading MetaTrader 5")
                    self._schedule("terminal", self.monotonic(), 5)
                self.sleep(0.25)
        finally:
            try:
                self.terminal.shutdown()
            except Exception:  # noqa: BLE001
                pass
