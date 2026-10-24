"""Test doubles. FOR AUTOMATED TESTS ONLY — never a real connection.

FakeTerminal imitates the shape of MetaTrader5 results (dicts instead of
namedtuples). Its server name is clearly marked as a test fixture.
"""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any

FIXTURE_SERVER = "TradePilot-TEST-FIXTURE"


class FakeTerminal:
    def __init__(self, *, trade_mode: int | None = 0, login: int = 51234821, broker_offset_s: int = 3 * 3600, now: float = 1_793_000_000.0):
        self.available = True
        self.connected = True
        self.build = 5200
        self.broker_offset_s = broker_offset_s
        self.now = now
        self.account: dict[str, Any] | None = {
            "login": login, "trade_mode": trade_mode, "leverage": 100, "balance": 10000.0, "credit": 0.0, "profit": 12.34,
            "equity": 10012.34, "margin": 120.5, "margin_free": 9891.84, "margin_level": 8309.0, "currency": "EUR",
            "currency_digits": 2, "server": FIXTURE_SERVER, "company": "Test Fixture Ltd", "name": "PRIVATE NAME",
        }
        self.symbol_table: dict[str, dict[str, Any]] = {
            "EURUSD.r": {"name": "EURUSD.r", "description": "Euro vs US Dollar", "path": "Forex\\Majors", "digits": 5, "point": 0.00001,
                         "currency_base": "EUR", "currency_profit": "USD", "trade_mode": 4, "visible": True},
            "XAUUSD": {"name": "XAUUSD", "description": "Gold", "path": "Metals", "digits": 2, "point": 0.01,
                       "currency_base": "XAU", "currency_profit": "USD", "trade_mode": 4, "visible": False},
        }
        self.ticks: dict[str, dict[str, Any] | None] = {"EURUSD.r": self._tick(1.08412, 1.08419), "XAUUSD": self._tick(2400.10, 2400.50)}
        self.position_list: list[dict[str, Any]] | None = []
        self.order_list: list[dict[str, Any]] | None = []
        self.deal_list: list[dict[str, Any]] | None = []
        self.rate_rows: list[dict[str, Any]] | None = None
        self.selected: list[str] = []
        self.calls: list[str] = []

    def _tick(self, bid: float, ask: float, age_s: float = 0.5) -> dict[str, Any]:
        broker = self.now + self.broker_offset_s - age_s
        return {"time": int(broker), "bid": bid, "ask": ask, "last": 0.0, "volume": 0, "time_msc": int(broker * 1000), "flags": 6, "volume_real": 0.0}

    def move(self, symbol: str, bid: float, ask: float, dt: float = 1.0) -> None:
        self.now += dt
        self.ticks[symbol] = self._tick(bid, ask)

    # Terminal protocol ------------------------------------------------------
    def connect(self):
        self.calls.append("initialize")
        return (True, None) if self.available else (False, "-10003: IPC initialize failed")

    def shutdown(self):
        self.calls.append("shutdown")

    def last_error(self):
        return (1, "Success")

    def version(self):
        return (500, self.build, "1 Oct 2026") if self.available else None

    def terminal_info(self):
        if not self.available:
            return None
        return {"connected": self.connected, "build": self.build, "trade_allowed": False, "company": "MetaQuotes"}

    def account_info(self):
        return copy.deepcopy(self.account) if self.available else None

    def symbols(self):
        return [copy.deepcopy(s) for s in self.symbol_table.values()]

    def symbol_info(self, name):
        return copy.deepcopy(self.symbol_table.get(name))

    def ensure_visible(self, name):
        if name not in self.symbol_table:
            return False
        self.symbol_table[name]["visible"] = True
        self.selected.append(name)
        return True

    def tick(self, name):
        return copy.deepcopy(self.ticks.get(name))

    def rates(self, name, timeframe, count):
        if self.rate_rows is not None:
            return copy.deepcopy(self.rate_rows)
        start = int(self.now + self.broker_offset_s) // 300 * 300 - 300 * (count - 1)
        rows = []
        price = 1.0840
        for i in range(count):
            o, c = price, price + (0.0002 if i % 2 else -0.0001)
            rows.append({"time": start + 300 * i, "open": o, "high": max(o, c) + 0.0001, "low": min(o, c) - 0.0001, "close": c,
                         "tick_volume": 100 + i, "spread": 7, "real_volume": 0})
            price = c
        return rows

    def positions(self):
        return copy.deepcopy(self.position_list)

    def orders(self):
        return copy.deepcopy(self.order_list)

    def deals(self, date_from: datetime, date_to: datetime):
        self.calls.append(f"deals:{date_from.isoformat()}")
        return copy.deepcopy(self.deal_list)


class FakeApi:
    """Records calls and plays the server's part with simple rules."""

    def __init__(self, status: str = "verified"):
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.status = status
        self.monitored = ["EURUSD.r"]
        self.responses: dict[str, Any] = {}
        self.errors: dict[str, Exception] = {}
        self.tasks: list[dict[str, Any]] = []

    def call(self, action, body=None):
        body = body or {}
        self.calls.append((action, copy.deepcopy(body)))
        if action in self.errors:
            raise self.errors[action]
        if action in self.responses:
            return self.responses[action]
        if action == "mt5-connection":
            demo = body.get("trade_mode") == "demo" and body.get("trade_mode_code") == 0 and body.get("state") == "ok"
            status = self.status if demo or self.status == "disconnected" else ("blocked" if body.get("state") == "ok" else "awaiting_verification")
            return {"connection_id": "c0ffee00-0000-4000-8000-000000000001", "status": status, "reason": None,
                    "monitored_symbols": self.monitored, "settings": {"quote_interval_ms": 1000, "account_interval_s": 5,
                                                                      "snapshot_interval_s": 60, "history_days": 7}}
        if action == "mt5-publish":
            return {"accepted": True, "status": "verified"}
        if action == "claim":
            return self.tasks.pop(0) if self.tasks else None
        return {"status": "ok"}

    def actions(self, name=None):
        return [a for a, _ in self.calls if name is None or a == name]

    def bodies(self, action, kind=None):
        return [b for a, b in self.calls if a == action and (kind is None or b.get("kind") == kind)]


class Clock:
    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    def advance(self, s):
        self.t += s
