"""
QIP Indicators API Views

Endpoints:
- GET  /api/v1/indicators/                    — 指標列表
- GET  /api/v1/indicators/<code>/             — 指標詳情
- GET  /api/v1/indicators/<code>/data/        — 月份資料
- GET  /api/v1/indicators/<code>/alerts/      — 異常警示
- GET  /api/v1/indicators/<code>/summaries/   — 年度摘要
- GET  /api/v1/indicators/<code>/analysis/    — 即時分析（管制圖+異常偵測）
- GET  /api/v1/dashboard/?campus=竹北          — 儀表板批次載入（所有指標+資料+狀態）
- POST /api/v1/tcpi/                          — TCPI 標竿批次匯入
- GET  /api/v1/tcpi/                          — TCPI 標竿列表
"""
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Indicator, DataPoint, YearlySummary, Alert, TCPIBenchmark
from .serializers import (
    IndicatorSerializer, DataPointSerializer,
    YearlySummarySerializer, AlertSerializer, TCPIBenchmarkSerializer,
)
from apps.analysis.services.control_chart import (
    MonthlyDataPoint, select_chart_type, compute_control_chart_params,
)
from apps.analysis.services.anomaly_detector import analyze_indicator
from apps.analysis.services.aggregation import aggregate_to_quarterly
from .constants import SKIP_SPC_INDICATORS


@api_view(["GET"])
def indicator_list(request):
    """GET /api/v1/indicators/ — 取得所有指標"""
    campus = request.GET.get("campus", "")
    category = request.GET.get("category", "")

    qs = Indicator.objects.filter(is_active=True).order_by("code")
    if category:
        qs = qs.filter(category=category)

    indicators = []
    for ind in qs:
        if campus and campus not in ind.campuses:
            continue
        indicators.append(IndicatorSerializer(ind).data)

    return Response({"data": indicators, "total": len(indicators)})


@api_view(["GET", "PATCH"])
def indicator_detail(request, code: str):
    """
    GET   /api/v1/indicators/<code>/ — 指標詳情
    PATCH /api/v1/indicators/<code>/ — 更新指標設定（目前支援 target_mode / target_value）
    """
    try:
        ind = Indicator.objects.get(code=code)
    except Indicator.DoesNotExist:
        return Response({"error": {"code": "NOT_FOUND", "message": f"指標 {code} 不存在"}}, status=404)

    if request.method == "PATCH":
        body = request.data if hasattr(request, "data") else {}
        if "target_mode" in body:
            ind.target_mode = bool(body["target_mode"])
        if "target_value" in body:
            tv = body["target_value"]
            if tv in (None, "", False):
                ind.target_value = None
            else:
                try:
                    ind.target_value = float(tv)
                except (TypeError, ValueError):
                    return Response(
                        {"error": {"code": "BAD_REQUEST", "message": "target_value 必須為數字"}},
                        status=400,
                    )
        ind.save(update_fields=["target_mode", "target_value", "updated_at"])

        # 更新後立刻刷新該指標的 alerts，讓儀表板即時反映
        _refresh_indicator_alerts(ind)

    return Response(IndicatorSerializer(ind).data)


def _refresh_indicator_alerts(ind: Indicator) -> None:
    """重算該指標所有院區的 alerts（target_mode 變更後同步）"""
    campuses = (
        DataPoint.objects.filter(indicator_id=ind.code)
        .values_list("campus", flat=True).distinct()
    )
    target = ind.target_value if ind.target_mode and ind.target_value is not None else None
    skip_cc = ind.code in SKIP_SPC_INDICATORS

    for campus in campuses:
        dps = DataPoint.objects.filter(
            indicator_id=ind.code, campus=campus,
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

        peer_value = _get_peer_value(ind.code, campus)
        result = analyze_indicator(
            monthly_data, peer_value, ind.direction, ind.data_nature,
            skip_control_chart=skip_cc, target_value=target,
        )

        Alert.objects.filter(indicator_id=ind.code, campus=campus).delete()
        for anomaly in result.anomalies:
            if (anomaly.direction == "unfavorable"
                    and anomaly.severity in ("alert", "warning", "watch")
                    and anomaly.year and anomaly.month):
                Alert.objects.create(
                    indicator_id=ind.code,
                    campus=campus,
                    severity=anomaly.severity,
                    mechanism=anomaly.mechanism,
                    rule=anomaly.rule,
                    message=anomaly.message,
                    year=anomaly.year,
                    month=anomaly.month,
                )


@api_view(["GET"])
def indicator_data(request, code: str):
    """GET /api/v1/indicators/<code>/data/?campus=竹北 — 月份資料"""
    campus = request.GET.get("campus", "")
    if not campus:
        return Response({"error": {"code": "BAD_REQUEST", "message": "必須指定 campus"}}, status=400)

    points = DataPoint.objects.filter(
        indicator_id=code, campus=campus
    ).order_by("year", "month")

    return Response({
        "data": DataPointSerializer(points, many=True).data,
        "total": points.count(),
    })


@api_view(["GET"])
def indicator_alerts(request, code: str):
    """GET /api/v1/indicators/<code>/alerts/?campus=竹北 — 異常警示"""
    campus = request.GET.get("campus", "")
    if not campus:
        return Response({"error": {"code": "BAD_REQUEST", "message": "必須指定 campus"}}, status=400)

    alerts = Alert.objects.filter(
        indicator_id=code, campus=campus
    ).order_by("-year", "-month")

    return Response({
        "data": AlertSerializer(alerts, many=True).data,
        "total": alerts.count(),
    })


@api_view(["GET"])
def indicator_summaries(request, code: str):
    """GET /api/v1/indicators/<code>/summaries/?campus=竹北 — 年度摘要"""
    campus = request.GET.get("campus", "")
    if not campus:
        return Response({"error": {"code": "BAD_REQUEST", "message": "必須指定 campus"}}, status=400)

    summaries = YearlySummary.objects.filter(
        indicator_id=code, campus=campus
    ).order_by("year")

    # Also get TCPI benchmarks
    tcpi_list = TCPIBenchmark.objects.filter(indicator_id=code).order_by("year")

    return Response({
        "data": YearlySummarySerializer(summaries, many=True).data,
        "tcpi": TCPIBenchmarkSerializer(tcpi_list, many=True).data,
        "total": summaries.count(),
    })


@api_view(["GET"])
def indicator_analysis(request, code: str):
    """GET /api/v1/indicators/<code>/analysis/?campus=竹北&period=monthly — 即時分析"""
    campus = request.GET.get("campus", "")
    if not campus:
        return Response({"error": {"code": "BAD_REQUEST", "message": "必須指定 campus"}}, status=400)

    period = request.GET.get("period", "monthly")

    try:
        ind = Indicator.objects.get(code=code)
    except Indicator.DoesNotExist:
        return Response({"error": {"code": "NOT_FOUND"}}, status=404)

    # Load data
    dps = DataPoint.objects.filter(
        indicator_id=code, campus=campus
    ).order_by("year", "month")

    monthly_data = [
        MonthlyDataPoint(
            year=dp.year, month=dp.month, value=dp.value,
            numerator=dp.numerator, denominator=dp.denominator,
        )
        for dp in dps
    ]

    if not monthly_data:
        return Response({"status": "neutral", "anomalies": [], "control_chart": None, "peer_value": None})

    # 季度模式：先彙總月資料再分析
    if period == "quarterly" and not ind.is_quarterly:
        monthly_data = aggregate_to_quarterly(monthly_data, ind.data_nature, ind.unit)

    # Get peer value
    peer_value = _get_peer_value(code, campus)

    # Run analysis（依「管制圖判定」文件，純計數型指標不畫管制圖）
    skip_cc = code in SKIP_SPC_INDICATORS
    target = ind.target_value if ind.target_mode and ind.target_value is not None else None
    result = analyze_indicator(monthly_data, peer_value, ind.direction, ind.data_nature,
                                skip_control_chart=skip_cc, target_value=target)

    # Serialize control chart
    cc_data = None
    if result.control_chart:
        cc = result.control_chart
        cc_data = {
            "chart_type": cc.chart_type,
            "cl": cc.cl,
            "ucl": cc.ucl,
            "lcl": cc.lcl,
            "sigma": cc.sigma,
            "ucl2": cc.ucl2,
            "lcl2": cc.lcl2,
            "n": cc.n,
            "target_mode": bool(target is not None),
            "target_value": target,
            "variable_limits": [
                {
                    "year": vl.year, "month": vl.month,
                    "ucl": vl.ucl, "lcl": vl.lcl,
                    "ucl2": vl.ucl2, "lcl2": vl.lcl2,
                    "sample_size": vl.sample_size,
                }
                for vl in cc.variable_limits
            ],
        }

    anomalies_data = [
        {
            "mechanism": a.mechanism,
            "severity": a.severity,
            "direction": a.direction,
            "message": a.message,
            "value": a.value,
            "rule": a.rule,
            "reference_value": a.reference_value,
            "year": a.year,
            "month": a.month,
        }
        for a in result.anomalies
    ]

    return Response({
        "status": result.status,
        "anomalies": anomalies_data,
        "control_chart": cc_data,
        "peer_value": peer_value,
    })


@api_view(["GET"])
def dashboard_bulk(request):
    """
    GET /api/v1/dashboard/?campus=竹北 — 儀表板批次載入

    返回所有指標的：
    - 基本資料（code, name, category, unit, direction）
    - 最新值 + 期間
    - 最近 24 個月資料（sparkline 用）
    - 狀態（from alerts）
    - 異常機制列表
    - 年均值
    - 同儕/標竿值
    - 趨勢方向
    """
    campus = request.GET.get("campus", "竹北")
    category = request.GET.get("category", "")
    search = request.GET.get("search", "")

    # Load all active indicators for this campus
    all_indicators = Indicator.objects.filter(is_active=True).order_by("code")
    campus_indicators = [ind for ind in all_indicators if campus in ind.campuses]

    if category:
        campus_indicators = [ind for ind in campus_indicators if ind.category == category]
    if search:
        q = search.lower()
        campus_indicators = [
            ind for ind in campus_indicators
            if q in ind.code.lower() or q in ind.name.lower()
        ]

    # Bulk load data points for all indicators in this campus
    codes = [ind.code for ind in campus_indicators]
    all_dps = DataPoint.objects.filter(
        indicator_id__in=codes, campus=campus,
    ).order_by("year", "month").values("indicator_id", "year", "month", "value", "numerator", "denominator")

    # Group by indicator
    dp_map: dict[str, list[dict]] = {}
    for dp in all_dps:
        dp_map.setdefault(dp["indicator_id"], []).append(dp)

    # Bulk load alerts (include message for banner display)
    all_alerts = Alert.objects.filter(
        indicator_id__in=codes, campus=campus,
    ).values("indicator_id", "severity", "mechanism", "year", "month", "message")

    alert_map: dict[str, list[dict]] = {}
    for a in all_alerts:
        alert_map.setdefault(a["indicator_id"], []).append(a)

    # Bulk load yearly summaries (for benchmarks)
    all_summaries = YearlySummary.objects.filter(
        indicator_id__in=codes, campus=campus,
    ).order_by("year").values(
        "indicator_id", "year", "average", "benchmark_regional", "benchmark_district"
    )
    summary_map: dict[str, list[dict]] = {}
    for s in all_summaries:
        summary_map.setdefault(s["indicator_id"], []).append(s)

    # Bulk load TCPI
    all_tcpi = TCPIBenchmark.objects.filter(
        indicator_id__in=codes,
    ).order_by("-year").values(
        "indicator_id", "year", "medical_center", "regional_hospital", "district_hospital"
    )
    tcpi_map: dict[str, dict] = {}
    for t in all_tcpi:
        if t["indicator_id"] not in tcpi_map:
            tcpi_map[t["indicator_id"]] = t  # Keep latest year only

    # Build response
    result = []
    for ind in campus_indicators:
        code = ind.code
        dps = dp_map.get(code, [])
        alerts = alert_map.get(code, [])

        # Latest value
        valid_dps = [dp for dp in dps if dp["value"] is not None]
        latest_value = None
        latest_period = None
        if valid_dps:
            latest = max(valid_dps, key=lambda d: d["year"] * 100 + d["month"])
            latest_value = latest["value"]
            latest_period = f"{latest['year']}.{latest['month']:02d}"

        # Sparkline data (last 24 months, with year/month for matrix view)
        all_values = [dp["value"] for dp in dps]
        sparkline = all_values[-24:] if all_values else []

        # Full monthly data with year/month (for matrix status computation)
        monthly_data = [
            {"year": dp["year"], "month": dp["month"], "value": dp["value"]}
            for dp in dps
        ]

        # Status from alerts — only latest month matters
        if valid_dps:
            latest_dp = max(valid_dps, key=lambda d: d["year"] * 100 + d["month"])
            ly, lm = latest_dp["year"], latest_dp["month"]
        else:
            ly, lm = 0, 0

        unfavorable = [
            a for a in alerts
            if a["severity"] in ("alert", "warning", "watch")
            and a["year"] == ly and a["month"] == lm
        ]
        if any(a["severity"] == "alert" for a in unfavorable):
            status = "alert"
        elif any(a["severity"] == "warning" for a in unfavorable):
            status = "warning"
        elif any(a["severity"] == "watch" for a in unfavorable):
            status = "watch"
        elif valid_dps:
            status = "good"
        else:
            status = "neutral"

        # Anomaly mechanisms (latest month only)
        mechanisms = list(set(a["mechanism"] for a in unfavorable))

        # Peer/benchmark value (computed early for anomaly display)
        peer_value = None
        peer_source = None
        summaries = summary_map.get(code, [])
        if summaries:
            latest_s = summaries[-1]
            if campus == "竹北":
                peer_value = latest_s.get("benchmark_regional")
            elif campus == "竹東":
                peer_value = latest_s.get("benchmark_district") or latest_s.get("benchmark_regional")
        if peer_value is None:
            tcpi = tcpi_map.get(code)
            if tcpi:
                if campus == "新竹":
                    peer_value = tcpi.get("medical_center")
                elif campus == "竹北":
                    peer_value = tcpi.get("regional_hospital")
                elif campus == "竹東":
                    peer_value = tcpi.get("district_hospital")
                if peer_value is not None:
                    peer_source = "TCPI"

        # Latest month anomaly details (for banner display)
        # unfavorable is already filtered to latest month
        latest_anomalies = []
        seen_mechanisms: set[str] = set()
        for a in unfavorable:
            if a["mechanism"] not in seen_mechanisms:
                latest_anomalies.append({
                    "mechanism": a["mechanism"],
                    "severity": a["severity"],
                    "message": a.get("message", ""),
                })
                seen_mechanisms.add(a["mechanism"])

        # Real-time peer comparison (doesn't depend on Alert table)
        if "peer_comparison" not in seen_mechanisms and peer_value is not None and latest_value is not None:
            direction = ind.direction
            diff_pct = (latest_value - peer_value) / peer_value * 100 if peer_value != 0 else 0
            is_unfavorable = (
                (direction == "lower" and latest_value > peer_value * 1.10) or
                (direction == "higher" and latest_value < peer_value * 0.90) or
                (direction == "monitor" and abs(diff_pct) > 20)
            )
            if is_unfavorable:
                msg = f"高於同儕值 {abs(diff_pct):.1f}%（同儕值: {peer_value:.2f}）" if diff_pct > 0 else f"低於同儕值 {abs(diff_pct):.1f}%（同儕值: {peer_value:.2f}）"
                latest_anomalies.append({
                    "mechanism": "peer_comparison",
                    "severity": "watch",
                    "message": msg,
                })
                if "peer_comparison" not in mechanisms:
                    mechanisms.append("peer_comparison")

        # Year average (分母加權)
        year_avg = None
        year_label = None
        if valid_dps:
            latest_year = max(dp["year"] for dp in valid_dps)
            year_dps = [dp for dp in dps if dp["value"] is not None and dp["year"] == latest_year]
            if year_dps:
                with_den = [dp for dp in year_dps if dp.get("denominator") and dp["denominator"] > 0]
                if with_den:
                    den_sum = sum(dp["denominator"] for dp in with_den)
                    year_avg = sum(dp["value"] * dp["denominator"] for dp in with_den) / den_sum
                else:
                    year_avg = sum(dp["value"] for dp in year_dps) / len(year_dps)
                year_label = f"{latest_year}"

        # Trend
        trend = _compute_trend(all_values, ind.direction)

        # Unfavorable count
        unfavorable_count = len(unfavorable)

        result.append({
            "code": code,
            "name": ind.name,
            "category": ind.category,
            "unit": ind.unit,
            "direction": ind.direction,
            "data_nature": ind.data_nature,
            "is_quarterly": ind.is_quarterly,
            "latest_value": latest_value,
            "latest_period": latest_period,
            "sparkline": sparkline,
            "monthly_data": monthly_data,
            "status": status,
            "mechanisms": mechanisms,
            "unfavorable_count": unfavorable_count,
            "year_avg": year_avg,
            "year_label": year_label,
            "peer_value": peer_value,
            "peer_source": peer_source,
            "trend": trend,
            "latest_anomalies": latest_anomalies,
        })

    return Response({"data": result, "total": len(result), "campus": campus})


def _get_peer_value(code: str, campus: str) -> float | None:
    """Get peer/benchmark value for indicator+campus."""
    # Try YearlySummary first
    ys = YearlySummary.objects.filter(
        indicator_id=code, campus=campus,
    ).order_by("-year").first()
    if ys:
        if campus == "竹北" and ys.benchmark_regional is not None:
            return ys.benchmark_regional
        if campus == "竹東":
            val = ys.benchmark_district or ys.benchmark_regional
            if val is not None:
                return val

    # Try TCPI
    tcpi = TCPIBenchmark.objects.filter(indicator_id=code).order_by("-year").first()
    if tcpi:
        if campus == "新竹":
            return tcpi.medical_center
        elif campus == "竹北":
            return tcpi.regional_hospital
        elif campus == "竹東":
            return tcpi.district_hospital

    return None


def _compute_trend(values: list[float | None], direction: str) -> str:
    """Compute trend direction from recent values."""
    valid = [v for v in values if v is not None]
    if len(valid) < 3:
        return "flat"

    recent = valid[-6:] if len(valid) >= 6 else valid
    n = len(recent)
    xs = list(range(n))
    avg_x = sum(xs) / n
    avg_y = sum(recent) / n
    num = sum((xs[i] - avg_x) * (recent[i] - avg_y) for i in range(n))
    den = sum((xs[i] - avg_x) ** 2 for i in range(n))

    if den == 0:
        return "flat"

    slope = num / den
    threshold = abs(avg_y) * 0.05 or 0.01

    if slope > threshold:
        return "up"
    elif slope < -threshold:
        return "down"
    return "flat"


# ── TCPI Benchmark API ──

@api_view(["GET", "POST"])
def tcpi_benchmarks(request):
    """
    GET  /api/v1/tcpi/ — 取得所有 TCPI 標竿
    POST /api/v1/tcpi/ — 批次匯入 TCPI 標竿（清除舊資料後寫入）
    """
    if request.method == "GET":
        benchmarks = TCPIBenchmark.objects.all().order_by("indicator_id", "year")
        data = [
            {
                "indicator_code": b.indicator_id,
                "tcpi_name": b.tcpi_name,
                "year": b.year,
                "medical_center": b.medical_center,
                "regional_hospital": b.regional_hospital,
                "district_hospital": b.district_hospital,
            }
            for b in benchmarks
        ]
        return Response({"data": data, "total": len(data)})

    # POST: bulk import
    import json
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return Response({"error": {"code": "BAD_REQUEST", "message": "Invalid JSON"}}, status=400)

    items = body.get("benchmarks", [])
    if not items:
        return Response({"error": {"code": "BAD_REQUEST", "message": "No benchmarks provided"}}, status=400)

    # Get valid indicator codes
    valid_codes = set(Indicator.objects.values_list("code", flat=True))

    # Clear existing TCPI data
    TCPIBenchmark.objects.all().delete()

    # Insert new
    saved = 0
    for item in items:
        code = item.get("indicatorCode") or item.get("indicator_code")
        if not code or code not in valid_codes:
            continue
        TCPIBenchmark.objects.create(
            indicator_id=code,
            tcpi_name=item.get("tcpiName", item.get("tcpi_name", "")),
            year=item.get("year", 0),
            medical_center=item.get("medicalCenter", item.get("medical_center")),
            regional_hospital=item.get("regionalHospital", item.get("regional_hospital")),
            district_hospital=item.get("districtHospital", item.get("district_hospital")),
        )
        saved += 1

    return Response({"saved": saved, "total": len(items)})


def export_all_data(request):
    """GET /api/v1/export/ — 匯出全部資料供 QIP Portable 匯入"""
    from apps.imports.models import ImportLog, MatchingRule

    indicators = list(Indicator.objects.filter(is_active=True).values(
        "code", "name", "category", "unit", "direction",
        "is_active", "source", "aliases", "campuses",
        "formula", "description", "has_denominator",
        "entry_mode", "target_mode", "target_value",
    ))

    data_points = list(DataPoint.objects.all().values(
        "indicator_id", "campus", "year", "month",
        "value", "numerator", "denominator",
    ))

    yearly_summaries = list(YearlySummary.objects.all().values(
        "indicator_id", "campus", "year",
        "average", "benchmark_regional", "benchmark_district",
    ))

    tcpi_benchmarks = list(TCPIBenchmark.objects.all().values(
        "indicator_id", "tcpi_name", "year",
        "medical_center", "regional_hospital", "district_hospital",
    ))

    import_logs = list(ImportLog.objects.all().values(
        "id", "file_name", "file_size", "sheets_processed",
        "data_points_new", "data_points_updated", "data_points_unchanged",
        "errors", "created_at",
    ))
    for log in import_logs:
        log["created_at"] = log["created_at"].isoformat()

    matching_rules = list(MatchingRule.objects.all().values(
        "excel_name", "normalized_name", "indicator_code",
    ))

    from datetime import datetime, timezone as tz
    return JsonResponse({
        "version": 1,
        "exportedAt": datetime.now(tz.utc).isoformat(),
        "indicators": indicators,
        "dataPoints": data_points,
        "yearlySummaries": yearly_summaries,
        "tcpiBenchmarks": tcpi_benchmarks,
        "importLogs": import_logs,
        "matchingRules": matching_rules,
    })

