"""Local configuration and secrets, kept in a private per-user directory.

Windows:  %LOCALAPPDATA%\\TradePilot\\Connector
Elsewhere (tests/development): $XDG_CONFIG_HOME/tradepilot-connector
Override: TRADEPILOT_CONNECTOR_HOME

config.json  - API address, agent id, optional terminal path / broker offset (not secret)
secrets.bin  - agent token + install secret. On Windows encrypted with DPAPI
               (CryptProtectData, current user only); elsewhere a 0600 file.
state.json   - last known status and broker time offset (not secret)
connector.log - redacted log
"""
from __future__ import annotations

import base64
import ctypes
import json
import os
import secrets as pysecrets
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def home() -> Path:
    override = os.environ.get("TRADEPILOT_CONNECTOR_HOME")
    if override:
        path = Path(override)
    elif sys.platform == "win32":
        path = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "TradePilot" / "Connector"
    else:
        path = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "tradepilot-connector"
    path.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        os.chmod(path, 0o700)
    return path


def validate_api_url(url: str) -> str:
    """Agent tokens are only ever sent over HTTPS, or plain HTTP to this computer."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path not in ("", "/") or parsed.query:
        raise ValueError("The TradePilot address must look like https://your-site.example (no path).")
    if parsed.scheme == "http" and parsed.hostname not in LOCAL_HOSTS:
        raise ValueError("Refusing to send the connector token over plain HTTP to another computer. Use https://.")
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass
class Config:
    api_url: str
    agent_id: str
    display_name: str
    terminal_path: str | None = None
    broker_utc_offset_minutes: int | None = None

    @staticmethod
    def path() -> Path:
        return home() / "config.json"

    @classmethod
    def load(cls) -> "Config | None":
        p = cls.path()
        if not p.exists():
            return None
        data = json.loads(p.read_text(encoding="utf-8"))
        cfg = cls(**{k: data.get(k) for k in cls.__dataclass_fields__})
        cfg.api_url = validate_api_url(cfg.api_url)
        return cfg

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


# --- Secrets -------------------------------------------------------------------


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    """Windows Data Protection API, current-user scope (no admin rights needed)."""
    crypt32 = ctypes.windll.crypt32  # type: ignore[attr-defined]
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(blob_in), None, None, None, None, 0x1, ctypes.byref(blob_out))  # CRYPTPROTECT_UI_FORBIDDEN
    if not ok:
        raise OSError("Windows could not protect/unprotect the connector secret")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


@dataclass
class Secrets:
    agent_token: str
    install_secret: bytes

    @staticmethod
    def path() -> Path:
        return home() / "secrets.bin"

    @staticmethod
    def storage_kind() -> str:
        return "Windows DPAPI (current user)" if sys.platform == "win32" else "file readable only by you (0600)"

    @classmethod
    def create(cls, agent_token: str) -> "Secrets":
        return cls(agent_token=agent_token, install_secret=pysecrets.token_bytes(32))

    @classmethod
    def load(cls) -> "Secrets | None":
        p = cls.path()
        if not p.exists():
            return None
        raw = p.read_bytes()
        if sys.platform == "win32":
            raw = _dpapi(raw, protect=False)
        data = json.loads(raw.decode("utf-8"))
        return cls(agent_token=data["agent_token"], install_secret=base64.b64decode(data["install_secret"]))

    def save(self) -> None:
        raw = json.dumps({"agent_token": self.agent_token, "install_secret": base64.b64encode(self.install_secret).decode()}).encode()
        p = self.path()
        if sys.platform == "win32":
            p.write_bytes(_dpapi(raw, protect=True))
        else:
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            os.chmod(p, 0o600)

    def __repr__(self) -> str:  # never print secrets by accident
        return "Secrets(agent_token=<redacted>, install_secret=<redacted>)"


# --- State (not secret) ----------------------------------------------------------


def load_state() -> dict[str, Any]:
    p = home() / "state.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict[str, Any]) -> None:
    (home() / "state.json").write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


def stop_file() -> Path:
    return home() / "stop.request"
