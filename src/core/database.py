"""SQLite persistence for esimker.

Persistent storage (this module):
  users, first/last app open, balances, eSIM profiles, orders, promo codes,
  referral graph, referral earnings, email, notification preferences.

Client-side cache only (localStorage, not stored here):
  last selected language (`esimker.lang`), selected theme (`esimker.theme`).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import string
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator, Literal

from core.security import (
    ESIM_STATUSES,
    ORDER_STATUSES,
    MAX_TOPUP,
    SecurityError,
    optional_text,
    resolve_db_path,
    validate_balance_kind,
    validate_country_code,
    validate_country_name,
    validate_days,
    validate_email,
    validate_money,
    validate_payment_method,
    validate_promo_code,
    validate_record_id,
    validate_referral_code,
    validate_telegram_id,
)

from core.esim_profile import build_android_install_url, build_apple_install_url, build_lpa_string

SCHEMA_VERSION = 7
REFERRAL_COMMISSION_RATE = 0.10
REFERRAL_FRIEND_DISCOUNT_RATE = 0.10

ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT_DIR / "data" / "data.db"

REFERRAL_ALPHABET = string.ascii_uppercase + string.digits
REFERRAL_CODE_LENGTH = 6

EsimStatus = Literal["inactive", "active", "expired", "limit"]
PaymentIntentKind = Literal["topup", "purchase"]
PaymentIntentStatus = Literal["pending", "completed", "expired", "cancelled"]

PAYMENT_INTENT_TTL_MINUTES = 30
PaymentMethod = Literal["balance", "card", "sbp", "crypto", "other"]
OrderStatus = Literal["pending", "paid", "failed", "refunded"]
BalanceKind = Literal["topup", "purchase", "promo", "referral", "refund", "adjustment"]
ReferralEarningKind = Literal["signup", "purchase"]


class DatabaseError(Exception):
    """Base database error."""


class NotFoundError(DatabaseError):
    """Requested row does not exist."""


class ConflictError(DatabaseError):
    """Unique constraint or business-rule conflict."""


class InsufficientBalanceError(DatabaseError):
    """User balance is too low for the operation."""


def utc_now() -> datetime:
    return datetime.now(UTC)


def isoformat(dt: datetime | None = None) -> str:
    return (dt or utc_now()).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def ms_to_iso(ms: int | float | None) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()


def iso_to_ms(value: str | None) -> int | None:
    dt = parse_iso(value)
    if dt is None:
        return None
    return int(dt.timestamp() * 1000)


def generate_referral_code(length: int = REFERRAL_CODE_LENGTH) -> str:
    return "".join(secrets.choice(REFERRAL_ALPHABET) for _ in range(length))


def build_referral_link(base_url: str, referral_code: str) -> str:
    return f"{base_url.rstrip('/')}/?ref={referral_code}"


def volume_to_db(gb: int | float | str) -> str:
    if gb == "Безлимит":
        return "unlimited"
    return str(gb)


def volume_from_db(value: str) -> int | float | Literal["Безлимит"]:
    if value == "unlimited":
        return "Безлимит"
    if "." in value:
        return float(value)
    return int(value)


@dataclass(slots=True)
class NotificationPrefs:
    news: bool = True
    marketing: bool = True
    traffic: bool = True
    subscription: bool = True

    def to_dict(self) -> dict[str, bool]:
        return asdict(self)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> NotificationPrefs:
        keys = row.keys()
        return cls(
            news=bool(row["notify_news"]),
            marketing=bool(row["notify_marketing"]),
            traffic=bool(row["notify_traffic"]),
            subscription=bool(row["notify_subscription"]) if "notify_subscription" in keys else True,
        )


@dataclass(slots=True)
class User:
    telegram_id: int
    language_code: str | None
    balance: float
    referral_code: str
    referred_by_id: int | None
    referral_earned_usd: float
    referral_count: int
    dent_customer_uid: str | None
    dent_profile_url: str | None
    first_opened_at: str
    last_opened_at: str
    created_at: str
    updated_at: str
    is_blocked: bool = False
    email: str | None = None
    email_verified: bool = False
    notifications: NotificationPrefs = field(default_factory=NotificationPrefs)

    @property
    def referral_link(self) -> str:
        return f"?ref={self.referral_code}"

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["notifications"] = self.notifications.to_dict()
        return data


@dataclass(slots=True)
class Esim:
    id: str
    user_id: int
    name: str
    country_code: str
    gb: str
    days: int
    usd: float
    status: EsimStatus
    purchased_at: str
    iccid: str | None = None
    imsi: str | None = None
    msisdn: str | None = None
    smdp_address: str | None = None
    activation_code: str | None = None
    apple_universal_link: str | None = None
    android_universal_link: str | None = None
    installation_url: str | None = None
    data_remaining_gb: float | None = None
    data_total_gb: float | None = None
    activated_at: str | None = None
    expires_at: str | None = None
    last_seen_at: str | None = None
    order_id: str | None = None
    dent_activation_uid: str | None = None
    dent_esim_uid: str | None = None
    dent_profile_domain_key: str | None = None
    dent_customer_profile_domain_id: str | None = None
    dent_esim_state: str | None = None
    dent_customer_uid: str | None = None
    metatag: str | None = None
    is_active: bool = True
    created_at: str = ""
    updated_at: str = ""

    def to_client_dict(self) -> dict[str, Any]:
        """Shape compatible with the miniapp ``Esim`` interface."""
        apple_url = build_apple_install_url(
            self.smdp_address,
            self.activation_code,
            apple_universal_link=self.apple_universal_link,
        )
        android_url = build_android_install_url(
            self.smdp_address,
            self.activation_code,
            android_universal_link=self.android_universal_link,
            installation_url=self.installation_url,
        )
        data: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "code": self.country_code,
            "gb": volume_from_db(self.gb),
            "days": self.days,
            "usd": self.usd,
            "purchasedAt": iso_to_ms(self.purchased_at) or 0,
            "status": self.status,
            "iccid": self.iccid or "",
            "smdpAddress": self.smdp_address or "",
            "activationCode": self.activation_code or "",
            "dataRemainingGb": self.data_remaining_gb,
            **({"activatedAt": iso_to_ms(self.activated_at)} if self.activated_at else {}),
            **({"expiresAt": iso_to_ms(self.expires_at)} if self.expires_at else {}),
        }
        if apple_url:
            data["appleInstallUrl"] = apple_url
        if android_url:
            data["androidInstallUrl"] = android_url
        lpa = build_lpa_string(self.smdp_address, self.activation_code)
        if lpa:
            data["lpaString"] = lpa
        return data

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PaymentIntent:
    id: str
    user_id: int
    kind: PaymentIntentKind
    amount_usd: float
    status: PaymentIntentStatus
    expires_at: str
    created_at: str
    plan_name: str | None = None
    country_code: str | None = None
    gb: str | None = None
    days: int | None = None
    payment_method: str | None = None
    payment_provider: str | None = None
    order_id: str | None = None
    esim_id: str | None = None
    provider_ref: str | None = None
    completed_at: str | None = None

    def to_client_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "amountUsd": self.amount_usd,
            "status": self.status,
            "expiresAt": iso_to_ms(self.expires_at),
            "createdAt": iso_to_ms(self.created_at),
        }
        if self.kind == "purchase" and self.plan_name:
            data["plan"] = {
                "name": self.plan_name,
                "countryCode": self.country_code,
                "gb": volume_from_db(self.gb or ""),
                "days": self.days,
                "usd": self.amount_usd,
            }
        return data


@dataclass(slots=True)
class Order:
    id: str
    user_id: int
    name: str
    country_code: str
    gb: str
    days: int
    amount_usd: float
    payment_method: PaymentMethod
    status: OrderStatus
    created_at: str
    payment_provider: str | None = None
    payment_ref: str | None = None
    referral_commission_usd: float = 0.0
    dent_inventory_item_id: str | None = None
    updated_at: str = ""

    def to_client_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "code": self.country_code,
            "gb": volume_from_db(self.gb),
            "days": self.days,
            "usd": self.amount_usd,
            "method": self.payment_method if self.payment_method in ("balance", "card") else "card",
            "createdAt": iso_to_ms(self.created_at) or 0,
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CountryStat:
    user_id: int
    country_name: str
    purchases: int
    last_at: str

    def to_client_dict(self) -> dict[str, int]:
        return {
            "purchases": self.purchases,
            "lastAt": iso_to_ms(self.last_at) or 0,
        }


@dataclass(slots=True)
class ReferralRelation:
    id: int
    referrer_id: int
    referred_user_id: int
    referred_at: str


@dataclass(slots=True)
class ReferralEarning:
    id: int
    referrer_id: int
    commission_usd: float
    kind: ReferralEarningKind
    created_at: str
    referred_user_id: int | None = None
    order_id: str | None = None


@dataclass(slots=True)
class BalanceTransaction:
    id: int
    user_id: int
    delta_usd: float
    balance_after: float
    kind: BalanceKind
    created_at: str
    reference_id: str | None = None
    note: str | None = None


@dataclass(slots=True)
class AccountSnapshot:
    """Full account state for API responses (except lang/theme — client cache)."""

    user: User
    esims: list[Esim]
    orders: list[Order]
    used_promos: list[str]
    country_stats: dict[str, CountryStat]
    referral_earnings: list[ReferralEarning]
    referred_users_count: int

    def to_client_dict(self) -> dict[str, Any]:
        return {
            "balanceUsd": self.user.balance,
            "esims": [e.to_client_dict() for e in self.esims],
            "orders": [o.to_client_dict() for o in self.orders],
            "usedPromos": self.used_promos,
            "countryStats": {
                name: stat.to_client_dict() for name, stat in self.country_stats.items()
            },
            "referral": {
                "code": self.user.referral_code,
                "earnedUsd": self.user.referral_earned_usd,
                "referredCount": self.referred_users_count,
            },
            "settings": {
                "email": self.user.email,
                "emailVerified": self.user.email_verified,
                "notifications": self.user.notifications.to_dict(),
            },
        }


_SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    telegram_id         INTEGER PRIMARY KEY,
    language_code       TEXT,
    balance             REAL NOT NULL DEFAULT 0,
    referral_code       TEXT NOT NULL UNIQUE,
    referred_by_id      INTEGER REFERENCES users(telegram_id) ON DELETE SET NULL,
    referral_earned_usd REAL NOT NULL DEFAULT 0,
    referral_count      INTEGER NOT NULL DEFAULT 0,
    dent_customer_uid   TEXT,
    dent_profile_url    TEXT,
    email               TEXT,
    email_verified      INTEGER NOT NULL DEFAULT 0,
    notify_news         INTEGER NOT NULL DEFAULT 1,
    notify_marketing    INTEGER NOT NULL DEFAULT 1,
    notify_traffic      INTEGER NOT NULL DEFAULT 1,
    notify_subscription INTEGER NOT NULL DEFAULT 1,
    first_opened_at     TEXT NOT NULL,
    last_opened_at      TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    is_blocked          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id                      TEXT PRIMARY KEY,
    user_id                 INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    country_code            TEXT NOT NULL,
    gb                      TEXT NOT NULL,
    days                    INTEGER NOT NULL,
    amount_usd              REAL NOT NULL,
    payment_method          TEXT NOT NULL,
    payment_provider        TEXT,
    payment_ref             TEXT,
    status                  TEXT NOT NULL DEFAULT 'paid',
    referral_commission_usd REAL NOT NULL DEFAULT 0,
    dent_inventory_item_id  TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS esims (
    id                              TEXT PRIMARY KEY,
    user_id                         INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    order_id                        TEXT REFERENCES orders(id) ON DELETE SET NULL,
    name                            TEXT NOT NULL,
    country_code                    TEXT NOT NULL,
    gb                              TEXT NOT NULL,
    days                            INTEGER NOT NULL,
    usd                             REAL NOT NULL,
    status                          TEXT NOT NULL DEFAULT 'inactive',
    iccid                           TEXT,
    imsi                            TEXT,
    msisdn                          TEXT,
    smdp_address                    TEXT,
    activation_code                 TEXT,
    apple_universal_link            TEXT,
    android_universal_link          TEXT,
    installation_url                TEXT,
    data_remaining_gb               REAL,
    data_total_gb                   REAL,
    dent_activation_uid             TEXT,
    dent_esim_uid                   TEXT,
    dent_profile_domain_key         TEXT,
    dent_customer_profile_domain_id TEXT,
    dent_esim_state                 TEXT,
    metatag                         TEXT,
    purchased_at                    TEXT NOT NULL,
    activated_at                    TEXT,
    expires_at                      TEXT,
    last_seen_at                    TEXT,
    is_active                       INTEGER NOT NULL DEFAULT 1,
    created_at                      TEXT NOT NULL,
    updated_at                      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    delta_usd     REAL NOT NULL,
    balance_after REAL NOT NULL,
    kind          TEXT NOT NULL,
    reference_id  TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
    code               TEXT PRIMARY KEY,
    credit_usd         REAL NOT NULL,
    max_uses           INTEGER,
    max_uses_per_user  INTEGER NOT NULL DEFAULT 1,
    active             INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    user_id      INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    promo_code   TEXT NOT NULL REFERENCES promo_codes(code),
    credited_usd REAL NOT NULL,
    redeemed_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, promo_code)
);

CREATE TABLE IF NOT EXISTS referral_relations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id       INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    referred_user_id  INTEGER NOT NULL UNIQUE REFERENCES users(telegram_id) ON DELETE CASCADE,
    referred_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_earnings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id      INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    referred_user_id INTEGER REFERENCES users(telegram_id) ON DELETE SET NULL,
    order_id         TEXT REFERENCES orders(id) ON DELETE SET NULL,
    commission_usd   REAL NOT NULL,
    kind             TEXT NOT NULL,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS country_stats (
    user_id      INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    country_name TEXT NOT NULL,
    purchases    INTEGER NOT NULL DEFAULT 0,
    last_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, country_name)
);

CREATE TABLE IF NOT EXISTS payment_intents (
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    kind             TEXT NOT NULL,
    amount_usd       REAL NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    plan_name        TEXT,
    country_code     TEXT,
    gb               TEXT,
    days             INTEGER,
    payment_method   TEXT,
    payment_provider TEXT,
    order_id         TEXT,
    esim_id          TEXT,
    provider_ref     TEXT,
    expires_at       TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    completed_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_id);
CREATE INDEX IF NOT EXISTS idx_esims_user_id ON esims(user_id);
CREATE INDEX IF NOT EXISTS idx_esims_iccid ON esims(iccid);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_tx_user_id ON balance_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer ON referral_earnings(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_relations_referrer ON referral_relations(referrer_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);

CREATE TABLE IF NOT EXISTS api_clients (
    telegram_id    INTEGER PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
    secret_hash    TEXT NOT NULL,
    webhook_url    TEXT,
    webhook_secret TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    message      TEXT NOT NULL,
    sent_count   INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS esim_alert_sent (
    esim_id    TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (esim_id, alert_type)
);
"""


def _row_to_user(row: sqlite3.Row) -> User:
    keys = row.keys()
    balance_col = "balance" if "balance" in keys else "balance_usd"
    return User(
        telegram_id=row["telegram_id"],
        language_code=row["language_code"],
        balance=float(row[balance_col]),
        referral_code=row["referral_code"],
        referred_by_id=row["referred_by_id"],
        referral_earned_usd=float(row["referral_earned_usd"]),
        referral_count=int(row["referral_count"]),
        dent_customer_uid=row["dent_customer_uid"],
        dent_profile_url=row["dent_profile_url"],
        first_opened_at=row["first_opened_at"],
        last_opened_at=row["last_opened_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        is_blocked=bool(row["is_blocked"]),
        email=row["email"],
        email_verified=bool(row["email_verified"]),
        notifications=NotificationPrefs.from_row(row),
    )


def _row_to_esim(row: sqlite3.Row) -> Esim:
    return Esim(
        id=row["id"],
        user_id=row["user_id"],
        order_id=row["order_id"],
        name=row["name"],
        country_code=row["country_code"],
        gb=row["gb"],
        days=row["days"],
        usd=float(row["usd"]),
        status=row["status"],
        iccid=row["iccid"],
        imsi=row["imsi"],
        msisdn=row["msisdn"],
        smdp_address=row["smdp_address"],
        activation_code=row["activation_code"],
        apple_universal_link=row["apple_universal_link"],
        android_universal_link=row["android_universal_link"],
        installation_url=row["installation_url"],
        data_remaining_gb=row["data_remaining_gb"],
        data_total_gb=row["data_total_gb"],
        dent_activation_uid=row["dent_activation_uid"],
        dent_esim_uid=row["dent_esim_uid"],
        dent_profile_domain_key=row["dent_profile_domain_key"],
        dent_customer_profile_domain_id=row["dent_customer_profile_domain_id"],
        dent_esim_state=row["dent_esim_state"],
        dent_customer_uid=row["dent_customer_uid"] if "dent_customer_uid" in row.keys() else None,
        metatag=row["metatag"],
        purchased_at=row["purchased_at"],
        activated_at=row["activated_at"],
        expires_at=row["expires_at"],
        last_seen_at=row["last_seen_at"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_payment_intent(row: sqlite3.Row) -> PaymentIntent:
    return PaymentIntent(
        id=row["id"],
        user_id=row["user_id"],
        kind=row["kind"],
        amount_usd=float(row["amount_usd"]),
        status=row["status"],
        plan_name=row["plan_name"],
        country_code=row["country_code"],
        gb=row["gb"],
        days=row["days"],
        payment_method=row["payment_method"],
        payment_provider=row["payment_provider"],
        order_id=row["order_id"],
        esim_id=row["esim_id"],
        provider_ref=row["provider_ref"] if "provider_ref" in row.keys() else None,
        expires_at=row["expires_at"],
        created_at=row["created_at"],
        completed_at=row["completed_at"],
    )


def _row_to_order(row: sqlite3.Row) -> Order:
    return Order(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        country_code=row["country_code"],
        gb=row["gb"],
        days=row["days"],
        amount_usd=float(row["amount_usd"]),
        payment_method=row["payment_method"],
        payment_provider=row["payment_provider"],
        payment_ref=row["payment_ref"],
        status=row["status"],
        referral_commission_usd=float(row["referral_commission_usd"]),
        dent_inventory_item_id=row["dent_inventory_item_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _migrate_v7(conn: sqlite3.Connection) -> None:
    """telegram_id as PK, drop profile fields, balance rename, new tables."""
    user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    if "id" not in user_cols:
        return

    id_map_rows = conn.execute("SELECT id, telegram_id FROM users").fetchall()
    id_to_tg = {int(r["id"]): int(r["telegram_id"]) for r in id_map_rows}

    def remap_user_ids(table: str) -> None:
        for old_id, tg_id in id_to_tg.items():
            conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (tg_id, old_id))

    for table in (
        "orders",
        "esims",
        "balance_transactions",
        "promo_redemptions",
        "country_stats",
        "payment_intents",
    ):
        remap_user_ids(table)

    for row in conn.execute("SELECT id, referred_by_id FROM users WHERE referred_by_id IS NOT NULL"):
        old_ref = int(row["referred_by_id"])
        if old_ref in id_to_tg:
            conn.execute(
                "UPDATE users SET referred_by_id = ? WHERE id = ?",
                (id_to_tg[old_ref], row["id"]),
            )

    for table in ("referral_relations", "referral_earnings"):
        for col in ("referrer_id", "referred_user_id"):
            for old_id, tg_id in id_to_tg.items():
                conn.execute(
                    f"UPDATE {table} SET {col} = ? WHERE {col} = ?",
                    (tg_id, old_id),
                )

    conn.executescript(
        """
        CREATE TABLE users_v7 (
            telegram_id         INTEGER PRIMARY KEY,
            language_code       TEXT,
            balance             REAL NOT NULL DEFAULT 0,
            referral_code       TEXT NOT NULL UNIQUE,
            referred_by_id      INTEGER,
            referral_earned_usd REAL NOT NULL DEFAULT 0,
            referral_count      INTEGER NOT NULL DEFAULT 0,
            dent_customer_uid   TEXT,
            dent_profile_url    TEXT,
            email               TEXT,
            email_verified      INTEGER NOT NULL DEFAULT 0,
            notify_news         INTEGER NOT NULL DEFAULT 1,
            notify_marketing    INTEGER NOT NULL DEFAULT 1,
            notify_traffic      INTEGER NOT NULL DEFAULT 1,
            notify_subscription INTEGER NOT NULL DEFAULT 1,
            first_opened_at     TEXT NOT NULL,
            last_opened_at      TEXT NOT NULL,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL,
            is_blocked          INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    balance_src = "balance_usd" if "balance_usd" in user_cols else "balance"
    conn.execute(
        f"""
        INSERT INTO users_v7 (
            telegram_id, language_code, balance, referral_code, referred_by_id,
            referral_earned_usd, referral_count, dent_customer_uid, dent_profile_url,
            email, email_verified, notify_news, notify_marketing, notify_traffic,
            notify_subscription, first_opened_at, last_opened_at, created_at, updated_at, is_blocked
        )
        SELECT
            telegram_id, language_code, {balance_src}, referral_code, referred_by_id,
            referral_earned_usd, referral_count, dent_customer_uid, dent_profile_url,
            email, email_verified,
            COALESCE(notify_news, 1),
            CASE WHEN notify_marketing IS NULL OR notify_marketing = 0 THEN 1 ELSE notify_marketing END,
            COALESCE(notify_traffic, 1),
            1,
            first_opened_at, last_opened_at, created_at, updated_at, is_blocked
        FROM users
        """
    )
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_v7 RENAME TO users")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_id)")

    conn.execute("DROP TABLE IF EXISTS popular_destinations")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS api_clients (
            telegram_id    INTEGER PRIMARY KEY,
            secret_hash    TEXT NOT NULL,
            webhook_url    TEXT,
            webhook_secret TEXT,
            is_active      INTEGER NOT NULL DEFAULT 1,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS broadcasts (
            id           TEXT PRIMARY KEY,
            kind         TEXT NOT NULL,
            message      TEXT NOT NULL,
            sent_count   INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS esim_alert_sent (
            esim_id    TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            sent_at    TEXT NOT NULL,
            PRIMARY KEY (esim_id, alert_type)
        );
        """
    )

    user_cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    if "notify_subscription" not in user_cols:
        conn.execute(
            "ALTER TABLE users ADD COLUMN notify_subscription INTEGER NOT NULL DEFAULT 1"
        )


class Database:
    """Thread-safe SQLite access layer for esimker."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        env_path = os.getenv("DB_PATH", "").strip() or None
        raw = db_path if db_path is not None else env_path
        self.db_path = resolve_db_path(raw, root=ROOT_DIR)
        self._local = threading.local()

    @classmethod
    def default(cls) -> Database:
        return cls()

    def connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA busy_timeout = 5000")
            self._local.conn = conn
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def init(self) -> None:
        """Create schema, run migrations, seed defaults."""
        with self.transaction() as conn:
            conn.executescript(_SCHEMA_SQL)
            version_row = conn.execute(
                "SELECT MAX(version) AS v FROM schema_migrations"
            ).fetchone()
            current = int(version_row["v"] or 0)
            if current < SCHEMA_VERSION:
                _legacy_popular = (
                    "Turkey", "Thailand", "United Arab Emirates", "Georgia", "Egypt",
                    "Armenia", "Kazakhstan", "China", "Indonesia", "Vietnam",
                )
                if current < 3:
                    tables = {
                        r["name"]
                        for r in conn.execute(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    }
                    if "popular_destinations" in tables:
                        for i, name in enumerate(_legacy_popular):
                            conn.execute(
                                """
                                INSERT INTO popular_destinations (country_name, sort_order)
                                VALUES (?, ?)
                                ON CONFLICT(country_name) DO NOTHING
                                """,
                                (name, i),
                            )
                if current < 4:
                    cols = {r["name"] for r in conn.execute("PRAGMA table_info(payment_intents)")}
                    if "provider_ref" not in cols:
                        conn.execute(
                            "ALTER TABLE payment_intents ADD COLUMN provider_ref TEXT"
                        )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_ref "
                        "ON payment_intents(provider_ref)"
                    )
                if current < 5:
                    esim_cols = {r["name"] for r in conn.execute("PRAGMA table_info(esims)")}
                    if "dent_customer_uid" not in esim_cols:
                        conn.execute("ALTER TABLE esims ADD COLUMN dent_customer_uid TEXT")
                if current < 6:
                    conn.execute(
                        "DELETE FROM promo_redemptions "
                        "WHERE promo_code IN ('WELCOME300', 'ESIM500')"
                    )
                    conn.execute(
                        "DELETE FROM promo_codes WHERE code IN ('WELCOME300', 'ESIM500')"
                    )
                if current < 7:
                    _migrate_v7(conn)
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, isoformat()),
                )

    # --- Users ---

    def touch_user(
        self,
        telegram_id: int,
        *,
        language_code: str | None = None,
        referral_code_from_link: str | None = None,
    ) -> User:
        """Register or update a user on miniapp open; bumps ``last_opened_at``."""
        telegram_id = validate_telegram_id(telegram_id)
        language_code = optional_text(language_code, max_len=16, field="language_code")
        if referral_code_from_link:
            referral_code_from_link = validate_referral_code(referral_code_from_link)
        now = isoformat()
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE telegram_id = ?",
                (telegram_id,),
            ).fetchone()

            if row:
                conn.execute(
                    """
                    UPDATE users SET
                        language_code = COALESCE(?, language_code),
                        last_opened_at = ?,
                        updated_at = ?
                    WHERE telegram_id = ?
                    """,
                    (language_code, now, now, telegram_id),
                )
                user = self.get_user(telegram_id, conn=conn)
                assert user is not None
                if referral_code_from_link and user.referred_by_id is None:
                    self._attach_referrer(user.telegram_id, referral_code_from_link, conn=conn)
                    user = self.get_user(telegram_id, conn=conn)
                if user.is_blocked:
                    raise SecurityError("account blocked")
                return user

            referral_code = self._unique_referral_code(conn)
            conn.execute(
                """
                INSERT INTO users (
                    telegram_id, language_code,
                    referral_code, first_opened_at, last_opened_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    telegram_id,
                    language_code,
                    referral_code,
                    now,
                    now,
                    now,
                    now,
                ),
            )
            user = self.get_user(telegram_id, conn=conn)
            assert user is not None

            if referral_code_from_link:
                self._attach_referrer(user.telegram_id, referral_code_from_link, conn=conn)
                user = self.get_user(telegram_id, conn=conn)
            if user.is_blocked:
                raise SecurityError("account blocked")
            return user

    def get_user(
        self,
        telegram_id: int,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> User | None:
        telegram_id = validate_telegram_id(telegram_id)
        db = conn or self.connect()
        row = db.execute(
            "SELECT * FROM users WHERE telegram_id = ?",
            (telegram_id,),
        ).fetchone()
        return _row_to_user(row) if row else None

    def get_user_by_telegram_id(
        self,
        telegram_id: int,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> User | None:
        return self.get_user(telegram_id, conn=conn)

    def get_user_by_id(
        self,
        user_id: int,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> User | None:
        """Alias: user_id is telegram_id."""
        return self.get_user(user_id, conn=conn)

    def get_user_by_referral_code(self, code: str) -> User | None:
        code = validate_referral_code(code)
        row = self.connect().execute(
            "SELECT * FROM users WHERE referral_code = ?",
            (code,),
        ).fetchone()
        return _row_to_user(row) if row else None

    def update_user_settings(
        self,
        telegram_id: int,
        *,
        email: str | None = None,
        email_verified: bool | None = None,
        notifications: NotificationPrefs | None = None,
        dent_customer_uid: str | None = None,
        dent_profile_url: str | None = None,
    ) -> User:
        fields: list[str] = []
        values: list[Any] = []

        if email is not None:
            fields.append("email = ?")
            values.append(validate_email(email) if email else None)
        if email_verified is not None:
            fields.append("email_verified = ?")
            values.append(int(email_verified))
        if notifications is not None:
            fields.extend(
                [
                    "notify_news = ?",
                    "notify_marketing = ?",
                    "notify_traffic = ?",
                    "notify_subscription = ?",
                ]
            )
            values.extend(
                [
                    int(notifications.news),
                    int(notifications.marketing),
                    int(notifications.traffic),
                    int(notifications.subscription),
                ]
            )
        if dent_customer_uid is not None:
            fields.append("dent_customer_uid = ?")
            values.append(optional_text(dent_customer_uid, max_len=128, field="dent_customer_uid"))
        if dent_profile_url is not None:
            fields.append("dent_profile_url = ?")
            values.append(optional_text(dent_profile_url, max_len=512, field="dent_profile_url"))

        if not fields:
            user = self.get_user(telegram_id)
            if user is None:
                raise NotFoundError(f"user {telegram_id} not found")
            return user

        now = isoformat()
        fields.append("updated_at = ?")
        values.append(now)
        values.append(telegram_id)

        with self.transaction() as conn:
            cur = conn.execute(
                f"UPDATE users SET {', '.join(fields)} WHERE telegram_id = ?",
                values,
            )
            if cur.rowcount == 0:
                raise NotFoundError(f"user {telegram_id} not found")
        user = self.get_user(telegram_id)
        assert user is not None
        return user

    def unlink_email(self, telegram_id: int) -> User:
        return self.update_user_settings(
            telegram_id,
            email=None,
            email_verified=False,
        )

    # --- Balance ---

    def adjust_balance(
        self,
        user_id: int,
        delta_usd: float,
        *,
        kind: BalanceKind,
        reference_id: str | None = None,
        note: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> float:
        """Credit or debit balance; returns new balance."""
        kind = validate_balance_kind(kind)
        if reference_id is not None:
            reference_id = optional_text(reference_id, max_len=128, field="reference_id")
        if note is not None:
            note = optional_text(note, max_len=256, field="note")
        delta_usd = validate_money(delta_usd, field="amount", min_value=-MAX_TOPUP, max_value=MAX_TOPUP)
        if conn is None:
            with self.transaction() as tx:
                return self.adjust_balance(
                    user_id,
                    delta_usd,
                    kind=kind,
                    reference_id=reference_id,
                    note=note,
                    conn=tx,
                )

        row = conn.execute(
            "SELECT balance FROM users WHERE telegram_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError(f"user {user_id} not found")

        current = float(row["balance"])
        new_balance = round(current + delta_usd, 2)
        if new_balance < -1e-9:
            raise InsufficientBalanceError(
                f"insufficient balance: have {current:.2f}, need {-delta_usd:.2f}"
            )

        now = isoformat()
        conn.execute(
            "UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?",
            (new_balance, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO balance_transactions
                (user_id, delta_usd, balance_after, kind, reference_id, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, delta_usd, new_balance, kind, reference_id, note, now),
        )
        return new_balance

    def top_up(self, user_id: int, amount_usd: float, *, reference_id: str | None = None) -> float:
        amount_usd = validate_money(amount_usd, field="amount", max_value=MAX_TOPUP)
        return self.adjust_balance(
            user_id,
            amount_usd,
            kind="topup",
            reference_id=reference_id,
        )

    def list_balance_transactions(
        self,
        user_id: int,
        *,
        limit: int = 50,
    ) -> list[BalanceTransaction]:
        rows = self.connect().execute(
            """
            SELECT * FROM balance_transactions
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [
            BalanceTransaction(
                id=r["id"],
                user_id=r["user_id"],
                delta_usd=float(r["delta_usd"]),
                balance_after=float(r["balance_after"]),
                kind=r["kind"],
                reference_id=r["reference_id"],
                note=r["note"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    # --- Promos ---

    def redeem_promo(self, user_id: int, code: str) -> Literal["ok", "invalid", "used"]:
        try:
            key = validate_promo_code(code)
        except SecurityError:
            return "invalid"
        with self.transaction() as conn:
            promo = conn.execute(
                "SELECT * FROM promo_codes WHERE code = ? AND active = 1",
                (key,),
            ).fetchone()
            if promo is None:
                return "invalid"

            existing = conn.execute(
                "SELECT 1 FROM promo_redemptions WHERE user_id = ? AND promo_code = ?",
                (user_id, key),
            ).fetchone()
            if existing:
                return "used"

            if promo["max_uses"] is not None:
                total = conn.execute(
                    "SELECT COUNT(*) AS c FROM promo_redemptions WHERE promo_code = ?",
                    (key,),
                ).fetchone()["c"]
                if int(total) >= int(promo["max_uses"]):
                    return "invalid"

            credit = float(promo["credit_usd"])
            now = isoformat()
            conn.execute(
                """
                INSERT INTO promo_redemptions (user_id, promo_code, credited_usd, redeemed_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, key, credit, now),
            )
            self.adjust_balance(
                user_id,
                credit,
                kind="promo",
                reference_id=key,
                conn=conn,
            )
        return "ok"

    def list_used_promos(self, user_id: int) -> list[str]:
        rows = self.connect().execute(
            "SELECT promo_code FROM promo_redemptions WHERE user_id = ? ORDER BY redeemed_at",
            (user_id,),
        ).fetchall()
        return [r["promo_code"] for r in rows]

    # --- Orders & eSIMs ---

    def create_order(
        self,
        *,
        order_id: str,
        user_id: int,
        name: str,
        country_code: str,
        gb: int | float | str,
        days: int,
        amount_usd: float,
        payment_method: PaymentMethod,
        status: OrderStatus = "paid",
        payment_provider: str | None = None,
        payment_ref: str | None = None,
        dent_inventory_item_id: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> Order:
        order_id = validate_record_id(order_id, field="order_id")
        name = validate_country_name(name)
        country_code = validate_country_code(country_code)
        days = validate_days(days)
        amount_usd = validate_money(amount_usd, field="amount")
        payment_method = validate_payment_method(payment_method)
        if status not in ORDER_STATUSES:
            raise SecurityError("invalid order status")
        if payment_provider is not None:
            payment_provider = optional_text(payment_provider, max_len=64, field="payment_provider")
        if payment_ref is not None:
            payment_ref = optional_text(payment_ref, max_len=128, field="payment_ref")
        if dent_inventory_item_id is not None:
            dent_inventory_item_id = optional_text(
                dent_inventory_item_id, max_len=128, field="dent_inventory_item_id"
            )
        now = isoformat()
        gb_value = volume_to_db(gb)

        def _insert(db: sqlite3.Connection) -> Order:
            db.execute(
                """
                INSERT INTO orders (
                    id, user_id, name, country_code, gb, days, amount_usd,
                    payment_method, payment_provider, payment_ref, status,
                    dent_inventory_item_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    user_id,
                    name,
                    country_code,
                    gb_value,
                    days,
                    amount_usd,
                    payment_method,
                    payment_provider,
                    payment_ref,
                    status,
                    dent_inventory_item_id,
                    now,
                    now,
                ),
            )
            row = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            return _row_to_order(row)

        if conn is not None:
            return _insert(conn)
        with self.transaction() as tx:
            return _insert(tx)

    def create_esim(
        self,
        *,
        esim_id: str,
        user_id: int,
        name: str,
        country_code: str,
        gb: int | float | str,
        days: int,
        usd: float,
        status: EsimStatus = "inactive",
        order_id: str | None = None,
        iccid: str | None = None,
        imsi: str | None = None,
        msisdn: str | None = None,
        smdp_address: str | None = None,
        activation_code: str | None = None,
        apple_universal_link: str | None = None,
        android_universal_link: str | None = None,
        installation_url: str | None = None,
        data_remaining_gb: float | None = None,
        data_total_gb: float | None = None,
        dent_activation_uid: str | None = None,
        dent_esim_uid: str | None = None,
        dent_profile_domain_key: str | None = None,
        dent_customer_profile_domain_id: str | None = None,
        dent_esim_state: str | None = None,
        dent_customer_uid: str | None = None,
        metatag: str | None = None,
        purchased_at: str | None = None,
        activated_at: str | None = None,
        expires_at: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> Esim:
        esim_id = validate_record_id(esim_id, field="esim_id")
        name = validate_country_name(name)
        country_code = validate_country_code(country_code)
        days = validate_days(days)
        usd = validate_money(usd, field="amount")
        if status not in ESIM_STATUSES:
            raise SecurityError("invalid esim status")
        if order_id is not None:
            order_id = validate_record_id(order_id, field="order_id")
        iccid = optional_text(iccid, max_len=32, field="iccid") if iccid is not None else None
        imsi = optional_text(imsi, max_len=32, field="imsi") if imsi is not None else None
        msisdn = optional_text(msisdn, max_len=32, field="msisdn") if msisdn is not None else None
        smdp_address = (
            optional_text(smdp_address, max_len=256, field="smdp_address")
            if smdp_address is not None
            else None
        )
        activation_code = (
            optional_text(activation_code, max_len=128, field="activation_code")
            if activation_code is not None
            else None
        )
        apple_universal_link = (
            optional_text(apple_universal_link, max_len=512, field="apple_universal_link")
            if apple_universal_link is not None
            else None
        )
        android_universal_link = (
            optional_text(android_universal_link, max_len=512, field="android_universal_link")
            if android_universal_link is not None
            else None
        )
        installation_url = (
            optional_text(installation_url, max_len=512, field="installation_url")
            if installation_url is not None
            else None
        )
        dent_activation_uid = (
            optional_text(dent_activation_uid, max_len=128, field="dent_activation_uid")
            if dent_activation_uid is not None
            else None
        )
        dent_esim_uid = (
            optional_text(dent_esim_uid, max_len=128, field="dent_esim_uid")
            if dent_esim_uid is not None
            else None
        )
        dent_profile_domain_key = (
            optional_text(dent_profile_domain_key, max_len=128, field="dent_profile_domain_key")
            if dent_profile_domain_key is not None
            else None
        )
        dent_customer_profile_domain_id = (
            optional_text(
                dent_customer_profile_domain_id,
                max_len=128,
                field="dent_customer_profile_domain_id",
            )
            if dent_customer_profile_domain_id is not None
            else None
        )
        dent_esim_state = (
            optional_text(dent_esim_state, max_len=64, field="dent_esim_state")
            if dent_esim_state is not None
            else None
        )
        dent_customer_uid = (
            optional_text(dent_customer_uid, max_len=128, field="dent_customer_uid")
            if dent_customer_uid is not None
            else None
        )
        metatag = optional_text(metatag, max_len=255, field="metatag") if metatag is not None else None
        now = isoformat()
        purchased = purchased_at or now
        gb_value = volume_to_db(gb)

        def _insert(db: sqlite3.Connection) -> Esim:
            db.execute(
                """
                INSERT INTO esims (
                    id, user_id, order_id, name, country_code, gb, days, usd, status,
                    iccid, imsi, msisdn, smdp_address, activation_code,
                    apple_universal_link, android_universal_link, installation_url,
                    data_remaining_gb, data_total_gb,
                    dent_activation_uid, dent_esim_uid, dent_profile_domain_key,
                    dent_customer_profile_domain_id, dent_esim_state, dent_customer_uid,
                    metatag, purchased_at, activated_at, expires_at,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?
                )
                """,
                (
                    esim_id,
                    user_id,
                    order_id,
                    name,
                    country_code,
                    gb_value,
                    days,
                    usd,
                    status,
                    iccid,
                    imsi,
                    msisdn,
                    smdp_address,
                    activation_code,
                    apple_universal_link,
                    android_universal_link,
                    installation_url,
                    data_remaining_gb,
                    data_total_gb,
                    dent_activation_uid,
                    dent_esim_uid,
                    dent_profile_domain_key,
                    dent_customer_profile_domain_id,
                    dent_esim_state,
                    dent_customer_uid,
                    metatag,
                    purchased,
                    activated_at,
                    expires_at,
                    now,
                    now,
                ),
            )
            row = db.execute("SELECT * FROM esims WHERE id = ?", (esim_id,)).fetchone()
            return _row_to_esim(row)

        if conn is not None:
            return _insert(conn)
        with self.transaction() as tx:
            return _insert(tx)

    def update_esim(self, esim_id: str, **fields: Any) -> Esim:
        allowed = {
            "status",
            "iccid",
            "imsi",
            "msisdn",
            "smdp_address",
            "activation_code",
            "apple_universal_link",
            "android_universal_link",
            "installation_url",
            "data_remaining_gb",
            "data_total_gb",
            "dent_activation_uid",
            "dent_esim_uid",
            "dent_profile_domain_key",
            "dent_customer_profile_domain_id",
            "dent_esim_state",
            "dent_customer_uid",
            "metatag",
            "activated_at",
            "expires_at",
            "last_seen_at",
            "is_active",
        }
        updates: list[str] = []
        values: list[Any] = []
        for key, value in fields.items():
            if key not in allowed:
                raise SecurityError(f"unknown esim field: {key}")
            updates.append(f"{key} = ?")
            if key == "is_active":
                values.append(int(bool(value)))
            elif value is None:
                values.append(None)
            elif key in {"data_remaining_gb", "data_total_gb"}:
                values.append(float(value))
            else:
                values.append(optional_text(value, max_len=512, field=key))

        if not updates:
            esim = self.get_esim(esim_id)
            if esim is None:
                raise NotFoundError(f"esim {esim_id} not found")
            return esim

        now = isoformat()
        updates.append("updated_at = ?")
        values.extend([now, esim_id])

        with self.transaction() as conn:
            cur = conn.execute(
                f"UPDATE esims SET {', '.join(updates)} WHERE id = ?",
                values,
            )
            if cur.rowcount == 0:
                raise NotFoundError(f"esim {esim_id} not found")
        esim = self.get_esim(esim_id)
        assert esim is not None
        return esim

    def get_esim(self, esim_id: str) -> Esim | None:
        esim_id = validate_record_id(esim_id, field="esim_id")
        row = self.connect().execute(
            "SELECT * FROM esims WHERE id = ?",
            (esim_id,),
        ).fetchone()
        return _row_to_esim(row) if row else None

    def get_esim_by_iccid(self, iccid: str) -> Esim | None:
        row = self.connect().execute(
            "SELECT * FROM esims WHERE iccid = ?",
            (iccid,),
        ).fetchone()
        return _row_to_esim(row) if row else None

    def list_esims(self, user_id: int, *, active_only: bool = True) -> list[Esim]:
        query = "SELECT * FROM esims WHERE user_id = ?"
        params: list[Any] = [user_id]
        if active_only:
            query += " AND is_active = 1"
        query += " ORDER BY purchased_at DESC"
        rows = self.connect().execute(query, params).fetchall()
        return [_row_to_esim(r) for r in rows]

    def find_dent_topup_esim(self, user_id: int, country_code: str) -> Esim | None:
        """Latest eSIM profile for the same country set, used for DENT top-ups."""
        code = validate_country_code(country_code)
        row = self.connect().execute(
            """
            SELECT * FROM esims
            WHERE user_id = ? AND country_code = ?
              AND iccid IS NOT NULL AND iccid != ''
            ORDER BY purchased_at DESC
            LIMIT 1
            """,
            (user_id, code),
        ).fetchone()
        return _row_to_esim(row) if row else None

    def list_orders(self, user_id: int, *, limit: int = 100) -> list[Order]:
        rows = self.connect().execute(
            """
            SELECT * FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [_row_to_order(r) for r in rows]

    def purchase_from_balance(
        self,
        *,
        user_id: int,
        order_id: str,
        esim_id: str,
        name: str,
        country_code: str,
        gb: int | float | str,
        days: int,
        amount_usd: float,
        country_name_for_stats: str | None = None,
        esim_fields: dict[str, Any] | None = None,
        dent_inventory_item_id: str | None = None,
    ) -> tuple[Order, Esim]:
        """Atomic purchase: debit balance, create order + eSIM, bump country stats."""
        with self.transaction() as conn:
            discount = self.referral_friend_discount_rate(user_id, conn=conn)
            effective = round(amount_usd * (1.0 - discount), 2)
            self.adjust_balance(
                user_id,
                -effective,
                kind="purchase",
                reference_id=order_id,
                conn=conn,
            )
            order = self.create_order(
                order_id=order_id,
                user_id=user_id,
                name=name,
                country_code=country_code,
                gb=gb,
                days=days,
                amount_usd=effective,
                payment_method="balance",
                status="paid",
                dent_inventory_item_id=dent_inventory_item_id,
                conn=conn,
            )
            esim = self.create_esim(
                esim_id=esim_id,
                user_id=user_id,
                order_id=order_id,
                name=name,
                country_code=country_code,
                gb=gb,
                days=days,
                usd=effective,
                conn=conn,
                **(esim_fields or {}),
            )
            if country_name_for_stats:
                self.touch_country(
                    user_id,
                    country_name_for_stats,
                    purchased=True,
                    conn=conn,
                )
            self._apply_referral_commission(user_id, order_id, effective, conn=conn)
        return order, esim

    def purchase_external(
        self,
        *,
        user_id: int,
        order_id: str,
        esim_id: str,
        name: str,
        country_code: str,
        gb: int | float | str,
        days: int,
        amount_usd: float,
        payment_method: PaymentMethod = "card",
        payment_provider: str | None = None,
        payment_ref: str | None = None,
        country_name_for_stats: str | None = None,
        esim_fields: dict[str, Any] | None = None,
        dent_inventory_item_id: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> tuple[Order, Esim]:
        def _run(db: sqlite3.Connection) -> tuple[Order, Esim]:
            order = self.create_order(
                order_id=order_id,
                user_id=user_id,
                name=name,
                country_code=country_code,
                gb=gb,
                days=days,
                amount_usd=amount_usd,
                payment_method=payment_method,
                payment_provider=payment_provider,
                payment_ref=payment_ref,
                status="paid",
                dent_inventory_item_id=dent_inventory_item_id,
                conn=db,
            )
            esim = self.create_esim(
                esim_id=esim_id,
                user_id=user_id,
                order_id=order_id,
                name=name,
                country_code=country_code,
                gb=gb,
                days=days,
                usd=amount_usd,
                conn=db,
                **(esim_fields or {}),
            )
            if country_name_for_stats:
                self.touch_country(
                    user_id,
                    country_name_for_stats,
                    purchased=True,
                    conn=db,
                )
            self._apply_referral_commission(user_id, order_id, amount_usd, conn=db)
            return order, esim

        if conn is not None:
            return _run(conn)
        with self.transaction() as tx:
            return _run(tx)

    # --- Country stats ---

    def touch_country(
        self,
        user_id: int,
        country_name: str,
        *,
        purchased: bool = False,
        conn: sqlite3.Connection | None = None,
    ) -> CountryStat:
        country_name = validate_country_name(country_name)
        now = isoformat()

        def _upsert(db: sqlite3.Connection) -> CountryStat:
            row = db.execute(
                """
                SELECT * FROM country_stats
                WHERE user_id = ? AND country_name = ?
                """,
                (user_id, country_name),
            ).fetchone()
            if row:
                purchases = int(row["purchases"]) + (1 if purchased else 0)
                db.execute(
                    """
                    UPDATE country_stats SET purchases = ?, last_at = ?
                    WHERE user_id = ? AND country_name = ?
                    """,
                    (purchases, now, user_id, country_name),
                )
            else:
                purchases = 1 if purchased else 0
                db.execute(
                    """
                    INSERT INTO country_stats (user_id, country_name, purchases, last_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (user_id, country_name, purchases, now),
                )
            return CountryStat(
                user_id=user_id,
                country_name=country_name,
                purchases=purchases,
                last_at=now,
            )

        if conn is not None:
            return _upsert(conn)
        with self.transaction() as tx:
            return _upsert(tx)

    def list_country_stats(self, user_id: int) -> dict[str, CountryStat]:
        rows = self.connect().execute(
            "SELECT * FROM country_stats WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {
            r["country_name"]: CountryStat(
                user_id=r["user_id"],
                country_name=r["country_name"],
                purchases=int(r["purchases"]),
                last_at=r["last_at"],
            )
            for r in rows
        }

    def list_popular_destinations(self) -> list[str]:
        rows = self.connect().execute(
            """
            SELECT name, COUNT(*) AS cnt
            FROM orders
            WHERE status = 'paid'
            GROUP BY name
            ORDER BY cnt DESC, name ASC
            LIMIT 10
            """
        ).fetchall()
        if rows:
            return [r["name"] for r in rows]
        return [
            "Turkey",
            "Thailand",
            "United Arab Emirates",
            "Georgia",
            "Egypt",
            "Armenia",
            "Kazakhstan",
            "China",
            "Indonesia",
            "Vietnam",
        ]

    # --- Referrals ---

    def referral_friend_discount_rate(
        self,
        user_id: int,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> float:
        """10% off first paid order for users who joined via referral link."""

        def _rate(db: sqlite3.Connection) -> float:
            row = db.execute(
                "SELECT referred_by_id FROM users WHERE telegram_id = ?",
                (user_id,),
            ).fetchone()
            if row is None or row["referred_by_id"] is None:
                return 0.0
            paid = db.execute(
                "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'paid'",
                (user_id,),
            ).fetchone()
            if paid is None or int(paid["c"]) > 0:
                return 0.0
            return REFERRAL_FRIEND_DISCOUNT_RATE

        if conn is not None:
            return _rate(conn)
        return _rate(self.connect())

    def _apply_referral_commission(
        self,
        buyer_id: int,
        order_id: str,
        amount_usd: float,
        *,
        conn: sqlite3.Connection,
    ) -> None:
        row = conn.execute(
            "SELECT referred_by_id FROM users WHERE telegram_id = ?",
            (buyer_id,),
        ).fetchone()
        if row is None or row["referred_by_id"] is None:
            return
        referrer_id = int(row["referred_by_id"])
        commission = round(float(amount_usd) * REFERRAL_COMMISSION_RATE, 2)
        if commission < 0.01:
            return
        conn.execute(
            "UPDATE orders SET referral_commission_usd = ? WHERE id = ?",
            (commission, order_id),
        )
        self._record_referral_earning(
            referrer_id,
            commission,
            kind="purchase",
            referred_user_id=buyer_id,
            order_id=order_id,
            conn=conn,
        )

    def record_referral_earning(
        self,
        referrer_id: int,
        commission_usd: float,
        *,
        kind: ReferralEarningKind,
        referred_user_id: int | None = None,
        order_id: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> ReferralEarning:
        if conn is not None:
            return self._record_referral_earning(
                referrer_id,
                commission_usd,
                kind=kind,
                referred_user_id=referred_user_id,
                order_id=order_id,
                conn=conn,
            )
        with self.transaction() as tx:
            return self._record_referral_earning(
                referrer_id,
                commission_usd,
                kind=kind,
                referred_user_id=referred_user_id,
                order_id=order_id,
                conn=tx,
            )

    def _record_referral_earning(
        self,
        referrer_id: int,
        commission_usd: float,
        *,
        kind: ReferralEarningKind,
        referred_user_id: int | None = None,
        order_id: str | None = None,
        conn: sqlite3.Connection,
    ) -> ReferralEarning:
        now = isoformat()
        conn.execute(
            """
            INSERT INTO referral_earnings
                (referrer_id, referred_user_id, order_id, commission_usd, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (referrer_id, referred_user_id, order_id, commission_usd, kind, now),
        )
        conn.execute(
            """
            UPDATE users SET
                referral_earned_usd = referral_earned_usd + ?,
                updated_at = ?
            WHERE telegram_id = ?
            """,
            (commission_usd, now, referrer_id),
        )
        self.adjust_balance(
            referrer_id,
            commission_usd,
            kind="referral",
            reference_id=order_id,
            note=kind,
            conn=conn,
        )
        row_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        return ReferralEarning(
            id=row_id,
            referrer_id=referrer_id,
            referred_user_id=referred_user_id,
            order_id=order_id,
            commission_usd=commission_usd,
            kind=kind,
            created_at=now,
        )

    def list_referral_earnings(self, referrer_id: int, *, limit: int = 50) -> list[ReferralEarning]:
        rows = self.connect().execute(
            """
            SELECT * FROM referral_earnings
            WHERE referrer_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (referrer_id, limit),
        ).fetchall()
        return [
            ReferralEarning(
                id=r["id"],
                referrer_id=r["referrer_id"],
                referred_user_id=r["referred_user_id"],
                order_id=r["order_id"],
                commission_usd=float(r["commission_usd"]),
                kind=r["kind"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    def list_referred_users(self, referrer_id: int) -> list[ReferralRelation]:
        rows = self.connect().execute(
            """
            SELECT * FROM referral_relations
            WHERE referrer_id = ?
            ORDER BY referred_at DESC
            """,
            (referrer_id,),
        ).fetchall()
        return [
            ReferralRelation(
                id=r["id"],
                referrer_id=r["referrer_id"],
                referred_user_id=r["referred_user_id"],
                referred_at=r["referred_at"],
            )
            for r in rows
        ]

    def get_referrer(self, user_id: int) -> User | None:
        row = self.connect().execute(
            "SELECT referred_by_id FROM users WHERE telegram_id = ?",
            (user_id,),
        ).fetchone()
        if not row or row["referred_by_id"] is None:
            return None
        return self.get_user(int(row["referred_by_id"]))

    # --- Aggregates ---

    def get_account_snapshot(self, user_id: int) -> AccountSnapshot:
        user = self.get_user_by_id(user_id)
        if user is None:
            raise NotFoundError(f"user {user_id} not found")
        return AccountSnapshot(
            user=user,
            esims=self.list_esims(user_id),
            orders=self.list_orders(user_id),
            used_promos=self.list_used_promos(user_id),
            country_stats=self.list_country_stats(user_id),
            referral_earnings=self.list_referral_earnings(user_id),
            referred_users_count=len(self.list_referred_users(user_id)),
        )

    def export_user_json(self, user_id: int) -> str:
        snapshot = self.get_account_snapshot(user_id)
        payload = {
            "user": snapshot.user.to_dict(),
            "account": snapshot.to_client_dict(),
            "referralEarnings": [asdict(e) for e in snapshot.referral_earnings],
            "referredUsers": [asdict(r) for r in self.list_referred_users(user_id)],
            "balanceTransactions": [
                asdict(t) for t in self.list_balance_transactions(user_id, limit=200)
            ],
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    # --- Internal helpers ---

    def _unique_referral_code(self, conn: sqlite3.Connection) -> str:
        for _ in range(32):
            code = generate_referral_code()
            exists = conn.execute(
                "SELECT 1 FROM users WHERE referral_code = ?",
                (code,),
            ).fetchone()
            if not exists:
                return code
        raise DatabaseError("failed to generate unique referral code")

    def _attach_referrer(
        self,
        user_id: int,
        referral_code: str,
        *,
        conn: sqlite3.Connection,
    ) -> None:
        code = referral_code.strip().upper()
        referrer_row = conn.execute(
            "SELECT telegram_id FROM users WHERE referral_code = ?",
            (code,),
        ).fetchone()
        if referrer_row is None:
            return
        referrer_id = int(referrer_row["telegram_id"])
        if referrer_id == user_id:
            return

        user_row = conn.execute(
            "SELECT referred_by_id FROM users WHERE telegram_id = ?",
            (user_id,),
        ).fetchone()
        if user_row is None or user_row["referred_by_id"] is not None:
            return

        now = isoformat()
        conn.execute(
            "UPDATE users SET referred_by_id = ?, updated_at = ? WHERE telegram_id = ?",
            (referrer_id, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO referral_relations (referrer_id, referred_user_id, referred_at)
            VALUES (?, ?, ?)
            """,
            (referrer_id, user_id, now),
        )
        conn.execute(
            "UPDATE users SET referral_count = referral_count + 1, updated_at = ? WHERE telegram_id = ?",
            (now, referrer_id),
        )

    # --- Payment intents ---

    def _payment_intent_expires_at(self) -> str:
        return isoformat(utc_now() + timedelta(minutes=PAYMENT_INTENT_TTL_MINUTES))

    def _ensure_payment_intent_active(self, intent: PaymentIntent) -> PaymentIntent:
        if intent.status != "pending":
            return intent
        if parse_iso(intent.expires_at) and parse_iso(intent.expires_at) < utc_now():
            with self.transaction() as conn:
                conn.execute(
                    "UPDATE payment_intents SET status = 'expired' WHERE id = ? AND status = 'pending'",
                    (intent.id,),
                )
            intent.status = "expired"
        return intent

    def create_payment_intent_topup(self, user_id: int, amount_usd: float) -> PaymentIntent:
        from core.catalog import validate_topup_amount

        amount_usd = validate_topup_amount(amount_usd)
        intent_id = secrets.token_hex(8)
        now = isoformat()
        expires = self._payment_intent_expires_at()
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO payment_intents (
                    id, user_id, kind, amount_usd, status, expires_at, created_at
                ) VALUES (?, ?, 'topup', ?, 'pending', ?, ?)
                """,
                (intent_id, user_id, amount_usd, expires, now),
            )
            row = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ?",
                (intent_id,),
            ).fetchone()
        return _row_to_payment_intent(row)

    def create_payment_intent_purchase(
        self,
        user_id: int,
        *,
        plan_name: str,
        country_code: str,
        gb: str,
        days: int,
        amount_usd: float,
    ) -> PaymentIntent:
        intent_id = secrets.token_hex(8)
        now = isoformat()
        expires = self._payment_intent_expires_at()
        amount_usd = validate_money(amount_usd, field="amount")
        with self.transaction() as conn:
            discount = self.referral_friend_discount_rate(user_id, conn=conn)
            if discount > 0:
                amount_usd = round(amount_usd * (1.0 - discount), 2)
            conn.execute(
                """
                INSERT INTO payment_intents (
                    id, user_id, kind, amount_usd, status,
                    plan_name, country_code, gb, days,
                    expires_at, created_at
                ) VALUES (?, ?, 'purchase', ?, 'pending', ?, ?, ?, ?, ?, ?)
                """,
                (
                    intent_id,
                    user_id,
                    amount_usd,
                    plan_name,
                    country_code,
                    gb,
                    days,
                    expires,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ?",
                (intent_id,),
            ).fetchone()
        return _row_to_payment_intent(row)

    def get_payment_intent(self, intent_id: str, user_id: int) -> PaymentIntent:
        intent_id = validate_record_id(intent_id, field="payment id")
        row = self.connect().execute(
            "SELECT * FROM payment_intents WHERE id = ? AND user_id = ?",
            (intent_id, user_id),
        ).fetchone()
        if row is None:
            raise NotFoundError("payment not found")
        return self._ensure_payment_intent_active(_row_to_payment_intent(row))

    def get_payment_intent_by_provider_ref(self, provider_ref: str) -> PaymentIntent | None:
        provider_ref = optional_text(provider_ref, max_len=128, field="provider ref")
        if not provider_ref:
            return None
        row = self.connect().execute(
            "SELECT * FROM payment_intents WHERE provider_ref = ?",
            (provider_ref,),
        ).fetchone()
        if row is None:
            return None
        return self._ensure_payment_intent_active(_row_to_payment_intent(row))

    def bind_payment_intent_provider(
        self,
        intent_id: str,
        user_id: int,
        *,
        provider_ref: str,
        payment_method: str,
        payment_provider: str,
    ) -> PaymentIntent:
        intent_id = validate_record_id(intent_id, field="payment id")
        provider_ref = optional_text(provider_ref, max_len=128, field="provider ref")
        if not provider_ref:
            raise SecurityError("provider ref is required")
        payment_method = validate_payment_method(payment_method)
        payment_provider = optional_text(payment_provider, max_len=64, field="payment_provider")
        if not payment_provider:
            raise SecurityError("payment provider is required")
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ? AND user_id = ?",
                (intent_id, user_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("payment not found")
            intent = self._ensure_payment_intent_active(_row_to_payment_intent(row))
            if intent.status != "pending":
                raise ConflictError("payment is not pending")
            conn.execute(
                """
                UPDATE payment_intents SET
                    provider_ref = ?,
                    payment_method = ?,
                    payment_provider = ?
                WHERE id = ? AND user_id = ?
                """,
                (provider_ref, payment_method, payment_provider, intent_id, user_id),
            )
            updated = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ?",
                (intent_id,),
            ).fetchone()
        return _row_to_payment_intent(updated)

    def complete_payment_intent(
        self,
        intent_id: str,
        user_id: int,
        *,
        payment_method: str,
        payment_provider: str | None,
        payment_ref: str | None = None,
        esim_fields: dict[str, Any] | None = None,
        order_id: str | None = None,
        esim_id: str | None = None,
        dent_inventory_item_id: str | None = None,
    ) -> PaymentIntent:
        intent_id = validate_record_id(intent_id, field="payment id")
        payment_method = validate_payment_method(payment_method)
        if payment_provider is not None:
            payment_provider = optional_text(payment_provider, max_len=64, field="payment_provider")
        if payment_ref is not None:
            payment_ref = optional_text(payment_ref, max_len=128, field="payment_ref")

        with self.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ? AND user_id = ?",
                (intent_id, user_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("payment not found")
            intent = self._ensure_payment_intent_active(_row_to_payment_intent(row))
            if intent.status != "pending":
                raise ConflictError("payment is not pending")
            if parse_iso(intent.expires_at) and parse_iso(intent.expires_at) < utc_now():
                conn.execute(
                    "UPDATE payment_intents SET status = 'expired' WHERE id = ?",
                    (intent_id,),
                )
                raise ConflictError("payment expired")

            now = isoformat()
            order_id: str | None = None
            esim_id: str | None = None

            if intent.kind == "topup":
                self.adjust_balance(
                    user_id,
                    intent.amount_usd,
                    kind="topup",
                    reference_id=intent_id,
                    conn=conn,
                )
            elif intent.kind == "purchase":
                if not intent.plan_name or not intent.country_code or intent.days is None:
                    raise ConflictError("invalid purchase intent")
                if not esim_fields:
                    raise ConflictError("eSIM provisioning is required")
                purchase_order_id = order_id or secrets.token_hex(8)
                purchase_esim_id = esim_id or secrets.token_hex(8)
                order_id = purchase_order_id
                esim_id = purchase_esim_id
                self.purchase_external(
                    user_id=user_id,
                    order_id=purchase_order_id,
                    esim_id=purchase_esim_id,
                    name=intent.plan_name,
                    country_code=intent.country_code,
                    gb=intent.gb or "",
                    days=intent.days,
                    amount_usd=intent.amount_usd,
                    payment_method=payment_method,
                    payment_provider=payment_provider,
                    payment_ref=payment_ref or intent_id,
                    country_name_for_stats=intent.plan_name,
                    esim_fields=esim_fields,
                    dent_inventory_item_id=dent_inventory_item_id,
                    conn=conn,
                )
            else:
                raise ConflictError("unsupported payment kind")

            conn.execute(
                """
                UPDATE payment_intents SET
                    status = 'completed',
                    payment_method = ?,
                    payment_provider = ?,
                    order_id = ?,
                    esim_id = ?,
                    completed_at = ?
                WHERE id = ?
                """,
                (payment_method, payment_provider, order_id, esim_id, now, intent_id),
            )
            final = conn.execute(
                "SELECT * FROM payment_intents WHERE id = ?",
                (intent_id,),
            ).fetchone()
        return _row_to_payment_intent(final)

    # --- API clients (reseller) ---

    @staticmethod
    def hash_api_secret(secret: str) -> str:
        return hashlib.sha256(secret.encode()).hexdigest()

    def get_api_client(self, telegram_id: int) -> dict[str, Any] | None:
        row = self.connect().execute(
            "SELECT telegram_id, webhook_url, webhook_secret, is_active, created_at, updated_at FROM api_clients WHERE telegram_id = ?",
            (telegram_id,),
        ).fetchone()
        return dict(row) if row else None

    def verify_api_secret(self, telegram_id: int, secret: str) -> bool:
        row = self.connect().execute(
            "SELECT secret_hash FROM api_clients WHERE telegram_id = ? AND is_active = 1",
            (telegram_id,),
        ).fetchone()
        if row is None:
            return False
        return hmac.compare_digest(row["secret_hash"], self.hash_api_secret(secret))

    def generate_api_client(self, telegram_id: int) -> tuple[str, dict[str, Any]]:
        """Create or rotate API secret. Returns (plaintext_secret, client_info)."""
        telegram_id = validate_telegram_id(telegram_id)
        if self.get_user(telegram_id) is None:
            raise NotFoundError("user not found")
        secret = secrets.token_urlsafe(32)
        secret_hash = self.hash_api_secret(secret)
        now = isoformat()
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO api_clients (telegram_id, secret_hash, is_active, created_at, updated_at)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(telegram_id) DO UPDATE SET
                    secret_hash = excluded.secret_hash,
                    is_active = 1,
                    updated_at = excluded.updated_at
                """,
                (telegram_id, secret_hash, now, now),
            )
        client = self.get_api_client(telegram_id)
        assert client is not None
        return secret, client

    def update_api_client_webhook(
        self, telegram_id: int, webhook_url: str | None
    ) -> tuple[dict[str, Any], str | None]:
        """Set webhook URL; returns (client, new_webhook_secret or None)."""
        telegram_id = validate_telegram_id(telegram_id)
        client = self.get_api_client(telegram_id)
        if client is None:
            raise NotFoundError("api client not configured")
        url = optional_text(webhook_url, max_len=512, field="webhook_url") if webhook_url else None
        webhook_secret = secrets.token_urlsafe(24) if url else None
        now = isoformat()
        with self.transaction() as conn:
            conn.execute(
                """
                UPDATE api_clients SET webhook_url = ?, webhook_secret = ?, updated_at = ?
                WHERE telegram_id = ?
                """,
                (url, webhook_secret, now, telegram_id),
            )
        updated = self.get_api_client(telegram_id)
        assert updated is not None
        return updated, webhook_secret

    def create_broadcast_record(
        self,
        broadcast_id: str,
        kind: str,
        message: str,
        *,
        sent: int,
        failed: int,
    ) -> None:
        now = isoformat()
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO broadcasts (id, kind, message, sent_count, failed_count, created_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (broadcast_id, kind, message[:4096], sent, failed, now, now),
            )

    def list_broadcasts(self, *, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.connect().execute(
            "SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?",
            (max(1, min(limit, 200)),),
        ).fetchall()
        return [dict(r) for r in rows]


__all__ = [
    "AccountSnapshot",
    "BalanceKind",
    "BalanceTransaction",
    "ConflictError",
    "CountryStat",
    "Database",
    "DatabaseError",
    "Esim",
    "EsimStatus",
    "InsufficientBalanceError",
    "NotFoundError",
    "NotificationPrefs",
    "Order",
    "OrderStatus",
    "PaymentIntent",
    "PaymentIntentKind",
    "PaymentIntentStatus",
    "PaymentMethod",
    "ReferralEarning",
    "ReferralEarningKind",
    "ReferralRelation",
    "User",
    "build_referral_link",
    "generate_referral_code",
    "iso_to_ms",
    "ms_to_iso",
    "volume_from_db",
    "volume_to_db",
]
