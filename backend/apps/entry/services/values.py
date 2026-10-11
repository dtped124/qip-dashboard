"""
Value rules shared by every path that writes an IndicatorEntry: online entry, reviewer edits,
case-list recalculation and Excel import.

- compute_value   ─ the one place where numerator / denominator turn into the indicator value
- parse_number    ─ strict parsing of user supplied numbers (no silent skipping)
- uses_sub_entries ─ D10: which indicator is entered as 13 sub-categories
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# D10: only HA10-01 at the Hsinchu campus is entered as 13 sub-categories that add up to the numerator.
# (HA10-04 and the other HA10 indicators of Hsinchu, and HA10-01 of the other campuses, are plain numbers.)
HA10_SUB_INDICATOR = "HA10-01"
HA10_SUB_CAMPUS = "hsinchu"

# HA10 Hsinchu sub-categories (13)
HA10_SUB_CATEGORIES = [
    {"sub_code": "HA10-10-01", "sub_name": "藥物事件"},
    {"sub_code": "HA10-10-02", "sub_name": "跌倒事件"},
    {"sub_code": "HA10-10-03", "sub_name": "管路事件"},
    {"sub_code": "HA10-10-04", "sub_name": "手術/處置事件"},
    {"sub_code": "HA10-10-05", "sub_name": "醫療儀器設備事件"},
    {"sub_code": "HA10-10-06", "sub_name": "院內不預期心跳停止事件"},
    {"sub_code": "HA10-10-07", "sub_name": "輸血事件"},
    {"sub_code": "HA10-10-08", "sub_name": "院內感染事件"},
    {"sub_code": "HA10-10-09", "sub_name": "燙傷事件"},
    {"sub_code": "HA10-10-10", "sub_name": "自殺/自傷事件"},
    {"sub_code": "HA10-10-11", "sub_name": "其他意外事件"},
    {"sub_code": "HA10-10-12", "sub_name": "診療事件"},
    {"sub_code": "HA10-10-13", "sub_name": "其他事件"},
]
HA10_SUB_NAMES = {s["sub_code"]: s["sub_name"] for s in HA10_SUB_CATEGORIES}

# entry_indicator_entries.value is numeric(12, 6): at most 6 digits before the decimal point.
VALUE_MAX_ABS = Decimal(10) ** 6


def uses_sub_entries(indicator_code: str, campus_code: str) -> bool:
    """D10: the 13 sub-categories exist for HA10-01 at Hsinchu only."""
    return indicator_code == HA10_SUB_INDICATOR and campus_code == HA10_SUB_CAMPUS


def compute_value(numerator, denominator, has_denominator: bool, unit: str):
    """
    The indicator value from its inputs.

    - no denominator (plain counts): the value is the numerator
    - permille x1000, percent x100, anything else is the plain ratio
    - a missing or zero denominator, or a missing numerator, gives None
    """
    if not has_denominator:
        return None if numerator is None else Decimal(str(numerator))
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    val = Decimal(str(numerator)) / Decimal(str(denominator))
    if unit == "permille":
        val = val * 1000
    elif unit == "percent":
        val = val * 100
    return round(val, 6)


def value_fits(value) -> bool:
    """False when ``value`` would overflow the numeric(12, 6) column."""
    return value is None or abs(value) < VALUE_MAX_ABS


def parse_number(raw, *, max_digits: int = 12, decimal_places: int = 2) -> Decimal | None:
    """
    A user supplied number as a Decimal that fits a numeric(max_digits, decimal_places) column.

    None stays None (the caller decides whether that means "clear"). Booleans, empty strings, text,
    NaN / Infinity and numbers too large for the column raise ValueError; nothing is skipped silently.
    Extra decimals are rounded half up, which is what the column would otherwise do on its own.
    """
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float, Decimal, str)):
        raise ValueError("not a number")
    text = raw.strip() if isinstance(raw, str) else str(raw)
    if not text:
        raise ValueError("empty")
    try:
        value = Decimal(text)
        if not value.is_finite():
            raise ValueError("not finite")
        value = value.quantize(Decimal(1).scaleb(-decimal_places), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise ValueError("not a number") from None
    if abs(value) >= Decimal(10) ** (max_digits - decimal_places):
        raise ValueError("out of range")
    return value
