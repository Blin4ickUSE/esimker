"""Admin read/write queries over the esimker SQLite database."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from typing import Any

from core.database import Database, NotFoundError, isoformat, utc_now
from core.security import SecurityError, validate_money, validate_promo_code

ADMIN_TABLES = frozenset(
    {
        "users",
        "orders",
        "esims",
        "balance_transactions",
        "promo_codes",
        "promo_redemptions",
        "referral_relations",
        "referral_earnings",
        "country_stats",
        "payment_intents",
        "api_clients",
        "broadcasts",
        "esim_alert_sent",
        "schema_migrations",
    }
)


class AdminData:
    def __init__(self, db: Database) -> None:
        self._db = db

    def _conn(self) -> sqlite3.Connection:
        return self._db.connect()

    def dashboard_stats(self) -> dict[str, Any]:
        conn = self._conn()
        users = int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
        blocked = int(conn.execute("SELECT COUNT(*) FROM users WHERE is_blocked = 1").fetchone()[0])
        orders = int(conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0])
        esims = int(conn.execute("SELECT COUNT(*) FROM esims").fetchone()[0])
        revenue = float(
            conn.execute(
                "SELECT COALESCE(SUM(amount_usd), 0) FROM orders WHERE status = 'paid'"
            ).fetchone()[0]
        )
        balance_total = float(conn.execute("SELECT COALESCE(SUM(balance), 0) FROM users").fetchone()[0])
        pending_payments = int(
            conn.execute(
                "SELECT COUNT(*) FROM payment_intents WHERE status = 'pending'"
            ).fetchone()[0]
        )
        referral_paid = float(
            conn.execute(
                "SELECT COALESCE(SUM(commission_usd), 0) FROM referral_earnings"
            ).fetchone()[0]
        )
        today = utc_now().strftime("%Y-%m-%d")
        revenue_today = float(
            conn.execute(
                """
                SELECT COALESCE(SUM(amount_usd), 0) FROM orders
                WHERE status = 'paid' AND created_at LIKE ?
                """,
                (f"{today}%",),
            ).fetchone()[0]
        )
        orders_today = int(
            conn.execute(
                "SELECT COUNT(*) FROM orders WHERE created_at LIKE ?",
                (f"{today}%",),
            ).fetchone()[0]
        )
        top_countries = [
            dict(row)
            for row in conn.execute(
                """
                SELECT country_code, COUNT(*) AS orders_count,
                       COALESCE(SUM(amount_usd), 0) AS revenue_usd
                FROM orders
                WHERE status = 'paid'
                GROUP BY country_code
                ORDER BY revenue_usd DESC
                LIMIT 8
                """
            ).fetchall()
        ]
        return {
            "users": users,
            "blockedUsers": blocked,
            "orders": orders,
            "esims": esims,
            "revenueUsd": round(revenue, 2),
            "revenueTodayUsd": round(revenue_today, 2),
            "ordersToday": orders_today,
            "balanceTotalUsd": round(balance_total, 2),
            "pendingPayments": pending_payments,
            "referralPaidUsd": round(referral_paid, 2),
            "topCountries": top_countries,
        }

    def list_users(
        self,
        *,
        search: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        conn = self._conn()
        params: list[Any] = []
        where = ""
        q = search.strip()
        if q:
            where = """
                WHERE CAST(telegram_id AS TEXT) LIKE ?
                   OR email LIKE ?
                   OR referral_code LIKE ?
                   OR CAST(telegram_id AS TEXT) = ?
            """
            like = f"%{q}%"
            params.extend([like, like, like, q])

        total = int(conn.execute(f"SELECT COUNT(*) FROM users {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT telegram_id, email, email_verified,
                   balance, referral_code, referral_count, referral_earned_usd,
                   is_blocked, created_at, last_opened_at
            FROM users
            {where}
            ORDER BY telegram_id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return {
            "total": total,
            "items": [dict(r) for r in rows],
            "offset": offset,
            "limit": limit,
        }

    def get_user_detail(self, telegram_id: int) -> dict[str, Any]:
        user = self._db.get_user(telegram_id)
        if user is None:
            raise NotFoundError("user not found")
        snapshot = self._db.get_account_snapshot(telegram_id)
        return {
            "user": user.to_dict(),
            "esims": [e.to_dict() for e in self._db.list_esims(telegram_id, active_only=False)],
            "orders": [o.to_dict() for o in self._db.list_orders(telegram_id, limit=200)],
            "balanceTransactions": [
                asdict(t) for t in self._db.list_balance_transactions(telegram_id, limit=200)
            ],
            "usedPromos": self._db.list_used_promos(telegram_id),
            "countryStats": {
                k: asdict(v) for k, v in self._db.list_country_stats(telegram_id).items()
            },
            "referralEarnings": [
                asdict(e) for e in self._db.list_referral_earnings(telegram_id, limit=100)
            ],
            "referredUsers": [asdict(r) for r in self._db.list_referred_users(telegram_id)],
            "referrer": (
                self._db.get_referrer(telegram_id).to_dict()
                if self._db.get_referrer(telegram_id)
                else None
            ),
            "account": snapshot.to_client_dict(),
        }

    def patch_user(self, telegram_id: int, body: dict[str, Any]) -> dict[str, Any]:
        user = self._db.get_user(telegram_id)
        if user is None:
            raise NotFoundError("user not found")

        if "isBlocked" in body:
            blocked = bool(body["isBlocked"])
            with self._db.transaction() as conn:
                conn.execute(
                    "UPDATE users SET is_blocked = ?, updated_at = ? WHERE telegram_id = ?",
                    (int(blocked), isoformat(), telegram_id),
                )

        if "balanceDelta" in body:
            delta = validate_money(body["balanceDelta"], field="balanceDelta")
            note = str(body.get("note", "admin adjustment"))[:255]
            self._db.adjust_balance(
                telegram_id,
                delta,
                kind="adjustment",
                reference_id=f"admin-{telegram_id}",
                note=note,
            )

        if "email" in body or "notifications" in body:
            from core.database import NotificationPrefs

            prefs = None
            notifications = body.get("notifications")
            if isinstance(notifications, dict):
                prefs = NotificationPrefs(
                    news=bool(notifications.get("news", True)),
                    marketing=bool(notifications.get("marketing", True)),
                    traffic=bool(notifications.get("traffic", True)),
                    subscription=bool(notifications.get("subscription", True)),
                )
            email = body.get("email")
            self._db.update_user_settings(
                telegram_id,
                email=str(email) if email is not None else None,
                email_verified=bool(body.get("emailVerified")) if "emailVerified" in body else None,
                notifications=prefs,
            )

        return self.get_user_detail(telegram_id)

    def list_orders(
        self,
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        conn = self._conn()
        params: list[Any] = []
        where = ""
        if status:
            where = "WHERE status = ?"
            params.append(status)
        total = int(conn.execute(f"SELECT COUNT(*) FROM orders {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT o.*, u.telegram_id
            FROM orders o
            JOIN users u ON u.telegram_id = o.user_id
            {where}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "offset": offset, "limit": limit}

    def list_esims(
        self,
        *,
        search: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        conn = self._conn()
        params: list[Any] = []
        where = ""
        q = search.strip()
        if q:
            where = """
                WHERE e.iccid LIKE ? OR e.id = ? OR CAST(e.user_id AS TEXT) = ?
            """
            like = f"%{q}%"
            params.extend([like, q, q])
        total = int(
            conn.execute(
                f"SELECT COUNT(*) FROM esims e {where}",
                params,
            ).fetchone()[0]
        )
        rows = conn.execute(
            f"""
            SELECT e.*, u.telegram_id
            FROM esims e
            JOIN users u ON u.telegram_id = e.user_id
            {where}
            ORDER BY e.purchased_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "offset": offset, "limit": limit}

    def patch_esim(self, esim_id: str, body: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "status",
            "is_active",
            "data_remaining_gb",
            "data_total_gb",
            "activated_at",
            "expires_at",
        }
        patch = {k: body[k] for k in allowed if k in body}
        if not patch:
            raise SecurityError("no valid fields")
        esim = self._db.update_esim(esim_id, **patch)
        return esim.to_dict()

    def list_payment_intents(
        self,
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        conn = self._conn()
        params: list[Any] = []
        where = ""
        if status:
            where = "WHERE p.status = ?"
            params.append(status)
        total = int(conn.execute(f"SELECT COUNT(*) FROM payment_intents p {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT p.*, u.telegram_id
            FROM payment_intents p
            JOIN users u ON u.telegram_id = p.user_id
            {where}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "offset": offset, "limit": limit}

    def list_promos(self) -> list[dict[str, Any]]:
        conn = self._conn()
        rows = conn.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_code = p.code) AS used_count
            FROM promo_codes p
            ORDER BY p.created_at DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]

    def create_promo(self, body: dict[str, Any]) -> dict[str, Any]:
        code = validate_promo_code(body.get("code", ""))
        credit = validate_money(body.get("creditUsd", 0), field="creditUsd", min_value=0.01)
        max_uses = body.get("maxUses")
        max_uses_val = int(max_uses) if max_uses is not None else None
        now = isoformat()
        with self._db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO promo_codes (code, credit_usd, max_uses, max_uses_per_user, active, created_at)
                VALUES (?, ?, ?, 1, 1, ?)
                """,
                (code, credit, max_uses_val, now),
            )
        row = self._conn().execute("SELECT * FROM promo_codes WHERE code = ?", (code,)).fetchone()
        return dict(row)

    def patch_promo(self, code: str, body: dict[str, Any]) -> dict[str, Any]:
        code = validate_promo_code(code)
        fields: list[str] = []
        values: list[Any] = []
        if "active" in body:
            fields.append("active = ?")
            values.append(int(bool(body["active"])))
        if "creditUsd" in body:
            fields.append("credit_usd = ?")
            values.append(validate_money(body["creditUsd"], field="creditUsd", min_value=0.01))
        if "maxUses" in body:
            fields.append("max_uses = ?")
            values.append(int(body["maxUses"]) if body["maxUses"] is not None else None)
        if not fields:
            raise SecurityError("no valid fields")
        values.append(code)
        with self._db.transaction() as conn:
            cur = conn.execute(
                f"UPDATE promo_codes SET {', '.join(fields)} WHERE code = ?",
                values,
            )
            if cur.rowcount == 0:
                raise NotFoundError("promo not found")
        row = self._conn().execute("SELECT * FROM promo_codes WHERE code = ?", (code,)).fetchone()
        return dict(row)

    def list_referrals(self, *, limit: int = 100) -> dict[str, Any]:
        limit = max(1, min(limit, 500))
        conn = self._conn()
        top = conn.execute(
            """
            SELECT u.telegram_id, u.referral_code,
                   u.referral_count, u.referral_earned_usd
            FROM users u
            WHERE u.referral_count > 0
            ORDER BY u.referral_earned_usd DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        recent = conn.execute(
            """
            SELECT e.*, ru.telegram_id AS referrer_telegram_id
            FROM referral_earnings e
            JOIN users ru ON ru.telegram_id = e.referrer_id
            ORDER BY e.created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return {"topReferrers": [dict(r) for r in top], "recentEarnings": [dict(r) for r in recent]}

    def list_broadcasts(self) -> list[dict[str, Any]]:
        return self._db.list_broadcasts()

    def send_broadcast(self, body: dict[str, Any]) -> dict[str, Any]:
        import secrets

        from core.notifications import send_broadcast

        kind = str(body.get("kind", "")).strip().lower()
        message = str(body.get("message", "")).strip()
        if kind not in ("news", "marketing"):
            raise SecurityError("kind must be news or marketing")
        if not message:
            raise SecurityError("message is required")
        sent, failed = send_broadcast(self._db, kind=kind, message=message)
        broadcast_id = secrets.token_hex(8)
        self._db.create_broadcast_record(broadcast_id, kind, message, sent=sent, failed=failed)
        return {"id": broadcast_id, "kind": kind, "sent": sent, "failed": failed}

    def list_table_names(self) -> list[str]:
        return sorted(ADMIN_TABLES)

    def browse_table(self, table: str, *, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        if table not in ADMIN_TABLES:
            raise SecurityError("unknown table")
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        conn = self._conn()
        total = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        rows = conn.execute(
            f"SELECT * FROM {table} ORDER BY rowid DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return {
            "table": table,
            "total": total,
            "items": [dict(r) for r in rows],
            "offset": offset,
            "limit": limit,
        }

    def export_user_json(self, telegram_id: int) -> str:
        return self._db.export_user_json(telegram_id)
