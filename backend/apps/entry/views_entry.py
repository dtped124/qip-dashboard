"""
填報 API（§8.2）
GET  /api/entry/my-tasks
GET  /api/entry/form
POST /api/entry/save-draft
POST /api/entry/submit

The campus a request is about comes from its ``campus`` parameter (query for GET, body for POST), never from
the user's own campus; see services.assignments.resolve_campus. Service errors are DRF exceptions
(403 / 400 / 404 with ``{"detail", "code"}``) and need no handling here.
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsReporter
from apps.entry.services.assignments import resolve_campus
from apps.entry.services.entry_service import (
    get_category_form,
    get_my_tasks,
    save_draft,
    submit_category,
)
from apps.entry.services.errors import rejected
from apps.entry.services.period import get_current_tw_year_month


def _parse_year_month(request) -> tuple[int, int]:
    """從 query params 解析民國年月，預設為本月"""
    tw_year, month = get_current_tw_year_month()
    try:
        year = int(request.query_params.get("year", tw_year))
        month = int(request.query_params.get("month", month))
    except (ValueError, TypeError):
        year, month = tw_year, get_current_tw_year_month()[1]
    return year, month


def _post_params(request) -> tuple[dict, int, int, str]:
    """(body, year, month, category) of a POST; 400 ``missing_params`` when one is absent or malformed."""
    data = request.data if isinstance(request.data, dict) else {}
    category_code = str(data.get("category") or "")
    raw_year, raw_month = data.get("year"), data.get("month")
    # Only an absent/non-integer value is "missing"; an integer out of range (e.g. month=0)
    # is left to the period validation so every endpoint answers invalid_period for it.
    if raw_year is None or raw_month is None or not category_code:
        raise rejected("缺少必要參數：year, month, category", "missing_params")
    try:
        year, month = int(raw_year), int(raw_month)
    except (TypeError, ValueError):
        raise rejected("缺少必要參數：year, month, category", "missing_params")
    return data, year, month, category_code


@api_view(["GET"])
@permission_classes([IsReporter])
def my_tasks(request):
    """GET /api/entry/my-tasks?year=115&month=3"""
    year, month = _parse_year_month(request)
    return Response(get_my_tasks(request.user, year, month))


@api_view(["GET"])
@permission_classes([IsReporter])
def entry_form(request):
    """GET /api/entry/form?year=115&month=3&category=HA03&campus=zhubei"""
    user = request.user
    year, month = _parse_year_month(request)
    category_code = request.query_params.get("category", "")
    if not category_code:
        return Response(
            {"detail": "缺少 category 參數", "code": "missing_params"}, status=status.HTTP_400_BAD_REQUEST
        )

    campus = resolve_campus(user, category_code, request.query_params.get("campus", ""), year, month)
    return Response(get_category_form(user, campus, year, month, category_code))


@api_view(["POST"])
@permission_classes([IsReporter])
def entry_save_draft(request):
    """
    POST /api/entry/save-draft
    body: { year, month, category, campus?, entries: [{indicator_code, numerator?, denominator?, note?, sub_entries?}] }
    """
    user = request.user
    data, year, month, category_code = _post_params(request)
    campus = resolve_campus(user, category_code, data.get("campus"), year, month)
    return Response(save_draft(user, campus, year, month, category_code, data.get("entries", [])))


@api_view(["POST"])
@permission_classes([IsReporter])
def entry_submit(request):
    """
    POST /api/entry/submit
    body: { year, month, category, campus? }
    """
    user = request.user
    data, year, month, category_code = _post_params(request)
    campus = resolve_campus(user, category_code, data.get("campus"), year, month)
    return Response(submit_category(user, campus, year, month, category_code))
