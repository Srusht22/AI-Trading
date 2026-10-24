import pytest

from tradepilot_connector.api import ApiError, LeaseLost
from tradepilot_connector.connector import AuthorizationLost

CONN = "c0ffee00-0000-4000-8000-000000000001"


def test_verified_demo_publishes_real_changed_data_only(rig):
    rig.run(3)
    assert rig.connector.publishing_allowed
    report = rig.api.bodies("mt5-connection")[0]
    assert report["trade_mode"] == "demo" and report["trade_mode_code"] == 0
    quotes = rig.api.bodies("mt5-publish", "quotes")
    assert len(quotes) == 1, "an unchanged tick is published once"
    assert quotes[0]["data"]["quotes"][0]["symbol"] == "EURUSD.r"
    assert rig.api.bodies("mt5-publish", "account")[0]["data"]["equity"] == 10012.34
    assert rig.api.bodies("mt5-publish", "symbols"), "the broker's symbol list is published at session start"
    rig.terminal.move("EURUSD.r", 1.08415, 1.08422)
    rig.run(2)
    assert len(rig.api.bodies("mt5-publish", "quotes")) == 2, "a new tick is published"
    assert rig.api.bodies("mt5-publish", "quotes")[1]["data"]["quotes"][0]["bid"] == 1.08415


def test_no_tick_means_no_update(rig):
    rig.run(3)
    before = len(rig.api.bodies("mt5-publish", "quotes"))
    rig.run(10)
    assert len(rig.api.bodies("mt5-publish", "quotes")) == before


@pytest.mark.parametrize("mode", [2, 1, None])
def test_non_demo_accounts_never_publish(rig, mode):
    rig.terminal.account["trade_mode"] = mode
    rig.run(5)
    assert not rig.connector.publishing_allowed
    assert rig.api.bodies("mt5-publish") == []
    report = rig.api.bodies("mt5-connection")[-1]
    assert "masked_account" not in report and "server" not in report


def test_account_switch_to_real_stops_publication_immediately(rig):
    rig.run(3)
    assert rig.connector.publishing_allowed
    published = len(rig.api.bodies("mt5-publish"))
    rig.terminal.account["trade_mode"] = 2
    rig.terminal.account["login"] = 99999999
    rig.terminal.move("EURUSD.r", 1.09, 1.0901)
    rig.run(3)
    assert not rig.connector.publishing_allowed
    assert len(rig.api.bodies("mt5-publish")) == published, "nothing from the real account was sent"
    assert rig.api.bodies("mt5-connection")[-1]["trade_mode"] == "real"


def test_switch_to_another_demo_account_ends_the_session(rig):
    rig.run(3)
    first_fp = rig.connector.session_fingerprint
    rig.terminal.account["login"] = 70000001
    rig.api.status = "blocked"  # the server refuses a different account
    rig.run(3)
    assert rig.connector.session_fingerprint is None
    assert rig.api.bodies("mt5-connection")[-1]["account_fingerprint"] != first_fp


def test_terminal_closing_stops_publication_and_reconnects_with_backoff(rig):
    rig.run(3)
    rig.terminal.available = False
    rig.run(10)
    assert not rig.connector.publishing_allowed
    assert rig.api.bodies("mt5-connection")[-1]["state"] == "terminal_unavailable"
    attempts = rig.terminal.calls.count("initialize")
    rig.run(20)
    assert rig.terminal.calls.count("initialize") - attempts <= 4, "reconnection is rate limited"
    rig.terminal.available = True
    rig.run(70)
    assert rig.connector.publishing_allowed, "resumes after verifying again"


def test_disconnect_in_website_stops_publication_but_keeps_reporting(rig):
    rig.run(3)
    rig.api.errors["mt5-publish"] = ApiError(409, "connection_disconnected", "disconnected")
    rig.api.status = "disconnected"
    rig.terminal.move("EURUSD.r", 1.1, 1.1001)
    rig.run(2)
    del rig.api.errors["mt5-publish"]
    assert not rig.connector.publishing_allowed
    n = len(rig.api.bodies("mt5-publish"))
    rig.run(40)
    assert len(rig.api.bodies("mt5-publish")) == n
    assert rig.api.bodies("mt5-connection")


def test_revoked_token_stops_the_connector(rig):
    rig.api.errors["heartbeat"] = ApiError(401, "unauthorized", "revoked")
    with pytest.raises(AuthorizationLost):
        rig.run(2)


def test_server_outage_backs_off_exponentially(rig):
    rig.api.errors["heartbeat"] = ApiError(0, "network_error", "down")
    rig.api.errors["mt5-connection"] = ApiError(503, "upstream_unavailable", "down")
    rig.run(30)
    calls = len(rig.api.calls)
    assert calls < 15, f"{calls} calls in 30 s during an outage"
    assert rig.api.bodies("mt5-publish") == []


def test_rejected_publish_ends_the_session(rig):
    rig.run(3)
    rig.api.responses["mt5-publish"] = {"accepted": False, "status": "blocked", "reason": "account_changed"}
    rig.terminal.move("EURUSD.r", 1.2, 1.2001)
    rig.run(2)
    assert not rig.connector.publishing_allowed


def task(task_type, payload):
    return {"task_id": "t-1", "lease_token": "l-1", "task_type": task_type, "payload": {"connection_id": CONN, **payload}, "attempt": 1}


def test_price_history_task_publishes_real_bars_and_completes(rig):
    rig.run(3)
    assert rig.connector.run_task(task("mt5.price_history", {"symbol": "EURUSD.r", "timeframe": "M5", "count": 50})) == "succeeded"
    bars = rig.api.bodies("mt5-publish", "bars")[0]["data"]
    assert bars["timeframe"] == "M5" and len(bars["bars"]) == 50
    complete = rig.api.bodies("complete")[0]
    assert complete["result"]["bars"] == 50


def test_tasks_fail_closed_when_the_account_is_not_verified(rig):
    rig.terminal.account["trade_mode"] = 2
    rig.run(3)
    assert rig.connector.run_task(task("mt5.symbol_list", {})) == "failed"
    fail = rig.api.bodies("fail")[0]
    assert fail["error"]["code"] == "account_not_verified" and fail["error"]["retryable"] is False


def test_missing_history_and_unknown_symbols_fail_with_explanations(rig):
    rig.run(3)
    rig.terminal.rate_rows = None
    rig.terminal.rates = lambda *a: None
    assert rig.connector.run_task(task("mt5.price_history", {"symbol": "EURUSD.r", "timeframe": "H1", "count": 10})) == "failed"
    assert rig.api.bodies("fail")[-1]["error"]["code"] == "history_unavailable"
    assert rig.connector.run_task(task("mt5.price_history", {"symbol": "NOPE", "timeframe": "H1", "count": 10})) == "failed"
    assert rig.api.bodies("fail")[-1]["error"]["code"] == "symbol_unavailable"


def test_malformed_mt5_data_fails_the_task(rig):
    rig.run(3)
    rig.terminal.position_list = [{"ticket": 1, "type": 9, "symbol": "EURUSD.r"}]
    assert rig.connector.run_task(task("mt5.positions_read", {})) == "failed"
    assert rig.api.bodies("fail")[-1]["error"]["code"] == "malformed_mt5_data"


def test_empty_positions_are_reported_as_empty(rig):
    rig.run(3)
    assert rig.connector.run_task(task("mt5.positions_read", {})) == "succeeded"
    assert rig.api.bodies("mt5-publish", "positions")[-1]["data"]["positions"] == []


def test_task_for_another_connection_is_refused(rig):
    rig.run(3)
    t = task("mt5.account_snapshot", {})
    t["payload"]["connection_id"] = "00000000-0000-4000-8000-000000000000"
    assert rig.connector.run_task(t) == "failed"
    assert rig.api.bodies("fail")[-1]["error"]["code"] == "wrong_connection"


def test_lease_loss_drops_the_task_quietly(rig):
    rig.run(3)
    rig.api.errors["complete"] = LeaseLost(409, "lease_lost", "lost")
    assert rig.connector.run_task(task("mt5.account_snapshot", {})) == "lease_lost"
    assert rig.api.bodies("fail") == []


def test_unknown_task_types_are_refused(rig):
    rig.run(3)
    assert rig.connector.run_task(task("mt5.order_send", {})) == "failed"
    assert rig.api.bodies("fail")[-1]["error"]["code"] == "unsupported_task"


def test_recent_history_queries_a_bounded_window(rig):
    rig.run(3)
    rig.terminal.deal_list = [{"ticket": 5, "type": 0, "entry": 0, "symbol": "EURUSD.r", "volume": 0.1, "price": 1.08,
                               "profit": 0.0, "time": int(rig.terminal.now)}]
    assert rig.connector.run_task(task("mt5.recent_history_read", {"days": 7})) == "succeeded"
    assert len(rig.api.bodies("mt5-publish", "deals")[-1]["data"]["deals"]) == 1


def test_quotes_are_held_until_the_broker_time_zone_is_known(rig):
    from tradepilot_connector.timebase import BrokerClock

    rig.connector.clock = BrokerClock()  # unknown offset, as on a first run
    rig.run(5)
    assert rig.api.bodies("mt5-publish", "quotes") == [], "tick times would be off by the broker's offset"
    for i in range(4):  # live ticks arrive: the offset is estimated from them
        rig.terminal.move("EURUSD.r", 1.0842 + i * 0.00001, 1.0843 + i * 0.00001)
        rig.run(1)
    assert rig.connector.clock.source == "estimated" and rig.connector.clock.offset_minutes == 180
    quotes = rig.api.bodies("mt5-publish", "quotes")
    assert quotes, "published once the offset is known"
    from datetime import datetime

    tick = datetime.fromisoformat(quotes[-1]["data"]["quotes"][0]["tick_time"].replace("Z", "+00:00"))
    assert abs(tick.timestamp() - rig.terminal.now) < 5, "published tick times are real UTC"


def test_quotes_are_published_after_the_grace_period_even_if_the_offset_stays_unknown(rig):
    from tradepilot_connector.timebase import BrokerClock

    rig.connector.clock = BrokerClock()
    rig.run(35)
    assert rig.api.bodies("mt5-publish", "quotes"), "a quiet market still shows its last real quote"
    assert rig.api.bodies("mt5-connection")[-1].get("broker_offset_source") == "unknown"


def test_symbol_choice_arrives_with_account_updates(rig):
    rig.api.monitored = []
    rig.run(3)
    assert rig.api.bodies("mt5-publish", "quotes") == []
    rig.api.responses["mt5-publish"] = {"accepted": True, "status": "verified", "monitored_symbols": ["EURUSD.r"],
                                        "settings": {"quote_interval_ms": 1000, "account_interval_s": 5}}
    rig.terminal.account["equity"] = 10013.0  # a real account change triggers the next account update
    rig.run(7)
    assert rig.connector.server["monitored_symbols"] == ["EURUSD.r"]
    assert rig.api.bodies("mt5-publish", "quotes"), "quotes start without waiting for the 30 s report"
