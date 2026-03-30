"""
儀表板資料供給 API（§8.6）
取代原本的 IndexedDB 讀取，從後端 PostgreSQL 提供已核准/送出的資料。

GET /api/dashboard/entry-data?campus=zhubei&from=112-01&to=115-03
GET /api/dashboard/entry-benchmarks?campus=zhubei
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.entry.models import Campus, IndicatorEntry, MonthlyReport, ReportStatus


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entry_indicators(request):
    """
    GET /api/dashboard/entry-data?campus=zhubei&from=112-01&to=115-03

    回傳格式：
    {
      "HA01-01": [
        {"year": 115, "month": 3, "value": 2.67, "numerator": 12, "denominator": 450,
         "status": "finalized"},
        ...
      ],
      ...
    }

    只回傳 approved + finalized 的資料（品管中心已確認）。
    """
    campus_code = request.query_params.get("campus", "")
    from_str = request.query_params.get("from", "")
    to_str = request.query_params.get("to", "")

    try:
        campus = Campus.objects.get(code=campus_code)
    except Campus.DoesNotExist:
        return Response({"detail": f"找不到院區 {campus_code}"}, status=400)

    # 解析 from / to（格式：TWY-MM，如 112-01）
    def parse_ym(s: str):
        try:
            parts = s.split("-")
            return int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            return None, None

    from_year, from_month = parse_ym(from_str)
    to_year, to_month = parse_ym(to_str)

    # 篩選 reports（approved + finalized）
    report_qs = MonthlyReport.objects.filter(
        campus=campus,
        status__in=[ReportStatus.APPROVED, ReportStatus.FINALIZED],
    )
    if from_year:
        report_qs = report_qs.filter(
            year__gt=from_year
        ) | report_qs.filter(year=from_year, month__gte=from_month)
    if to_year:
        report_qs = report_qs.filter(
            year__lt=to_year
        ) | report_qs.filter(year=to_year, month__lte=to_month)

    report_ids = list(report_qs.values_list("id", flat=True))

    # 取得所有 entries
    entries = IndicatorEntry.objects.filter(
        report_id__in=report_ids
    ).select_related("report").order_by("report__year", "report__month")

    # 組織成 indicator_code → list of data points
    result: dict[str, list] = {}
    for entry in entries:
        code = entry.indicator_code
        if code not in result:
            result[code] = []
        result[code].append({
            "year": entry.report.year,
            "month": entry.report.month,
            "value": float(entry.value) if entry.value is not None else None,
            "numerator": float(entry.numerator) if entry.numerator is not None else None,
            "denominator": float(entry.denominator) if entry.denominator is not None else None,
            "data_source": entry.data_source,
            "status": entry.report.status,
        })

    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entry_benchmarks(request):
    """
    GET /api/dashboard/entry-benchmarks?campus=zhubei
    從 TCPI 表取得標竿值（已有現有 API，此為整合入口）
    """
    from apps.indicators.views import tcpi_benchmarks
    return tcpi_benchmarks(request)
