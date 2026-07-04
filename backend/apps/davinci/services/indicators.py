"""
達文西匯入 — 七指標月聚合計算

- 比率型（DV01/04/05/06/07）：分子 = 事件人次、分母 = 去重總人次、值 = %。
  分子 0 照樣輸出 0/n（前端呈現 0/15 而非 0%）。
- 連續型（DV02/03）：value = 月平均、median_value = 月中位數（定案 #2）、
  denominator = 納入平均的台數、n_excluded = 清洗失敗 null 的台數。
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from ..constants import DAVINCI_INDICATORS
from .dedup import DedupCase


@dataclass
class AggregatedValue:
    """對應 DavinciIndicatorValue 一筆。"""
    campus: str
    period: int
    indicator_code: str
    numerator: int | None
    denominator: int | None
    value: float | None
    median_value: float | None
    n_cases: int
    n_excluded: int


def compute_indicators(cases: list[DedupCase]) -> list[AggregatedValue]:
    """對每個 (campus, period) 計算七指標。"""
    groups: dict[tuple[str, int], list[DedupCase]] = {}
    for c in cases:
        groups.setdefault((c.campus, c.period), []).append(c)

    out: list[AggregatedValue] = []
    for (campus, period), grp in sorted(groups.items()):
        n = len(grp)
        for code, meta in DAVINCI_INDICATORS.items():
            field = meta["case_field"]
            if meta["kind"] == "rate":
                num = sum(1 for c in grp if getattr(c, field))
                out.append(AggregatedValue(
                    campus=campus, period=period, indicator_code=code,
                    numerator=num, denominator=n,
                    value=round(num / n * 100, 2) if n > 0 else None,
                    median_value=None,
                    n_cases=n, n_excluded=0,
                ))
            else:  # continuous
                values = [getattr(c, field) for c in grp]
                present = [v for v in values if v is not None]
                out.append(AggregatedValue(
                    campus=campus, period=period, indicator_code=code,
                    numerator=None, denominator=len(present),
                    value=round(sum(present) / len(present), 1) if present else None,
                    median_value=round(median(present), 1) if present else None,
                    n_cases=n, n_excluded=n - len(present),
                ))
    return out
