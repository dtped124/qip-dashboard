"""
填報系統核心業務邏輯（欄位級指派）

- get_my_tasks：取得填報者任務清單（依 院區 × 面向 分組）
- get_category_form：取得面向填報表單資料（唯讀，GET 不建立任何資料）
- save_draft：暫存草稿（只寫有權限的欄位，絕不覆寫他人的欄位）
- submit_category：送審面向（整個院區 × 面向的必填欄位都要有值）

Authorization rules live in services.assignments, value arithmetic in services.values.
Failures raise DRF exceptions whose body is {"detail", "code", ...} (services.errors).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.accounts.permissions import is_admin
from apps.entry.models import (
    Campus,
    DataSource,
    HA10SubEntry,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.entry.services.assignments import (
    FIELD_SET,
    active_assignments,
    editable_fields,
    group_fields,
    owners_from_assignments,
    period_bounds,
    required_fields,
)
from apps.entry.services.errors import forbidden, not_found, rejected
from apps.entry.services.period import get_deadline_info
from apps.entry.services.values import (
    HA10_SUB_CATEGORIES,
    HA10_SUB_NAMES,
    compute_value,
    parse_number,
    uses_sub_entries,
    value_fits,
)
from apps.indicators.models import Indicator

FIELD_LABELS = {"numerator": "分子", "denominator": "分母"}

# How many missing fields the human readable message names before it says "...and N more".
_MESSAGE_LIMIT = 10


# ── Small helpers ────────────────────────────────────────────────

def _get_indicator_category_code(indicator_code: str) -> str:
    """從指標代碼取得面向代碼（如 HA03-01 → HA03）"""
    return indicator_code.split("-")[0]


def _get_category(category_code: str) -> ReportCategory:
    try:
        return ReportCategory.objects.get(code=category_code)
    except ReportCategory.DoesNotExist:
        raise not_found(f"找不到面向 {category_code}", "category_not_found") from None


def _full_name(user) -> str | None:
    return user.full_name if user is not None else None


def _iso(moment) -> str | None:
    return moment.isoformat() if moment is not None else None


def _float(number) -> float | None:
    return float(number) if number is not None else None


def _meta_defaults(indicator: Indicator | None) -> tuple[bool, str]:
    """(has_denominator, unit) with the legacy defaults for an indicator without metadata."""
    if indicator is None:
        return True, "percent"
    return indicator.has_denominator, indicator.unit


# ── One campus x category x month, loaded once ───────────────────

@dataclass
class _Unit:
    """Everything the entry logic needs to know about one campus x category x month."""

    campus: Campus
    category: ReportCategory
    assignments: list  # IndicatorAssignment rows in force, all users (user select_related)
    codes: list  # indicators with at least one assignment in force (the scope of a submission, KD3)
    meta: dict  # indicator code -> Indicator
    owners: dict  # (indicator code, field) -> [User]
    report: MonthlyReport | None
    entries: dict  # indicator code -> IndicatorEntry (sub_entries prefetched)


def _load_unit(campus: Campus, category: ReportCategory, year: int, month: int, *, lock_report: bool = False) -> _Unit:
    assignments = list(
        active_assignments(year, month, campus=campus, category_code=category.code).select_related("user")
    )
    codes = sorted({a.indicator_code for a in assignments})
    meta = {i.code: i for i in Indicator.objects.filter(code__in=codes)}

    reports = MonthlyReport.objects.filter(campus=campus, year=year, month=month, category=category)
    if lock_report:
        reports = reports.select_for_update()
    report = reports.first()

    entries: dict[str, IndicatorEntry] = {}
    if report is not None:
        entries = {
            e.indicator_code: e
            for e in IndicatorEntry.objects.filter(report=report, indicator_code__in=codes)
            .select_related("numerator_filled_by", "denominator_filled_by")
            .prefetch_related("sub_entries")
        }
    return _Unit(campus, category, assignments, codes, meta, owners_from_assignments(assignments), report, entries)


def _missing_sub_codes(entry: IndicatorEntry | None) -> list[str]:
    """HA10 sub-category codes without a value (all 13 when there is no entry yet)."""
    have = {s.sub_code for s in entry.sub_entries.all() if s.value is not None} if entry is not None else set()
    return [s["sub_code"] for s in HA10_SUB_CATEGORIES if s["sub_code"] not in have]


def _field_filled(entry: IndicatorEntry | None, field: str, sub_mode: bool) -> bool:
    """KD2: a field counts as filled when it is not NULL (a zero denominator is filled)."""
    if entry is None or getattr(entry, field) is None:
        return False
    if field == "numerator" and sub_mode and _missing_sub_codes(entry):
        return False  # HA10-01 at Hsinchu: all 13 sub-categories must hold a value
    return True


def _unit_gaps(unit: _Unit) -> list[dict]:
    """
    Required fields without a value, over every indicator that has an assignment in force (KD3).

    Each gap: {indicator_code, indicator_name, field, owners: [names], unassigned}; ``unassigned`` is true
    when nobody is responsible for that field. A gap in HA10-01 at Hsinchu also lists ``sub_codes``.
    """
    gaps: list[dict] = []
    for code in unit.codes:
        indicator = unit.meta.get(code)
        entry = unit.entries.get(code)
        sub_mode = uses_sub_entries(code, unit.campus.code)
        required = required_fields(indicator, unit.campus)
        for field in FIELD_SET:
            if field not in required or _field_filled(entry, field, sub_mode):
                continue
            owners = [u.full_name for u in unit.owners.get((code, field), [])]
            gap = {
                "indicator_code": code,
                "indicator_name": indicator.name if indicator else code,
                "field": field,
                "owners": owners,
                "unassigned": not owners,
            }
            if field == "numerator" and sub_mode:
                gap["sub_codes"] = _missing_sub_codes(entry)
            gaps.append(gap)
    return gaps


def _incomplete_message(gaps: list[dict]) -> str:
    parts = [
        f"{g['indicator_code']} {FIELD_LABELS[g['field']]}（{'、'.join(g['owners']) if g['owners'] else '未指派'}）"
        for g in gaps[:_MESSAGE_LIMIT]
    ]
    more = f"…等共 {len(gaps)} 項" if len(gaps) > _MESSAGE_LIMIT else ""
    return "送審前提未達：以下必填欄位尚未填寫：" + "；".join(parts) + more


# ── my-tasks ─────────────────────────────────────────────────────

def get_my_tasks(user, year: int, month: int) -> dict:
    """
    取得填報者的任務清單（§8.2 my-tasks）
    回傳：期間資訊、截止日、退回通知、各 院區 × 面向 的狀態與進度

    One row per (campus, category) the user has an assignment in force for. ``filled_count`` / ``total_count``
    count the user's indicators; ``my_filled`` / ``my_total`` count the user's fields; ``category_missing``
    counts the required fields still empty in the whole campus x category, whoever owns them.
    """
    # First of all: an impossible period is a 400. get_deadline_info below raises a bare ValueError
    # (HTTP 500) for month=-1 or year=1000000.
    period_bounds(year, month)
    deadline_info = get_deadline_info(year, month)

    mine = list(active_assignments(year, month, user=user).select_related("campus"))
    campuses: dict[tuple[int, str], Campus] = {}
    for assignment in mine:
        key = (assignment.campus_id, _get_indicator_category_code(assignment.indicator_code))
        campuses.setdefault(key, assignment.campus)
    categories = {c.code: c for c in ReportCategory.objects.filter(code__in={cat for _, cat in campuses})}

    status_rank = {
        ReportStatus.UNFILLED: 0,
        ReportStatus.DRAFT: 1,
        "rejected": 2,  # 草稿 + 有退回理由
        ReportStatus.SUBMITTED: 3,
        ReportStatus.APPROVED: 4,
        ReportStatus.FINALIZED: 5,
    }

    categories_data = []
    rejection_notices = []
    for (_campus_id, cat_code), campus in campuses.items():
        category = categories.get(cat_code)
        if category is None:
            continue
        unit = _load_unit(campus, category, year, month)
        my_fields = {
            code: fields
            for code, fields in group_fields([a for a in unit.assignments if a.user_id == user.pk], unit.meta).items()
            if fields
        }
        if not my_fields:
            continue

        my_total = my_filled = filled_indicators = 0
        for code, fields in my_fields.items():
            entry = unit.entries.get(code)
            sub_mode = uses_sub_entries(code, campus.code)
            done = sum(1 for f in fields if _field_filled(entry, f, sub_mode))
            my_total += len(fields)
            my_filled += done
            filled_indicators += done == len(fields)

        report = unit.report
        status = report.status if report else ReportStatus.UNFILLED
        categories_data.append({
            "category_code": category.code,
            "category_name": category.name,
            "category_color": category.color,
            "campus_code": campus.code,
            "campus_name": campus.name,
            "report_id": report.id if report else None,
            "status": status,
            "filled_count": filled_indicators,
            "total_count": len(my_fields),
            "rejection_reason": report.rejection_reason if report else "",
            "my_filled": my_filled,
            "my_total": my_total,
            "category_missing": len(_unit_gaps(unit)),
        })
        if report is not None and report.status == ReportStatus.DRAFT and report.rejection_reason:
            rejection_notices.append({
                "category_code": category.code,
                "category_name": category.name,
                "campus_code": campus.code,
                "campus_name": campus.name,
                "reason": report.rejection_reason,
                "report_id": report.id,
            })

    # 未填/草稿排前面
    def sort_key(c):
        s = c["status"]
        rank = 2 if s == ReportStatus.DRAFT and c["rejection_reason"] else status_rank.get(s, 9)
        return (rank, c["category_code"], c["campus_code"])

    categories_data.sort(key=sort_key)

    return {
        "period": {"year": year, "month": month},
        "deadline": deadline_info,
        "rejection_notices": rejection_notices,
        "categories": categories_data,
        "overall_progress": {
            "filled": sum(c["filled_count"] for c in categories_data),
            "total": sum(c["total_count"] for c in categories_data),
        },
    }


# ── form ─────────────────────────────────────────────────────────

def _entry_fields(entry: IndicatorEntry | None, code: str, campus_code: str) -> dict:
    """The stored numbers of an entry (None for no entry yet), with who filled each field."""
    sub_mode = uses_sub_entries(code, campus_code)
    sub_entries = []
    if sub_mode:
        stored = {s.sub_code: s for s in entry.sub_entries.all()} if entry is not None else {}
        for sub in HA10_SUB_CATEGORIES:
            row = stored.get(sub["sub_code"])
            sub_entries.append({
                "sub_code": sub["sub_code"],
                "sub_name": sub["sub_name"],
                "value": _float(row.value) if row is not None else None,
            })
    return {
        "numerator": _float(entry.numerator) if entry else None,
        "denominator": _float(entry.denominator) if entry else None,
        "value": _float(entry.value) if entry else None,
        "note": entry.note if entry else "",
        "numerator_filled_by": _full_name(entry.numerator_filled_by) if entry else None,
        "numerator_filled_at": _iso(entry.numerator_filled_at) if entry else None,
        "denominator_filled_by": _full_name(entry.denominator_filled_by) if entry else None,
        "denominator_filled_at": _iso(entry.denominator_filled_at) if entry else None,
        "sub_entries": sub_entries,
        "is_ha10_hsinchu": sub_mode,
    }


def get_category_form(user, campus: Campus, year: int, month: int, category_code: str) -> dict:
    """
    取得面向填報表單（§8.2 form）
    包含：指標清單、當前值、上月值、誰可以改哪個欄位

    Read-only: nothing is created here. A report that does not exist yet is shown as ``unfilled``
    with ``report.id`` null.

    Which indicators are listed: the ones the user has an assignment in force for (the keys of
    editable_fields), nothing more. Indicators that belong to other people only are left out because the
    forms written before field-level assignment post every row they list back on save, and the server
    refuses payloads that name indicators the user is not assigned to. Where the user covers only one
    field of an indicator, the row still carries the other field's value, its owners and who filled it.
    """
    category = _get_category(category_code)
    editable = editable_fields(user, campus, year, month, category_code)
    unit = _load_unit(campus, category, year, month)
    codes = sorted(editable)

    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    prev_report = MonthlyReport.objects.filter(
        campus=campus, year=prev_year, month=prev_month, category=category
    ).first()
    prev_entries = {}
    if prev_report is not None:
        prev_entries = {
            e.indicator_code: e
            for e in IndicatorEntry.objects.filter(report=prev_report, indicator_code__in=codes)
        }

    indicators_data = []
    for code in codes:
        meta = unit.meta.get(code)
        entry = unit.entries.get(code)
        prev_entry = prev_entries.get(code)

        prev_value = _float(prev_entry.value) if prev_entry else None
        current_value = _float(entry.value) if entry else None

        # 月變動百分比
        change_pct = None
        if current_value is not None and prev_value is not None and prev_value != 0:
            change_pct = round((current_value - prev_value) / abs(prev_value) * 100, 1)

        has_denominator = meta.has_denominator if meta else True
        owners = {
            field: [u.full_name for u in unit.owners.get((code, field), [])] if field in required_fields(meta) else []
            for field in FIELD_SET
        }
        indicators_data.append({
            "indicator_code": code,
            "indicator_name": meta.name if meta else code,
            "unit": meta.unit if meta else "percent",
            "direction": meta.direction if meta else "lower",
            "has_denominator": has_denominator,
            "entry_mode": meta.entry_mode if meta else "manual",
            **_entry_fields(entry, code, campus.code),
            "prev_value": prev_value,
            "prev_numerator": _float(prev_entry.numerator) if prev_entry else None,
            "prev_denominator": _float(prev_entry.denominator) if prev_entry else None,
            "change_pct": change_pct,
            "editable_fields": [f for f in FIELD_SET if f in editable[code]],
            "field_owners": owners,
        })

    report = unit.report
    return {
        "report": {
            "id": report.id if report else None,
            "status": report.status if report else ReportStatus.UNFILLED,
            "rejection_reason": report.rejection_reason if report else "",
            "submitted_at": _iso(report.submitted_at) if report else None,
            "is_late": report.is_late if report else False,
            "locked": bool(report and report.locked_for_reporters),
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


# ── save-draft ───────────────────────────────────────────────────

def _lock_error(report: MonthlyReport):
    return forbidden(
        f"目前狀態 {report.status} 不可編輯（已送審、核准或送出的月報只有品管中心能修改）",
        "report_locked",
        status=report.status,
    )


def _payload_items(entries_data) -> list[dict]:
    if not isinstance(entries_data, list):
        raise rejected("entries 必須是清單", "invalid_payload")
    for item in entries_data:
        if not isinstance(item, dict) or not isinstance(item.get("indicator_code"), str) or not item["indicator_code"]:
            raise rejected("entries 的每一筆都要有 indicator_code", "invalid_payload")
    return entries_data


def _build_plans(items: list[dict], editable: dict, metas: dict, campus_code: str) -> list[dict]:
    """
    Validate a save-draft payload against what the user may edit; nothing is written here.

    - an indicator the user has no assignment for: 403 ``not_assigned``
    - a field the user has no right to (key present in the payload): 400 ``field_not_assigned``
    - a value that is not a number: 400 ``invalid_number``
    """
    unassigned = sorted({it["indicator_code"] for it in items if it["indicator_code"] not in editable})
    if unassigned:
        raise forbidden(f"以下指標未指派給你，無法儲存：{'、'.join(unassigned)}", "not_assigned", codes=unassigned)

    denied: list[dict] = []
    bad_numbers: list[dict] = []
    bad_payload: list[dict] = []
    plans: list[dict] = []

    def deny(code: str, field: str) -> None:
        if {"indicator_code": code, "field": field} not in denied:
            denied.append({"indicator_code": code, "field": field})

    for item in items:
        code = item["indicator_code"]
        allowed = editable[code]
        indicator = metas.get(code)
        sub_mode = uses_sub_entries(code, campus_code)
        sub_items = item.get("sub_entries")
        plan = {"code": code, "indicator": indicator, "allowed": allowed, "numbers": {}, "subs": None, "note": None}

        for field in FIELD_SET:
            if field not in item:
                continue
            raw = item[field]
            if field not in allowed:
                # Clients written before field-level assignment send "denominator": null for count indicators.
                if field == "denominator" and raw is None and indicator is not None and not indicator.has_denominator:
                    continue
                deny(code, field)
            elif field == "numerator" and sub_mode:
                if not sub_items:  # with sub_entries the explicit numerator is simply replaced by their sum
                    bad_payload.append({
                        "indicator_code": code, "field": "numerator",
                        "reason": "此指標的分子由 13 類子項加總，請提供 sub_entries",
                    })
            else:
                try:
                    plan["numbers"][field] = parse_number(raw)
                except ValueError:
                    bad_numbers.append({"indicator_code": code, "field": field, "reason": "必須是數字或 null"})

        if sub_items:
            if not sub_mode:
                bad_payload.append({"indicator_code": code, "field": "sub_entries", "reason": "此指標沒有子類別"})
            elif "numerator" not in allowed:
                deny(code, "numerator")  # the sub-categories are the numerator
            else:
                plan["subs"] = {}
                if not isinstance(sub_items, list):
                    bad_payload.append({"indicator_code": code, "field": "sub_entries", "reason": "必須是清單"})
                    sub_items = []
                for sub in sub_items:
                    sub_code = sub.get("sub_code") if isinstance(sub, dict) else None
                    if sub_code not in HA10_SUB_NAMES:
                        bad_payload.append({"indicator_code": code, "field": "sub_entries",
                                            "reason": f"未知的子類別 {sub_code}"})
                        continue
                    try:
                        plan["subs"][sub_code] = parse_number(sub.get("value"), max_digits=10)
                    except ValueError:
                        bad_numbers.append({"indicator_code": code, "field": sub_code, "reason": "必須是數字或 null"})

        if "note" in item:
            # Every item here is an indicator the user is assigned to (checked above), and that is all a note
            # takes: case-list indicators have no editable field, yet their note is written like any other.
            note = "" if item["note"] is None else item["note"]
            if isinstance(note, str):
                plan["note"] = note
            else:
                bad_payload.append({"indicator_code": code, "field": "note", "reason": "必須是文字"})
        plans.append(plan)

    if denied:
        names = "、".join(f"{d['indicator_code']} {FIELD_LABELS[d['field']]}" for d in denied)
        raise rejected(f"以下欄位不是你負責的，無法儲存：{names}", "field_not_assigned", fields=denied)
    if bad_numbers:
        raise rejected("有欄位不是數字，請修正後再儲存", "invalid_number", errors=bad_numbers)
    if bad_payload:
        raise rejected("填報內容格式不正確", "invalid_payload", errors=bad_payload)
    return plans


def _has_content(plan: dict) -> bool:
    """Whether a validated item names anything to write: a number (null clears one), sub-categories or a note."""
    return bool(plan["numbers"]) or plan["subs"] is not None or plan["note"] is not None


def _apply_sub_values(entry: IndicatorEntry, sub_values: dict, user, now) -> bool:
    """
    Write HA10 sub-category values and make the numerator their sum. True when the numerator changed.

    A sub-category left out of ``sub_values`` keeps its value. With no value at all the numerator is NULL.
    The numerator is set to the sum on every call, also when no sub-category changed: a numerator that has
    drifted away from its sub-categories is repaired by the next save that carries them.
    """
    stored = {s.sub_code: s for s in entry.sub_entries.all()}
    changed = False
    for sub_code, new in sub_values.items():
        row = stored.get(sub_code)
        if row is None:
            if new is None:
                continue
            stored[sub_code] = HA10SubEntry.objects.create(
                entry=entry, sub_code=sub_code, sub_name=HA10_SUB_NAMES[sub_code], value=new
            )
            changed = True
        elif row.value != new:
            row.value = new
            row.sub_name = HA10_SUB_NAMES[sub_code]
            row.save(update_fields=["value", "sub_name"])
            changed = True
    present = [row.value for row in stored.values() if row.value is not None]
    total = sum(present, Decimal("0")) if present else None
    if changed or entry.numerator != total:
        entry.numerator = total
        entry.numerator_filled_by = user
        entry.numerator_filled_at = now
        return True
    return False


_ENTRY_UPDATE_FIELDS = [
    "numerator", "denominator", "value", "note", "filled_by", "filled_at", "data_source",
    "numerator_filled_by", "numerator_filled_at", "denominator_filled_by", "denominator_filled_at",
]


@transaction.atomic
def save_draft(user, campus: Campus, year: int, month: int, category_code: str, entries_data: list) -> dict:
    """
    暫存草稿（§8.2 save-draft）
    entries_data: [{ indicator_code, numerator?, denominator?, note?, sub_entries? }]

    Only fields present in the payload are touched (absent = unchanged, null = clear), and only fields
    the user is assigned to. Either the whole payload is written or nothing is. A payload with nothing to
    write (no entries, or entries that only name an indicator) creates and changes nothing: no report, no
    draft status; the answer then has ``report_id`` null while the report does not exist.
    """
    category = _get_category(category_code)
    items = _payload_items(entries_data)

    # The report row is locked for the whole transaction, so concurrent saves of one report queue up and
    # each one recomputes ``value`` from what the previous one committed.
    report = MonthlyReport.objects.select_for_update().filter(
        campus=campus, year=year, month=month, category=category
    ).first()
    if report is not None and report.locked_for_reporters:
        raise _lock_error(report)  # KD1

    editable = editable_fields(user, campus, year, month, category_code)
    metas = {i.code: i for i in Indicator.objects.filter(code__in={it["indicator_code"] for it in items})}
    plans = _build_plans(items, editable, metas, campus.code)

    writable = [plan for plan in plans if _has_content(plan)]
    if report is None and writable:
        report, _ = MonthlyReport.objects.select_for_update().get_or_create(
            campus=campus, year=year, month=month, category=category,
            defaults={"status": ReportStatus.UNFILLED},
        )
        if report.locked_for_reporters:  # somebody else created it and moved it on in between
            raise _lock_error(report)

    now = timezone.now()
    for plan in writable:
        code = plan["code"]
        has_denominator, unit = _meta_defaults(plan["indicator"])
        entry, _ = IndicatorEntry.objects.select_for_update().get_or_create(report=report, indicator_code=code)

        inputs_changed = False
        for field, new in plan["numbers"].items():
            if getattr(entry, field) != new:
                setattr(entry, field, new)
                setattr(entry, f"{field}_filled_by", user)
                setattr(entry, f"{field}_filled_at", now)
                inputs_changed = True
        if plan["subs"] is not None and _apply_sub_values(entry, plan["subs"], user, now):
            inputs_changed = True
        note_changed = plan["note"] is not None and entry.note != plan["note"]
        if note_changed:
            entry.note = plan["note"]

        # Recompute from the numerator and denominator as they are now, other people's included.
        value = compute_value(entry.numerator, entry.denominator, has_denominator, unit)
        if not value_fits(value):
            raise rejected(f"{code} 的計算值超出可儲存範圍，請確認分子與分母", "value_out_of_range")
        value_changed = entry.value != value
        entry.value = value

        if inputs_changed or note_changed:
            entry.filled_by = user
            entry.filled_at = now
        if inputs_changed:
            entry.data_source = DataSource.MANUAL
        if inputs_changed or note_changed or value_changed:
            entry.save(update_fields=_ENTRY_UPDATE_FIELDS)

    # 更新 report 狀態為 draft（只有真的寫了東西才算）
    if writable and report.status == ReportStatus.UNFILLED:
        report.status = ReportStatus.DRAFT
        # 逾期檢查
        if get_deadline_info(year, month)["is_overdue"]:
            report.is_late = True
        report.save(update_fields=["status", "is_late"])

    payload_codes = list(dict.fromkeys(it["indicator_code"] for it in items))
    stored = {}
    if report is not None:
        stored = {
            e.indicator_code: e
            for e in IndicatorEntry.objects.filter(report=report, indicator_code__in=payload_codes)
            .select_related("numerator_filled_by", "denominator_filled_by", "filled_by")
            .prefetch_related("sub_entries")
        }
    return {
        "ok": True,
        "report_id": report.id if report is not None else None,
        "status": report.status if report is not None else ReportStatus.UNFILLED,
        "entries": [
            {
                "indicator_code": code,
                **_entry_fields(stored[code], code, campus.code),
                "filled_by": _full_name(stored[code].filled_by),
                "filled_at": _iso(stored[code].filled_at),
            }
            for code in payload_codes
            if code in stored
        ],
    }


# ── submit ───────────────────────────────────────────────────────

@transaction.atomic
def submit_category(user, campus: Campus, year: int, month: int, category_code: str) -> dict:
    """
    送審面向（§8.2 submit）

    Who may submit: anyone with an assignment in force for the campus x category, and admins (KD4).
    What is checked (KD3, KD2): every indicator of the whole campus x category that has an assignment in
    force, not just the submitter's own, must have all its required fields filled (not NULL; a zero
    denominator counts). HA10-01 at Hsinchu also needs all 13 sub-categories.
    """
    category = _get_category(category_code)
    # Defence for direct callers of this function. Through the API this never fires: resolve_campus has already
    # refused a campus (403 campus_not_assigned) or a category (400 no_assignment) the user holds no assignment for.
    if not is_admin(user) and not active_assignments(
        year, month, user=user, campus=campus, category_code=category_code
    ).exists():
        raise forbidden("你在此院區的這個面向沒有指派的指標，無法送審", "not_assigned")

    unit = _load_unit(campus, category, year, month, lock_report=True)
    report = unit.report
    if report is not None and report.locked_for_reporters:
        raise _lock_error(report)
    if not unit.codes:
        raise rejected("此面向無指派指標", "no_indicators")

    gaps = _unit_gaps(unit)
    if gaps:
        raise rejected(
            _incomplete_message(gaps),
            "incomplete",
            missing=gaps,
            unfilled_codes=sorted({g["indicator_code"] for g in gaps}),  # kept for clients that read it
        )
    if report is None:  # cannot happen (no entry means a gap), but never submit a report that does not exist
        raise rejected("尚無草稿，請先暫存", "no_draft")

    report.status = ReportStatus.SUBMITTED
    report.submitted_at = timezone.now()
    report.submitted_by = user
    report.rejection_reason = ""  # 清空退回理由
    report.save(update_fields=["status", "submitted_at", "submitted_by", "rejection_reason"])

    return {"ok": True, "report_id": report.id, "status": report.status}
