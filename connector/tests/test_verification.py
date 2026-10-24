from tests.conftest import SECRET
from tests.fakes import FakeTerminal
from tradepilot_connector.verification import account_fingerprint, verify


def test_demo_account_is_verified_from_trade_mode_only():
    v = verify(FakeTerminal(trade_mode=0), SECRET)
    assert v.is_demo
    assert v.masked_account == "****821"
    assert v.currency == "EUR"
    assert "Demo account" in v.message


def test_real_account_is_rejected_and_described_by_mode_only():
    v = verify(FakeTerminal(trade_mode=2), SECRET)
    assert not v.is_demo
    assert "REAL-money" in v.message
    report = v.report(None, "unknown")
    assert report["trade_mode"] == "real"
    for key in ("account_fingerprint", "masked_account", "server", "currency"):
        assert key not in report


def test_contest_and_unknown_modes_are_rejected():
    assert not verify(FakeTerminal(trade_mode=1), SECRET).is_demo
    assert verify(FakeTerminal(trade_mode=1), SECRET).trade_mode == "contest"
    for code in (None, 7, True, "0"):
        t = FakeTerminal()
        t.account["trade_mode"] = code
        v = verify(t, SECRET)
        assert not v.is_demo and v.trade_mode == "unknown"


def test_server_name_containing_demo_is_not_evidence():
    t = FakeTerminal(trade_mode=2)
    t.account["server"] = "Broker-Demo"
    assert not verify(t, SECRET).is_demo


def test_terminal_unavailable_and_not_logged_in():
    t = FakeTerminal()
    t.available = False
    assert verify(t, SECRET).state == "terminal_unavailable"
    t = FakeTerminal()
    t.account = None
    assert verify(t, SECRET).state == "not_logged_in"
    t = FakeTerminal()
    t.account["login"] = 0
    assert verify(t, SECRET).state == "not_logged_in"
    t = FakeTerminal()
    t.connected = False
    assert verify(t, SECRET).state == "broker_disconnected"
    t = FakeTerminal()
    t.build = 0
    assert verify(t, SECRET).state == "unsupported_terminal"


def test_missing_account_fields_fail_closed():
    t = FakeTerminal()
    t.account["currency"] = None
    assert verify(t, SECRET).state == "account_unavailable"


def test_fingerprint_hides_the_login_and_detects_account_switches():
    a = verify(FakeTerminal(login=51234821), SECRET)
    b = verify(FakeTerminal(login=51234822), SECRET)
    assert a.fingerprint != b.fingerprint
    assert "51234821" not in a.fingerprint
    assert a.fingerprint == account_fingerprint(SECRET, 51234821, "TradePilot-TEST-FIXTURE")
    # A different installation secret gives a different, unlinkable fingerprint.
    assert verify(FakeTerminal(login=51234821), b"\x02" * 32).fingerprint != a.fingerprint


def test_report_never_contains_the_account_name_or_full_login():
    report = verify(FakeTerminal(), SECRET).report(180, "estimated")
    text = str(report)
    assert "PRIVATE NAME" not in text and "51234821" not in text
