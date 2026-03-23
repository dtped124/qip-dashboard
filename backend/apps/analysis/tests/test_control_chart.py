"""管制圖計算單元測試"""
import pytest

from apps.analysis.services.control_chart import (
    MonthlyDataPoint,
    compute_imr_chart_params,
    compute_p_chart_params,
    compute_u_chart_params,
    detect_control_chart_anomalies,
    select_chart_type,
)


class TestSelectChartType:
    def test_continuous_returns_imr(self):
        data = [MonthlyDataPoint(year=113, month=m, value=float(m)) for m in range(1, 13)]
        assert select_chart_type(data, "continuous") == "I-MR"

    def test_binomial_with_nd_returns_p(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=3.0, numerator=30, denominator=1000)
            for m in range(1, 13)
        ]
        assert select_chart_type(data, "binomial_rate") == "P"

    def test_binomial_rare_event_returns_imr(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=0.1, numerator=1, denominator=100)
            for m in range(1, 13)
        ]
        # p_bar * avg_n = 0.01 * 100 = 1 < 5
        assert select_chart_type(data, "binomial_rate") == "I-MR"

    def test_poisson_returns_u(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=0.73, numerator=5, denominator=6849)
            for m in range(1, 13)
        ]
        assert select_chart_type(data, "poisson_rate") == "U"

    def test_insufficient_data_returns_imr(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=3.0, numerator=30, denominator=1000)
            for m in range(1, 4)
        ]
        assert select_chart_type(data, "binomial_rate") == "I-MR"


class TestIMRChart:
    def test_basic_computation(self):
        data = [MonthlyDataPoint(year=113, month=m, value=float(m)) for m in range(1, 13)]
        params = compute_imr_chart_params(data)
        assert params is not None
        assert params.chart_type == "I-MR"
        assert params.cl == pytest.approx(6.5, abs=0.01)
        assert params.ucl > params.cl
        assert params.lcl < params.cl
        assert params.n == 12

    def test_insufficient_data_returns_none(self):
        data = [MonthlyDataPoint(year=113, month=m, value=float(m)) for m in range(1, 4)]
        assert compute_imr_chart_params(data) is None

    def test_constant_values(self):
        data = [MonthlyDataPoint(year=113, month=m, value=5.0) for m in range(1, 13)]
        params = compute_imr_chart_params(data)
        assert params is not None
        assert params.sigma == 0
        assert params.ucl == params.cl


class TestPChart:
    def test_basic_computation(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=3.0, numerator=30, denominator=1000)
            for m in range(1, 13)
        ]
        params = compute_p_chart_params(data)
        assert params is not None
        assert params.chart_type == "P"
        assert params.cl == pytest.approx(3.0, abs=0.1)
        assert len(params.variable_limits) == 12


class TestUChart:
    def test_basic_computation(self):
        data = [
            MonthlyDataPoint(year=113, month=m, value=0.73, numerator=5, denominator=6849)
            for m in range(1, 13)
        ]
        params = compute_u_chart_params(data)
        assert params is not None
        assert params.chart_type == "U"
        assert params.cl > 0
        assert len(params.variable_limits) == 12


class TestAnomalyDetection:
    def test_rule1_above_ucl(self):
        data = [MonthlyDataPoint(year=113, month=m, value=5.0) for m in range(1, 12)]
        data.append(MonthlyDataPoint(year=113, month=12, value=50.0))  # extreme outlier
        params = compute_imr_chart_params(data)
        assert params is not None
        anomalies = detect_control_chart_anomalies(data, params, "lower")
        rule1 = [a for a in anomalies if a.rule and "rule1" in a.rule]
        assert len(rule1) > 0
        assert any(a.severity == "alert" for a in rule1)
