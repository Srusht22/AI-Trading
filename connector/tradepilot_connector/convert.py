"""MetaTrader 5 results -> validated, JSON-ready records for the TradePilot API.

Every converter rejects malformed values instead of guessing. Broker
timestamps go through BrokerClock so the server only ever receives UTC.
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

from .timebase import BrokerClock, iso

SYMBOL = re.compile(r"^[A-Za-z0-9._#+&!$@-]{1,32}$")
MAX_SYMBOLS = 5000

ORDER_TYPES = {2: "buy_limit", 3: "sell_limit", 4: "buy_stop", 5: "sell_stop", 6: "buy_stop_limit", 7: "sell_stop_limit"}
DEAL_TYPES = {0: "buy", 1: "sell", 2: "balance", 3: "credit", 4: "charge", 5: "correction", 6: "bonus"}
DEAL_ENTRIES = {0: "in", 1: "out", 2: "inout", 3: "out_by"}


class ConversionError(ValueError):
    pass


def _num(value: Any, name: str, *, minimum: float = -1e15, maximum: float = 1e15, optional: bool = False) -> float | None:
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ConversionError(f"{name} is not a finite number")
    if not minimum <= value <= maximum:
        raise ConversionError(f"{name} is out of range")
    return float(value)


def _price(value: Any, name: str, optional: bool = False) -> float | None:
    """MT5 uses 0 for "not set" on SL/TP and current price fields."""
    if optional and (value is None or value == 0):
        return None
    return _num(value, name, minimum=0, maximum=1e12)


def _int(value: Any, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ConversionError(f"{name} is not a valid integer")
    return value


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = "".join(ch for ch in value if ch.isprintable()).strip()
    return text[:limit] or None


def _broker_time(record: dict[str, Any], clock: BrokerClock, seconds_key: str, msc_key: str | None = None) -> datetime:
    msc = record.get(msc_key) if msc_key else None
    if isinstance(msc, int) and not isinstance(msc, bool) and msc > 0:
        return clock.to_utc(msc / 1000.0)
    seconds = record.get(seconds_key)
    if isinstance(seconds, bool) or not isinstance(seconds, int) or seconds <= 0:
        raise ConversionError(f"{seconds_key} is missing")
    return clock.to_utc(seconds)


def quote(symbol: str, tick: dict[str, Any] | None, clock: BrokerClock) -> dict[str, Any] | None:
    """A tick -> quote record, or None when MT5 has no usable price for the symbol."""
    if tick is None:
        return None
    bid, ask = tick.get("bid"), tick.get("ask")
    try:
        bid_v = _num(bid, "bid", minimum=0, maximum=1e12)
        ask_v = _num(ask, "ask", minimum=0, maximum=1e12)
    except ConversionError:
        return None
    if not bid_v or not ask_v or ask_v < bid_v:
        return None  # no quote (e.g. market closed before any tick) or a crossed book: publish nothing
    last = tick.get("last")
    last_v = float(last) if isinstance(last, (int, float)) and not isinstance(last, bool) and math.isfinite(last) and last > 0 else None
    try:
        tick_time = _broker_time(tick, clock, "time", "time_msc")
    except ConversionError:
        return None
    return {"symbol": symbol, "bid": bid_v, "ask": ask_v, "last": last_v, "tick_time": iso(tick_time)}


def account(info: dict[str, Any], observed: datetime) -> dict[str, Any]:
    level = info.get("margin_level")
    margin = _num(info.get("margin"), "margin", minimum=0)
    return {
        "balance": _num(info.get("balance"), "balance"),
        "credit": _num(info.get("credit", 0.0), "credit"),
        "equity": _num(info.get("equity"), "equity"),
        "profit": _num(info.get("profit"), "profit"),
        "margin": margin,
        "margin_free": _num(info.get("margin_free"), "margin_free"),
        # MT5 reports 0 when no margin is used: the level is undefined, not zero.
        "margin_level": _num(level, "margin_level", minimum=0, maximum=1e12) if margin and level is not None else None,
        "currency": info.get("currency"),
        "currency_digits": _int(info.get("currency_digits"), "currency_digits"),
        "leverage": info.get("leverage") if isinstance(info.get("leverage"), int) and 1 <= info.get("leverage") <= 100000 else None,
        "observed_at": iso(observed),
    }


def symbols(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for s in raw[:MAX_SYMBOLS]:
        name = s.get("name")
        point = s.get("point")
        digits = s.get("digits")
        if not isinstance(name, str) or not SYMBOL.match(name):
            continue  # names the website cannot represent safely are skipped, not altered
        if isinstance(point, bool) or not isinstance(point, (int, float)) or not math.isfinite(point) or point <= 0:
            continue
        if isinstance(digits, bool) or not isinstance(digits, int) or not 0 <= digits <= 10:
            continue
        mode = s.get("trade_mode")
        out.append(
            {
                "name": name,
                "description": _text(s.get("description"), 128),
                "path": _text(s.get("path"), 128),
                "digits": digits,
                "point": float(point),
                "currency_base": _text(s.get("currency_base"), 12),
                "currency_profit": _text(s.get("currency_profit"), 12),
                "trade_mode": mode if isinstance(mode, int) and not isinstance(mode, bool) and 0 <= mode <= 4 else None,
                "visible": bool(s.get("visible")),
            }
        )
    return out


def bars(raw: list[dict[str, Any]], clock: BrokerClock) -> list[dict[str, Any]]:
    out = []
    for r in raw:
        o, h, low, c = (_num(r.get(k), k, minimum=0, maximum=1e12) for k in ("open", "high", "low", "close"))
        if not (low and o and c and h) or h < max(o, c) or low > min(o, c):
            raise ConversionError("inconsistent OHLC values")
        tv = r.get("tick_volume")
        rv = r.get("real_volume")
        sp = r.get("spread")
        out.append(
            {
                "open_time": iso(_broker_time(r, clock, "time")),
                "open": o,
                "high": h,
                "low": low,
                "close": c,
                "tick_volume": int(tv) if isinstance(tv, int) and not isinstance(tv, bool) and tv >= 0 else None,
                "real_volume": float(rv) if isinstance(rv, (int, float)) and not isinstance(rv, bool) and rv >= 0 else None,
                "spread": int(sp) if isinstance(sp, int) and not isinstance(sp, bool) and sp >= 0 else None,
            }
        )
    return out


def positions(raw: list[dict[str, Any]], clock: BrokerClock) -> list[dict[str, Any]]:
    out = []
    for p in raw[:200]:
        side = {0: "buy", 1: "sell"}.get(p.get("type"))
        if side is None or not isinstance(p.get("symbol"), str) or not SYMBOL.match(p["symbol"]):
            raise ConversionError("unexpected position record")
        out.append(
            {
                "ticket": _int(p.get("ticket"), "ticket", minimum=1),
                "symbol": p["symbol"],
                "side": side,
                "volume": _num(p.get("volume"), "volume", minimum=0, maximum=1e9),
                "price_open": _price(p.get("price_open"), "price_open"),
                "price_current": _price(p.get("price_current"), "price_current", optional=True),
                "stop_loss": _price(p.get("sl"), "sl", optional=True),
                "take_profit": _price(p.get("tp"), "tp", optional=True),
                "profit": _num(p.get("profit"), "profit"),
                "swap": _num(p.get("swap", 0.0), "swap"),
                "opened_at": iso(_broker_time(p, clock, "time", "time_msc")),
            }
        )
    return out


def orders(raw: list[dict[str, Any]], clock: BrokerClock) -> list[dict[str, Any]]:
    out = []
    for o in raw[:200]:
        if not isinstance(o.get("symbol"), str) or not SYMBOL.match(o["symbol"]):
            raise ConversionError("unexpected order record")
        out.append(
            {
                "ticket": _int(o.get("ticket"), "ticket", minimum=1),
                "symbol": o["symbol"],
                "order_type": ORDER_TYPES.get(o.get("type"), "other"),
                "volume_initial": _num(o.get("volume_initial"), "volume_initial", minimum=0, maximum=1e9),
                "volume_current": _num(o.get("volume_current"), "volume_current", minimum=0, maximum=1e9),
                "price_open": _price(o.get("price_open"), "price_open"),
                "price_stoplimit": _price(o.get("price_stoplimit"), "price_stoplimit", optional=True),
                "stop_loss": _price(o.get("sl"), "sl", optional=True),
                "take_profit": _price(o.get("tp"), "tp", optional=True),
                "placed_at": iso(_broker_time(o, clock, "time_setup", "time_setup_msc")),
            }
        )
    return out


def deals(raw: list[dict[str, Any]], clock: BrokerClock) -> list[dict[str, Any]]:
    """Newest 500 deals of the requested window."""
    items = sorted(raw, key=lambda d: d.get("time_msc") or d.get("time") or 0, reverse=True)[:500]
    out = []
    for d in items:
        symbol = d.get("symbol") if isinstance(d.get("symbol"), str) else ""
        if symbol and not SYMBOL.match(symbol):
            raise ConversionError("unexpected deal record")
        dtype = d.get("type")
        out.append(
            {
                "ticket": _int(d.get("ticket"), "ticket", minimum=1),
                "order_ticket": d.get("order") if isinstance(d.get("order"), int) and d.get("order") >= 0 else None,
                "position_id": d.get("position_id") if isinstance(d.get("position_id"), int) and d.get("position_id") >= 0 else None,
                "symbol": symbol,
                "deal_type": DEAL_TYPES.get(dtype, "commission" if isinstance(dtype, int) and 7 <= dtype <= 12 else "other"),
                "entry": DEAL_ENTRIES.get(d.get("entry")),
                "volume": _num(d.get("volume", 0.0), "volume", minimum=0, maximum=1e9),
                "price": _num(d.get("price", 0.0), "price", minimum=0, maximum=1e12),
                "profit": _num(d.get("profit", 0.0), "profit"),
                "commission": _num(d.get("commission", 0.0), "commission"),
                "swap": _num(d.get("swap", 0.0), "swap"),
                "fee": _num(d.get("fee", 0.0), "fee"),
                "executed_at": iso(_broker_time(d, clock, "time", "time_msc")),
            }
        )
    return out
