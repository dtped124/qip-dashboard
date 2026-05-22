"""
三重異常偵測引擎 — 整合管制圖、月增減、同儕比較

狀態判定優先級：
🔴 Alert    — 管制圖 Rule 1（3σ 超限）
🟠 Warning  — 管制圖 Rule 2-5，或多重不利因素
🟡 Watch    — 僅月增減不利 或 僅同儕比較不利
🟢 Good     — 無任何異常
🔵 Excellent — 多重改善訊號 + 優於同儕
⚪ Neutral  — 資料不足
"""
from __future__ import annotations

from dataclasses import dataclass

from .control_chart import (
    AnomalyResult,
    ControlChartParams,
    MonthlyDataPoint,
    compute_control_chart_params,
    detect_control_chart_anomalies,
    select_chart_type,
)
from .monthly_change import detect_monthly_changes
from .peer_comparison import detect_peer_deviation


@dataclass
class AnalysisResult:
    status: str  # IndicatorStatus
    anomalies: list[AnomalyResult]
    control_chart: ControlChartParams | None


def analyze_indicator(
    monthly_data: list[MonthlyDataPoint],
    peer_value: float | None,
    direction: str,
    data_nature: str = "continuous",
    skip_control_chart: bool = False,
    target_value: float | None = None,
) -> AnalysisResult:
    """三重異常偵測引擎

    target_value: 啟用挑戰平均值模式時，由呼叫端傳入目標值（顯示單位：% / ‰ / 原值）。
    """
    anomalies: list[AnomalyResult] = []

    sorted_data = sorted(
        [dp for dp in monthly_data if dp.value is not None],
        key=lambda dp: dp.year * 12 + dp.month,
    )

    if not sorted_data:
        return AnalysisResult(status="neutral", anomalies=[], control_chart=None)

    # Mechanism 1: Control chart
    control_chart: ControlChartParams | None = None
    if not skip_control_chart:
        recent_25 = sorted_data[-25:]
        chart_type = select_chart_type(recent_25, data_nature)
        control_chart = compute_control_chart_params(recent_25, chart_type, target_value=target_value)
        if control_chart:
            cc_anomalies = detect_control_chart_anomalies(sorted_data, control_chart, direction)
            anomalies.extend(cc_anomalies)

    # Mechanism 2: Monthly change
    monthly_anomalies = detect_monthly_changes(sorted_data, direction)
    anomalies.extend(monthly_anomalies)

    # Mechanism 3: Peer comparison
    latest = sorted_data[-1]
    if latest.value is not None and peer_value is not None:
        peer_anomaly = detect_peer_deviation(
            latest.value, peer_value, direction, latest.year, latest.month
        )
        if peer_anomaly:
            anomalies.append(peer_anomaly)

    status = _resolve_status(anomalies, latest)
    return AnalysisResult(status=status, anomalies=anomalies, control_chart=control_chart)


def _resolve_status(anomalies: list[AnomalyResult], latest: MonthlyDataPoint | None) -> str:
    if not latest or latest.value is None:
        return "neutral"

    all_relevant = [
        a for a in anomalies
        if (a.year is None and a.month is None)
        or (a.year == latest.year and a.month == latest.month)
    ]

    unfavorable = [a for a in all_relevant if a.direction == "unfavorable"]
    favorable = [a for a in all_relevant if a.direction == "favorable"]

    # 與 dashboard_bulk view 統一：watch 機制再多也不升級為 warning。
    # 升級只發生在 anomaly 本身就是 warning/alert 級別時（如管制圖 rule1/rule2）。
    has_alert = any(a.severity == "alert" for a in unfavorable)
    has_warning = any(a.severity == "warning" for a in unfavorable)
    has_watch = any(a.severity == "watch" for a in unfavorable)

    if has_alert:
        return "alert"
    if has_warning:
        return "warning"
    if has_watch:
        return "watch"

    has_excellent = any(a.severity == "excellent" for a in favorable)
    favorable_mechanisms = {a.mechanism for a in favorable}
    if has_excellent and len(favorable_mechanisms) >= 2:
        return "excellent"

    return "good"
