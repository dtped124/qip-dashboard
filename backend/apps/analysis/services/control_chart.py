"""
管制圖計算引擎

支援三種管制圖：
- I-MR (Individual-Moving Range): 連續型資料
- P Chart (Proportion): 二項比率資料，含變動管制限
- U Chart (Rate): Poisson 密度資料，含變動管制限

Western Electric Rules（依吳文祥教授 SPC 範本術語）：
- Rule 1: 單點超出 ±3σ 管制界限（失控，alert）
- Rule 2: 單點超出 ±2σ 警戒線（warning）
- Rule 3: 連續 7 點在 CL 同側（warning）
- Rule 4: 連續 7 點遞增或遞減（warning）
- Rule 5: 連續 3 點中有 2 點超出 ±2σ 警戒線（快失控，warning）
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

MIN_DATA_POINTS = 6
D2 = 1.128  # d2 constant for subgroup size n=2 (Moving Range)

ChartType = Literal["I-MR", "P", "U"]
DataNature = Literal["continuous", "binomial_rate", "poisson_rate"]
Direction = Literal["lower", "higher", "monitor"]


@dataclass
class MonthlyDataPoint:
    year: int
    month: int
    value: float | None
    numerator: int | None = None
    denominator: int | None = None


@dataclass
class VariableLimit:
    year: int
    month: int
    ucl: float
    lcl: float
    ucl2: float
    lcl2: float
    sample_size: int


@dataclass
class ControlChartParams:
    chart_type: ChartType
    cl: float
    ucl: float
    lcl: float
    sigma: float
    ucl2: float
    lcl2: float
    n: int
    variable_limits: list[VariableLimit] = field(default_factory=list)


@dataclass
class AnomalyResult:
    mechanism: str  # "control_chart", "monthly_change", "peer_comparison"
    severity: str   # "excellent", "good", "watch", "warning", "alert"
    direction: str  # "unfavorable", "favorable"
    message: str
    value: float
    rule: str = ""
    reference_value: float | None = None
    year: int | None = None
    month: int | None = None


def select_chart_type(data_points: list[MonthlyDataPoint], data_nature: DataNature) -> ChartType:
    """根據資料性質和分子分母可用性，智慧選擇管制圖類型"""
    if data_nature == "continuous":
        return "I-MR"

    valid_points = [dp for dp in data_points if dp.value is not None]
    with_nd = [
        dp for dp in data_points
        if dp.value is not None and dp.numerator is not None
        and dp.denominator is not None and dp.denominator > 0
    ]

    if len(with_nd) < MIN_DATA_POINTS:
        return "I-MR"

    coverage = len(with_nd) / len(valid_points) if valid_points else 0
    if coverage < 0.5:
        return "I-MR"

    if data_nature == "binomial_rate":
        return "P"

    if data_nature == "poisson_rate":
        avg_events = sum(dp.numerator for dp in with_nd) / len(with_nd)
        if avg_events < 1:
            return "I-MR"
        return "U"

    return "I-MR"


def compute_imr_chart_params(
    data_points: list[MonthlyDataPoint],
    target_value: float | None = None,
) -> ControlChartParams | None:
    """I-MR 管制圖：UCL = X̄ + 2.66 × MR̄

    挑戰平均值模式：若提供 target_value，則 CL 改為 target_value（σ 仍由 MR̄ 推導）。
    """
    values = np.array([dp.value for dp in data_points if dp.value is not None], dtype=np.float64)
    if len(values) < MIN_DATA_POINTS:
        return None

    cl = float(target_value) if target_value is not None else float(np.mean(values))
    mrs = np.abs(np.diff(values))
    mr_bar = float(np.mean(mrs))
    sigma = mr_bar / D2

    if sigma == 0:
        return ControlChartParams(chart_type="I-MR", cl=cl, ucl=cl, lcl=cl, sigma=0, ucl2=cl, lcl2=cl, n=len(values))

    ucl = cl + 3 * sigma
    lcl = max(0.0, cl - 3 * sigma)
    ucl2 = cl + 2 * sigma
    lcl2 = max(0.0, cl - 2 * sigma)

    return ControlChartParams(chart_type="I-MR", cl=cl, ucl=ucl, lcl=lcl, sigma=sigma, ucl2=ucl2, lcl2=lcl2, n=len(values))


def compute_p_chart_params(
    data_points: list[MonthlyDataPoint],
    target_value: float | None = None,
) -> ControlChartParams | None:
    """P Chart: p̄ = Σd_i / Σn_i, UCL_i = p̄ + 3√(p̄(1-p̄)/n_i)

    挑戰平均值模式：target_value 為百分比 (0~100)，套用後 σ 以目標 p 重算。
    """
    with_nd = [
        dp for dp in data_points
        if dp.value is not None and dp.numerator is not None
        and dp.denominator is not None and dp.denominator > 0
    ]
    if len(with_nd) < MIN_DATA_POINTS:
        return None

    total_num = sum(dp.numerator for dp in with_nd)
    total_den = sum(dp.denominator for dp in with_nd)
    computed_p = total_num / total_den

    # target_value 是百分比 (0~100)，需轉回比例 (0~1)
    if target_value is not None and 0 <= target_value <= 100:
        p_bar = target_value / 100.0
    else:
        p_bar = computed_p
    cl = p_bar * 100

    variable_limits = []
    for dp in with_nd:
        ni = dp.denominator
        sigma3 = 3 * math.sqrt(p_bar * (1 - p_bar) / ni) * 100
        sigma2 = 2 * math.sqrt(p_bar * (1 - p_bar) / ni) * 100
        variable_limits.append(VariableLimit(
            year=dp.year, month=dp.month,
            ucl=cl + sigma3, lcl=max(0.0, cl - sigma3),
            ucl2=cl + sigma2, lcl2=max(0.0, cl - sigma2),
            sample_size=ni,
        ))

    avg_n = total_den / len(with_nd)
    avg_sigma3 = 3 * math.sqrt(p_bar * (1 - p_bar) / avg_n) * 100
    avg_sigma2 = 2 * math.sqrt(p_bar * (1 - p_bar) / avg_n) * 100

    return ControlChartParams(
        chart_type="P", cl=cl,
        ucl=cl + avg_sigma3, lcl=max(0.0, cl - avg_sigma3),
        sigma=0, ucl2=cl + avg_sigma2, lcl2=max(0.0, cl - avg_sigma2),
        n=len(with_nd), variable_limits=variable_limits,
    )


def compute_u_chart_params(
    data_points: list[MonthlyDataPoint],
    target_value: float | None = None,
) -> ControlChartParams | None:
    """U Chart: ū = Σc_i / Σn_i, UCL_i = ū + 3√(ū/n_i)

    挑戰平均值模式：target_value 為千分比 (‰)，套用後 σ 以目標 u 重算。
    """
    with_nd = [
        dp for dp in data_points
        if dp.value is not None and dp.numerator is not None
        and dp.denominator is not None and dp.denominator > 0
    ]
    if len(with_nd) < MIN_DATA_POINTS:
        return None

    total_num = sum(dp.numerator for dp in with_nd)
    total_den = sum(dp.denominator for dp in with_nd)
    computed_u = total_num / total_den

    # target_value 是千分比 (‰)，需轉回每單位率
    if target_value is not None and target_value > 0:
        u_bar = target_value / 1000.0
    else:
        u_bar = computed_u
    cl = u_bar * 1000

    variable_limits = []
    for dp in with_nd:
        ni = dp.denominator
        sigma3 = 3 * math.sqrt(u_bar / ni) * 1000
        sigma2 = 2 * math.sqrt(u_bar / ni) * 1000
        variable_limits.append(VariableLimit(
            year=dp.year, month=dp.month,
            ucl=cl + sigma3, lcl=max(0.0, cl - sigma3),
            ucl2=cl + sigma2, lcl2=max(0.0, cl - sigma2),
            sample_size=ni,
        ))

    avg_n = total_den / len(with_nd)
    avg_sigma3 = 3 * math.sqrt(u_bar / avg_n) * 1000
    avg_sigma2 = 2 * math.sqrt(u_bar / avg_n) * 1000

    return ControlChartParams(
        chart_type="U", cl=cl,
        ucl=cl + avg_sigma3, lcl=max(0.0, cl - avg_sigma3),
        sigma=0, ucl2=cl + avg_sigma2, lcl2=max(0.0, cl - avg_sigma2),
        n=len(with_nd), variable_limits=variable_limits,
    )


def compute_control_chart_params(
    data_points: list[MonthlyDataPoint],
    chart_type: ChartType = "I-MR",
    target_value: float | None = None,
) -> ControlChartParams | None:
    """根據圖表類型計算管制圖參數"""
    if chart_type == "P":
        return compute_p_chart_params(data_points, target_value=target_value)
    elif chart_type == "U":
        return compute_u_chart_params(data_points, target_value=target_value)
    return compute_imr_chart_params(data_points, target_value=target_value)


def detect_control_chart_anomalies(
    data_points: list[MonthlyDataPoint],
    params: ControlChartParams,
    direction: Direction,
) -> list[AnomalyResult]:
    """Western Electric Rules 異常偵測"""
    anomalies: list[AnomalyResult] = []
    valid_points = [dp for dp in data_points if dp.value is not None]

    if params.sigma == 0 and not params.variable_limits:
        return anomalies

    # Build variable limits lookup
    limits_map: dict[str, VariableLimit] = {}
    for vl in params.variable_limits:
        limits_map[f"{vl.year}_{vl.month}"] = vl

    for dp in valid_points:
        value = dp.value
        vl = limits_map.get(f"{dp.year}_{dp.month}")
        ucl = vl.ucl if vl else params.ucl
        lcl = vl.lcl if vl else params.lcl
        ucl2 = vl.ucl2 if vl else params.ucl2
        lcl2 = vl.lcl2 if vl else params.lcl2

        # Rule 1: single point beyond ±3σ
        if value > ucl:
            if direction in ("lower", "monitor"):
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule1_above_ucl",
                    severity="alert", direction="unfavorable",
                    message=f"超出 3σ 管制上限 (失控, UCL={ucl:.2f})",
                    value=value, reference_value=ucl, year=dp.year, month=dp.month,
                ))
            elif direction == "higher":
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule1_above_ucl_favorable",
                    severity="excellent", direction="favorable",
                    message="顯著高於 3σ 管制上限，表現優異",
                    value=value, reference_value=ucl, year=dp.year, month=dp.month,
                ))

        if value < lcl and lcl > 0:
            if direction in ("higher", "monitor"):
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule1_below_lcl",
                    severity="alert", direction="unfavorable",
                    message=f"低於 3σ 管制下限 (失控, LCL={lcl:.2f})",
                    value=value, reference_value=lcl, year=dp.year, month=dp.month,
                ))
            elif direction == "lower":
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule1_below_lcl_favorable",
                    severity="excellent", direction="favorable",
                    message="顯著低於 3σ 管制下限，表現優異",
                    value=value, reference_value=lcl, year=dp.year, month=dp.month,
                ))

        # Rule 2: single point beyond ±2σ
        if value > ucl2 and value <= ucl:
            if direction in ("lower", "monitor"):
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule2_above_2sigma",
                    severity="warning", direction="unfavorable",
                    message="超出 2σ 警戒線",
                    value=value, reference_value=ucl2, year=dp.year, month=dp.month,
                ))

        if value < lcl2 and value >= lcl and lcl2 > 0:
            if direction in ("higher", "monitor"):
                anomalies.append(AnomalyResult(
                    mechanism="control_chart", rule="rule2_below_2sigma",
                    severity="warning", direction="unfavorable",
                    message="低於 2σ 警戒線",
                    value=value, reference_value=lcl2, year=dp.year, month=dp.month,
                ))

    # Rule 3: 7 consecutive points on same side of CL
    _detect_consecutive_same_side(valid_points, params, direction, anomalies)
    # Rule 4: 7 consecutive trending
    _detect_consecutive_trend(valid_points, direction, anomalies)
    # Rule 5: 2 of 3 beyond ±2σ
    _detect_two_of_three(valid_points, params, direction, anomalies, limits_map)

    return anomalies


def _detect_consecutive_same_side(
    points: list[MonthlyDataPoint],
    params: ControlChartParams,
    direction: Direction,
    anomalies: list[AnomalyResult],
) -> None:
    if len(points) < 7:
        return
    for i in range(6, len(points)):
        window = points[i - 6: i + 1]
        values = [p.value for p in window]
        all_above = all(v > params.cl for v in values)
        all_below = all(v < params.cl for v in values)

        if all_above:
            is_unfavorable = direction in ("lower", "monitor")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule3_7above",
                severity="warning",
                direction="unfavorable" if is_unfavorable else "favorable",
                message="連續 7 點高於中心線，可能存在趨勢偏移",
                value=values[6], reference_value=params.cl,
                year=window[6].year, month=window[6].month,
            ))

        if all_below:
            is_unfavorable = direction in ("higher", "monitor")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule3_7below",
                severity="warning",
                direction="unfavorable" if is_unfavorable else "favorable",
                message="連續 7 點低於中心線，可能存在趨勢偏移",
                value=values[6], reference_value=params.cl,
                year=window[6].year, month=window[6].month,
            ))


def _detect_consecutive_trend(
    points: list[MonthlyDataPoint],
    direction: Direction,
    anomalies: list[AnomalyResult],
) -> None:
    if len(points) < 7:
        return
    for i in range(6, len(points)):
        window = points[i - 6: i + 1]
        values = [p.value for p in window]

        increasing = all(values[j] > values[j - 1] for j in range(1, len(values)))
        decreasing = all(values[j] < values[j - 1] for j in range(1, len(values)))

        if increasing:
            is_unfavorable = direction in ("lower", "monitor")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule4_trending_up",
                severity="warning",
                direction="unfavorable" if is_unfavorable else "favorable",
                message="連續 7 點遞增趨勢",
                value=values[6], year=window[6].year, month=window[6].month,
            ))

        if decreasing:
            is_unfavorable = direction in ("higher", "monitor")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule4_trending_down",
                severity="warning",
                direction="unfavorable" if is_unfavorable else "favorable",
                message="連續 7 點遞減趨勢",
                value=values[6], year=window[6].year, month=window[6].month,
            ))


def _detect_two_of_three(
    points: list[MonthlyDataPoint],
    params: ControlChartParams,
    direction: Direction,
    anomalies: list[AnomalyResult],
    limits_map: dict[str, VariableLimit],
) -> None:
    if len(points) < 3:
        return
    for i in range(2, len(points)):
        window = points[i - 2: i + 1]
        values = [p.value for p in window]

        above_count = sum(
            1 for j, p in enumerate(window)
            if values[j] > (limits_map.get(f"{p.year}_{p.month}", None) or params).ucl2
            if hasattr(limits_map.get(f"{p.year}_{p.month}", params), "ucl2")
        )
        # Simplified: use params.ucl2 as fallback
        above_count = 0
        below_count = 0
        for j, p in enumerate(window):
            vl = limits_map.get(f"{p.year}_{p.month}")
            u2 = vl.ucl2 if vl else params.ucl2
            l2 = vl.lcl2 if vl else params.lcl2
            if values[j] > u2:
                above_count += 1
            if values[j] < l2 and l2 > 0:
                below_count += 1

        if above_count >= 2 and direction in ("lower", "monitor"):
            vl = limits_map.get(f"{window[2].year}_{window[2].month}")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule5_2of3_above",
                severity="warning", direction="unfavorable",
                message=f"連續 3 點中 {above_count} 點超出 2σ 警戒線上方 (快失控)",
                value=values[2],
                reference_value=vl.ucl2 if vl else params.ucl2,
                year=window[2].year, month=window[2].month,
            ))

        if below_count >= 2 and direction in ("higher", "monitor"):
            vl = limits_map.get(f"{window[2].year}_{window[2].month}")
            anomalies.append(AnomalyResult(
                mechanism="control_chart", rule="rule5_2of3_below",
                severity="warning", direction="unfavorable",
                message=f"連續 3 點中 {below_count} 點低於 2σ 警戒線下方 (快失控)",
                value=values[2],
                reference_value=vl.lcl2 if vl else params.lcl2,
                year=window[2].year, month=window[2].month,
            ))
