"""Demo-only verification of the account the terminal is logged into.

The decision uses only MetaTrader 5's own ACCOUNT_TRADE_MODE value
(account_info().trade_mode): 0 = demo, 1 = contest, 2 = real. Server names,
account numbers and user choices are never used as evidence. Anything other
than an explicit 0 fails closed.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from typing import Any

from . import VERSION
from .terminal import Terminal

ACCOUNT_TRADE_MODE_DEMO = 0
TRADE_MODES = {0: "demo", 1: "contest", 2: "real"}
CURRENCY = re.compile(r"^[A-Z]{3,6}$")

MESSAGES = {
    "terminal_unavailable": "MetaTrader 5 is not running, or this connector cannot attach to it. Open MT5 on this computer.",
    "unsupported_terminal": "This MetaTrader 5 terminal did not report its version. Update MT5 and try again.",
    "broker_disconnected": "MetaTrader 5 is open but not connected to the broker. Check the connection status in the bottom-right corner of MT5.",
    "not_logged_in": "No account is logged in. In MetaTrader 5 use File > Login to Trade Account and log into your demo account.",
    "account_unavailable": "MetaTrader 5 did not return complete account information. Try again in a moment.",
}


@dataclass
class Verification:
    state: str
    trade_mode: str = "unknown"
    trade_mode_code: int | None = None
    fingerprint: str | None = None
    masked_account: str | None = None
    server: str | None = None
    company: str | None = None
    currency: str | None = None
    currency_digits: int | None = None
    leverage: int | None = None
    terminal_build: int | None = None
    terminal_connected: bool | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_demo(self) -> bool:
        return self.state == "ok" and self.trade_mode == "demo" and self.trade_mode_code == ACCOUNT_TRADE_MODE_DEMO

    @property
    def message(self) -> str:
        if self.state != "ok":
            return MESSAGES.get(self.state, "MetaTrader 5 is not usable right now.")
        if self.is_demo:
            return f"Demo account {self.masked_account} on {self.server} verified."
        if self.trade_mode == "real":
            return "Connection blocked: this is a REAL-money account. TradePilot only connects to demo accounts."
        if self.trade_mode == "contest":
            return "Connection blocked: contest accounts are not supported. Log into a demo account."
        return "Account not verified as demo: MetaTrader 5 did not report a recognised account type."

    def report(self, broker_offset_minutes: int | None, broker_offset_source: str) -> dict[str, Any]:
        """What is sent to the server. A non-demo account is described by its mode only."""
        body: dict[str, Any] = {"state": self.state, "connector_version": VERSION}
        if self.terminal_build is not None:
            body["terminal_build"] = self.terminal_build
        if self.terminal_connected is not None:
            body["terminal_connected"] = self.terminal_connected
        if self.state != "ok":
            return body
        body["trade_mode"] = self.trade_mode
        body["trade_mode_code"] = self.trade_mode_code
        if not self.is_demo:
            return body
        body.update(
            account_fingerprint=self.fingerprint,
            masked_account=self.masked_account,
            server=self.server,
            company=self.company,
            currency=self.currency,
            currency_digits=self.currency_digits,
            leverage=self.leverage,
            broker_utc_offset_minutes=broker_offset_minutes,
            broker_offset_source=broker_offset_source,
        )
        return body


def account_fingerprint(install_secret: bytes, account_number: int, server: str) -> str:
    """Stable, non-reversible identity of account_number@server for this installation."""
    return hmac.new(install_secret, f"{account_number}@{server}".encode(), hashlib.sha256).hexdigest()


def mask_login(account_number: int) -> str:
    return "****" + str(account_number)[-3:]


def _clean_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = "".join(ch for ch in value if ch.isprintable()).strip()
    return text[:limit] or None


def verify(terminal: Terminal, install_secret: bytes) -> Verification:
    """Inspect the running terminal and its logged-in account. Never raises for terminal problems."""
    try:
        info = terminal.terminal_info()
        version = terminal.version()
    except Exception:  # noqa: BLE001 - IPC failures are reported as an unavailable terminal
        return Verification(state="terminal_unavailable")
    if info is None:
        return Verification(state="terminal_unavailable")
    build = version[1] if version and isinstance(version[1], int) and version[1] > 0 else None
    connected = bool(info.get("connected"))
    base = {"terminal_build": build, "terminal_connected": connected}
    if build is None:
        return Verification(state="unsupported_terminal", **base)
    if not connected:
        return Verification(state="broker_disconnected", **base)

    try:
        account = terminal.account_info()
    except Exception:  # noqa: BLE001
        return Verification(state="account_unavailable", **base)
    if account is None:
        return Verification(state="not_logged_in", **base)
    account_number = account.get("login")
    if not isinstance(account_number, int) or isinstance(account_number, bool) or account_number <= 0:
        return Verification(state="not_logged_in", **base)

    code = account.get("trade_mode")
    if not isinstance(code, int) or isinstance(code, bool):
        code = None
    mode = TRADE_MODES.get(code, "unknown") if code is not None else "unknown"
    server = _clean_text(account.get("server"), 64)
    currency = account.get("currency") if isinstance(account.get("currency"), str) else None
    digits = account.get("currency_digits")
    if mode == "demo" and (server is None or currency is None or not CURRENCY.match(currency)
                           or not isinstance(digits, int) or not 0 <= digits <= 8):
        return Verification(state="account_unavailable", **base)
    leverage = account.get("leverage")
    return Verification(
        state="ok",
        trade_mode=mode,
        trade_mode_code=code,
        fingerprint=account_fingerprint(install_secret, account_number, server or ""),
        masked_account=mask_login(account_number),
        server=server,
        company=_clean_text(account.get("company"), 128),
        currency=currency,
        currency_digits=digits if isinstance(digits, int) else None,
        leverage=leverage if isinstance(leverage, int) and 1 <= leverage <= 100000 else None,
        **base,
    )
