"""同儕值比較偵測"""
from __future__ import annotations

from .control_chart import AnomalyResult

DEVIATION_THRESHOLD = 0.10  # 10%
MONITOR_THRESHOLD = 0.20    # 20%


def detect_peer_deviation(
    value: float,
    peer_value: float | None,
    direction: str,
    year: int | None = None,
    month: int | None = None,
) -> AnomalyResult | None:
    """偵測與同儕值的偏差"""
    if peer_value is None or peer_value == 0:
        return None

    deviation_rate = (value - peer_value) / peer_value
    abs_deviation = abs(deviation_rate)
    dev_pct = f"{deviation_rate * 100:.1f}"

    if direction == "lower":
        if value > peer_value * (1 + DEVIATION_THRESHOLD):
            return AnomalyResult(
                mechanism="peer_comparison", severity="watch", direction="unfavorable",
                message=f"高於同儕值 {dev_pct}%（同儕值: {peer_value:.2f}）",
                value=value, reference_value=peer_value, year=year, month=month,
            )
        if value <= peer_value * (1 - DEVIATION_THRESHOLD):
            return AnomalyResult(
                mechanism="peer_comparison", severity="excellent", direction="favorable",
                message=f"低於同儕值 {abs(float(dev_pct))}%（同儕值: {peer_value:.2f}）",
                value=value, reference_value=peer_value, year=year, month=month,
            )
    elif direction == "higher":
        if value < peer_value * (1 - DEVIATION_THRESHOLD):
            return AnomalyResult(
                mechanism="peer_comparison", severity="watch", direction="unfavorable",
                message=f"低於同儕值 {abs(float(dev_pct))}%（同儕值: {peer_value:.2f}）",
                value=value, reference_value=peer_value, year=year, month=month,
            )
        if value >= peer_value * (1 + DEVIATION_THRESHOLD):
            return AnomalyResult(
                mechanism="peer_comparison", severity="excellent", direction="favorable",
                message=f"高於同儕值 {dev_pct}%（同儕值: {peer_value:.2f}）",
                value=value, reference_value=peer_value, year=year, month=month,
            )
    else:  # monitor
        if abs_deviation > MONITOR_THRESHOLD:
            return AnomalyResult(
                mechanism="peer_comparison", severity="watch", direction="unfavorable",
                message=f"與同儕值差異 {dev_pct}%（同儕值: {peer_value:.2f}）",
                value=value, reference_value=peer_value, year=year, month=month,
            )

    return None
