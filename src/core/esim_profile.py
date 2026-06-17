"""eSIM profile field generation for new purchases."""

from __future__ import annotations

from typing import Any

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
