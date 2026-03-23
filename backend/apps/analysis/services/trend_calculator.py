"""趨勢計算 — 線性回歸"""
from __future__ import annotations

from typing import Literal

import numpy as np

from .control_chart import MonthlyDataPoint

TrendDirection = Literal["up", "down", "flat"]


def calculate_trend(monthly_data: list[MonthlyDataPoint], n: int = 6) -> TrendDirection:
    """使用最近 N 個有值的月份做線性回歸，判定趨勢方向"""
    sorted_data = sorted(
        monthly_data,
        key=lambda dp: (dp.year, dp.month),
        reverse=True,
    )

    valid_points: list[tuple[int, float]] = []
    for p in sorted_data:
        if p.value is not None:
            valid_points.append((p.year * 12 + p.month, p.value))
            if len(valid_points) >= n:
                break

    if len(valid_points) < 3:
        return "flat"

    xs = np.array([p[0] for p in valid_points], dtype=np.float64)
    ys = np.array([p[1] for p in valid_points], dtype=np.float64)

    avg_x = np.mean(xs)
    avg_y = np.mean(ys)

    numerator = np.sum((xs - avg_x) * (ys - avg_y))
    denominator = np.sum((xs - avg_x) ** 2)

    if denominator == 0:
        return "flat"

    slope = numerator / denominator
    threshold = abs(avg_y) * 0.05 or 0.01

    if slope > threshold:
        return "up"
    if slope < -threshold:
        return "down"
    return "flat"
