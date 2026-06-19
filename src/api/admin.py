"""HTTP handlers for the admin panel API (/api/admin/*)."""

from __future__ import annotations

import re
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse

from core.admin_auth import AdminAuthError, authenticate_admin, parse_bearer_token
from core.admin_data import AdminData
from core.database import ConflictError, Database, NotFoundError
from core.security import SecurityError, safe_public_error

_USER_ID_RE = re.compile(r"^/api/admin/users/(\d+)$")
_ESIM_ID_RE = re.compile(r"^/api/admin/esims/([a-f0-9]+)$")
_PROMO_CODE_RE = re.compile(r"^/api/admin/promos/([A-Z0-9_-]+)$", re.IGNORECASE)
_TABLE_RE = re.compile(r"^/api/admin/tables/([a-z_]+)$")


def _qs_int(qs: dict[str, list[str]], key: str, default: int) -> int:
    raw = (qs.get(key) or [None])[0]
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _qs_str(qs: dict[str, list[str]], key: str) -> str | None:
    raw = (qs.get(key) or [None])[0]
    return str(raw).strip() if raw else None


def handle_admin_request(
    handler: BaseHTTPRequestHandler,
    method: str,
    path: str,
    body: dict[str, Any] | None,
    *,
    db: Database,
    json_response: Any,
    read_json: Any,
) -> bool:
    """Return True if the request was handled."""
    if not path.startswith("/api/admin"):
        return False

    admin = AdminData(db)

    if path == "/api/admin/login" and method == "POST":
        payload = body if body is not None else read_json(handler)
        login = str(payload.get("login", "")).strip()
        password = str(payload.get("password", ""))
        try:
            token = authenticate_admin(login, password)
            json_response(handler, 200, {"token": token, "login": login})
        except AdminAuthError as exc:
            json_response(handler, 401, {"error": str(exc)})
        return True

    try:
        login = parse_bearer_token(handler.headers.get("Authorization"))
    except AdminAuthError as exc:
        if path == "/api/admin/health":
            json_response(handler, 200, {"ok": True, "auth": False})
            return True
        json_response(handler, 401, {"error": str(exc)})
        return True

    try:
        if path == "/api/admin/me" and method == "GET":
            json_response(handler, 200, {"login": login})
            return True

        if path == "/api/admin/stats" and method == "GET":
            json_response(handler, 200, admin.dashboard_stats())
            return True

        parsed = urlparse(handler.path)
        qs = parse_qs(parsed.query)

        if path == "/api/admin/users" and method == "GET":
            json_response(
                handler,
                200,
                admin.list_users(
                    search=_qs_str(qs, "search") or "",
                    offset=_qs_int(qs, "offset", 0),
                    limit=_qs_int(qs, "limit", 50),
                ),
            )
            return True

        if path == "/api/admin/users/usernames" and method == "POST":
            payload = body if body is not None else read_json(handler)
            ids_raw = payload.get("telegramIds") or payload.get("ids") or []
            if not isinstance(ids_raw, list):
                ids_raw = []
            telegram_ids = [int(x) for x in ids_raw if str(x).isdigit()]
            json_response(handler, 200, {"usernames": admin.resolve_telegram_usernames(telegram_ids)})
            return True

        m = _USER_ID_RE.match(path)
        if m:
            telegram_id = int(m.group(1))
            if method == "GET":
                json_response(handler, 200, admin.get_user_detail(telegram_id))
                return True
            if method == "PATCH":
                payload = body if body is not None else read_json(handler)
                json_response(handler, 200, admin.patch_user(telegram_id, payload))
                return True

        export_match = re.match(r"^/api/admin/users/(\d+)/export$", path)
        if export_match and method == "GET":
            json_response(
                handler,
                200,
                {"json": admin.export_user_json(int(export_match.group(1)))},
            )
            return True

        if path == "/api/admin/orders" and method == "GET":
            json_response(
                handler,
                200,
                admin.list_orders(
                    status=_qs_str(qs, "status"),
                    offset=_qs_int(qs, "offset", 0),
                    limit=_qs_int(qs, "limit", 50),
                ),
            )
            return True

        if path == "/api/admin/esims" and method == "GET":
            json_response(
                handler,
                200,
                admin.list_esims(
                    search=_qs_str(qs, "search") or "",
                    offset=_qs_int(qs, "offset", 0),
                    limit=_qs_int(qs, "limit", 50),
                ),
            )
            return True

        em = _ESIM_ID_RE.match(path)
        if em and method == "PATCH":
            payload = body if body is not None else read_json(handler)
            json_response(handler, 200, admin.patch_esim(em.group(1), payload))
            return True

        if path == "/api/admin/payments" and method == "GET":
            json_response(
                handler,
                200,
                admin.list_payment_intents(
                    status=_qs_str(qs, "status"),
                    offset=_qs_int(qs, "offset", 0),
                    limit=_qs_int(qs, "limit", 50),
                ),
            )
            return True

        if path == "/api/admin/promos" and method == "GET":
            json_response(handler, 200, {"items": admin.list_promos()})
            return True

        if path == "/api/admin/promos" and method == "POST":
            payload = body if body is not None else read_json(handler)
            json_response(handler, 201, admin.create_promo(payload))
            return True

        pm = _PROMO_CODE_RE.match(path)
        if pm and method == "PATCH":
            payload = body if body is not None else read_json(handler)
            json_response(handler, 200, admin.patch_promo(pm.group(1), payload))
            return True

        if pm and method == "DELETE":
            admin.delete_promo(pm.group(1))
            json_response(handler, 200, {"ok": True})
            return True

        if path == "/api/admin/referrals" and method == "GET":
            json_response(handler, 200, admin.list_referrals(limit=_qs_int(qs, "limit", 100)))
            return True

        if path == "/api/admin/broadcasts" and method == "GET":
            json_response(handler, 200, {"items": admin.list_broadcasts()})
            return True

        if path == "/api/admin/broadcasts" and method == "POST":
            payload = body if body is not None else read_json(handler)
            json_response(handler, 201, admin.send_broadcast(payload))
            return True

        if path == "/api/admin/tables" and method == "GET":
            json_response(handler, 200, {"tables": admin.list_table_names()})
            return True

        tm = _TABLE_RE.match(path)
        if tm and method == "GET":
            json_response(
                handler,
                200,
                admin.browse_table(
                    tm.group(1),
                    offset=_qs_int(qs, "offset", 0),
                    limit=_qs_int(qs, "limit", 50),
                ),
            )
            return True

        json_response(handler, 404, {"error": "not found"})
        return True

    except NotFoundError as exc:
        json_response(handler, 404, {"error": str(exc)})
        return True
    except ConflictError as exc:
        json_response(handler, 409, {"error": str(exc)})
        return True
    except SecurityError as exc:
        json_response(handler, 400, {"error": safe_public_error(exc)})
        return True
    except Exception as exc:
        json_response(handler, 500, {"error": safe_public_error(exc)})
        return True
