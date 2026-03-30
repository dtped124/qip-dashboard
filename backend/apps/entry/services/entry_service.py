"""
填報系統核心業務邏輯

- get_my_tasks：取得填報者任務清單
- get_category_form：取得面向填報表單資料
- save_draft：暫存草稿
- submit_category：送審面向
"""
import datetime
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from apps.entry.models import (
    Campus,
    DeadlineSetting,
    HA10SubEntry,
    IndicatorAssignment,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.entry.services.period import get_deadline_info
from apps.indicators.models import Indicator

# HA10 新竹子類別定義（13 類）
HA10_SUB_CATEGORIES = [
    {"sub_code": "HA10-10-01", "sub_name": "藥物事件"},
    {"sub_code": "HA10-10-02", "sub_name": "跌倒事件"},
    {"sub_code": "HA10-10-03", "sub_name": "管路事件"},
    {"sub_code": "HA10-10-04", "sub_name": "手術/處置事件"},
    {"sub_code": "HA10-10-05", "sub_name": "醫療儀器設備事件"},
    {"sub_code": "HA10-10-06", "sub_name": "院內不預期心跳停止事件"},
    {"sub_code": "HA10-10-07", "sub_name": "輸血事件"},
    {"sub_code": "HA10-10-08", "sub_name": "院內感染事件"},
    {"sub_code": "HA10-10-09", "sub_name": "燙傷事件"},
    {"sub_code": "HA10-10-10", "sub_name": "自殺/自傷事件"},
    {"sub_code": "HA10-10-11", "sub_name": "其他意外事件"},
    {"sub_code": "HA10-10-12", "sub_name": "診療事件"},
    {"sub_code": "HA10-10-13", "sub_name": "其他事件"},
]


def _get_indicator_category_code(indicator_code: str) -> str:
    """從指標代碼取得面向代碼（如 HA03-01 → HA03）"""
    parts = indicator_code.split("-")
    return parts[0]  # "HA03"


def _get_active_assignments(user, year: int, month: int):
    """取得使用者在指定月份有效的指標指派"""
    period_date = datetime.date(year + 1911, month, 1)
    return IndicatorAssignment.objects.filter(
        user=user,
        campus=user.campus,
        effective_from__lte=period_date,
    ).filter(
        effective_to__isnull=True  # 現行有效
    ) | IndicatorAssignment.objects.filter(
        user=user,
        campus=user.campus,
        effective_from__lte=period_date,
        effective_to__gte=period_date,
    )


def get_my_tasks(user, year: int, month: int) -> dict:
    """
    取得填報者的任務清單（§8.2 my-tasks）
    回傳：期間資訊、截止日、退回通知、各面向狀態與進度
    """
    campus = user.campus
    if not campus:
        return {"error": "帳號未設定院區"}

    deadline_info = get_deadline_info(year, month)

    # 取得有效指派，依面向分組
    assignments = _get_active_assignments(user, year, month).select_related("campus")
    indicator_codes = list(assignments.values_list("indicator_code", flat=True).distinct())

    # 依面向代碼分組
    category_indicators: dict[str, list[str]] = {}
    for code in indicator_codes:
        cat_code = _get_indicator_category_code(code)
        category_indicators.setdefault(cat_code, []).append(code)

    # 取得各面向 MonthlyReport
    reports = {
        r.category.code: r
        for r in MonthlyReport.objects.filter(
            campus=campus, year=year, month=month
        ).select_related("category")
    }

    # 取得各面向已填的指標數
    filled_by_category: dict[str, int] = {}
    if reports:
        entries = IndicatorEntry.objects.filter(
            report__in=reports.values(),
            indicator_code__in=indicator_codes,
        ).exclude(numerator=None, value=None)
        for entry in entries:
            cat_code = _get_indicator_category_code(entry.indicator_code)
            filled_by_category[cat_code] = filled_by_category.get(cat_code, 0) + 1

    # 取得退回通知
    rejection_notices = []
    for cat_code, report in reports.items():
        if report.status == ReportStatus.DRAFT and report.rejection_reason:
            try:
                cat = ReportCategory.objects.get(code=cat_code)
                cat_name = cat.name
            except ReportCategory.DoesNotExist:
                cat_name = cat_code
            rejection_notices.append({
                "category_code": cat_code,
                "category_name": cat_name,
                "reason": report.rejection_reason,
                "report_id": report.id,
            })

    # 組合面向清單（未填 / 草稿排前面）
    STATUS_SORT = {
        ReportStatus.UNFILLED: 0,
        ReportStatus.DRAFT: 1,
        "rejected": 2,  # 草稿 + 有退回理由
        ReportStatus.SUBMITTED: 3,
        ReportStatus.APPROVED: 4,
        ReportStatus.FINALIZED: 5,
    }

    categories_data = []
    all_categories = ReportCategory.objects.filter(
        code__in=category_indicators.keys()
    ).order_by("sort_order")

    for cat in all_categories:
        report = reports.get(cat.code)
        status = report.status if report else ReportStatus.UNFILLED
        filled = filled_by_category.get(cat.code, 0)
        total = len(category_indicators.get(cat.code, []))

        categories_data.append({
            "category_code": cat.code,
            "category_name": cat.name,
            "category_color": cat.color,
            "report_id": report.id if report else None,
            "status": status,
            "filled_count": filled,
            "total_count": total,
            "rejection_reason": report.rejection_reason if report else "",
        })

    # 未填/草稿排前面
    def sort_key(c):
        s = c["status"]
        if s == ReportStatus.DRAFT and c["rejection_reason"]:
            return (2, c["category_code"])
        return (STATUS_SORT.get(s, 9), c["category_code"])

    categories_data.sort(key=sort_key)

    total_filled = sum(c["filled_count"] for c in categories_data)
    total_indicators = sum(c["total_count"] for c in categories_data)

    return {
        "period": {"year": year, "month": month},
        "deadline": deadline_info,
        "rejection_notices": rejection_notices,
        "categories": categories_data,
        "overall_progress": {
            "filled": total_filled,
            "total": total_indicators,
        },
    }


def get_category_form(user, campus: Campus, year: int, month: int, category_code: str) -> dict:
    """
    取得面向填報表單（§8.2 form）
    包含：指標清單、當前值、上月值
    """
    # 找對應面向
    try:
        category = ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        return {"error": f"找不到面向 {category_code}"}

    # 取得或建立 MonthlyReport
    report, _ = MonthlyReport.objects.get_or_create(
        campus=campus, year=year, month=month, category=category,
        defaults={"status": ReportStatus.UNFILLED},
    )

    # 取得此面向負責的指標（此使用者負責 + 屬於此院區此面向）
    period_date = datetime.date(year + 1911, month, 1)
    assignments = IndicatorAssignment.objects.filter(
        user=user,
        campus=campus,
        indicator_code__startswith=category_code,
        effective_from__lte=period_date,
    ).filter(
        effective_to__isnull=True
    ) | IndicatorAssignment.objects.filter(
        user=user,
        campus=campus,
        indicator_code__startswith=category_code,
        effective_from__lte=period_date,
        effective_to__gte=period_date,
    )
    indicator_codes = list(assignments.values_list("indicator_code", flat=True).distinct())

    # 取得指標元資料（排序）
    indicators_meta = {
        ind.code: ind
        for ind in Indicator.objects.filter(code__in=indicator_codes)
    }

    # 取得已填數據
    entries = {
        e.indicator_code: e
        for e in IndicatorEntry.objects.filter(
            report=report, indicator_code__in=indicator_codes
        ).prefetch_related("sub_entries")
    }

    # 取得上個月數據
    prev_year, prev_month = year, month - 1
    if prev_month <= 0:
        prev_month = 12
        prev_year -= 1
    try:
        prev_report = MonthlyReport.objects.get(
            campus=campus, year=prev_year, month=prev_month, category=category
        )
        prev_entries = {
            e.indicator_code: e
            for e in IndicatorEntry.objects.filter(
                report=prev_report, indicator_code__in=indicator_codes
            )
        }
    except MonthlyReport.DoesNotExist:
        prev_entries = {}

    # 組合指標資料
    indicators_data = []
    for code in sorted(indicator_codes):
        meta = indicators_meta.get(code)
        entry = entries.get(code)
        prev_entry = prev_entries.get(code)

        prev_value = float(prev_entry.value) if prev_entry and prev_entry.value is not None else None
        current_value = float(entry.value) if entry and entry.value is not None else None

        # 月變動百分比
        change_pct = None
        if current_value is not None and prev_value is not None and prev_value != 0:
            change_pct = round((current_value - prev_value) / abs(prev_value) * 100, 1)

        # HA10 新竹子類別
        sub_entries_data = []
        if code.startswith("HA10") and campus.code == "hsinchu" and entry:
            sub_map = {s.sub_code: s for s in entry.sub_entries.all()}
            for sub in HA10_SUB_CATEGORIES:
                sub_entry = sub_map.get(sub["sub_code"])
                sub_entries_data.append({
                    "sub_code": sub["sub_code"],
                    "sub_name": sub["sub_name"],
                    "value": float(sub_entry.value) if sub_entry and sub_entry.value is not None else None,
                })
        elif code.startswith("HA10") and campus.code == "hsinchu" and not entry:
            for sub in HA10_SUB_CATEGORIES:
                sub_entries_data.append({
                    "sub_code": sub["sub_code"],
                    "sub_name": sub["sub_name"],
                    "value": None,
                })

        indicators_data.append({
            "indicator_code": code,
            "indicator_name": meta.name if meta else code,
            "unit": meta.unit if meta else "percent",
            "direction": meta.direction if meta else "lower",
            "has_denominator": meta.has_denominator if meta else True,
            "entry_mode": meta.entry_mode if meta else "manual",
            "numerator": float(entry.numerator) if entry and entry.numerator is not None else None,
            "denominator": float(entry.denominator) if entry and entry.denominator is not None else None,
            "value": current_value,
            "note": entry.note if entry else "",
            "prev_value": prev_value,
            "prev_numerator": float(prev_entry.numerator) if prev_entry and prev_entry.numerator is not None else None,
            "prev_denominator": float(prev_entry.denominator) if prev_entry and prev_entry.denominator is not None else None,
            "change_pct": change_pct,
            "sub_entries": sub_entries_data,
            "is_ha10_hsinchu": bool(sub_entries_data),
        })

    return {
        "report": {
            "id": report.id,
            "status": report.status,
            "rejection_reason": report.rejection_reason,
            "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
            "is_late": report.is_late,
        },
        "category": {
            "code": category.code,
            "name": category.name,
            "color": category.color,
        },
        "campus": {
            "code": campus.code,
            "name": campus.name,
        },
        "period": {"year": year, "month": month},
        "deadline": get_deadline_info(year, month),
        "indicators": indicators_data,
    }


def _calculate_value(numerator, denominator, has_denominator: bool, unit: str):
    """計算比率值"""
    if not has_denominator:
        return numerator  # 純計數型，數值即為 numerator
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    val = Decimal(str(numerator)) / Decimal(str(denominator))
    if unit == "permille":
        val = val * 1000
    elif unit == "percent":
        val = val * 100
    return round(val, 6)


@transaction.atomic
def save_draft(user, campus: Campus, year: int, month: int, category_code: str,
               entries_data: list, is_ha10_hsinchu: bool = False) -> dict:
    """
    暫存草稿（§8.2 save-draft）
    entries_data: [{ indicator_code, numerator, denominator, note, sub_entries? }]
    """
    try:
        category = ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        return {"ok": False, "error": f"找不到面向 {category_code}"}

    report, _ = MonthlyReport.objects.get_or_create(
        campus=campus, year=year, month=month, category=category,
        defaults={"status": ReportStatus.UNFILLED},
    )

    # 鎖定檢查：submitted / finalized 不可編輯（填報者端）
    if report.status in (ReportStatus.SUBMITTED, ReportStatus.FINALIZED):
        return {"ok": False, "error": f"目前狀態 {report.status} 不可編輯"}

    now = timezone.now()

    for item in entries_data:
        indicator_code = item["indicator_code"]
        numerator = item.get("numerator")
        denominator = item.get("denominator")
        note = item.get("note", "")

        # 取得指標元資料以判斷 has_denominator / unit
        try:
            ind = Indicator.objects.get(code=indicator_code)
            has_denominator = ind.has_denominator
            unit = ind.unit
        except Indicator.DoesNotExist:
            has_denominator = True
            unit = "percent"

        # 轉型
        try:
            num = Decimal(str(numerator)) if numerator is not None else None
            den = Decimal(str(denominator)) if denominator is not None else None
        except (InvalidOperation, ValueError):
            continue

        value = _calculate_value(num, den, has_denominator, unit)

        entry, _ = IndicatorEntry.objects.update_or_create(
            report=report,
            indicator_code=indicator_code,
            defaults={
                "numerator": num,
                "denominator": den,
                "value": value,
                "note": note,
                "filled_by": user,
                "filled_at": now,
                "data_source": "manual",
            },
        )

        # HA10 新竹子類別
        sub_entries_input = item.get("sub_entries", [])
        if sub_entries_input and indicator_code.startswith("HA10") and campus.code == "hsinchu":
            total = Decimal("0")
            for sub in sub_entries_input:
                sub_val = sub.get("value")
                try:
                    sv = Decimal(str(sub_val)) if sub_val is not None else None
                except (InvalidOperation, ValueError):
                    sv = None
                HA10SubEntry.objects.update_or_create(
                    entry=entry,
                    sub_code=sub["sub_code"],
                    defaults={"sub_name": sub["sub_name"], "value": sv},
                )
                if sv is not None:
                    total += sv
            # 自動加總到主 entry
            entry.value = total
            entry.numerator = total
            entry.save(update_fields=["value", "numerator"])

    # 更新 report 狀態為 draft
    if report.status == ReportStatus.UNFILLED:
        report.status = ReportStatus.DRAFT
        # 逾期檢查
        deadline_info = get_deadline_info(year, month)
        if deadline_info["is_overdue"]:
            report.is_late = True
        report.save(update_fields=["status", "is_late"])

    return {"ok": True, "report_id": report.id, "status": report.status}


@transaction.atomic
def submit_category(user, campus: Campus, year: int, month: int, category_code: str) -> dict:
    """
    送審面向（§8.2 submit）
    前提：該面向所有負責指標皆已填入數值
    """
    try:
        category = ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        return {"ok": False, "error": f"找不到面向 {category_code}"}

    try:
        report = MonthlyReport.objects.get(
            campus=campus, year=year, month=month, category=category
        )
    except MonthlyReport.DoesNotExist:
        return {"ok": False, "error": "尚無草稿，請先暫存"}

    if report.status == ReportStatus.SUBMITTED:
        return {"ok": False, "error": "已送審，請等待審核"}
    if report.status in (ReportStatus.APPROVED, ReportStatus.FINALIZED):
        return {"ok": False, "error": f"目前狀態 {report.status} 不可重複送審"}

    # 取得負責的指標
    period_date = datetime.date(year + 1911, month, 1)
    assignments = IndicatorAssignment.objects.filter(
        user=user,
        campus=campus,
        indicator_code__startswith=category_code,
        effective_from__lte=period_date,
    ).filter(effective_to__isnull=True)
    indicator_codes = list(assignments.values_list("indicator_code", flat=True).distinct())

    if not indicator_codes:
        return {"ok": False, "error": "此面向無指派指標"}

    # 檢查所有指標是否已填
    filled_entries = IndicatorEntry.objects.filter(
        report=report, indicator_code__in=indicator_codes
    ).exclude(value=None)
    filled_codes = set(filled_entries.values_list("indicator_code", flat=True))

    unfilled = [c for c in indicator_codes if c not in filled_codes]
    if unfilled:
        return {
            "ok": False,
            "error": f"送審前提未達：以下指標尚未填寫：{', '.join(unfilled)}",
            "unfilled_codes": unfilled,
        }

    # 更新狀態
    report.status = ReportStatus.SUBMITTED
    report.submitted_at = timezone.now()
    report.submitted_by = user
    report.rejection_reason = ""  # 清空退回理由
    report.save(update_fields=["status", "submitted_at", "submitted_by", "rejection_reason"])

    return {"ok": True, "report_id": report.id, "status": report.status}
