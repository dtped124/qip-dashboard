import pytest


@pytest.fixture
def sample_monthly_data():
    """建立測試用的月份資料點"""
    from apps.analysis.services.control_chart import MonthlyDataPoint

    return [
        MonthlyDataPoint(year=113, month=m, value=2.0 + (m % 3) * 0.5)
        for m in range(1, 13)
    ]


@pytest.fixture
def sample_binomial_data():
    """建立測試用的二項比率資料（含分子/分母）"""
    from apps.analysis.services.control_chart import MonthlyDataPoint

    return [
        MonthlyDataPoint(year=113, month=m, value=3.0 + m * 0.2,
                         numerator=30 + m * 2, denominator=1000)
        for m in range(1, 13)
    ]
