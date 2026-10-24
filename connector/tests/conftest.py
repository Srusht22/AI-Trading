import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.fakes import Clock, FakeApi, FakeTerminal  # noqa: E402
from tradepilot_connector.connector import Connector  # noqa: E402
from tradepilot_connector.timebase import BrokerClock  # noqa: E402

SECRET = b"\x01" * 32


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("TRADEPILOT_CONNECTOR_HOME", str(tmp_path / "home"))
    for k in ("TRADEPILOT_ACCESS_CLIENT_ID", "TRADEPILOT_ACCESS_CLIENT_SECRET"):
        os.environ.pop(k, None)


@pytest.fixture
def rig():
    """A connector wired to a fake terminal and fake server, with a controllable clock."""
    terminal = FakeTerminal()
    api = FakeApi()
    clock = Clock()
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock.advance(s)

    connector = Connector(
        api, terminal, SECRET, BrokerClock(configured_minutes=180), logging.getLogger("test"),
        monotonic=clock.monotonic, now=lambda: datetime.fromtimestamp(terminal.now, tz=timezone.utc), sleep=sleep,
    )

    class Rig:
        pass

    r = Rig()
    r.terminal, r.api, r.clock, r.connector, r.sleeps = terminal, api, clock, connector, sleeps

    def run(seconds, dt=0.5):
        end = clock.t + seconds
        while clock.t < end:
            connector.step()
            clock.advance(dt)
            terminal.now += dt

    r.run = run
    return r
