"""Logging with redaction. Nothing secret should be logged in the first place;
this is a second line of defence for tokens, pairing codes and bearer headers."""
from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

PATTERNS = [
    (re.compile(r"tpa_[A-Za-z0-9_-]{8,}"), "tpa_[redacted]"),
    (re.compile(r"(?i)bearer\s+\S+"), "Bearer [redacted]"),
    (re.compile(r"\b[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}\b"), "[pairing code redacted]"),
    (re.compile(r"(?i)(password|passwd|secret|token)(\"?\s*[:=]\s*\"?)[^\s\",}]+"), r"\1\2[redacted]"),
]


def redact(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = ()
        return True


def setup(log_file: Path, verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger("tradepilot")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    for handler in (logging.StreamHandler(), RotatingFileHandler(log_file, maxBytes=1_000_000, backupCount=3, encoding="utf-8")):
        handler.setFormatter(fmt)
        handler.addFilter(RedactingFilter())
        logger.addHandler(handler)
    return logger


def tail(log_file: Path, lines: int) -> list[str]:
    if not log_file.exists():
        return []
    content = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
    return [redact(line) for line in content[-lines:]]
