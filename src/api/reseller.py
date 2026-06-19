"""External reseller API (/api/v1/*) — balance, purchase, webhooks."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from http.server import BaseHTTPRequestHandler
from typing import Any, TYPE_CHECKING

from core.catalog import lookup_plan
from core.database import ConflictError, InsufficientBalanceError, NotFoundError
from core.dent_provision import DentProvisionError, provision_dent_esim
from core.security import (
    AuthenticationError,
    RateLimitError,
    SecurityError,
    validate_record_id,
    validate_telegram_id,
)

if TYPE_CHECKING:
    from core.database import Database

logger = logging.getLogger(__name__)

RESELLER_PATH_PREFIX = "/api/v1"
AUTH_MAX_AGE_SECONDS = 60
NONCE_TTL_SECONDS = 120

_seen_nonces: dict[str, float] = {}
_nonce_lock = __import__("threading").Lock()


def _purge_nonces(now: float) -> None:
    expired = [k for k, t in _seen_nonces.items() if now - t > NONCE_TTL_SECONDS]
    for k in expired:
        _seen_nonces.pop(k, None)


def _body_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def verify_reseller_auth(
    handler: BaseHTTPRequestHandler,
    body: bytes,
    db: Database,
) -> int:
    """Validate HMAC headers; return authenticated telegram_id (client_id)."""
    client_id_raw = handler.headers.get("X-Client-Id", "").strip()
    api_secret = handler.headers.get("X-Api-Secret", "").strip()
    timestamp_raw = handler.headers.get("X-Timestamp", "").strip()
    nonce = handler.headers.get("X-Nonce", "").strip()
    signature = handler.headers.get("X-Signature", "").strip()

    if not client_id_raw or not api_secret or not timestamp_raw or not nonce or not signature:
        raise AuthenticationError("missing auth headers")
    if len(nonce) < 16 or len(nonce) > 64:
        raise AuthenticationError("invalid nonce")
    try:
        client_id = validate_telegram_id(int(client_id_raw))
        timestamp = int(timestamp_raw)
    except (TypeError, ValueError) as exc:
        raise AuthenticationError("invalid auth headers") from exc

    now = int(time.time())
    if abs(now - timestamp) > AUTH_MAX_AGE_SECONDS:
        raise AuthenticationError("timestamp expired")

    with _nonce_lock:
        _purge_nonces(now)
        nonce_key = f"{client_id}:{nonce}"
        if nonce_key in _seen_nonces:
            raise AuthenticationError("nonce replay")
        _seen_nonces[nonce_key] = float(now)

    client = db.get_api_client(client_id)
    if client is None or not client.get("is_active"):
        raise AuthenticationError("invalid client")
    if not db.verify_api_secret(client_id, api_secret):
        raise AuthenticationError("invalid client")

    path = handler.path.split("?", 1)[0]
    message = "\n".join(
        [
            str(timestamp),
            nonce,
            handler.command.upper(),
            path,
            _body_hash(body),
        ]
    )
    expected = hmac.new(api_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise AuthenticationError("invalid signature")

    user = db.get_user(client_id)
    if user is None or user.is_blocked:
        raise AuthenticationError("account not found or blocked")
    return client_id


def handle_reseller_request(
    handler: BaseHTTPRequestHandler,
    method: str,
    path: str,
    body: dict[str, Any],
    raw_body: bytes,
    *,
    db: Database,
    json_response: Any,
    client_ip: str,
) -> bool:
    if not path.startswith(RESELLER_PATH_PREFIX):
        return False

    try:
        telegram_id = verify_reseller_auth(handler, raw_body, db)

        if method == "GET" and path == "/api/v1/balance":
            user = db.get_user(telegram_id)
            assert user is not None
            json_response(handler, 200, {"balance": user.balance, "currency": "USD"})
            return True

        if method == "POST" and path == "/api/v1/purchase":
            if "country_code" not in body or "gb" not in body or "days" not in body:
                raise SecurityError("missing plan fields")
            plan = lookup_plan(
                country_code=body["country_code"],
                gb=body["gb"],
                days=body["days"],
            )
            purchase = plan.to_purchase_dict()
            user = db.get_user(telegram_id)
            if user is None:
                raise SecurityError("user not found")
            discount = db.referral_friend_discount_rate(telegram_id)
            effective = round(purchase["usd"] * (1.0 - discount), 2)
            if user.balance < effective:
                json_response(handler, 402, {"error": "insufficient balance"})
                return True

            order_id = secrets.token_hex(8)
            esim_id = secrets.token_hex(8)
            try:
                provision = provision_dent_esim(
                    db,
                    user_id=telegram_id,
                    order_id=order_id,
                    plan=plan,
                    user_ip=client_ip,
                    user_country=plan.country_code,
                    inventory_override=plan.dent_inventory_item_id,
                )
            except DentProvisionError as exc:
                raise SecurityError(str(exc)) from exc

            try:
                order, esim = db.purchase_from_balance(
                    user_id=telegram_id,
                    order_id=order_id,
                    esim_id=esim_id,
                    name=purchase["name"],
                    country_code=purchase["country_code"],
                    gb=purchase["gb"],
                    days=purchase["days"],
                    amount_usd=purchase["usd"],
                    country_name_for_stats=purchase["name"],
                    esim_fields=provision.esim_fields,
                    dent_inventory_item_id=provision.inventory_item_id,
                )
            except InsufficientBalanceError:
                json_response(handler, 402, {"error": "insufficient balance"})
                return True

            if provision.dent_customer_uid:
                db.update_user_settings(
                    telegram_id,
                    dent_customer_uid=provision.dent_customer_uid,
                    dent_profile_url=provision.dent_profile_url,
                )

            json_response(
                handler,
                200,
                {
                    "orderId": order.id,
                    "esimId": esim.id,
                    "amountUsd": order.amount_usd,
                    "balance": db.get_user(telegram_id).balance if db.get_user(telegram_id) else 0,
                    "esim": esim.to_client_dict(),
                },
            )
            return True

        if method == "GET" and path == "/api/v1/esims":
            esims = db.list_esims(telegram_id)
            json_response(handler, 200, {"items": [e.to_client_dict() for e in esims]})
            return True

        json_response(handler, 404, {"error": "not found"})
        return True

    except AuthenticationError as exc:
        json_response(handler, 401, {"error": str(exc)})
        return True
    except NotFoundError as exc:
        json_response(handler, 404, {"error": str(exc)})
        return True
    except ConflictError as exc:
        json_response(handler, 409, {"error": str(exc)})
        return True
    except RateLimitError as exc:
        json_response(handler, 429, {"error": str(exc)})
        return True
    except SecurityError as exc:
        json_response(handler, 400, {"error": str(exc)})
        return True
    except Exception:
        logger.exception("Reseller API error on %s", path)
        json_response(handler, 500, {"error": "internal server error"})
        return True


def dispatch_reseller_webhooks(db: Database, esim_id: str, event: str, payload: dict[str, Any]) -> None:
    """Notify reseller webhook URLs about subscription events."""
    import urllib.request

    esim = db.get_esim(esim_id)
    if esim is None:
        return
    client = db.get_api_client(esim.user_id)
    if client is None or not client.get("webhook_url") or not client.get("is_active"):
        return
    webhook_secret = client.get("webhook_secret")
    if not webhook_secret:
        return
    url = str(client["webhook_url"])
    body = json.dumps(
        {"event": event, "esimId": esim_id, "payload": payload},
        ensure_ascii=False,
    ).encode("utf-8")
    ts = str(int(time.time()))
    sig = hmac.new(str(webhook_secret).encode(), f"{ts}.{body.decode()}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Timestamp": ts,
            "X-Signature": sig,
            "User-Agent": "esimker-webhook/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status >= 400:
                logger.warning("Reseller webhook %s returned %s", url, resp.status)
    except Exception as exc:
        logger.warning("Reseller webhook failed for %s: %s", url, exc)
