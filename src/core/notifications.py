"""Background checks: eSIM traffic/subscription expiry → Telegram notifications."""

from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from core.database import isoformat, parse_iso, utc_now
from core.telegram_send import send_message

if TYPE_CHECKING:
    from core.database import Database

logger = logging.getLogger(__name__)

TRAFFIC_THRESHOLD_GB = 0.05
SUBSCRIPTION_WARN_HOURS = 24
CHECK_INTERVAL_SECONDS = 300


def _traffic_message(name: str, remaining: float | None, lang: str) -> str:
    if lang == "ru":
        rem = f"{remaining:.2f} ГБ" if remaining is not None else "0"
        return (
            f"⚠️ <b>Заканчивается трафик</b>\n\n"
            f"eSIM «{name}» — осталось {rem}.\n"
            f"Пополните тариф в приложении, чтобы не остаться без интернета."
        )
    rem = f"{remaining:.2f} GB" if remaining is not None else "0"
    return (
        f"⚠️ <b>Data running low</b>\n\n"
        f"eSIM «{name}» — {rem} left.\n"
        f"Top up in the app to stay connected."
    )


def _subscription_message(name: str, expires: datetime, lang: str) -> str:
    if lang == "ru":
        return (
            f"⏳ <b>Срок действия eSIM</b>\n\n"
            f"«{name}» истекает {expires.strftime('%d.%m.%Y %H:%M')} UTC.\n"
            f"Продлите подписку в приложении."
        )
    return (
        f"⏳ <b>eSIM expiring soon</b>\n\n"
        f"«{name}» expires on {expires.strftime('%Y-%m-%d %H:%M')} UTC.\n"
        f"Renew in the app."
    )


def check_esim_alerts(db: Database) -> int:
    """Scan active eSIMs and send alerts. Returns number of messages sent."""
    conn = db.connect()
    now = utc_now()
    warn_before = now + timedelta(hours=SUBSCRIPTION_WARN_HOURS)
    sent = 0

    rows = conn.execute(
        """
        SELECT e.id, e.user_id, e.name, e.data_remaining_gb, e.data_total_gb,
               e.expires_at, e.status, u.notify_traffic, u.notify_subscription,
               u.language_code, u.is_blocked
        FROM esims e
        JOIN users u ON u.telegram_id = e.user_id
        WHERE e.is_active = 1 AND u.is_blocked = 0
        """
    ).fetchall()

    for row in rows:
        telegram_id = int(row["user_id"])
        lang = "ru" if (row["language_code"] or "").lower().startswith("ru") else "en"
        name = row["name"]

        if bool(row["notify_traffic"]):
            remaining = row["data_remaining_gb"]
            total = row["data_total_gb"]
            if (
                remaining is not None
                and total is not None
                and float(total) > 0
                and float(remaining) <= TRAFFIC_THRESHOLD_GB
                and row["status"] in ("active", "limit")
            ):
                already = conn.execute(
                    "SELECT 1 FROM esim_alert_sent WHERE esim_id = ? AND alert_type = 'traffic'",
                    (row["id"],),
                ).fetchone()
                if not already:
                    if send_message(telegram_id, _traffic_message(name, float(remaining), lang)):
                        conn.execute(
                            "INSERT INTO esim_alert_sent (esim_id, alert_type, sent_at) VALUES (?, 'traffic', ?)",
                            (row["id"], isoformat()),
                        )
                        conn.commit()
                        sent += 1

        if bool(row["notify_subscription"]):
            expires_at = parse_iso(row["expires_at"])
            if expires_at and now < expires_at <= warn_before:
                already = conn.execute(
                    "SELECT 1 FROM esim_alert_sent WHERE esim_id = ? AND alert_type = 'subscription'",
                    (row["id"],),
                ).fetchone()
                if not already:
                    if send_message(telegram_id, _subscription_message(name, expires_at, lang)):
                        conn.execute(
                            "INSERT INTO esim_alert_sent (esim_id, alert_type, sent_at) VALUES (?, 'subscription', ?)",
                            (row["id"], isoformat()),
                        )
                        conn.commit()
                        sent += 1
                        try:
                            from api.reseller import dispatch_reseller_webhooks

                            dispatch_reseller_webhooks(
                                db,
                                row["id"],
                                "subscription.expiring",
                                {
                                    "name": name,
                                    "expiresAt": expires_at.isoformat(),
                                    "telegramId": telegram_id,
                                },
                            )
                        except Exception:
                            logger.exception("reseller webhook dispatch failed")

    return sent


def send_broadcast(
    db: Database,
    *,
    kind: str,
    message: str,
) -> tuple[int, int]:
    """Send broadcast to users with matching notification prefs. Returns (sent, failed)."""
    if kind not in ("news", "marketing"):
        raise ValueError("invalid broadcast kind")
    col = "notify_news" if kind == "news" else "notify_marketing"
    conn = db.connect()
    rows = conn.execute(
        f"""
        SELECT telegram_id FROM users
        WHERE is_blocked = 0 AND {col} = 1
        """
    ).fetchall()
    sent = failed = 0
    text = message.strip()
    if not text:
        return 0, 0
    for row in rows:
        tid = int(row["telegram_id"])
        if send_message(tid, text):
            sent += 1
        else:
            failed += 1
    return sent, failed


class NotificationWorker:
    """Periodic eSIM alert checker."""

    def __init__(self, db: Database, interval: int = CHECK_INTERVAL_SECONDS) -> None:
        self._db = db
        self._interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="esimker-notify", daemon=True)
        self._thread.start()
        logger.info("Notification worker started (interval=%ss)", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                count = check_esim_alerts(self._db)
                if count:
                    logger.info("Sent %s eSIM alert(s)", count)
            except Exception:
                logger.exception("eSIM alert check failed")
