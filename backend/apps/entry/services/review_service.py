"""
品管中心審核業務邏輯（§8.3）

- get_review_overview  ─ 全景矩陣
- get_review_detail    ─ 單一面向審核詳情
- approve_category     ─ 核准
- reject_category      ─ 退回
- edit_entry           ─ 核准後直接修改數值（留 audit log）
- finalize_campus      ─ 送出至醫策會（所有面向 approved → finalized）
"""
from django.db import transaction
from django.utils import timezone

from apps.entry.models import (
    Campus,
    EntryAuditLog,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.entry.services.values import compute_value, parse_number, uses_sub_entries, value_fits
from apps.indicators.models import Indicator

# ── 全景矩陣 ─────────────────────────────────────────────────

def get_review_overview(year: int, month: int) -> dict:
    """
    §8.3 GET /api/review/overview
    回傳所有院區 × 所有面向的狀態矩陣
    """
    campuses = Campus.objects.filter(is_active=True).order_by("name")
    categories = ReportCategory.objects.all().order_by("sort_order")

    # 一次撈出全部 reports
    reports = {
        (r.campus_id, r.category_id): r
        for r in MonthlyReport.objects.filter(year=year, month=month).select_related("campus", "category")
    }

    campus_data = []
    for campus in campuses:
        cat_statuses = []
        all_approved = True
        submitted_count = 0

        for cat in categories:
            report = reports.get((campus.id, cat.id))
            status = report.status if report else ReportStatus.UNFILLED
            cat_statuses.append({
                "category_code": cat.code,
                "category_name": cat.name,
                "status": status,
                "report_id": report.id if report else None,
                "is_late": report.is_late if report else False,
            })
            if status != ReportStatus.APPROVED and status != ReportStatus.FINALIZED:
                all_approved = False
            if status == ReportStatus.SUBMITTED:
                submitted_count += 1

        campus_data.append({
            "campus_code": campus.code,
            "campus_name": campus.name,
            "benchmark_level": campus.benchmark_level,
            "categories": cat_statuses,
            "all_approved": all_approved,
            "submitted_count": submitted_count,
        })

    return {
        "year": year,
        "month": month,
        "campuses": campus_data,
        "categories": [{"code": c.code, "name": c.name, "color": c.color} for c in categories],
    }


# ── 審核詳情 ─────────────────────────────────────────────────

def get_review_detail(campus: Campus, year: int, month: int, category_code: str) -> dict:
    """
    §8.3 GET /api/review/detail
    含：所有指標數值、填報者備註、上月對比、audit log
    """
    try:
        category = ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        return {"error": f"找不到面向 {category_code}"}

    try:
        report = MonthlyReport.objects.select_related(
            "campus", "category", "submitted_by", "approved_by"
        ).get(campus=campus, year=year, month=month, category=category)
    except MonthlyReport.DoesNotExist:
        return {"error": "此面向尚未填報"}

    # 指標數據
    entries = list(
        IndicatorEntry.objects.filter(report=report)
        .select_related("filled_by", "numerator_filled_by", "denominator_filled_by")
        .prefetch_related("audit_logs__changed_by")
        .order_by("indicator_code")
    )

    # 上月對比
    prev_year, prev_month = year, month - 1
    if prev_month <= 0:
        prev_month = 12
        prev_year -= 1
    prev_entries = {}
    try:
        prev_report = MonthlyReport.objects.get(
            campus=campus, year=prev_year, month=prev_month, category=category
        )
        prev_entries = {e.indicator_code: e for e in IndicatorEntry.objects.filter(report=prev_report)}
    except MonthlyReport.DoesNotExist:
        pass

    # 指標元資料
    indicator_codes = [e.indicator_code for e in entries]
    meta_map = {i.code: i for i in Indicator.objects.filter(code__in=indicator_codes)}

    indicators_data = []
    for entry in entries:
        meta = meta_map.get(entry.indicator_code)
        prev = prev_entries.get(entry.indicator_code)
        prev_val = float(prev.value) if prev and prev.value is not None else None
        cur_val = float(entry.value) if entry.value is not None else None

        change_pct = None
        if cur_val is not None and prev_val is not None and prev_val != 0:
            change_pct = round((cur_val - prev_val) / abs(prev_val) * 100, 1)

        # 是否觸發月變動異常（±10% 儀表板判定閾值）
        is_anomaly = change_pct is not None and abs(change_pct) > 10

        # Audit log
        logs = [
            {
                "field_name": log.field_name,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "changed_by": log.changed_by.full_name,
                "changed_at": log.changed_at.isoformat(),
                "reason": log.reason,
            }
            for log in entry.audit_logs.all()
        ]

        indicators_data.append({
            "entry_id": entry.id,
            "indicator_code": entry.indicator_code,
            "indicator_name": meta.name if meta else entry.indicator_code,
            "unit": meta.unit if meta else "percent",
            "direction": meta.direction if meta else "lower",
            "has_denominator": meta.has_denominator if meta else True,
            "entry_mode": meta.entry_mode if meta else "manual",
            "numerator": float(entry.numerator) if entry.numerator is not None else None,
            "denominator": float(entry.denominator) if entry.denominator is not None else None,
            "raw_numerator": entry.raw_numerator,
            "exclusion_count": entry.exclusion_count,
            "value": cur_val,
            "note": entry.note,
            "data_source": entry.data_source,
            "filled_by": entry.filled_by.full_name if entry.filled_by else None,
            "filled_at": entry.filled_at.isoformat() if entry.filled_at else None,
            "numerator_filled_by": entry.numerator_filled_by.full_name if entry.numerator_filled_by else None,
            "numerator_filled_at": entry.numerator_filled_at.isoformat() if entry.numerator_filled_at else None,
            "denominator_filled_by": entry.denominator_filled_by.full_name if entry.denominator_filled_by else None,
            "denominator_filled_at": (
                entry.denominator_filled_at.isoformat() if entry.denominator_filled_at else None
            ),
            "prev_value": prev_val,
            "change_pct": change_pct,
            "is_anomaly": is_anomaly,
            "audit_logs": logs,
        })

    return {
        "report": {
            "id": report.id,
            "status": report.status,
            "rejection_reason": report.rejection_reason,
            "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
            "submitted_by": report.submitted_by.full_name if report.submitted_by else None,
            "approved_at": report.approved_at.isoformat() if report.approved_at else None,
            "approved_by": report.approved_by.full_name if report.approved_by else None,
            "is_late": report.is_late,
        },
        "category": {"code": category.code, "name": category.name, "color": category.color},
        "campus": {"code": campus.code, "name": campus.name},
        "period": {"year": year, "month": month},
        "indicators": indicators_data,
    }


# ── 核准 ─────────────────────────────────────────────────────

@transaction.atomic
def approve_category(reviewer, campus: Campus, year: int, month: int, category_code: str) -> dict:
    """§8.3 POST /api/review/approve"""
    try:
        report = _get_report(campus, year, month, category_code)
    except LookupError as e:
        return {"ok": False, "error": str(e)}

    if report.status != ReportStatus.SUBMITTED:
        return {"ok": False, "error": f"只有已送審狀態可核准，目前狀態：{report.status}"}

    report.status = ReportStatus.APPROVED
    report.approved_at = timezone.now()
    report.approved_by = reviewer
    report.rejection_reason = ""
    report.save(update_fields=["status", "approved_at", "approved_by", "rejection_reason"])
    return {"ok": True, "report_id": report.id, "status": report.status}


# ── 退回 ─────────────────────────────────────────────────────

@transaction.atomic
def reject_category(reviewer, campus: Campus, year: int, month: int,
                    category_code: str, reason: str) -> dict:
    """§8.3 POST /api/review/reject"""
    if not reason.strip():
        return {"ok": False, "error": "退回必須填寫理由"}

    try:
        report = _get_report(campus, year, month, category_code)
    except LookupError as e:
        return {"ok": False, "error": str(e)}

    if report.status not in (ReportStatus.SUBMITTED, ReportStatus.APPROVED):
        return {"ok": False, "error": f"目前狀態 {report.status} 不可退回"}

    report.status = ReportStatus.DRAFT
    report.rejection_reason = reason
    report.reviewed_at = timezone.now()
    report.reviewed_by = reviewer
    report.save(update_fields=["status", "rejection_reason", "reviewed_at", "reviewed_by"])
    return {"ok": True, "report_id": report.id, "status": report.status}


# ── 品管中心直接修改數值 ─────────────────────────────────────

def _fail(error: str, code: str) -> dict:
    return {"ok": False, "error": error, "code": code}


def _text(value) -> str:
    """A stored value as text for the audit log (zero is "0", only NULL is empty)."""
    return "" if value is None else str(value)


@transaction.atomic
def edit_entry(reviewer, entry_id: int, field: str, new_value, reason: str) -> dict:
    """
    §8.3 PATCH /api/review/edit-entry
    允許欄位：numerator, denominator, value, note

    KD5: reviewers are not limited by field assignment, but they may only change a report that is
    ``submitted`` or ``approved`` (while it is a draft the reporters own it, and their autosave would
    overwrite the edit). The numerator_filled_by / denominator_filled_by attribution is left alone: it
    keeps saying who entered the number. For an indicator with a denominator ``value`` is derived and
    cannot be edited directly; the value is always recomputed with services.values.compute_value. The numerator
    (and with it the value) of HA10-01 at Hsinchu is the sum of its sub-categories and cannot be edited either.
    """
    allowed_fields = {"numerator", "denominator", "value", "note"}
    if field not in allowed_fields:
        return _fail(f"不可修改欄位：{field}", "field_not_editable")

    try:
        report_id = IndicatorEntry.objects.values_list("report_id", flat=True).get(pk=entry_id)
    except IndicatorEntry.DoesNotExist:
        return _fail("找不到指標數據", "entry_not_found")

    # Same lock order as save_draft: the report first, then the entry.
    report = MonthlyReport.objects.select_for_update(of=("self",)).select_related("campus").get(pk=report_id)
    entry = IndicatorEntry.objects.select_for_update().get(pk=entry_id)

    if report.status == ReportStatus.FINALIZED:
        return _fail("已送出的資料不可修改", "report_finalized")
    if report.status not in (ReportStatus.SUBMITTED, ReportStatus.APPROVED):
        return _fail(f"月報目前為 {report.status}，仍在填報中，只有已送審或已核准的月報可由品管中心修改",
                     "report_not_editable")

    if field in ("numerator", "value") and uses_sub_entries(entry.indicator_code, report.campus.code):
        # HA10-01 at Hsinchu: the numerator is the sum of 13 sub-categories. An override here would be undone by
        # the reporter's next save, and the reviewer has no endpoint to edit the sub-categories themselves.
        return _fail("此指標（新竹 HA10-01）的分子由 13 類子項加總，不能直接修改分子或計算值；"
                     "請修改子項（可退回給填報者修正）", "field_not_editable")

    indicator = Indicator.objects.filter(code=entry.indicator_code).first()
    has_den = indicator.has_denominator if indicator else True
    unit = indicator.unit if indicator else "percent"

    target = field
    if field == "value":
        if has_den:
            return _fail("此指標的計算值由分子與分母算出，請修改分子或分母", "value_not_editable")
        target = "numerator"  # without a denominator the value is the numerator
    elif field == "denominator" and not has_den:
        return _fail("此指標沒有分母", "no_denominator")

    old_value = getattr(entry, target)
    if target == "note":
        setattr(entry, "note", "" if new_value is None else str(new_value))
    else:
        blank = new_value is None or (isinstance(new_value, str) and not new_value.strip())
        try:
            setattr(entry, target, None if blank else parse_number(new_value))
        except ValueError:
            return _fail(f"數值格式錯誤：{new_value}", "invalid_number")

    update_fields = [target]
    if target in ("numerator", "denominator"):
        value = compute_value(entry.numerator, entry.denominator, has_den, unit)
        if not value_fits(value):
            return _fail("計算值超出可儲存範圍，請確認分子與分母", "value_out_of_range")
        entry.value = value
        update_fields.append("value")
    entry.save(update_fields=update_fields)

    # Audit log (the columns are 100 characters wide; a long note is cut for the log only)
    EntryAuditLog.objects.create(
        entry=entry,
        field_name=target,
        old_value=_text(old_value)[:100],
        new_value=_text(getattr(entry, target))[:100],
        changed_by=reviewer,
        reason=reason,
    )

    return {
        "ok": True,
        "entry_id": entry.id,
        "field": field,
        "new_value": _text(getattr(entry, target)),
        "value": _text(entry.value),
    }


# ── 送出至醫策會 ────────────────────────────────────────────

@transaction.atomic
def finalize_campus(reviewer, campus: Campus, year: int, month: int) -> dict:
    """
    §8.3 POST /api/review/finalize
    前提：該院區該月所有面向皆為 approved
    """
    reports = MonthlyReport.objects.filter(campus=campus, year=year, month=month)

    # 檢查：至少要有一個 report，且全部都是 approved
    if not reports.exists():
        return {"ok": False, "error": "尚無填報資料"}

    non_approved = reports.exclude(status=ReportStatus.APPROVED)
    if non_approved.exists():
        bad = list(non_approved.values_list("category__code", "status"))
        details = ", ".join(f"{c}({s})" for c, s in bad)
        return {"ok": False, "error": f"以下面向尚未核准：{details}"}

    now = timezone.now()
    reports.update(status=ReportStatus.FINALIZED, finalized_at=now, finalized_by=reviewer)
    return {
        "ok": True,
        "campus": campus.code,
        "year": year,
        "month": month,
        "finalized_count": reports.count(),
    }


# ── 解鎖（系統管理員）────────────────────────────────────────

@transaction.atomic
def unlock_month(admin_user, campus: Campus, year: int, month: int, reason: str) -> dict:
    """解鎖已 finalized 的月份，回退到 approved（§3.4）"""
    reports = MonthlyReport.objects.filter(
        campus=campus, year=year, month=month, status=ReportStatus.FINALIZED
    )
    # update() returns the number of rows it changed; counting the queryset afterwards would
    # always say 0 because the status filter no longer matches.
    unlocked = reports.update(status=ReportStatus.APPROVED, finalized_at=None, finalized_by=None)
    if not unlocked:
        return {"ok": False, "error": "找不到已送出的報表"}
    return {"ok": True, "unlocked_count": unlocked}


# ── 私有輔助 ─────────────────────────────────────────────────

def _get_report(campus: Campus, year: int, month: int, category_code: str) -> MonthlyReport:
    try:
        category = ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        raise LookupError(f"找不到面向 {category_code}")
    try:
        return MonthlyReport.objects.get(campus=campus, year=year, month=month, category=category)
    except MonthlyReport.DoesNotExist:
        raise LookupError("找不到該月報")
