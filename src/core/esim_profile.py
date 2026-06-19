"""eSIM profile field generation for new purchases."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

SMDP = "rsp.esimker.com"


def _hash_seed(s: str) -> int:
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    if h & 0x80000000:
        h -= 0x100000000
    return abs(h)


def gen_iccid(seed: str) -> str:
    h = _hash_seed(seed)
    tail = str(h).zfill(15)[:15]
    digits = f"89{tail}"
    total = 0
    for i, ch in enumerate(digits[:18]):
        d = int(ch)
        total += d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2)
    check = (10 - (total % 10)) % 10
    return f"{digits}{check}"


def gen_activation_code(seed: str) -> str:
    h = _hash_seed(seed + "act")
    return format(h, "x").upper().zfill(12)[:12]


def volume_gb_value(gb: Any) -> float | None:
    if gb in ("Безлимит", "unlimited"):
        return None
    return float(gb)


def build_esim_fields(esim_id: str, gb: Any) -> dict[str, Any]:
    return {
        "iccid": gen_iccid(esim_id),
        "smdp_address": SMDP,
        "activation_code": gen_activation_code(esim_id),
        "data_remaining_gb": volume_gb_value(gb),
        "data_total_gb": volume_gb_value(gb),
    }


def build_lpa_string(smdp_address: str | None, activation_code: str | None) -> str | None:
    if not activation_code:
        return None
    code = activation_code.strip()
    if code.startswith("LPA:"):
        return code
    if smdp_address:
        return f"LPA:1${smdp_address.strip()}${code}"
    return code or None


def build_apple_install_url(
    smdp_address: str | None,
    activation_code: str | None,
    *,
    apple_universal_link: str | None = None,
) -> str | None:
    if apple_universal_link and apple_universal_link.strip():
        return apple_universal_link.strip()
    lpa = build_lpa_string(smdp_address, activation_code)
    if not lpa:
        return None
    return (
        "https://esimsetup.apple.com/esim_qrcode_provisioning"
        f"?carddata={quote(lpa, safe='')}"
    )


def build_android_install_url(
    smdp_address: str | None,
    activation_code: str | None,
    *,
    android_universal_link: str | None = None,
    installation_url: str | None = None,
) -> str | None:
    if android_universal_link and android_universal_link.strip():
        return android_universal_link.strip()
    lpa = build_lpa_string(smdp_address, activation_code)
    if lpa:
        return (
            "https://esimsetup.android.com/esim_qrcode_provisioning"
            f"?carddata={quote(lpa, safe='')}"
        )
    if installation_url and installation_url.strip():
        return installation_url.strip()
    return None
