"""HTTP API for the esimker miniapp (account, settings, purchases)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import sys
import time
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, parse_qsl, urlparse

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from core.catalog import lookup_plan, validate_topup_amount  # noqa: E402
from core.database import (  # noqa: E402
    ConflictError,
    Database,
    InsufficientBalanceError,
    NotFoundError,
    NotificationPrefs,
)
from core.security import (  # noqa: E402
    AuthenticationError,
    MAX_BODY_BYTES,
    MAX_INIT_DATA_BYTES,
    RateLimitError,
    RateLimiter,
    SecurityError,
    env_bool,
    env_int,
    is_production,
    safe_public_error,
    validate_country_name,
    validate_days,
    validate_email,
    validate_payment_method,
    validate_payment_provider,
    validate_promo_code,
    validate_record_id,
    validate_referral_code,
    validate_telegram_id,
)

from core.security import optional_text  # noqa: E402
from core.esim_profile import build_esim_fields  # noqa: E402

load_dotenv(ROOT / ".env")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def parse_telegram_user(init_data: str, bot_token: str, *, max_age_seconds: int) -> dict[str, Any]:
    if len(init_data.encode("utf-8")) > MAX_INIT_DATA_BYTES:
        raise AuthenticationError("init data too large")
    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", "")
    if not received_hash:
        raise AuthenticationError("invalid init data")
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise AuthenticationError("invalid init data")
    try:
        auth_date = int(parsed.get("auth_date", "0"))
    except ValueError as exc:
        raise AuthenticationError("invalid auth date") from exc
    if auth_date <= 0 or time.time() - auth_date > max_age_seconds:
        raise AuthenticationError("init data expired")
    user_raw = parsed.get("user", "{}")
    user = json.loads(user_raw)
    if not isinstance(user, dict) or "id" not in user:
        raise AuthenticationError("missing user in init data")
    return user


_LOGIN_WIDGET_FIELDS = frozenset({"id", "first_name", "last_name", "username", "photo_url", "auth_date"})


def parse_telegram_login(payload: dict[str, Any], bot_token: str, *, max_age_seconds: int) -> dict[str, Any]:
    """Verify Telegram Login Widget callback (browser auth)."""
    if not bot_token:
        raise AuthenticationError("telegram auth is not configured")
    received_hash = str(payload.get("hash", "")).strip()
    if not received_hash:
        raise AuthenticationError("invalid login data")
    try:
        auth_date = int(payload.get("auth_date", 0))
    except (TypeError, ValueError) as exc:
        raise AuthenticationError("invalid auth date") from exc
    if auth_date <= 0 or time.time() - auth_date > max_age_seconds:
        raise AuthenticationError("login data expired")
    telegram_id = validate_telegram_id(payload.get("id"))
    data_check = "\n".join(
        f"{k}={v}"
        for k, v in sorted(
            (key, str(payload[key]))
            for key in payload
            if key in _LOGIN_WIDGET_FIELDS and payload[key] is not None
        )
    )
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    calculated = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise AuthenticationError("invalid login data")
    return {
        "id": telegram_id,
        "username": optional_text(payload.get("username"), max_len=64, field="username"),
        "first_name": optional_text(payload.get("first_name"), max_len=128, field="first_name"),
        "last_name": optional_text(payload.get("last_name"), max_len=128, field="last_name"),
        "photo_url": optional_text(payload.get("photo_url"), max_len=512, field="photo_url"),
    }


def fetch_bot_username(token: str) -> str | None:
    if not token:
        return None
    try:
        import urllib.request

        url = f"https://api.telegram.org/bot{token}/getMe"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("ok") and isinstance(data.get("result"), dict):
            username = data["result"].get("username")
            return str(username).strip() if username else None
    except Exception as exc:
        logger.warning("Could not resolve bot username via getMe: %s", exc)
    return None


class ApiState:
    def __init__(self) -> None:
        self.db = Database()
        self.db.init()
        self.bot_token = os.getenv("telegram_bot_token", "").strip()
        env_username = os.getenv("telegram_bot_username", "").strip().lstrip("@")
        self.bot_username = env_username or fetch_bot_username(self.bot_token) or ""
        if self.bot_username:
            logger.info("Telegram bot username: @%s", self.bot_username)
        self.production = is_production()
        self.allow_mock_payments = (
            env_bool("ALLOW_MOCK_PAYMENTS", default=False)
            and not self.production
        )
        if env_bool("ALLOW_MOCK_PAYMENTS", default=False) and self.production:
            logger.warning("ALLOW_MOCK_PAYMENTS is ignored in production")
        if env_bool("ALLOW_DEV_AUTH", default=False):
            logger.warning("ALLOW_DEV_AUTH is deprecated and ignored")
        self.init_data_max_age = env_int("INIT_DATA_MAX_AGE_SECONDS", 86_400)
        self.rate_limiter = RateLimiter(env_int("API_RATE_LIMIT_PER_MINUTE", 120))
        origins = os.getenv("API_CORS_ORIGINS", "").strip()
        self.cors_origins = {o.strip() for o in origins.split(",") if o.strip()}


STATE = ApiState()


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or handler.client_address[0]


def cors_origin(handler: BaseHTTPRequestHandler) -> str | None:
    origin = handler.headers.get("Origin", "").strip()
    if not origin:
        return None
    if not STATE.cors_origins:
        return None
    return origin if origin in STATE.cors_origins else None


def apply_security_headers(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    handler.send_header("Cache-Control", "no-store")
    origin = cors_origin(handler)
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Telegram-Init-Data, X-Telegram-Login-Data",
    )


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    apply_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    if length > MAX_BODY_BYTES:
        raise SecurityError("request body too large")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SecurityError("invalid json") from exc
    if not isinstance(data, dict):
        raise SecurityError("invalid json object")
    return data


def enforce_rate_limit(handler: BaseHTTPRequestHandler, *, user_key: str | None = None) -> None:
    ip = client_ip(handler)
    STATE.rate_limiter.check(f"ip:{ip}")
    if user_key:
        STATE.rate_limiter.check(f"user:{user_key}")


def parse_login_header_raw(raw: str) -> dict[str, Any]:
    """Decode X-Telegram-Login-Data (plain JSON or b64: UTF-8 JSON)."""
    text = raw.strip()
    if not text:
        raise AuthenticationError("invalid login data")
    if text.startswith("b64:"):
        try:
            text = base64.b64decode(text[4:], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise AuthenticationError("invalid login data") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AuthenticationError("invalid login data") from exc
    if not isinstance(data, dict):
        raise AuthenticationError("invalid login data")
    return data


def resolve_user(handler: BaseHTTPRequestHandler, *, ref: str | None = None) -> Any:
    init_data = handler.headers.get("X-Telegram-Init-Data", "").strip()
    bot_token = STATE.bot_token
    referral = validate_referral_code(ref) if ref else None

    if init_data:
        if not bot_token:
            raise AuthenticationError("telegram auth is not configured")
        tg_user = parse_telegram_user(
            init_data,
            bot_token,
            max_age_seconds=STATE.init_data_max_age,
        )
        telegram_id = validate_telegram_id(tg_user["id"])
        user = STATE.db.touch_user(
            telegram_id,
            username=tg_user.get("username"),
            first_name=tg_user.get("first_name"),
            last_name=tg_user.get("last_name"),
            language_code=tg_user.get("language_code"),
            referral_code_from_link=referral,
        )
        enforce_rate_limit(handler, user_key=str(telegram_id))
        return user

    login_raw = handler.headers.get("X-Telegram-Login-Data", "").strip()
    if login_raw:
        if not bot_token:
            raise AuthenticationError("telegram auth is not configured")
        login_payload = parse_login_header_raw(login_raw)
        tg_user = parse_telegram_login(
            login_payload,
            bot_token,
            max_age_seconds=STATE.init_data_max_age,
        )
        telegram_id = tg_user["id"]
        user = STATE.db.touch_user(
            telegram_id,
            username=tg_user.get("username"),
            first_name=tg_user.get("first_name"),
            last_name=tg_user.get("last_name"),
            referral_code_from_link=referral,
        )
        enforce_rate_limit(handler, user_key=str(telegram_id))
        return user

    raise AuthenticationError("authentication required")


def account_payload(user_id: int) -> dict[str, Any]:
    snapshot = STATE.db.get_account_snapshot(user_id)
    base = snapshot.to_client_dict()
    base["referral"]["link"] = f"/?ref={snapshot.user.referral_code}"
    return base


def plan_ref_from_body(body: dict[str, Any]) -> Any:
    if "country_code" not in body or "gb" not in body or "days" not in body:
        raise SecurityError("missing plan fields")
    return lookup_plan(
        country_code=body["country_code"],
        gb=body["gb"],
        days=body["days"],
    )


def esim_fields(esim_id: str, gb: Any) -> dict[str, Any]:
    return build_esim_fields(esim_id, gb)


def require_payment_gateway() -> None:
    if not STATE.allow_mock_payments:
        raise SecurityError("payment gateway is not configured")


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "esimker"

    def log_message(self, fmt: str, *args: Any) -> None:
        logger.info("%s - %s", self.address_string(), fmt % args)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        apply_security_headers(self)
        self.end_headers()

    def _handle(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        ref_raw = (qs.get("ref") or [None])[0]
        ref = None
        if ref_raw:
            try:
                ref = validate_referral_code(ref_raw)
            except SecurityError:
                ref = None

        try:
            if path == "/api/health":
                json_response(self, 200, {"ok": True})
                return

            if method == "GET" and path == "/api/config":
                enforce_rate_limit(self)
                json_response(
                    self,
                    200,
                    {"botUsername": STATE.bot_username or None},
                )
                return

            if method == "GET" and path == "/api/catalog/popular":
                enforce_rate_limit(self)
                json_response(self, 200, {"countries": STATE.db.list_popular_destinations()})
                return

            if method == "GET" and path == "/api/account":
                user = resolve_user(self, ref=ref)
                json_response(self, 200, account_payload(user.id))
                return

            if method == "GET" and path == "/api/payments/intent":
                user = resolve_user(self, ref=ref)
                intent_id = validate_record_id((qs.get("id") or [""])[0], field="payment id")
                intent = STATE.db.get_payment_intent(intent_id, user.id)
                json_response(self, 200, intent.to_client_dict())
                return

            if method == "POST":
                body = read_json(self)

                if path == "/api/auth/telegram":
                    enforce_rate_limit(self)
                    if not STATE.bot_token:
                        raise AuthenticationError("telegram auth is not configured")
                    tg_user = parse_telegram_login(
                        body,
                        STATE.bot_token,
                        max_age_seconds=STATE.init_data_max_age,
                    )
                    ref_body = validate_referral_code(body.get("ref")) if body.get("ref") else ref
                    user = STATE.db.touch_user(
                        tg_user["id"],
                        username=tg_user.get("username"),
                        first_name=tg_user.get("first_name"),
                        last_name=tg_user.get("last_name"),
                        referral_code_from_link=ref_body,
                    )
                    enforce_rate_limit(self, user_key=str(tg_user["id"]))
                    json_response(self, 200, account_payload(user.id))
                    return

                user = resolve_user(self, ref=body.get("ref") or ref)

                if path == "/api/payments/intent":
                    kind = str(body.get("kind", "")).strip().lower()
                    if kind == "topup":
                        amount = validate_topup_amount(body.get("amount"))
                        intent = STATE.db.create_payment_intent_topup(user.id, amount)
                    elif kind == "purchase":
                        plan = plan_ref_from_body(body)
                        purchase = plan.to_purchase_dict()
                        intent = STATE.db.create_payment_intent_purchase(
                            user.id,
                            plan_name=purchase["name"],
                            country_code=purchase["country_code"],
                            gb=plan.gb,
                            days=purchase["days"],
                            amount_usd=purchase["usd"],
                        )
                    else:
                        raise SecurityError("invalid payment kind")
                    json_response(self, 200, intent.to_client_dict())
                    return

                if path == "/api/payments/complete":
                    require_payment_gateway()
                    intent_id = validate_record_id(body.get("id", ""), field="payment id")
                    method_name = validate_payment_method(body.get("payment_method", "card"))
                    provider_raw = body.get("payment_provider")
                    provider = validate_payment_provider(provider_raw) if provider_raw else None
                    intent = STATE.db.get_payment_intent(intent_id, user.id)
                    if intent.status != "pending":
                        raise ConflictError("payment is not pending")
                    completed = STATE.db.complete_payment_intent(
                        intent.id,
                        user.id,
                        payment_method=method_name,
                        payment_provider=str(provider) if provider else None,
                    )
                    payload = account_payload(user.id)
                    if completed.esim_id:
                        payload["esimId"] = completed.esim_id
                    json_response(self, 200, payload)
                    return

                if path == "/api/account/promo":
                    code = validate_promo_code(body.get("code", ""))
                    result = STATE.db.redeem_promo(user.id, code)
                    json_response(self, 200, {"result": result, **account_payload(user.id)})
                    return

                if path == "/api/account/touch-country":
                    country = validate_country_name(body.get("country_name", ""))
                    STATE.db.touch_country(user.id, country, purchased=False)
                    json_response(self, 200, account_payload(user.id))
                    return

                if path == "/api/account/purchase/balance":
                    plan = plan_ref_from_body(body)
                    purchase = plan.to_purchase_dict()
                    esim_id = secrets.token_hex(8)
                    order_id = secrets.token_hex(8)
                    try:
                        _order, esim = STATE.db.purchase_from_balance(
                            user_id=user.id,
                            order_id=order_id,
                            esim_id=esim_id,
                            name=purchase["name"],
                            country_code=purchase["country_code"],
                            gb=purchase["gb"],
                            days=purchase["days"],
                            amount_usd=purchase["usd"],
                            country_name_for_stats=purchase["name"],
                            esim_fields=esim_fields(esim_id, purchase["gb"]),
                        )
                    except InsufficientBalanceError:
                        json_response(self, 402, {"error": "insufficient balance"})
                        return
                    payload = account_payload(user.id)
                    payload["esimId"] = esim.id
                    json_response(self, 200, payload)
                    return

                if path == "/api/settings/email/unlink":
                    STATE.db.unlink_email(user.id)
                    json_response(self, 200, account_payload(user.id))
                    return

                if path == "/api/settings/email/confirm":
                    if STATE.production:
                        raise SecurityError("email verification is not configured")
                    email = validate_email(body.get("email", ""))
                    code = str(body.get("code", "")).strip()
                    if len(code) < 4 or len(code) > 6 or not code.isdigit():
                        raise SecurityError("invalid verification code")
                    STATE.db.update_user_settings(
                        user.id,
                        email=email,
                        email_verified=True,
                    )
                    json_response(self, 200, account_payload(user.id))
                    return

            if method == "PATCH" and path == "/api/settings":
                body = read_json(self)
                user = resolve_user(self)
                notifications = body.get("notifications")
                prefs = None
                if isinstance(notifications, dict):
                    prefs = NotificationPrefs(
                        news=bool(notifications.get("news", True)),
                        marketing=bool(notifications.get("marketing", False)),
                        traffic=bool(notifications.get("traffic", True)),
                    )
                kwargs: dict[str, Any] = {}
                if "email" in body:
                    raw_email = body.get("email")
                    kwargs["email"] = validate_email(raw_email) if raw_email else None
                    kwargs["email_verified"] = False
                if prefs is not None:
                    kwargs["notifications"] = prefs
                if kwargs:
                    STATE.db.update_user_settings(user.id, **kwargs)
                json_response(self, 200, account_payload(user.id))
                return

            json_response(self, 404, {"error": "not found"})
        except ConflictError as exc:
            json_response(self, 409, {"error": str(exc)})
        except NotFoundError as exc:
            json_response(self, 404, {"error": str(exc)})
        except RateLimitError as exc:
            json_response(self, 429, {"error": str(exc)})
        except AuthenticationError as exc:
            json_response(self, 401, {"error": str(exc)})
        except InsufficientBalanceError:
            json_response(self, 402, {"error": "insufficient balance"})
        except SecurityError as exc:
            json_response(self, 400, {"error": str(exc)})
        except ValueError as exc:
            json_response(self, 400, {"error": str(exc)})
        except Exception:
            logger.exception("Unhandled API error on %s", path)
            json_response(self, 500, {"error": "internal server error"})

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_PATCH(self) -> None:
        self._handle("PATCH")


def main() -> None:
    port = env_int("API_PORT", 8000)
    host = os.getenv("API_HOST", "127.0.0.1").strip() or "127.0.0.1"
    if not STATE.bot_token:
        raise SystemExit("telegram_bot_token is required")
    if STATE.production and host not in ("127.0.0.1", "::1", "0.0.0.0"):
        logger.info("API listening on all interfaces (container/network mode)")
    server = ThreadingHTTPServer((host, port), ApiHandler)
    logger.info("esimker API listening on http://%s:%s", host, port)
    logger.info(
        "Security: environment=%s mock_payments=%s cors_origins=%s",
        "production" if STATE.production else "development",
        STATE.allow_mock_payments,
        len(STATE.cors_origins),
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        STATE.db.close()


if __name__ == "__main__":
    main()
