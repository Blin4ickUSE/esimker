"""Platega.io payment gateway (SBP, Russian cards)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL = "https://app.platega.io/transaction/process"

# https://docs.platega.io — paymentMethod integers
METHOD_SBP = 2
METHOD_CARD_RU = 10

PROVIDER_TO_METHOD: dict[str, int] = {
    "sbp": METHOD_SBP,
    "card_ru": METHOD_CARD_RU,
}

PLATEGA_PROVIDERS = frozenset(PROVIDER_TO_METHOD)


class PlategaError(Exception):
    """Platega API or configuration error."""


def configured() -> bool:
    return bool(_merchant_id() and _secret())


def _merchant_id() -> str:
    return os.getenv("platega_merchant_id", "").strip()


def _secret() -> str:
    return os.getenv("platega_secret", "").strip()


def usd_to_rub(usd: float) -> float:
    rate_raw = os.getenv("PLATEGA_USD_RUB_RATE", "95").strip()
    try:
        rate = float(rate_raw)
    except ValueError:
        rate = 95.0
    if rate <= 0:
        rate = 95.0
    return round(usd * rate, 2)


def provider_to_method(provider: str) -> int:
    method = PROVIDER_TO_METHOD.get(provider.lower())
    if method is None:
        raise PlategaError(f"unsupported payment provider: {provider}")
    return method


def verify_callback_headers(merchant_id: str, secret: str) -> bool:
    expected_mid = _merchant_id()
    expected_secret = _secret()
    if not expected_mid or not expected_secret:
        return False
    return merchant_id.strip() == expected_mid and secret.strip() == expected_secret


def create_transaction(
    *,
    provider: str,
    amount_rub: float,
    description: str,
    return_url: str,
    failed_url: str,
    payload: str,
) -> dict[str, Any]:
    """Create a Platega payment and return API response (redirect URL, transactionId)."""
    if not configured():
        raise PlategaError("platega is not configured")
    if amount_rub < 1:
        raise PlategaError("amount too small")

    merchant_id = _merchant_id()
    secret = _secret()
    method = provider_to_method(provider)

    body = {
        "paymentMethod": method,
        "paymentDetails": {
            "amount": round(float(amount_rub), 2),
            "currency": "RUB",
        },
        "description": description[:255] or "esimker payment",
        "return": return_url,
        "failedUrl": failed_url,
        "payload": payload[:512],
    }

    req = urllib.request.Request(
        BASE_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-MerchantId": merchant_id,
            "X-Secret": secret,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        logger.error("Platega HTTP %s: %s", exc.code, detail)
        raise PlategaError("platega request failed") from exc
    except urllib.error.URLError as exc:
        logger.error("Platega network error: %s", exc)
        raise PlategaError("platega unreachable") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("Platega invalid JSON: %s", raw[:200])
        raise PlategaError("invalid platega response") from exc

    if not isinstance(data, dict):
        raise PlategaError("invalid platega response")

    redirect = data.get("redirect") or data.get("redirectUrl")
    tx_id = data.get("transactionId") or data.get("id")
    if not redirect or not tx_id:
        logger.error("Platega response missing redirect/transactionId: %s", data)
        raise PlategaError("platega response incomplete")

    return {
        "redirectUrl": str(redirect),
        "transactionId": str(tx_id),
        "status": data.get("status"),
        "raw": data,
    }
