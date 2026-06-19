"""Crypto Pay (CryptoBot) payment gateway."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CRYPTOBOT_PROVIDERS = frozenset({"cryptobot"})

# Cloudflare blocks Python-urllib; use httpx with an explicit client identity.
_USER_AGENT = "esimker-cryptopay/1.0 (https://github.com/Blin4ickUSE/esimker)"


class CryptobotError(Exception):
    """Crypto Pay API or configuration error."""


def _api_token() -> str:
    return os.getenv("cryptobot_api_token", "").strip()


def _api_base() -> str:
    testnet = os.getenv("cryptobot_testnet", "").strip().lower() in ("1", "true", "yes")
    return "https://testnet-pay.crypt.bot/api" if testnet else "https://pay.crypt.bot/api"


def configured() -> bool:
    return bool(_api_token())


def _headers() -> dict[str, str]:
    return {
        "Crypto-Pay-API-Token": _api_token(),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": _USER_AGENT,
    }


def _request(method: str, api_method: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    token = _api_token()
    if not token:
        raise CryptobotError("cryptobot is not configured")
    url = f"{_api_base()}/{api_method}"
    try:
        with httpx.Client(timeout=30.0, headers=_headers()) as client:
            if method.upper() == "GET":
                resp = client.get(url)
            else:
                resp = client.post(url, json=body or {})
    except httpx.RequestError as exc:
        logger.error("Crypto Pay network error: %s", exc)
        raise CryptobotError("cryptobot unreachable") from exc

    if resp.status_code >= 400:
        detail = resp.text[:500]
        logger.error("Crypto Pay HTTP %s: %s", resp.status_code, detail)
        raise CryptobotError("cryptobot request failed") from None

    try:
        payload = resp.json()
    except ValueError as exc:
        logger.error("Crypto Pay invalid JSON: %s", resp.text[:200])
        raise CryptobotError("invalid cryptobot response") from exc

    if not isinstance(payload, dict):
        raise CryptobotError("invalid cryptobot response")
    if not payload.get("ok"):
        logger.error("Crypto Pay API error: %s", payload)
        raise CryptobotError("cryptobot api error")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise CryptobotError("cryptobot response incomplete")
    return result


def create_invoice(
    *,
    amount_usd: float,
    description: str,
    payload: str,
    paid_btn_url: str,
) -> dict[str, Any]:
    """Create a fiat-denominated USDT invoice. Returns invoice with bot_invoice_url."""
    if amount_usd < 0.01:
        raise CryptobotError("amount too small")
    body = {
        "currency_type": "fiat",
        "fiat": "USD",
        "amount": f"{amount_usd:.2f}",
        "description": description[:1024] or "esimker payment",
        "payload": payload[:4096],
        "paid_btn_name": "callback",
        "paid_btn_url": paid_btn_url,
        "expires_in": 1800,
    }
    result = _request("POST", "createInvoice", body)
    invoice_url = result.get("bot_invoice_url") or result.get("pay_url")
    invoice_id = result.get("invoice_id")
    if not invoice_url or invoice_id is None:
        logger.error("Crypto Pay invoice incomplete: %s", result)
        raise CryptobotError("cryptobot invoice incomplete")
    return {
        "redirectUrl": str(invoice_url),
        "transactionId": str(invoice_id),
        "raw": result,
    }


def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """HMAC-SHA256(SHA256(token), body) per Crypto Pay docs."""
    token = _api_token()
    if not token or not signature_header:
        return False
    secret = hashlib.sha256(token.encode()).digest()
    expected = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header.strip())


def parse_webhook_update(body: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """Return (update_type, payload) for invoice_paid events."""
    update_type = str(body.get("update_type", ""))
    payload = body.get("payload")
    if update_type == "invoice_paid" and isinstance(payload, dict):
        return update_type, payload
    return None
