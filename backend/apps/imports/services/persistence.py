"""
匯入結果持久化 — 將解析結果寫入 Django ORM

流程：
1. 建立 ImportLog 紀錄
2. 逐筆 update_or_create DataPoint
3. 逐筆 update_or_create YearlySummary
4. 執行匯入後分析（異常偵測）
"""
from __future__ import annotations

import logging

from apps.indicators.constants import SKIP_SPC_INDICATORS
from apps.indicators.models import (
    Alert,
    DataPoint,
    DataPointSubcategory,
    Indicator,
    YearlySummary,
)
from apps.imports.models import ImportLog
from apps.analysis.services.control_chart import MonthlyDataPoint
from apps.analysis.services.anomaly_detector import analyze_indicator

from .excel_parser import ParseResult

logger = logging.getLogger(__name__)


def save_import_results(
    parse_result: ParseResult,
    file_name: str,
    file_size: int,
) -> ImportLog:
    """Save parsed data to database and return ImportLog."""
    new_count = 0
    updated_count = 0
    unchanged_count = 0

    # Get valid indicator codes
    valid_codes = set(Indicator.objects.values_list("code", flat=True))

    # Save data points
    for dp in parse_result.data_points:
        if dp.indicator_code not in valid_codes:
            continue
        if dp.value is None and dp.numerator is None:
            continue

        obj, created = DataPoint.objects.update_or_create(
            indicator_id=dp.indicator_code,
            campus=dp.campus,
            year=dp.year,
            month=dp.month,
            defaults={
                "value": dp.value,
                "numerator": dp.numerator,
                "denominator": dp.denominator,
            },
        )

        if created:
            new_count += 1
        else:
            # Check if values actually changed
            changed = False
            if obj.value != dp.value:
                changed = True
            if obj.numerator != dp.numerator:
                changed = True
            if obj.denominator != dp.denominator:
                changed = True

            if changed:
                updated_count += 1
            else:
                unchanged_count += 1

    # Save subcategory data points (HA08-01 / HA10-01 sub-rows)
    for sdp in parse_result.subcategory_data_points:
        DataPointSubcategory.objects.update_or_create(
            subcategory_code=sdp.subcategory_code,
            campus=sdp.campus,
            year=sdp.year,
            month=sdp.month,
            defaults={
                "parent_code": sdp.parent_code,
                "value": sdp.value,
            },
        )

    # Save yearly summaries
    for summary in parse_result.yearly_summaries:
        if summary.indicator_code not in valid_codes:
            continue

        defaults = {}
        if summary.average is not None:
            defaults["average"] = summary.average
        if summary.benchmark_regional is not None:
            defaults["benchmark_regional"] = summary.benchmark_regional
        if summary.benchmark_district is not None:
            defaults["benchmark_district"] = summary.benchmark_district

        if defaults:
            YearlySummary.objects.update_or_create(
                indicator_id=summary.indicator_code,
                campus=summary.campus,
                year=summary.year,
                defaults=defaults,
            )

    # Create import log
    log = ImportLog.objects.create(
        file_name=file_name,
        file_size=file_size,
        sheets_processed=parse_result.sheets_processed,
        data_points_new=new_count,
        data_points_updated=updated_count,
        data_points_unchanged=unchanged_count,
        errors=parse_result.errors,
    )

    # Run post-import analysis
    try:
        run_post_import_analysis(parse_result, valid_codes)
    except Exception as e:
        logger.exception("Post-import analysis failed: %s", e)

    return log


def run_post_import_analysis(parse_result: ParseResult, valid_codes: set[str]) -> None:
    """Run anomaly detection for all affected indicators."""
    # Collect unique (code, campus) pairs
    affected: set[tuple[str, str]] = set()
    for dp in parse_result.data_points:
        if dp.indicator_code in valid_codes:
            affected.add((dp.indicator_code, dp.campus))

    for code, campus in affected:
        try:
            indicator = Indicator.objects.get(code=code)
        except Indicator.DoesNotExist:
            continue

        # Load all data points for this indicator+campus
        dps = DataPoint.objects.filter(
            indicator_id=code, campus=campus,
        ).order_by("year", "month")

        monthly_data = [
            MonthlyDataPoint(
                year=dp.year, month=dp.month, value=dp.value,
                numerator=dp.numerator, denominator=dp.denominator,
            )
            for dp in dps
        ]

        if not monthly_data:
            continue

        # Get peer value
        from apps.indicators.models import TCPIBenchmark
        peer_value = None
        tcpi = TCPIBenchmark.objects.filter(indicator_id=code).order_by("-year").first()
        if tcpi:
            if campus == "新竹":
                peer_value = tcpi.medical_center
            elif campus == "竹北":
                peer_value = tcpi.regional_hospital
            elif campus == "竹東":
                peer_value = tcpi.district_hospital

        # Run analysis（依「管制圖判定」文件，純計數型指標不畫管制圖）
        skip_cc = code in SKIP_SPC_INDICATORS
        target = indicator.target_value if indicator.target_mode and indicator.target_value is not None else None
        result = analyze_indicator(
            monthly_data, peer_value, indicator.direction, indicator.data_nature,
            skip_control_chart=skip_cc, target_value=target,
        )

        # Clear old alerts for this indicator+campus
        Alert.objects.filter(indicator_id=code, campus=campus).delete()

        # Save new alerts (only unfavorable ones with year/month)
        for anomaly in result.anomalies:
            if anomaly.direction == "unfavorable" and anomaly.severity in ("alert", "warning", "watch") and anomaly.year and anomaly.month:
                Alert.objects.create(
                    indicator_id=code,
                    campus=campus,
                    severity=anomaly.severity,
                    mechanism=anomaly.mechanism,
                    rule=anomaly.rule,
                    message=anomaly.message,
                    year=anomaly.year,
                    month=anomaly.month,
                )
