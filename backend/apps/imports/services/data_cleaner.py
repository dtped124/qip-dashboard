"""
資料清洗模組

處理 Excel 匯入時的值轉換：
- 清洗原始儲存格值（%, ‰, NR, NP, 分數格式）
- 正規化月份值（依年度×院區判斷比率/顯示格式）
- 標竿值單位統一
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from apps.indicators.constants import INDICATOR_META


@dataclass
class CleanResult:
    value: float | None
    had_symbol: bool
    numerator: int | None = None
    denominator: int | None = None


def clean_value_raw(raw) -> CleanResult:
    """清洗原始 Excel 儲存格值"""
    if raw is None or raw == "":
        return CleanResult(value=None, had_symbol=False)

    s = str(raw).strip()
    numerator = None
    denominator = None

    # Handle 110-year combined format: "3.27%\n(9/275)"
    if "\n" in s:
        parts = s.split("\n")
        for p in parts[1:]:
            frac_match = re.search(r"\(?(\d+)\s*/\s*(\d+)\)?", p.strip())
            if frac_match:
                numerator = int(frac_match.group(1))
                denominator = int(frac_match.group(2))
                break
        s = parts[0].strip()

    # No data markers
    if s in ("NR", "NP", "N/A", "-", ""):
        return CleanResult(value=None, had_symbol=False)

    # Pure fraction format — skip
    if re.match(r"^\(?\d+/\d+\)?$", s):
        return CleanResult(value=None, had_symbol=False)

    # Remove ‰ and % symbols
    has_permille = "‰" in s
    has_percent = "%" in s
    had_symbol = has_permille or has_percent
    cleaned = s.replace("‰", "").replace("%", "").strip()

    try:
        value = float(cleaned)
    except ValueError:
        return CleanResult(value=None, had_symbol=False)

    return CleanResult(value=value, had_symbol=had_symbol, numerator=numerator, denominator=denominator)


def clean_value(raw) -> float | None:
    """簡化版：只回傳數值"""
    return clean_value_raw(raw).value


def normalize_monthly_value(
    value: float | None,
    indicator_code: str,
    year: int,
    campus: str,
    had_symbol: bool,
) -> float | None:
    """正規化月份值 — 根據年度、院區、是否帶符號判斷是否需要轉換"""
    if value is None or value == 0:
        return value

    meta = INDICATOR_META.get(indicator_code)
    if not meta:
        return value

    if meta["unit"] in ("count", "ratio"):
        return value

    if had_symbol:
        return value

    if campus == "新竹":
        return value

    # Known raw-ratio year/campus ranges
    is_raw_ratio = (
        (campus == "竹東" and year >= 111) or
        (campus == "竹北" and 111 <= year <= 113)
    )

    if is_raw_ratio and value <= 1:
        return value * 100

    # Permille fallback
    if meta["unit"] == "permille" and 0 < value < 0.1:
        return value * 1000

    return value


def normalize_benchmark(
    value: float | None,
    indicator_code: str,
    year: int,
    campus: str,
) -> float | None:
    """標竿值單位統一"""
    if value is None:
        return None

    meta = INDICATOR_META.get(indicator_code)
    if not meta:
        return value

    if meta["unit"] in ("count", "ratio"):
        return value

    if campus == "新竹":
        return value

    if campus == "竹北" and year >= 114:
        return value

    if 0 < value < 1:
        return value * 100

    return value
