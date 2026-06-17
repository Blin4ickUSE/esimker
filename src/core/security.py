"""Shared security helpers: validation, rate limiting, auth checks."""

from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Any

EMAIL_RE = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$")
REFERRAL_CODE_RE = re.compile(r"^[A-Z0-9]{4,16}$")
COUNTRY_CODE_RE = re.compile(r"^[A-Z0-9]{1,12}$")
ID_RE = re.compile(r"^[a-f0-9]{8,64}$")
PROMO_CODE_RE = re.compile(r"^[A-Z0-9_-]{3,32}$")
PAYMENT_METHODS = frozenset({
    "balance",
    "card",
    "card_ru",
    "card_intl",
    "crypto",
    "sbp",
    "cryptobot",
    "other",
})
PAYMENT_PROVIDERS = frozenset({
    "sbp",
    "card_ru",
    "card_intl",
    "crypto",
    "cryptobot",
    "ton_usdt",
    "ton_gram",
    "trc20_usdt",
    "trc20_trx",
})
BALANCE_KINDS = frozenset({"topup", "purchase", "promo", "referral", "refund", "adjustment"})
ESIM_STATUSES = frozenset({"inactive", "active", "expired", "limit"})
ORDER_STATUSES = frozenset({"pending", "paid", "failed", "refunded"})

MAX_STRING = 512
MAX_EMAIL = 254
MAX_PROMO = 32
MAX_COUNTRY_NAME = 128
MAX_TELEGRAM_ID = 9_999_999_999_999
MIN_MONEY = 0.01
MAX_MONEY = 10_000.0
MAX_TOPUP = 1000.0
MAX_BODY_BYTES = 65_536
MAX_INIT_DATA_BYTES = 8_192


class SecurityError(ValueError):
    """Invalid or rejected input."""


class RateLimitError(Exception):
    """Too many requests."""


class AuthenticationError(SecurityError):
    """Missing or invalid credentials."""


def env_bool(name: str, default: bool = False) -> bool:
    import os

    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    import os

    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def resolve_db_path(raw: str | Path | None, *, root: Path) -> Path:
    """Resolve DB path and forbid writes outside ``<root>/data``."""
    data_dir = (root / "data").resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    if raw is None or str(raw).strip() == "":
        return data_dir / "data.db"
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    resolved = path.resolve()
    try:
        resolved.relative_to(data_dir)
    except ValueError as exc:
        raise SecurityError("DB_PATH must stay inside the data directory") from exc
    return resolved


def clamp_text(value: Any, *, max_len: int = MAX_STRING, field: str = "value") -> str:
    if value is None:
        raise SecurityError(f"{field} is required")
    text = str(value).strip()
    if not text or len(text) > max_len:
        raise SecurityError(f"{field} length is invalid")
    if "\x00" in text:
        raise SecurityError(f"{field} contains invalid characters")
    return text


def optional_text(value: Any, *, max_len: int = MAX_STRING, field: str = "value") -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > max_len or "\x00" in text:
        raise SecurityError(f"{field} length is invalid")
    return text


def validate_telegram_id(value: Any) -> int:
    try:
        tid = int(value)
    except (TypeError, ValueError) as exc:
        raise SecurityError("invalid telegram id") from exc
    if tid <= 0 or tid > MAX_TELEGRAM_ID:
        raise SecurityError("invalid telegram id")
    return tid


def validate_email(value: Any) -> str:
    email = clamp_text(value, max_len=MAX_EMAIL, field="email").lower()
    if not EMAIL_RE.fullmatch(email):
        raise SecurityError("invalid email")
    return email


def validate_referral_code(value: Any) -> str:
    code = clamp_text(value, max_len=16, field="referral code").upper()
    if not REFERRAL_CODE_RE.fullmatch(code):
        raise SecurityError("invalid referral code")
    return code


def validate_promo_code(value: Any) -> str:
    code = clamp_text(value, max_len=MAX_PROMO, field="promo code").upper()
    if not PROMO_CODE_RE.fullmatch(code):
        raise SecurityError("invalid promo code")
    return code


def validate_country_code(value: Any) -> str:
    code = clamp_text(value, max_len=12, field="country code").upper()
    if not COUNTRY_CODE_RE.fullmatch(code):
        raise SecurityError("invalid country code")
    return code


def validate_country_name(value: Any) -> str:
    return clamp_text(value, max_len=MAX_COUNTRY_NAME, field="country name")


def validate_record_id(value: Any, *, field: str = "id") -> str:
    text = clamp_text(value, max_len=64, field=field).lower()
    if not ID_RE.fullmatch(text):
        raise SecurityError(f"invalid {field}")
    return text


def validate_money(
    value: Any,
    *,
    field: str = "amount",
    min_value: float = MIN_MONEY,
    max_value: float = MAX_MONEY,
) -> float:
    try:
        amount = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise SecurityError(f"invalid {field}") from exc
    if amount < min_value or amount > max_value:
        raise SecurityError(f"{field} out of range")
    return amount


def validate_days(value: Any) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError) as exc:
        raise SecurityError("invalid days") from exc
    if days < 1 or days > 3650:
        raise SecurityError("invalid days")
    return days


def validate_payment_method(value: Any) -> str:
    method = clamp_text(value, max_len=16, field="payment method").lower()
    if method not in PAYMENT_METHODS:
        raise SecurityError("invalid payment method")
    return method


def validate_payment_provider(value: Any) -> str:
    provider = clamp_text(value, max_len=32, field="payment provider").lower()
    if provider not in PAYMENT_PROVIDERS:
        raise SecurityError("invalid payment provider")
    return provider


def env_name(name: str, default: str = "production") -> str:
    import os

    raw = os.getenv(name, "").strip().lower()
    return raw or default


def is_production() -> bool:
    return env_name("ENVIRONMENT", "production") == "production"


def validate_balance_kind(value: Any) -> str:
    kind = clamp_text(value, max_len=32, field="balance kind").lower()
    if kind not in BALANCE_KINDS:
        raise SecurityError("invalid balance kind")
    return kind


def safe_public_error(exc: BaseException) -> str:
    if isinstance(exc, (SecurityError, RateLimitError, AuthenticationError)):
        return str(exc)
    if isinstance(exc, ValueError):
        return str(exc)
    return "internal server error"


class RateLimiter:
    """Thread-safe sliding-window rate limiter."""

    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self.max_requests = max(1, max_requests)
        self.window_seconds = max(1, window_seconds)
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = [t for t in self._hits.get(key, []) if now - t < self.window_seconds]
            if len(bucket) >= self.max_requests:
                self._hits[key] = bucket
                raise RateLimitError("too many requests")
            bucket.append(now)
            self._hits[key] = bucket
