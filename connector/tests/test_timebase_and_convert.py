from datetime import datetime, timezone

import pytest

from tests.fakes import FakeTerminal
from tradepilot_connector import convert
from tradepilot_connector.timebase import BrokerClock, iso

NOW = 1_793_000_000.0


def test_offset_is_estimated_only_from_agreeing_fresh_ticks():
    clock = BrokerClock()
    clock.observe(int((NOW + 3 * 3600 - 0.4) * 1000), NOW)
    clock.observe(int((NOW + 3 * 3600 - 0.4) * 1000), NOW + 1)  # same tick again does not count twice
    assert clock.source == "unknown"
    clock.observe(int((NOW + 3 * 3600 + 1.2) * 1000), NOW + 2)
    clock.observe(int((NOW + 3 * 3600 + 2.7) * 1000), NOW + 3)
    assert clock.source == "estimated" and clock.offset_minutes == 180


def test_stale_ticks_from_a_closed_market_never_set_an_offset():
    clock = BrokerClock()
    for i in range(10):
        clock.observe(int((NOW + 3 * 3600 - 2 * 86400) * 1000), NOW + i)  # the same two-day-old tick, seen repeatedly
        clock.observe(int((NOW + 3 * 3600 - 600) * 1000), NOW + i)  # the same 10-minute-old tick, seen repeatedly
    assert clock.offset_s is None and clock.source == "unknown"


def test_configured_offset_wins():
    clock = BrokerClock(configured_minutes=120)
    clock.observe(int((NOW + 3 * 3600) * 1000), NOW)
    assert clock.offset_minutes == 120 and clock.source == "configured"


def test_quote_conversion_uses_utc_and_keeps_tick_time():
    t = FakeTerminal(now=NOW)
    clock = BrokerClock(configured_minutes=180)
    q = convert.quote("EURUSD.r", t.tick("EURUSD.r"), clock)
    assert q["bid"] == 1.08412 and q["ask"] == 1.08419
    tick_utc = datetime.fromisoformat(q["tick_time"].replace("Z", "+00:00"))
    assert abs(tick_utc.timestamp() - (NOW - 0.5)) < 0.01
    assert q["tick_time"].endswith("Z")


@pytest.mark.parametrize(
    "tick",
    [None, {"bid": 0, "ask": 0, "time": 1, "time_msc": 1000}, {"bid": 1.2, "ask": 1.1, "time": 1, "time_msc": 1000},
     {"bid": float("nan"), "ask": 1.1, "time": 1}, {"bid": 1.1, "ask": 1.2}, {"bid": "1.1", "ask": 1.2, "time": 5}],
)
def test_missing_or_invalid_ticks_produce_no_quote(tick):
    assert convert.quote("EURUSD.r", tick, BrokerClock()) is None


def test_bars_are_converted_and_inconsistent_bars_rejected():
    t = FakeTerminal(now=NOW)
    clock = BrokerClock(configured_minutes=180)
    rows = t.rates("EURUSD.r", "M5", 20)
    bars = convert.bars(rows, clock)
    assert len(bars) == 20
    first = datetime.fromisoformat(bars[0]["open_time"].replace("Z", "+00:00"))
    assert first.tzinfo == timezone.utc and first.timestamp() == rows[0]["time"] - 3 * 3600
    with pytest.raises(convert.ConversionError):
        convert.bars([{"time": 1_700_000_000, "open": 1.2, "high": 1.1, "low": 1.0, "close": 1.05}], clock)


def test_account_conversion_reports_source_values_and_undefined_margin_level():
    t = FakeTerminal()
    record = convert.account(t.account_info(), datetime(2026, 10, 24, tzinfo=timezone.utc))
    assert record["equity"] == 10012.34 and record["currency"] == "EUR"
    t.account["margin"] = 0.0
    t.account["margin_level"] = 0.0
    assert convert.account(t.account_info(), datetime(2026, 10, 24, tzinfo=timezone.utc))["margin_level"] is None
    t.account["equity"] = float("inf")
    with pytest.raises(convert.ConversionError):
        convert.account(t.account_info(), datetime(2026, 10, 24, tzinfo=timezone.utc))


def test_positions_orders_and_deals():
    clock = BrokerClock(configured_minutes=0)
    pos = convert.positions([{"ticket": 7, "type": 1, "symbol": "EURUSD.r", "volume": 0.1, "price_open": 1.08, "price_current": 1.081,
                              "sl": 0.0, "tp": 1.07, "profit": -10.0, "swap": 0.0, "time": 1_790_000_000, "time_msc": 1_790_000_000_000}], clock)
    assert pos[0]["side"] == "sell" and pos[0]["stop_loss"] is None and pos[0]["take_profit"] == 1.07
    assert convert.positions([], clock) == [] and convert.orders([], clock) == []
    orders = convert.orders([{"ticket": 9, "type": 2, "symbol": "EURUSD.r", "volume_initial": 0.1, "volume_current": 0.1,
                              "price_open": 1.07, "price_stoplimit": 0.0, "sl": 0.0, "tp": 0.0, "time_setup": 1_790_000_000}], clock)
    assert orders[0]["order_type"] == "buy_limit"
    deals = convert.deals([{"ticket": 1, "type": 2, "entry": 0, "symbol": "", "volume": 0.0, "price": 0.0, "profit": 10000.0,
                            "time": 1_789_000_000}, {"ticket": 2, "type": 0, "entry": 0, "symbol": "EURUSD.r", "volume": 0.1,
                            "price": 1.08, "profit": 0.0, "time": 1_789_100_000}], clock)
    assert [d["deal_type"] for d in deals] == ["buy", "balance"]  # newest first
    with pytest.raises(convert.ConversionError):
        convert.positions([{"ticket": 7, "type": 9, "symbol": "EURUSD.r"}], clock)


def test_symbols_keep_real_broker_names_and_skip_unrepresentable_ones():
    out = convert.symbols([{"name": "EURUSD.r", "digits": 5, "point": 0.00001, "visible": True},
                           {"name": "BAD NAME WITH SPACES", "digits": 5, "point": 0.00001},
                           {"name": "GER40", "digits": 1, "point": 0.1}])
    assert [s["name"] for s in out] == ["EURUSD.r", "GER40"]


def test_iso_is_always_utc():
    assert iso(datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)) == "2026-01-02T03:04:05.000Z"
