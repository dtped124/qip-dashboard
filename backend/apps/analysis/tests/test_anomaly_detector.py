"""三重異常偵測引擎測試"""
import pytest

from apps.analysis.services.anomaly_detector import analyze_indicator
from apps.analysis.services.control_chart import MonthlyDataPoint


class TestAnalyzeIndicator:
    def test_no_data_returns_neutral(self):
        result = analyze_indicator([], None, "lower")
        assert result.status == "neutral"

    def test_stable_data_returns_good(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=3.0 + (m % 2) * 0.1)
            for m in range(1, 13)
        ]
        result = analyze_indicator(data, 3.0, "lower")
        assert result.status in ("good", "excellent")

    def test_extreme_value_triggers_alert(self):
        data = [MonthlyDataPoint(year=113, month=m, value=3.0) for m in range(1, 12)]
        data.append(MonthlyDataPoint(year=113, month=12, value=30.0))
        result = analyze_indicator(data, 3.0, "lower")
        assert result.status == "alert"

    def test_skip_control_chart(self):
        data = [MonthlyDataPoint(year=113, month=m, value=float(m)) for m in range(1, 13)]
        result = analyze_indicator(data, None, "higher", skip_control_chart=True)
        assert result.control_chart is None

    def test_peer_deviation_unfavorable(self):
        data = [MonthlyDataPoint(year=113, month=m, value=5.0) for m in range(1, 13)]
        result = analyze_indicator(data, 2.0, "lower")
        peer_anomalies = [a for a in result.anomalies if a.mechanism == "peer_comparison"]
        assert len(peer_anomalies) > 0
