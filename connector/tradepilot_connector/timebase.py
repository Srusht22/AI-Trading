"""Broker server time -> UTC.

MetaTrader 5 timestamps (tick.time, tick.time_msc, bar times, deal times) are
seconds since 1970 counted in the broker's *server* time zone, which is often
UTC+2/UTC+3 and changes with daylight saving. TradePilot stores UTC, so the
connector estimates the server's offset from fresh ticks:

* offset candidate = tick time - real UTC time, rounded to 15 minutes;
* accepted only when the remainder is under 90 s (the tick is fresh) and
  three ticks with *different* timestamps agree, so a stale quote from a
  closed market can never produce a wrong offset;
* a configured offset (config.json "broker_utc_offset_minutes") overrides it.

Until an offset is known the source is "unknown": times are passed through
unchanged and the website says so instead of pretending they are UTC.
"""
from __future__ import annotations

from datetime import datetime, timezone

QUARTER_HOUR = 900
TOLERANCE_S = 90
MAX_OFFSET_S = 14 * 3600
AGREEMENT = 3


class BrokerClock:
    def __init__(self, configured_minutes: int | None = None, remembered_minutes: int | None = None):
        if configured_minutes is not None:
            self.offset_s: int | None = int(configured_minutes) * 60
            self.source = "configured"
        elif remembered_minutes is not None:
            self.offset_s = int(remembered_minutes) * 60
            self.source = "estimated"
        else:
            self.offset_s = None
            self.source = "unknown"
        self._votes: dict[int, set[int]] = {}

    @property
    def offset_minutes(self) -> int | None:
        return None if self.offset_s is None else self.offset_s // 60

    def observe(self, broker_time_msc: int, now_utc_s: float) -> None:
        """Feed a tick's broker timestamp (ms) taken at real time now_utc_s."""
        if self.source == "configured" or broker_time_msc <= 0:
            return
        diff = broker_time_msc / 1000.0 - now_utc_s
        candidate = int(round(diff / QUARTER_HOUR)) * QUARTER_HOUR
        if abs(candidate) > MAX_OFFSET_S or abs(diff - candidate) > TOLERANCE_S:
            return
        votes = self._votes.setdefault(candidate, set())
        votes.add(int(broker_time_msc))
        if len(votes) >= AGREEMENT:
            self.offset_s = candidate
            self.source = "estimated"
            self._votes = {candidate: set(list(votes)[-AGREEMENT:])}

    def to_utc(self, broker_epoch_s: float) -> datetime:
        offset = self.offset_s or 0
        return datetime.fromtimestamp(broker_epoch_s - offset, tz=timezone.utc)

    def to_broker(self, utc: datetime) -> datetime:
        """UTC -> naive broker-time datetime, for history queries."""
        offset = self.offset_s or 0
        return datetime.fromtimestamp(utc.timestamp() + offset, tz=timezone.utc).replace(tzinfo=None)


def iso(dt: datetime) -> str:
    """UTC ISO-8601 with a Z suffix, as the server expects."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="milliseconds") + "Z"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
