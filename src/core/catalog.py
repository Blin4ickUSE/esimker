"""Server-side catalog and plan pricing (source of truth: assets/plans.json)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.security import SecurityError, validate_country_code, validate_days, validate_money

ROOT_DIR = Path(__file__).resolve().parents[2]
PLANS_PATH = ROOT_DIR / "assets" / "plans.json"
EXCLUDED = frozenset({"Весь мир (Lite)", "Весь мир (Max)"})


@dataclass(frozen=True, slots=True)
class CatalogPlan:
    name_en: str
    name_ru: str
    country_code: str
    gb: str
    days: int
    usd: float
    rub: float
    dent_inventory_item_id: str | None = None

    def to_purchase_dict(self) -> dict[str, Any]:
        gb_client: Any = "Безлимит" if self.gb == "unlimited" else (
            int(self.gb) if self.gb.isdigit() else float(self.gb)
        )
        return {
            "name": self.name_en,
            "country_code": self.country_code,
            "gb": gb_client,
            "days": self.days,
            "usd": self.usd,
        }


def _vol_ok(gb: Any) -> bool:
    if gb == "Безлимит":
        return True
    if isinstance(gb, (int, float)):
        return gb >= 1
    return False


def _gb_to_db(gb: Any) -> str:
    if gb == "Безлимит":
        return "unlimited"
    return str(gb)


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, str], dict[tuple[str, str, int], CatalogPlan]]:
    raw = json.loads(PLANS_PATH.read_text(encoding="utf-8"))
    code_by_name: dict[str, str] = {}
    plans_index: dict[tuple[str, str, int], CatalogPlan] = {}

    for item in raw:
        name_en = str(item.get("name_en", "")).strip()
        if not name_en or name_en in EXCLUDED:
            continue
        gb_raw = item.get("gb")
        if not _vol_ok(gb_raw):
            continue
        code = str(item.get("code", "")).strip().upper()
        days = int(item["days"])
        usd = round(float(item["usd"]), 2)
        rub = float(item.get("rub", 0))
        gb_db = _gb_to_db(gb_raw)

        if name_en not in code_by_name:
            code_by_name[name_en] = code

        key = (code, gb_db, days)
        dent_id = item.get("dent_inventory_item_id")
        plans_index[key] = CatalogPlan(
            name_en=name_en,
            name_ru=str(item.get("name_ru", name_en)),
            country_code=code,
            gb=gb_db,
            days=days,
            usd=usd,
            rub=rub,
            dent_inventory_item_id=str(dent_id).strip() if dent_id else None,
        )

    return code_by_name, plans_index


def lookup_plan(*, country_code: str, gb: Any, days: int) -> CatalogPlan:
    code = validate_country_code(country_code)
    days = validate_days(days)
    gb_db = _gb_to_db(gb)
    _code_by_name, plans_index = _catalog()
    plan = plans_index.get((code, gb_db, days))
    if plan is None:
        raise SecurityError("plan not found")
    return plan


def validate_topup_amount(value: Any) -> float:
    from core.security import MAX_TOPUP

    return validate_money(value, field="amount", min_value=1.0, max_value=MAX_TOPUP)
