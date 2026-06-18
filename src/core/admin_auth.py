"""Admin panel authentication (login + signed session tokens)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

import bcrypt

SESSION_TTL_SECONDS = 7 * 24 * 3600


class AdminAuthError(Exception):
    """Invalid admin credentials or session."""


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _session_secret() -> bytes:
    secret = os.getenv("admin_session_secret", "").strip()
    if not secret:
        raise AdminAuthError("admin session is not configured")
    return secret.encode("utf-8")


def create_session_token(login: str) -> str:
    payload = {"login": login, "exp": int(time.time()) + SESSION_TTL_SECONDS}
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    sig = hmac.new(_session_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_session_token(token: str) -> str:
    token = token.strip()
    if not token or "." not in token:
        raise AdminAuthError("invalid session")
    body, sig = token.rsplit(".", 1)
    expected = hmac.new(_session_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise AdminAuthError("invalid session")
    pad = "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except (json.JSONDecodeError, ValueError) as exc:
        raise AdminAuthError("invalid session") from exc
    if not isinstance(payload, dict):
        raise AdminAuthError("invalid session")
    exp = int(payload.get("exp", 0))
    if exp < int(time.time()):
        raise AdminAuthError("session expired")
    login = str(payload.get("login", "")).strip()
    if not login:
        raise AdminAuthError("invalid session")
    return login


def authenticate_admin(login: str, password: str) -> str:
    expected_login = os.getenv("admin_login", "").strip()
    password_hash = os.getenv("admin_password_hash", "").strip()
    if not expected_login or not password_hash:
        raise AdminAuthError("admin credentials are not configured")
    if login.strip() != expected_login:
        raise AdminAuthError("invalid credentials")
    if not verify_password(password, password_hash):
        raise AdminAuthError("invalid credentials")
    return create_session_token(expected_login)


def parse_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise AdminAuthError("missing authorization")
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AdminAuthError("missing authorization")
    return verify_session_token(parts[1])
