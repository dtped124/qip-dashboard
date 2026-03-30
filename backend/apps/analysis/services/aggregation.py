"""
月資料 → 季資料彙總

將月度資料點彙總為季度資料點（Q1-Q4）。
- binomial_rate / poisson_rate：加總分子分母後重算
- continuous：取非 null 值的平均
"""
from __future__ import annotations

import math
from collections import defaultdict

from .control_chart import MonthlyDataPoint, DataNature

QUARTER_START_MONTH = {1: 1, 2: 4, 3: 7, 4: 10}


def aggregate_to_quarterly(
    monthly_data: list[MonthlyDataPoint],
    data_nature: DataNature,
    unit: str = "percent",
) -> list[MonthlyDataPoint]:
    """將月度資料彙總為季度資料。輸出 month 使用 1/4/7/10。"""
    groups: dict[tuple[int, int], list[MonthlyDataPoint]] = defaultdict(list)

    for dp in monthly_data:
        if dp.value is None and dp.numerator is None:
            continue
        quarter = math.ceil(dp.month / 3)  # 1-4
        groups[(dp.year, quarter)].append(dp)

    result: list[MonthlyDataPoint] = []

    for (year, quarter), points in sorted(groups.items()):
        month = QUARTER_START_MONTH[quarter]

        if data_nature in ("binomial_rate", "poisson_rate"):
            with_nd = [
                p for p in points
                if p.numerator is not None and p.denominator is not None and p.denominator > 0
            ]
            if with_nd:
                total_num = sum(p.numerator for p in with_nd)
                total_den = sum(p.denominator for p in with_nd)
                multiplier = 1000 if unit == "permille" else 100
                value = (total_num / total_den * multiplier) if total_den > 0 else None
                result.append(MonthlyDataPoint(
                    year=year, month=month, value=value,
                    numerator=total_num, denominator=total_den,
                ))
            else:
                valid = [p.value for p in points if p.value is not None]
                value = sum(valid) / len(valid) if valid else None
                result.append(MonthlyDataPoint(year=year, month=month, value=value))
        else:
            valid = [p.value for p in points if p.value is not None]
            value = sum(valid) / len(valid) if valid else None
            result.append(MonthlyDataPoint(year=year, month=month, value=value))

    return result
