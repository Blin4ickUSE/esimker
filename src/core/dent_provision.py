"""Provision real eSIM profiles via the DENT Giga Store API."""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from api.dent import ActivationMode, DentAPIError, DentClient
from core.catalog import CatalogPlan
from core.esim_profile import volume_gb_value
from core.security import SecurityError

if TYPE_CHECKING:
    from core.database import Database, Esim, User

_INVENTORY_TTL = 300.0
_inventory_cache: tuple[float, list[dict[str, Any]]] | None = None


class DentProvisionError(SecurityError):
    """DENT activation failed or is unavailable."""


@dataclass(frozen=True, slots=True)
class ProvisionResult:
    esim_fields: dict[str, Any]
    inventory_item_id: str
    dent_customer_uid: str | None = None
    dent_profile_url: str | None = None


def dent_configured() -> bool:
    return bool(
        os.getenv("dent_client_id", "").strip()
        and os.getenv("dent_client_secret", "").strip()
    )


def parse_lpa_activation_code(activation_code: str) -> tuple[str, str]:
    """Split ``LPA:1$<smdp>$<code>`` into SM-DP+ address and activation code."""
    code = activation_code.strip()
    if code.startswith("LPA:"):
        parts = code.split("$")
        if len(parts) >= 3:
            return parts[1], parts[2]
    return "", code


def _item_size_gb(item: dict[str, Any]) -> float:
    val = float(item.get("sizeValue") or 0)
    unit = str(item.get("sizeUnit") or "MB").upper()
    if unit == "GB":
        return val
    if unit == "MB":
        return val / 1024.0
    if unit == "TB":
        return val * 1024.0
    return val


def _validity_matches(item: dict[str, Any], days: int) -> bool:
    if item.get("validityUnlimited"):
        return False
    try:
        size = int(item.get("validitySize") or 0)
    except (TypeError, ValueError):
        return False
    unit = str(item.get("validityUnit") or "days").lower().rstrip("s")
    return unit == "day" and size == int(days)


def _is_unlimited_gb(gb: Any) -> bool:
    if gb in ("Безлимит", "unlimited"):
        return True
    return str(gb).lower() == "unlimited"


def _size_matches(item: dict[str, Any], gb: Any) -> bool:
    if _is_unlimited_gb(gb):
        name = str(item.get("name") or "").lower()
        return "unlimited" in name or "unlim" in name
    try:
        target = float(gb)
    except (TypeError, ValueError):
        return False
    item_gb = _item_size_gb(item)
    return abs(item_gb - target) < 0.05 or round(item_gb) == round(target)


def resolve_inventory_item_id(
    items: list[dict[str, Any]],
    *,
    country_code: str,
    gb: Any,
    days: int,
    override_id: str | None = None,
) -> str:
    if override_id:
        return override_id

    country_set = country_code.upper()
    matches = [
        item
        for item in items
        if str(item.get("countrySet") or "").upper() == country_set
        and _validity_matches(item, days)
        and _size_matches(item, gb)
    ]
    if not matches:
        raise DentProvisionError("no matching DENT inventory item for this plan")

    matches.sort(
        key=lambda item: float(
            (item.get("retailPrices") or item.get("prices") or [{}])[0].get("priceValue") or 0
        )
    )
    item_id = matches[0].get("id")
    if not item_id:
        raise DentProvisionError("invalid DENT inventory item")
    return str(item_id)


def _retail_price(plan: CatalogPlan) -> dict[str, Any]:
    return {
        "sortIndex": 0,
        "priceValue": plan.usd,
        "currencyCode": "USD",
    }


def _customer_email(user: User) -> str:
    if user.email and user.email_verified:
        return user.email
    return f"tg{user.telegram_id}@esimker.app"


def _balance_gb(balance: dict[str, Any] | None) -> float | None:
    if not balance:
        return None
    avail = balance.get("availableBalance") or balance.get("size") or {}
    if not avail:
        return None
    return _item_size_gb(avail)


def map_dent_response_to_esim_fields(
    response: dict[str, Any],
    *,
    gb: Any,
    existing_esim: Esim | None = None,
    order_id: str,
) -> dict[str, Any]:
    activated = response.get("activatedItem") or {}
    balance = activated.get("balance") or {}
    profile = response.get("esimProfile") or {}
    customer = response.get("customer") or {}

    if not profile and existing_esim:
        profile = {
            "iccid": existing_esim.iccid,
            "imsi": existing_esim.imsi,
            "activationCode": (
                f"LPA:1${existing_esim.smdp_address}${existing_esim.activation_code}"
                if existing_esim.smdp_address and existing_esim.activation_code
                else existing_esim.activation_code
            ),
            "appleUniversalLink": existing_esim.apple_universal_link,
            "androidUniversalLink": existing_esim.android_universal_link,
            "installationUrl": existing_esim.installation_url,
            "uid": existing_esim.dent_esim_uid,
            "state": existing_esim.dent_esim_state,
            "lastSeen": existing_esim.last_seen_at,
            "activatedAt": existing_esim.activated_at,
        }

    activation_raw = str(profile.get("activationCode") or "")
    smdp, activation_part = parse_lpa_activation_code(activation_raw)
    if not activation_part and activation_raw:
        activation_part = activation_raw

    data_total = volume_gb_value(gb)
    data_remaining = _balance_gb(balance) if balance else data_total

    fields: dict[str, Any] = {
        "iccid": profile.get("iccid"),
        "imsi": profile.get("imsi"),
        "smdp_address": smdp or None,
        "activation_code": activation_part or None,
        "apple_universal_link": profile.get("appleUniversalLink"),
        "android_universal_link": profile.get("androidUniversalLink"),
        "installation_url": profile.get("installationUrl"),
        "data_remaining_gb": data_remaining,
        "data_total_gb": data_total,
        "dent_activation_uid": activated.get("uid"),
        "dent_esim_uid": profile.get("uid"),
        "dent_esim_state": profile.get("state"),
        "metatag": order_id,
        "activated_at": balance.get("activatedAt") or profile.get("activatedAt"),
        "expires_at": balance.get("expiresAt"),
        "last_seen_at": profile.get("lastSeen"),
        "dent_customer_uid": customer.get("uid"),
    }
    return {key: value for key, value in fields.items() if value is not None}


async def _fetch_inventory(client: DentClient) -> list[dict[str, Any]]:
    global _inventory_cache
    now = time.monotonic()
    if _inventory_cache and now - _inventory_cache[0] < _INVENTORY_TTL:
        return _inventory_cache[1]

    data = await client.get_inventory_items()
    items = data.get("items", []) if isinstance(data, dict) else []
    if not isinstance(items, list):
        items = []
    _inventory_cache = (now, items)
    return items


async def _activate(
    client: DentClient,
    *,
    user: User,
    plan: CatalogPlan,
    order_id: str,
    inventory_item_id: str,
    existing_esim: Esim | None,
    user_ip: str | None,
    user_country: str | None,
) -> dict[str, Any]:
    body_base: dict[str, Any] = {
        "inventoryItemId": inventory_item_id,
        "metatag": order_id,
        "expectedPrice": _retail_price(plan),
        "activationMode": ActivationMode.FIRST_USE.value,
        "userCountry": (user_country or plan.country_code).upper(),
    }
    if user_ip:
        body_base["userIp"] = user_ip

    customer_uid: str | None = None
    if existing_esim and existing_esim.iccid:
        customer_uid = existing_esim.dent_customer_uid or user.dent_customer_uid

    if existing_esim and existing_esim.iccid and customer_uid:
        return await client.top_up(
            {
                **body_base,
                "customerUid": customer_uid,
            },
            idempotency_key=order_id,
        )

    return await client.register(
        {
            **body_base,
            "customerEmail": _customer_email(user),
        },
        idempotency_key=order_id,
    )


async def _provision_async(
    db: Database,
    *,
    user_id: int,
    order_id: str,
    plan: CatalogPlan,
    user_ip: str | None,
    user_country: str | None,
    inventory_override: str | None,
) -> ProvisionResult:
    user = db.get_user_by_id(user_id)
    if user is None:
        raise DentProvisionError("user not found")

    existing_esim = db.find_dent_topup_esim(user_id, plan.country_code)

    async with DentClient.from_env() as client:
        items = await _fetch_inventory(client)
        inventory_item_id = resolve_inventory_item_id(
            items,
            country_code=plan.country_code,
            gb=plan.gb,
            days=plan.days,
            override_id=inventory_override,
        )
        try:
            response = await _activate(
                client,
                user=user,
                plan=plan,
                order_id=order_id,
                inventory_item_id=inventory_item_id,
                existing_esim=existing_esim,
                user_ip=user_ip,
                user_country=user_country,
            )
        except DentAPIError as exc:
            raise DentProvisionError(f"DENT activation failed: {exc.message}") from exc

    if str(response.get("status", "")).lower() not in ("success", "ok", ""):
        raise DentProvisionError("DENT activation returned an error")

    esim_fields = map_dent_response_to_esim_fields(
        response,
        gb=plan.gb,
        existing_esim=existing_esim,
        order_id=order_id,
    )
    if not esim_fields.get("iccid"):
        raise DentProvisionError("DENT did not return an eSIM profile")

    customer = response.get("customer") or {}
    return ProvisionResult(
        esim_fields=esim_fields,
        inventory_item_id=inventory_item_id,
        dent_customer_uid=customer.get("uid"),
        dent_profile_url=customer.get("profileUrl"),
    )


def provision_dent_esim(
    db: Database,
    *,
    user_id: int,
    order_id: str,
    plan: CatalogPlan,
    user_ip: str | None = None,
    user_country: str | None = None,
    inventory_override: str | None = None,
) -> ProvisionResult:
    if not dent_configured():
        raise DentProvisionError("DENT API credentials are not configured")

    return asyncio.run(
        _provision_async(
            db,
            user_id=user_id,
            order_id=order_id,
            plan=plan,
            user_ip=user_ip,
            user_country=user_country,
            inventory_override=inventory_override,
        )
    )
