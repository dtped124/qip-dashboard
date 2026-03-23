"""月增減幅度變化偵測"""
from __future__ import annotations

from .control_chart import AnomalyResult, MonthlyDataPoint

CHANGE_THRESHOLD = 0.10  # 10%


def detect_monthly_changes(
    data_points: list[MonthlyDataPoint],
    direction: str,
) -> list[AnomalyResult]:
    """偵測月增減幅度異常：計算有效數據點的變化率，判斷是否 ≥ 10%"""
    anomalies: list[AnomalyResult] = []
    valid_points = [dp for dp in data_points if dp.value is not None]

    if len(valid_points) < 2:
        return anomalies

    for i in range(1, len(valid_points)):
        prev = valid_points[i - 1]
        curr = valid_points[i]
        prev_value = prev.value
        curr_value = curr.value

        if prev_value == 0:
            continue

        change_rate = (curr_value - prev_value) / abs(prev_value)
        abs_change = abs(change_rate)

        if abs_change < CHANGE_THRESHOLD:
            continue

        is_increase = change_rate > 0
        change_pct = f"{change_rate * 100:.1f}"

        if direction == "lower":
            anomalies.append(AnomalyResult(
                mechanism="monthly_change",
                severity="watch" if is_increase else "excellent",
                direction="unfavorable" if is_increase else "favorable",
                message=(
                    f"較上月增加 {change_pct}%（不利方向）" if is_increase
                    else f"較上月減少 {abs(float(change_pct))}%（改善趨勢）"
                ),
                value=curr_value,
                reference_value=prev_value,
                year=curr.year,
                month=curr.month,
            ))
        elif direction == "higher":
            anomalies.append(AnomalyResult(
                mechanism="monthly_change",
                severity="excellent" if is_increase else "watch",
                direction="favorable" if is_increase else "unfavorable",
                message=(
                    f"較上月增加 {change_pct}%（改善趨勢）" if is_increase
                    else f"較上月減少 {abs(float(change_pct))}%（不利方向）"
                ),
                value=curr_value,
                reference_value=prev_value,
                year=curr.year,
                month=curr.month,
            ))
        else:  # monitor
            anomalies.append(AnomalyResult(
                mechanism="monthly_change",
                severity="watch",
                direction="unfavorable",
                message=f"較上月{'增加' if is_increase else '減少'} {abs(float(change_pct))}%（大幅波動）",
                value=curr_value,
                reference_value=prev_value,
                year=curr.year,
                month=curr.month,
            ))

    return anomalies
