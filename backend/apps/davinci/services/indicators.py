"""
達文西匯入 — 七指標月聚合計算（入庫路徑）

實際數學集中於 aggregation.aggregate_group()（全模組唯一實作），
本模組只負責把去重人次依 (campus, period) 分組並轉成 AggregatedValue
供 persistence 寫入 DavinciIndicatorValue（匯入時快照）。
"""
from __future__ import annotations

from dataclasses import dataclass

from .aggregation import aggregate_group
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
        for row in aggregate_group(grp):
            out.append(AggregatedValue(
                campus=campus,
                period=period,
                indicator_code=row["code"],
                numerator=row["numerator"],
                denominator=row["denominator"],
                value=row["value"],
                median_value=row["median_value"],
                n_cases=row["n_cases"],
                n_excluded=row["n_excluded"],
            ))
    return out
