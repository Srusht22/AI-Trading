import json
import os
import stat
import sys

import pytest

from tradepilot_connector import cli
from tradepilot_connector.api import AgentApi, ApiError
from tradepilot_connector.config import Config, Secrets, home, validate_api_url
from tradepilot_connector.logs import redact


def test_tokens_only_travel_over_https_or_to_this_computer():
    assert validate_api_url("https://tradepilot.example/") == "https://tradepilot.example"
    assert validate_api_url("http://127.0.0.1:8788") == "http://127.0.0.1:8788"
    for bad in ("http://tradepilot.example", "ftp://x", "https://x.example/api", "tradepilot.example"):
        with pytest.raises(ValueError):
            validate_api_url(bad)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permissions")
def test_secrets_file_is_private_and_never_printed(capsys):
    s = Secrets.create("tpa_" + "x" * 43)
    s.save()
    mode = stat.S_IMODE(os.stat(Secrets.path()).st_mode)
    assert mode == 0o600
    assert Secrets.load().agent_token == s.agent_token
    print(repr(s))
    assert "tpa_" not in capsys.readouterr().out


def test_redaction_of_tokens_codes_and_bearer_headers():
    text = redact("token=tpa_abcdefghijk Authorization: Bearer tpa_zzzzzzzzzz code AB12-CD34-EF56-7890-AAAA password: hunter2")
    assert "tpa_abcdefghijk" not in text and "zzzz" not in text and "AB12-CD34" not in text and "hunter2" not in text


def transport_returning(status, body, seen):
    def transport(request, timeout):
        seen.append(request)
        return status, json.dumps(body).encode()
    return transport


def test_api_client_maps_errors():
    seen = []
    api = AgentApi("http://127.0.0.1:8788", "tpa_" + "y" * 43, transport=transport_returning(401, {"ok": False, "error": {"code": "unauthorized", "message": "no"}}, seen))
    with pytest.raises(ApiError) as e:
        api.call("heartbeat", {})
    assert e.value.auth_lost
    assert seen[0].get_header("Authorization").startswith("Bearer tpa_")
    assert seen[0].full_url == "http://127.0.0.1:8788/api/agent/heartbeat"


def test_pair_stores_token_locally_and_never_prints_it(monkeypatch, capsys):
    seen = []
    monkeypatch.setattr("tradepilot_connector.api._urllib_transport",
                        transport_returning(200, {"ok": True, "data": {"agent_id": "a-1", "display_name": "My PC", "capabilities": ["mt5.read"]}}, seen))
    assert cli.main(["pair", "--api-url", "http://127.0.0.1:8788", "--code", "AB12-CD34-EF56-7890-AAAA"]) == 0
    out = capsys.readouterr().out
    token = Secrets.load().agent_token
    assert token.startswith("tpa_") and token not in out
    assert Config.load().agent_id == "a-1"
    body = json.loads(seen[0].data)
    assert body["pairing_code"] == "AB12-CD34-EF56-7890-AAAA" and "token" not in json.dumps(body)
    assert seen[0].get_header("Authorization") == f"Bearer {token}"


def test_reset_removes_local_secrets(capsys):
    Secrets.create("tpa_" + "z" * 43).save()
    Config(api_url="http://127.0.0.1:8788", agent_id="a", display_name="x").save()
    assert cli.main(["reset", "--yes"]) == 0
    assert not (home() / "secrets.bin").exists() and not (home() / "config.json").exists()
    assert "revoke" in capsys.readouterr().out


def test_stop_requests_a_graceful_exit():
    assert cli.main(["stop"]) == 0
    assert (home() / "stop.request").exists()
