"""Browser-test harness. FOR AUTOMATED TESTS ONLY.

Runs the real connector loop and the real HTTP agent API against FakeTerminal,
a scripted stand-in for MetaTrader 5 whose server is named
"TradePilot-TEST-FIXTURE". Prices move by a fixed, deterministic step so a
browser test can watch genuine pipeline updates; nothing here is market data.

    python tests/e2e_fixture_session.py --api-url http://127.0.0.1:8788 --code XXXX-... --control-dir DIR

Control files in DIR (created by the test):
    freeze        stop moving prices (quotes go stale)
    real-account  switch the fake terminal to a REAL account (must be blocked)
    stop          exit
"""
from __future__ import annotations

import argparse
import base64
import logging
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.fakes import FakeTerminal  # noqa: E402
from tradepilot_connector import VERSION  # noqa: E402
from tradepilot_connector.api import AgentApi  # noqa: E402
from tradepilot_connector.connector import AuthorizationLost, Connector  # noqa: E402
from tradepilot_connector.timebase import BrokerClock  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api-url", required=True)
    p.add_argument("--code", required=True)
    p.add_argument("--control-dir", required=True)
    args = p.parse_args()
    control = Path(args.control_dir)
    control.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [fixture] %(message)s")
    log = logging.getLogger("tradepilot.fixture")
    token = "tpa_" + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    api = AgentApi(args.api_url, token)
    paired = api.call("pair", {"pairing_code": args.code, "agent_version": VERSION, "platform": "TEST-FIXTURE"})
    (control / "agent_id").write_text(paired["agent_id"])
    log.info("paired test fixture agent %s", paired["agent_id"])

    terminal = FakeTerminal(trade_mode=0, now=time.time())
    connector = Connector(api, terminal, secrets.token_bytes(32), BrokerClock(), log,
                          now=lambda: datetime.fromtimestamp(terminal.now, tz=timezone.utc))
    step = 0
    last_move = 0.0

    def tick() -> bool:
        nonlocal step, last_move
        terminal.now = time.time()
        if (control / "real-account").exists():
            terminal.account["trade_mode"] = 2
        if not (control / "freeze").exists() and terminal.now - last_move >= 2:
            step += 1
            bid = round(1.08400 + 0.00001 * step, 5)
            terminal.move("EURUSD.r", bid, round(bid + 0.00007, 5), dt=0)
            last_move = terminal.now
        return (control / "stop").exists()

    try:
        connector.run(tick)
    except AuthorizationLost:
        log.info("fixture agent revoked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
