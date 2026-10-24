"""The only code that touches the MetaTrader5 package.

The official package also exports trading helpers (order_send, order_check,
Buy, Sell, Close, login, ...). The connector never imports the module
directly: it gets a ReadOnlyMt5 wrapper that exposes an explicit allow-list
of read functions and raises for everything else. tests/test_readonly.py
scans the source to make sure nothing bypasses this boundary.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

# Read-only functions the connector may call. symbol_select only adds a
# symbol to Market Watch so the terminal delivers its prices.
ALLOWED_MT5_FUNCTIONS = frozenset(
    {
        "initialize",
        "shutdown",
        "version",
        "last_error",
        "terminal_info",
        "account_info",
        "symbols_get",
        "symbol_info",
        "symbol_info_tick",
        "symbol_select",
        "copy_rates_from_pos",
        "positions_get",
        "orders_get",
        "history_deals_get",
    }
)

TIMEFRAMES = ("M1", "M5", "M15", "H1")


class ForbiddenOperation(PermissionError):
    """Raised when code asks the wrapper for anything outside the allow-list."""


class ReadOnlyMt5:
    """Allow-list proxy around the MetaTrader5 module."""

    def __init__(self, module: Any):
        self._module = module

    def __getattr__(self, name: str) -> Any:
        if name in ALLOWED_MT5_FUNCTIONS:
            return getattr(self._module, name)
        # Plain constants (TIMEFRAME_M1, ACCOUNT_TRADE_MODE_DEMO, ...) are data, not operations.
        if name.isupper() and not callable(getattr(self._module, name, None)):
            return getattr(self._module, name)
        raise ForbiddenOperation(f"MetaTrader5.{name} is not available to the read-only connector")


def load_mt5() -> ReadOnlyMt5:
    """Import the official package lazily (it only exists on Windows)."""
    import MetaTrader5  # noqa: PLC0415 - optional, Windows-only dependency

    return ReadOnlyMt5(MetaTrader5)


def _as_dict(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "_asdict"):
        return dict(value._asdict())
    raise TypeError("unexpected MetaTrader5 result type")


def _rows(array: Any) -> list[dict[str, Any]]:
    """numpy structured array (copy_rates_*) -> list of plain dicts."""
    if array is None:
        return []
    names = getattr(getattr(array, "dtype", None), "names", None)
    if names:
        return [{name: row[name].item() if hasattr(row[name], "item") else row[name] for name in names} for row in array]
    return [_as_dict(r) or {} for r in array]


class Terminal(Protocol):
    """What the connector needs from a terminal (real or, in tests, fake)."""

    def connect(self) -> tuple[bool, str | None]: ...
    def shutdown(self) -> None: ...
    def version(self) -> tuple[int, int, str] | None: ...
    def terminal_info(self) -> dict[str, Any] | None: ...
    def account_info(self) -> dict[str, Any] | None: ...
    def symbols(self) -> list[dict[str, Any]] | None: ...
    def symbol_info(self, name: str) -> dict[str, Any] | None: ...
    def ensure_visible(self, name: str) -> bool: ...
    def tick(self, name: str) -> dict[str, Any] | None: ...
    def rates(self, name: str, timeframe: str, count: int) -> list[dict[str, Any]] | None: ...
    def positions(self) -> list[dict[str, Any]] | None: ...
    def orders(self) -> list[dict[str, Any]] | None: ...
    def deals(self, date_from: datetime, date_to: datetime) -> list[dict[str, Any]] | None: ...
    def last_error(self) -> tuple[int, str]: ...


class Mt5Terminal:
    """Terminal backed by the official MetaTrader5 package, read-only.

    initialize() attaches to the terminal that is already running and logged
    in. No login, server or password is ever passed: the account stays the
    one you chose inside MetaTrader 5.
    """

    def __init__(self, path: str | None = None, mt5: ReadOnlyMt5 | None = None):
        self._path = path
        self._mt5 = mt5 or load_mt5()

    def connect(self) -> tuple[bool, str | None]:
        ok = self._mt5.initialize(self._path) if self._path else self._mt5.initialize()
        if ok:
            return True, None
        code, message = self.last_error()
        return False, f"{code}: {message}"

    def shutdown(self) -> None:
        self._mt5.shutdown()

    def last_error(self) -> tuple[int, str]:
        err = self._mt5.last_error()
        try:
            return int(err[0]), str(err[1])
        except (TypeError, IndexError, ValueError):
            return -1, "unknown error"

    def version(self) -> tuple[int, int, str] | None:
        v = self._mt5.version()
        if not v:
            return None
        return int(v[0]), int(v[1]), str(v[2])

    def terminal_info(self) -> dict[str, Any] | None:
        return _as_dict(self._mt5.terminal_info())

    def account_info(self) -> dict[str, Any] | None:
        return _as_dict(self._mt5.account_info())

    def symbols(self) -> list[dict[str, Any]] | None:
        result = self._mt5.symbols_get()
        return None if result is None else [_as_dict(s) or {} for s in result]

    def symbol_info(self, name: str) -> dict[str, Any] | None:
        return _as_dict(self._mt5.symbol_info(name))

    def ensure_visible(self, name: str) -> bool:
        info = self.symbol_info(name)
        if info is None:
            return False
        if info.get("visible"):
            return True
        return bool(self._mt5.symbol_select(name, True))

    def tick(self, name: str) -> dict[str, Any] | None:
        return _as_dict(self._mt5.symbol_info_tick(name))

    def rates(self, name: str, timeframe: str, count: int) -> list[dict[str, Any]] | None:
        if timeframe not in TIMEFRAMES:
            raise ValueError("unsupported timeframe")
        tf = getattr(self._mt5, f"TIMEFRAME_{timeframe}")
        result = self._mt5.copy_rates_from_pos(name, tf, 0, count)
        return None if result is None else _rows(result)

    def positions(self) -> list[dict[str, Any]] | None:
        result = self._mt5.positions_get()
        return None if result is None else [_as_dict(p) or {} for p in result]

    def orders(self) -> list[dict[str, Any]] | None:
        result = self._mt5.orders_get()
        return None if result is None else [_as_dict(o) or {} for o in result]

    def deals(self, date_from: datetime, date_to: datetime) -> list[dict[str, Any]] | None:
        result = self._mt5.history_deals_get(date_from, date_to)
        return None if result is None else [_as_dict(d) or {} for d in result]
