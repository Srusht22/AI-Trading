"""Command line: python -m tradepilot_connector <command>

  check   local diagnostic: Python, MetaTrader5 package, terminal, account type, server
  pair    enrol this computer with a one-time pairing code from the website
  start   run the connector (Ctrl+C or `stop` to end it)
  stop    ask a running connector to stop
  status  show local configuration and the last known state (no secrets)
  logs    show the redacted log
  reset   delete local configuration and secrets from this computer
"""
from __future__ import annotations

import argparse
import base64
import os
import platform
import secrets
import struct
import sys
from contextlib import contextmanager
from typing import Iterator

from . import VERSION
from .api import AgentApi, ApiError
from .config import Config, Secrets, home, load_state, save_state, stop_file, validate_api_url
from .logs import setup, tail
from .timebase import BrokerClock

MIN_PYTHON = (3, 10)
EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_REVOKED = 0, 1, 2, 3


def _print_check(ok: bool | None, label: str, detail: str = "") -> None:
    mark = {True: "[ OK ]", False: "[FAIL]", None: "[ -- ]"}[ok]
    print(f"{mark} {label}{': ' + detail if detail else ''}")


@contextmanager
def single_instance() -> Iterator[None]:
    """Hold an exclusive lock so two connectors never publish for the same agent."""
    path = home() / "connector.lock"
    fh = open(path, "a+")  # noqa: SIM115
    try:
        if sys.platform == "win32":
            import msvcrt  # noqa: PLC0415

            fh.seek(0)
            try:
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise SystemExit("Another TradePilot connector is already running on this computer.") from None
        else:
            import fcntl  # noqa: PLC0415

            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise SystemExit("Another TradePilot connector is already running on this computer.") from None
        yield
    finally:
        fh.close()


def cmd_check(args: argparse.Namespace) -> int:
    from .terminal import Mt5Terminal  # noqa: PLC0415
    from .verification import verify  # noqa: PLC0415

    failures = 0
    py_ok = sys.version_info[:2] >= MIN_PYTHON and struct.calcsize("P") == 8
    _print_check(py_ok, "Python", f"{platform.python_version()} ({struct.calcsize('P') * 8}-bit)")
    failures += not py_ok
    _print_check(sys.platform == "win32", "Windows", platform.platform())
    try:
        import MetaTrader5  # noqa: PLC0415

        _print_check(True, "MetaTrader5 package", getattr(MetaTrader5, "__version__", "installed"))
    except ImportError:
        _print_check(False, "MetaTrader5 package", "not installed — run setup.ps1")
        return EXIT_FAIL

    cfg = Config.load()
    stored = Secrets.load() if cfg else None
    terminal = Mt5Terminal(path=args.terminal_path or (cfg.terminal_path if cfg else None))
    ok, error = terminal.connect()
    _print_check(ok, "MetaTrader 5 terminal", "attached" if ok else f"not available ({error}). Open MT5 and log in.")
    if ok:
        info = terminal.terminal_info() or {}
        version = terminal.version()
        _print_check(bool(version), "Terminal version", f"build {version[1]}" if version else "unknown")
        _print_check(bool(info.get("connected")), "Broker connection", "connected" if info.get("connected") else "not connected")
        v = verify(terminal, stored.install_secret if stored else secrets.token_bytes(32))
        _print_check(v.is_demo, "Account", v.message)
        failures += not v.is_demo
        terminal.shutdown()
    else:
        failures += 1

    if cfg and stored:
        api = AgentApi(cfg.api_url, stored.agent_token)
        health = api.health()
        _print_check(bool(health), "TradePilot server", cfg.api_url if health else f"{cfg.api_url} not reachable")
        failures += not health
        _print_check(True, "Pairing", f"agent {cfg.agent_id} ({cfg.display_name}); token stored in {Secrets.storage_kind()}")
    else:
        _print_check(None, "Pairing", "not paired yet — create a pairing code in TradePilot > Connections, then run `pair`")
    return EXIT_OK if failures == 0 else EXIT_FAIL


def cmd_pair(args: argparse.Namespace) -> int:
    try:
        api_url = validate_api_url(args.api_url)
    except ValueError as e:
        print(e)
        return EXIT_USAGE
    if Config.load() and not args.force:
        print("This computer is already paired. Run `reset` first (and revoke the old connector in the website) or pass --force.")
        return EXIT_USAGE
    code = (args.code or input("Pairing code from the website: ")).strip()
    # The token is created here and never leaves this computer except as a bearer header to TradePilot.
    token = "tpa_" + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    api = AgentApi(api_url, token)
    try:
        result = api.call("pair", {"pairing_code": code, "agent_version": VERSION, "platform": f"{platform.system()}/{platform.machine()}"[:60]})
    except ApiError as e:
        print(f"Pairing failed: {e.message}")
        return EXIT_FAIL
    Secrets.create(token).save()
    Config(api_url=api_url, agent_id=result["agent_id"], display_name=result["display_name"], terminal_path=args.terminal_path).save()
    print(f"Paired as \"{result['display_name']}\" (agent {result['agent_id']}).")
    print(f"The connector token is stored in {Secrets.storage_kind()} under {home()} and is not shown.")
    print("Next: start the connector with `tradepilot-connector start`.")
    return EXIT_OK


def cmd_start(args: argparse.Namespace) -> int:
    from .connector import AuthorizationLost, Connector  # noqa: PLC0415
    from .terminal import Mt5Terminal  # noqa: PLC0415

    cfg = Config.load()
    stored = Secrets.load() if cfg else None
    if not cfg or not stored:
        print("Not paired yet. Create a pairing code in TradePilot > Connections and run `pair` first.")
        return EXIT_USAGE
    log = setup(home() / "connector.log", verbose=args.verbose)
    stop_file().unlink(missing_ok=True)
    state = load_state()
    clock = BrokerClock(cfg.broker_utc_offset_minutes, state.get("broker_utc_offset_minutes") if state.get("broker_offset_source") == "estimated" else None)
    terminal = Mt5Terminal(path=args.terminal_path or cfg.terminal_path)
    api = AgentApi(cfg.api_url, stored.agent_token)
    connector = Connector(api, terminal, stored.install_secret, clock, log, on_state=save_state)
    with single_instance():
        log.info("TradePilot connector %s starting (read-only). Press Ctrl+C to stop.", VERSION)
        try:
            connector.run(lambda: stop_file().exists())
        except AuthorizationLost:
            log.error("TradePilot no longer accepts this connector (it was revoked or removed). Pair again to reconnect.")
            save_state({**connector.status_summary(), "server_status": "agent_revoked"})
            return EXIT_REVOKED
        except KeyboardInterrupt:
            pass
        finally:
            stop_file().unlink(missing_ok=True)
            save_state({**connector.status_summary(), "stopped": True})
        log.info("Connector stopped. The website will show it as offline after about 45 seconds.")
    return EXIT_OK


def cmd_stop(_args: argparse.Namespace) -> int:
    stop_file().write_text("stop", encoding="utf-8")
    print("Stop requested. A running connector exits within a second.")
    return EXIT_OK


def cmd_status(_args: argparse.Namespace) -> int:
    cfg = Config.load()
    if not cfg:
        print("Not paired.")
        return EXIT_OK
    print(f"Connector version : {VERSION}")
    print(f"TradePilot address: {cfg.api_url}")
    print(f"Agent             : {cfg.display_name} ({cfg.agent_id})")
    print(f"Token             : stored ({Secrets.storage_kind()}), never displayed")
    print(f"Configuration dir : {home()}")
    state = load_state()
    if state:
        print("Last known state  :")
        for key in ("updated_at", "local_message", "server_status", "server_reason", "publishing", "monitored_symbols",
                    "broker_utc_offset_minutes", "broker_offset_source", "stopped"):
            if key in state:
                print(f"  {key:26}: {state[key]}")
    return EXIT_OK


def cmd_logs(args: argparse.Namespace) -> int:
    for line in tail(home() / "connector.log", args.lines):
        print(line)
    return EXIT_OK


def cmd_reset(args: argparse.Namespace) -> int:
    if not args.yes and input(f"Delete the connector configuration and secrets in {home()}? [y/N] ").strip().lower() != "y":
        print("Nothing deleted.")
        return EXIT_OK
    for name in ("config.json", "secrets.bin", "state.json", "stop.request"):
        path = home() / name
        if path.exists():
            if name == "secrets.bin":
                path.write_bytes(os.urandom(path.stat().st_size))  # best effort overwrite before deleting
            path.unlink()
    print("Local configuration removed. Also revoke this connector in TradePilot > Connections so its old token stops working.")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tradepilot-connector", description=f"TradePilot AI read-only MT5 connector {VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("check", help="diagnose Python, MT5, the account type and the server connection")
    p.add_argument("--terminal-path", help="path to terminal64.exe if MT5 is not found automatically")
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("pair", help="pair this computer using a code from the website")
    p.add_argument("--api-url", required=True, help="TradePilot address, e.g. https://tradepilot.example or http://127.0.0.1:8788")
    p.add_argument("--code", help="the one-time pairing code (prompted if omitted)")
    p.add_argument("--terminal-path", help="path to terminal64.exe (optional)")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_pair)
    p = sub.add_parser("start", help="run the connector")
    p.add_argument("--terminal-path")
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(fn=cmd_start)
    sub.add_parser("stop", help="stop a running connector").set_defaults(fn=cmd_stop)
    sub.add_parser("status", help="show configuration and last state").set_defaults(fn=cmd_status)
    p = sub.add_parser("logs", help="show the redacted log")
    p.add_argument("-n", "--lines", type=int, default=60)
    p.set_defaults(fn=cmd_logs)
    p = sub.add_parser("reset", help="remove local configuration and secrets")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(fn=cmd_reset)
    sub.add_parser("version", help="print the version").set_defaults(fn=lambda _a: print(VERSION) or EXIT_OK)
    args = parser.parse_args(argv)
    return int(args.fn(args))
