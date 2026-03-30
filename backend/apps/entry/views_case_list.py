"""
個案清單 API（§8.2A）
GET  /api/case-list/          — 取得個案清單
POST /api/case-list/exclude   — 排除個案
POST /api/case-list/restore   — 取消排除
GET  /api/case-list/exclusion-reasons
POST /api/case-list/review-exclusion  — 品管中心審查排除
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.entry.models import (
    CaseRecord,
    ExclusionReason,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.entry.models import Campus


def _mask_chart_no(chart_no: str, is_full: bool) -> str:
    """部分遮蔽病歷號（§5A.6）"""
    if is_full or len(chart_no) <= 3:
        return chart_no
    return chart_no[0] + "*" * (len(chart_no) - 2) + chart_no[-1]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def case_list(request):
    """
    GET /api/case-list/?indicator=HA03-01&campus=zhubei&year=115&month=3
    回傳：CaseRecord 列表 + 摘要統計
    病歷號顯示依角色決定是否完整
    """
    indicator_code = request.query_params.get("indicator", "")
    campus_code = request.query_params.get("campus", "")
    year = request.query_params.get("year")
    month = request.query_params.get("month")

    if not all([indicator_code, campus_code, year, month]):
        return Response({"detail": "缺少必要參數"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        campus = Campus.objects.get(code=campus_code)
    except Campus.DoesNotExist:
        return Response({"detail": f"找不到院區 {campus_code}"}, status=status.HTTP_404_NOT_FOUND)

    cat_code = indicator_code.split("-")[0]
    try:
        category = ReportCategory.objects.get(code=cat_code)
        report = MonthlyReport.objects.get(campus=campus, year=int(year), month=int(month), category=category)
        entry = IndicatorEntry.objects.get(report=report, indicator_code=indicator_code)
    except (ReportCategory.DoesNotExist, MonthlyReport.DoesNotExist, IndicatorEntry.DoesNotExist):
        return Response({"detail": "找不到指標數據"}, status=status.HTTP_404_NOT_FOUND)

    # 判斷是否顯示完整病歷號
    u = request.user
    show_full = (u.is_reviewer or u.is_system_admin or u.is_staff
                 or (u.campus and u.campus.code == campus_code))

    records = CaseRecord.objects.filter(entry=entry).select_related(
        "excluded_by", "exclusion_reason"
    ).order_by("created_at")

    # 統計
    total = records.count()
    numerator_total = records.filter(case_role="numerator").count()
    excluded = records.filter(is_excluded=True).count()
    final_numerator = numerator_total - excluded

    records_data = []
    for r in records:
        raw = dict(r.his_raw_data)
        # 遮蔽病歷號
        if "chart_no" in raw:
            raw["chart_no"] = _mask_chart_no(str(raw["chart_no"]), show_full)

        records_data.append({
            "id": r.id,
            "case_role": r.case_role,
            "his_raw_data": raw,
            "is_excluded": r.is_excluded,
            "excluded_by": r.excluded_by.full_name if r.excluded_by else None,
            "excluded_at": r.excluded_at.isoformat() if r.excluded_at else None,
            "exclusion_reason_code": r.exclusion_reason.code if r.exclusion_reason else None,
            "exclusion_reason_name": r.exclusion_reason.name if r.exclusion_reason else None,
            "exclusion_note": r.exclusion_note,
            "reviewer_approved": r.reviewer_approved,
            "reviewer_note": r.reviewer_note,
        })

    return Response({
        "entry_id": entry.id,
        "indicator_code": indicator_code,
        "summary": {
            "denominator_total": total,
            "raw_numerator": numerator_total,
            "excluded": excluded,
            "final_numerator": final_numerator,
        },
        "records": records_data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def case_list_exclude(request):
    """
    POST /api/case-list/exclude
    body: {case_record_ids: [...], exclusion_reason_code, exclusion_note}
    """
    ids = request.data.get("case_record_ids", [])
    reason_code = request.data.get("exclusion_reason_code", "")
    note = request.data.get("exclusion_note", "")

    if not ids:
        return Response({"detail": "缺少 case_record_ids"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        reason = ExclusionReason.objects.get(code=reason_code, is_active=True)
    except ExclusionReason.DoesNotExist:
        return Response({"detail": f"找不到排除理由代碼 {reason_code}"}, status=status.HTTP_400_BAD_REQUEST)

    if reason_code == "OTHER" and not note.strip():
        return Response({"detail": "選擇「其他」時，補充說明為必填"}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    updated = CaseRecord.objects.filter(id__in=ids).update(
        is_excluded=True,
        excluded_by=request.user,
        excluded_at=now,
        exclusion_reason=reason,
        exclusion_note=note,
    )

    # 重新計算 IndicatorEntry 的分子
    _recalculate_entry(ids)

    return Response({"ok": True, "updated": updated})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def case_list_restore(request):
    """POST /api/case-list/restore  body: {case_record_ids: [...]}"""
    ids = request.data.get("case_record_ids", [])
    if not ids:
        return Response({"detail": "缺少 case_record_ids"}, status=status.HTTP_400_BAD_REQUEST)

    updated = CaseRecord.objects.filter(id__in=ids).update(
        is_excluded=False,
        excluded_by=None,
        excluded_at=None,
        exclusion_reason=None,
        exclusion_note="",
    )
    _recalculate_entry(ids)
    return Response({"ok": True, "updated": updated})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def exclusion_reasons(request):
    """GET /api/case-list/exclusion-reasons"""
    reasons = ExclusionReason.objects.filter(is_active=True).order_by("sort_order")
    data = [{"code": r.code, "name": r.name, "description": r.description} for r in reasons]
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def review_exclusion(request):
    """
    POST /api/case-list/review-exclusion
    body: {case_record_id, approved: bool, reviewer_note}
    品管中心審查排除是否合理
    """
    u = request.user
    if not (u.is_reviewer or u.is_system_admin or u.is_staff):
        return Response({"detail": "需要審核者權限"}, status=status.HTTP_403_FORBIDDEN)

    record_id = request.data.get("case_record_id")
    approved = request.data.get("approved")
    note = request.data.get("reviewer_note", "")

    if record_id is None or approved is None:
        return Response({"detail": "缺少必要參數"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        record = CaseRecord.objects.get(pk=record_id)
    except CaseRecord.DoesNotExist:
        return Response({"detail": "找不到個案紀錄"}, status=status.HTTP_404_NOT_FOUND)

    record.reviewer_approved = approved
    record.reviewer_note = note
    record.save(update_fields=["reviewer_approved", "reviewer_note"])

    return Response({"ok": True, "case_record_id": record.id, "reviewer_approved": approved})


def _recalculate_entry(case_record_ids: list) -> None:
    """排除/恢復後重新計算 IndicatorEntry 的最終分子"""
    if not case_record_ids:
        return
    entries = set(
        CaseRecord.objects.filter(id__in=case_record_ids).values_list("entry_id", flat=True)
    )
    for entry_id in entries:
        try:
            entry = IndicatorEntry.objects.get(pk=entry_id)
            records = CaseRecord.objects.filter(entry=entry, case_role="numerator")
            raw_num = records.count()
            excluded = records.filter(is_excluded=True).count()
            final_num = raw_num - excluded
            entry.raw_numerator = raw_num
            entry.exclusion_count = excluded
            entry.numerator = final_num
            # 重算 value
            from apps.indicators.models import Indicator
            from decimal import Decimal
            try:
                ind = Indicator.objects.get(code=entry.indicator_code)
                den = entry.denominator
                if den and den > 0:
                    val = Decimal(str(final_num)) / den
                    if ind.unit == "percent":
                        val *= 100
                    elif ind.unit == "permille":
                        val *= 1000
                    entry.value = round(val, 6)
            except Indicator.DoesNotExist:
                pass
            entry.save(update_fields=["raw_numerator", "exclusion_count", "numerator", "value"])
        except IndicatorEntry.DoesNotExist:
            pass
