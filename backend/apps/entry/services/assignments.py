"""
Who may fill what: field-level assignments (D2).

An IndicatorAssignment covers the numerator, the denominator or both of one indicator at one
campus. Everything that needs to know "is this assignment in force" or "which fields may this
user touch" asks this module, so the rule lives in exactly one place.

- active_assignments  ─ assignments in force during a month
- assigned_fields     ─ per indicator, the fields a user is responsible for
- editable_fields     ─ ... of those, the ones the entry form lets the user type into
- required_fields     ─ the fields an indicator needs before a report may be submitted
- field_owners        ─ per (indicator, field), the people responsible
- resolve_campus      ─ which campus a request is about (no silent fallback)

Admins get no special treatment in editable_fields (KD4): they pass the reporter gate, but the
fields they may edit still come from their own assignments.
"""
from __future__ import annotations

import calendar
import datetime
from collections.abc import Iterable

from django.db.models import Q

from apps.accounts.permissions import is_admin
from apps.entry.models import AssignmentField, AssignmentRole, Campus, IndicatorAssignment
from apps.entry.services.errors import forbidden, rejected
from apps.indicators.models import Indicator

FIELD_SET = ("numerator", "denominator")


# ── Periods and assignments in force ─────────────────────────────

def period_bounds(year: int, month: int) -> tuple[datetime.date, datetime.date]:
    """
    First and last calendar day of an ROC (year, month); 400 ``invalid_period`` for nonsense.

    Call this before anything else that does date arithmetic with the period: the deadline
    (services.period.get_deadline_info) lives in the following month and raises a bare ValueError (HTTP 500)
    for month=-1 or year=1000000, so a period that passes here is also one whose deadline can be computed.
    """
    try:
        ad_year, month = int(year) + 1911, int(month)
        last_day = calendar.monthrange(ad_year, month)[1]  # IllegalMonthError (a ValueError) unless 1..12
        first, last = datetime.date(ad_year, month, 1), datetime.date(ad_year, month, last_day)
        datetime.date(ad_year + (month == 12), month % 12 + 1, 1)  # the next month must exist too (year 8088)
        return first, last
    except (TypeError, ValueError, OverflowError):
        raise rejected("年月不正確", "invalid_period") from None


def fields_of(assignment: IndicatorAssignment) -> set[str]:
    """The fields an assignment covers: ``both`` expands to numerator and denominator."""
    if assignment.field == AssignmentField.BOTH:
        return set(FIELD_SET)
    return {assignment.field} if assignment.field in FIELD_SET else set()


def active_assignments(year: int, month: int, *, user=None, campus=None, category_code: str | None = None):
    """
    Assignments in force during the given ROC month, as a queryset.

    In force = effective_from <= last day of the month AND (effective_to IS NULL OR
    effective_to >= first day of the month). ``user`` and ``campus`` (instances or ids) and
    ``category_code`` ("HA03" matches HA03-01, HA03-01-01, ...) narrow the result.
    """
    first_day, last_day = period_bounds(year, month)
    in_force = Q(effective_from__lte=last_day) & (Q(effective_to__isnull=True) | Q(effective_to__gte=first_day))
    qs = IndicatorAssignment.objects.filter(in_force)
    if user is not None:
        qs = qs.filter(user=user)
    if campus is not None:
        qs = qs.filter(campus=campus)
    if category_code:
        qs = qs.filter(indicator_code__startswith=f"{category_code}-")
    return qs


def _meta_for(codes: Iterable[str]) -> dict[str, Indicator]:
    return {i.code: i for i in Indicator.objects.filter(code__in=set(codes))}


# ── What a user may touch ────────────────────────────────────────

def group_fields(assignments: Iterable[IndicatorAssignment], meta: dict[str, Indicator]) -> dict[str, set[str]]:
    """
    {indicator_code: fields} covered by already loaded assignments.

    A field that cannot exist (the denominator of a count indicator) is left out; nothing else is.
    """
    result: dict[str, set[str]] = {}
    for assignment in assignments:
        result.setdefault(assignment.indicator_code, set()).update(fields_of(assignment))
    for code, fields in result.items():
        indicator = meta.get(code)
        if indicator is not None and not indicator.has_denominator:
            fields.discard("denominator")
    return result


def assigned_fields(user, campus, year: int, month: int, category_code: str) -> dict[str, set[str]]:
    """
    {indicator_code: fields} the user is responsible for at the campus in that month.

    Pure responsibility. Case-list indicators keep their fields here (the case-list pages check the
    numerator permission through this), while the entry form uses editable_fields.
    """
    assignments = list(active_assignments(year, month, user=user, campus=campus, category_code=category_code))
    return group_fields(assignments, _meta_for(a.indicator_code for a in assignments))


def editable_fields(user, campus, year: int, month: int, category_code: str) -> dict[str, set[str]]:
    """
    {indicator_code: fields} the entry form lets the user type into.

    Every indicator the user is assigned to is a key. The set is empty for case-list indicators (KD9):
    their numbers come from the case-list pages and imports, not from the form. A count indicator never
    offers its denominator.
    """
    assignments = list(active_assignments(year, month, user=user, campus=campus, category_code=category_code))
    meta = _meta_for(a.indicator_code for a in assignments)
    fields_by_code = group_fields(assignments, meta)
    for code in fields_by_code:
        indicator = meta.get(code)
        if indicator is not None and indicator.entry_mode == "case_list":
            fields_by_code[code] = set()
    return fields_by_code


def required_fields(indicator: Indicator | None, campus: Campus | None = None) -> set[str]:
    """
    The fields that must hold a value (not NULL) before a report may be submitted (KD2).

    The numerator is always required, the denominator only for indicators that have one. HA10-01 at
    Hsinchu additionally needs its 13 sub-categories (services.values.uses_sub_entries); those live in
    HA10SubEntry, so the caller checks them. Unknown metadata counts as the legacy default (has a denominator).
    """
    required = {"numerator"}
    if indicator is None or indicator.has_denominator:
        required.add("denominator")
    return required


# ── Who is responsible ───────────────────────────────────────────

def owners_from_assignments(assignments: Iterable[IndicatorAssignment]) -> dict[tuple[str, str], list]:
    """
    {(indicator_code, field): [users]} for already loaded assignments (``user`` should be select_related).

    ``both`` is spread over both fields; primaries come before deputies and nobody is listed twice.
    """
    ordered = sorted(assignments, key=lambda a: (a.role != AssignmentRole.PRIMARY, a.user_id))
    owners: dict[tuple[str, str], list] = {}
    for assignment in ordered:
        for field in sorted(fields_of(assignment), key=FIELD_SET.index):
            users = owners.setdefault((assignment.indicator_code, field), [])
            if all(u.pk != assignment.user_id for u in users):
                users.append(assignment.user)
    return owners


def field_owners(campus, year: int, month: int, category_code: str) -> dict[tuple[str, str], list]:
    """{(indicator_code, field): [users in force that month]} for one campus and category."""
    assignments = active_assignments(year, month, campus=campus, category_code=category_code).select_related("user")
    return owners_from_assignments(assignments)


# ── Which campus a request is about ──────────────────────────────

def resolve_campus(user, category_code: str, campus_code: str | None, year: int, month: int) -> Campus:
    """
    The campus an entry request is about. There is no fallback to ``user.campus``.

    - ``campus_code`` given: it must be a campus where the user has an assignment in force for the
      category that month, otherwise 403 ``campus_not_assigned``. Admins may name any campus (KD4);
      an unknown code is 400 ``campus_not_found`` for them.
    - not given: the one campus of the user's assignments in that category. Several campuses is
      400 ``campus_required``; none is 400 ``no_assignment`` (an admin, who may name any campus,
      is simply asked to give one).
    """
    assigned = active_assignments(year, month, user=user, category_code=category_code)
    campuses = list(Campus.objects.filter(id__in=assigned.values("campus_id")).order_by("name"))

    campus_code = str(campus_code).strip() if campus_code else ""
    if campus_code:
        for campus in campuses:
            if campus.code == campus_code:
                return campus
        if is_admin(user):
            try:
                return Campus.objects.get(code=campus_code)
            except Campus.DoesNotExist:
                raise rejected(f"找不到院區 {campus_code}", "campus_not_found") from None
        raise forbidden("此面向沒有指派給你在該院區的指標", "campus_not_assigned")

    if len(campuses) == 1:
        return campuses[0]
    if campuses or is_admin(user):
        raise rejected("請指定院區", "campus_required")
    raise rejected("此面向沒有指派給你的指標", "no_assignment")
