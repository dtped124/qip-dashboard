"""
個案清單 API（§8.2A）
GET  /api/case-list/          — 取得個案清單
POST /api/case-list/exclude   — 排除個案
POST /api/case-list/restore   — 取消排除
GET  /api/case-list/exclusion-reasons
POST /api/case-list/review-exclusion  — 品管中心審查排除
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import (
    REVIEWER,
    IsReporter,
    IsReporterOrReviewer,
    IsReviewer,
    has_role,
)
from apps.entry.models import (
    Campus,
    CaseRecord,
    ExclusionReason,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
)
from apps.entry.services.assignments import active_assignments, assigned_fields, period_bounds
from apps.entry.services.errors import forbidden, rejected
from apps.entry.services.values import compute_value, value_fits
from apps.indicators.models import Indicator


def _mask_chart_no(chart_no: str, is_full: bool) -> str:
    """部分遮蔽病歷號（§5A.6）"""
    if is_full or len(chart_no) <= 3:
        return chart_no
    return chart_no[0] + "*" * (len(chart_no) - 2) + chart_no[-1]


def _sees_full_chart_no(user, campus: Campus, year: int, month: int) -> bool:
    """
    Whether the full chart number is shown (§5A.6): reviewers and admins, and everybody with an assignment
    in force at that campus that month (any indicator, any field). Not the user's own ``campus`` column:
    that says where the account works, not what it is responsible for.
    """
    return bool(has_role(user, REVIEWER) or active_assignments(year, month, user=user, campus=campus).exists())


@api_view(["GET"])
@permission_classes([IsReporterOrReviewer])
def case_list(request):
    """
    GET /api/case-list/?indicator=HA03-01&campus=zhubei&year=115&month=3
    回傳：CaseRecord 列表 + 摘要統計

    Who may read (the records carry HIS data and chart numbers): reviewers and admins any case list; a
    reporter only the case lists of indicators assigned to them (any field) at that campus in that month,
    otherwise 403 ``not_assigned``. That check comes before anything is looked up, so a refused caller
    learns nothing about which campuses, reports or entries exist.
    """
    indicator_code = request.query_params.get("indicator", "")
    campus_code = request.query_params.get("campus", "")
    year = request.query_params.get("year")
    month = request.query_params.get("month")

    if not all([indicator_code, campus_code, year, month]):
        return Response({"detail": "缺少必要參數"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        year, month = int(year), int(month)
    except ValueError:
        raise rejected("年月不正確", "invalid_period") from None
    period_bounds(year, month)  # 400 invalid_period

    u = request.user
    campus = Campus.objects.filter(code=campus_code).first()
    if not has_role(u, REVIEWER):  # reviewer, or admin (has_role is true for admins)
        assigned = (
            campus is not None
            and active_assignments(year, month, user=u, campus=campus).filter(indicator_code=indicator_code).exists()
        )
        if not assigned:
            raise forbidden("你沒有這個指標在該院區的指派，無法查看個案清單", "not_assigned")

    if campus is None:
        return Response({"detail": f"找不到院區 {campus_code}"}, status=status.HTTP_404_NOT_FOUND)

    cat_code = indicator_code.split("-")[0]
    try:
        category = ReportCategory.objects.get(code=cat_code)
        report = MonthlyReport.objects.get(campus=campus, year=year, month=month, category=category)
        entry = IndicatorEntry.objects.get(report=report, indicator_code=indicator_code)
    except (ReportCategory.DoesNotExist, MonthlyReport.DoesNotExist, IndicatorEntry.DoesNotExist):
        return Response({"detail": "找不到指標數據"}, status=status.HTTP_404_NOT_FOUND)

    # 判斷是否顯示完整病歷號
    show_full = _sees_full_chart_no(u, campus, year, month)

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
@permission_classes([IsReporter])
def case_list_exclude(request):
    """
    POST /api/case-list/exclude
    body: {case_record_ids: [...], exclusion_reason_code, exclusion_note}

    Every id must belong to an entry whose numerator the user is assigned to, in a report that is not
    locked for reporters; otherwise 403 and nothing changes.
    """
    ids = _case_record_ids(request.data)
    reason_code = request.data.get("exclusion_reason_code", "")
    note = str(request.data.get("exclusion_note") or "")

    try:
        reason = ExclusionReason.objects.get(code=reason_code, is_active=True)
    except ExclusionReason.DoesNotExist:
        return Response({"detail": f"找不到排除理由代碼 {reason_code}"}, status=status.HTTP_400_BAD_REQUEST)

    if reason_code == "OTHER" and not note.strip():
        return Response({"detail": "選擇「其他」時，補充說明為必填"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        _authorize_case_records(request.user, ids)
        updated = CaseRecord.objects.filter(id__in=ids).update(
            is_excluded=True,
            excluded_by=request.user,
            excluded_at=timezone.now(),
            exclusion_reason=reason,
            exclusion_note=note,
        )
        # 重新計算 IndicatorEntry 的分子
        _recalculate_entry(ids, request.user)

    return Response({"ok": True, "updated": updated})


@api_view(["POST"])
@permission_classes([IsReporter])
def case_list_restore(request):
    """POST /api/case-list/restore  body: {case_record_ids: [...]}  (same permission rule as exclude)"""
    ids = _case_record_ids(request.data)

    with transaction.atomic():
        _authorize_case_records(request.user, ids)
        updated = CaseRecord.objects.filter(id__in=ids).update(
            is_excluded=False,
            excluded_by=None,
            excluded_at=None,
            exclusion_reason=None,
            exclusion_note="",
        )
        _recalculate_entry(ids, request.user)
    return Response({"ok": True, "updated": updated})


@api_view(["GET"])
@permission_classes([IsReporterOrReviewer])
def exclusion_reasons(request):
    """GET /api/case-list/exclusion-reasons"""
    reasons = ExclusionReason.objects.filter(is_active=True).order_by("sort_order")
    data = [{"code": r.code, "name": r.name, "description": r.description} for r in reasons]
    return Response(data)


@api_view(["POST"])
@permission_classes([IsReviewer])
def review_exclusion(request):
    """
    POST /api/case-list/review-exclusion
    body: {case_record_id, approved: bool, reviewer_note}
    品管中心審查排除是否合理
    """
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


def _case_record_ids(data) -> list[int]:
    """The ``case_record_ids`` of a request body: a non-empty list of integers, else 400."""
    ids = data.get("case_record_ids", []) if isinstance(data, dict) else []
    if not ids:
        raise rejected("缺少 case_record_ids", "missing_params")
    if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise rejected("case_record_ids 必須是整數清單", "invalid_ids")
    return list(dict.fromkeys(ids))


def _authorize_case_records(user, ids: list[int]) -> None:
    """
    403 unless every id is a case record of an entry the user is assigned the numerator of (KD4: admins
    need the assignment too), in a report that reporters can still change.

    The reports are locked until the end of the transaction, so a submission cannot slip in between the
    check and the write. Ids that do not exist cannot be shown to belong to the user and count as refused.
    """
    records = list(CaseRecord.objects.filter(id__in=ids).select_related("entry"))
    report_ids = {r.entry.report_id for r in records}
    reports = {
        report.id: report
        for report in MonthlyReport.objects.select_for_update(of=("self",))
        .select_related("campus", "category")
        .filter(pk__in=report_ids)
    }

    refused = len(records) != len(ids)
    locked = False
    responsibilities: dict[int, dict] = {}
    for record in records:
        report = reports[record.entry.report_id]
        if report.id not in responsibilities:
            responsibilities[report.id] = assigned_fields(
                user, report.campus, report.year, report.month, report.category.code
            )
        if "numerator" not in responsibilities[report.id].get(record.entry.indicator_code, ()):
            refused = True
        elif report.locked_for_reporters:
            locked = True
    if refused:
        raise forbidden("這些個案不屬於你負責的指標分子，無法操作", "not_assigned")
    if locked:
        raise forbidden("月報已送審、核准或送出，個案不可再變更", "report_locked")


def _recalculate_entry(case_record_ids: list, user) -> None:
    """排除/恢復後重新計算 IndicatorEntry 的最終分子（誰改的分子記在 numerator_filled_by）"""
    if not case_record_ids:
        return
    entry_ids = set(
        CaseRecord.objects.filter(id__in=case_record_ids).values_list("entry_id", flat=True)
    )
    now = timezone.now()
    for entry in IndicatorEntry.objects.select_for_update().filter(pk__in=entry_ids):
        records = CaseRecord.objects.filter(entry=entry, case_role="numerator")
        raw_num = records.count()
        excluded = records.filter(is_excluded=True).count()
        final_num = Decimal(raw_num - excluded)

        indicator = Indicator.objects.filter(code=entry.indicator_code).first()
        has_den = indicator.has_denominator if indicator else True
        unit = indicator.unit if indicator else "percent"
        value = compute_value(final_num, entry.denominator, has_den, unit)
        if not value_fits(value):
            raise rejected("計算值超出可儲存範圍，請確認分母", "value_out_of_range")

        if entry.numerator != final_num:
            entry.numerator_filled_by = user
            entry.numerator_filled_at = now
            entry.filled_by = user
            entry.filled_at = now
        entry.raw_numerator = raw_num
        entry.exclusion_count = excluded
        entry.numerator = final_num
        entry.value = value
        entry.save(update_fields=[
            "raw_numerator", "exclusion_count", "numerator", "value",
            "numerator_filled_by", "numerator_filled_at", "filled_by", "filled_at",
        ])
