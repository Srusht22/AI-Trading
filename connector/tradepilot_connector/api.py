"""Client for the TradePilot agent API (POST /api/agent/<action>) — the same
authenticated protocol the Phase 3 diagnostics worker uses."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

from . import VERSION
from .config import validate_api_url

Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message

    @property
    def retryable(self) -> bool:
        return self.status == 0 or self.status >= 500 or self.status == 429

    @property
    def auth_lost(self) -> bool:
        return self.code == "unauthorized"


class LeaseLost(ApiError):
    pass


def _urllib_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:  # noqa: S310 - URL validated (https or localhost)
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class AgentApi:
    def __init__(self, api_url: str, token: str, transport: Transport | None = None, timeout: float = 15.0):
        self.base = validate_api_url(api_url)
        self._token = token
        self._transport = transport or _urllib_transport
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "User-Agent": f"TradePilotConnector/{VERSION}",
        }
        # Optional Cloudflare Access service token for a protected staging site.
        cid, csecret = os.environ.get("TRADEPILOT_ACCESS_CLIENT_ID"), os.environ.get("TRADEPILOT_ACCESS_CLIENT_SECRET")
        if cid and csecret:
            headers["CF-Access-Client-Id"] = cid
            headers["CF-Access-Client-Secret"] = csecret
        return headers

    def call(self, action: str, body: dict[str, Any] | None = None) -> Any:
        data = json.dumps(body or {}, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(f"{self.base}/api/agent/{action}", data=data, headers=self._headers(), method="POST")
        try:
            status, raw = self._transport(request, self._timeout)
        except (OSError, urllib.error.URLError) as e:
            raise ApiError(0, "network_error", f"could not reach TradePilot ({type(e).__name__})") from None
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            payload = None
        if 200 <= status < 300 and isinstance(payload, dict) and payload.get("ok"):
            return payload.get("data")
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        code = str(error.get("code") or f"http_{status}")
        message = str(error.get("message") or "unexpected response")
        if code == "lease_lost":
            raise LeaseLost(status, code, message)
        raise ApiError(status, code, message)

    def health(self) -> dict[str, Any] | None:
        request = urllib.request.Request(f"{self.base}/api/health", headers={"User-Agent": f"TradePilotConnector/{VERSION}"})
        try:
            status, raw = self._transport(request, self._timeout)
        except (OSError, urllib.error.URLError):
            return None
        try:
            payload = json.loads(raw.decode("utf-8"))
        except ValueError:
            return None
        return payload.get("data") if status == 200 and isinstance(payload, dict) else None
