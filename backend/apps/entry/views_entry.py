"""
填報 API（§8.2）
GET  /api/entry/my-tasks
GET  /api/entry/form
POST /api/entry/save-draft
POST /api/entry/submit
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.entry.services.entry_service import (
    get_category_form,
    get_my_tasks,
    save_draft,
    submit_category,
)
from apps.entry.services.period import get_current_period, get_current_tw_year_month


def _parse_year_month(request) -> tuple[int, int]:
    """從 query params 解析民國年月，預設為本月"""
    tw_year, month = get_current_tw_year_month()
    try:
        year = int(request.query_params.get("year", tw_year))
        month = int(request.query_params.get("month", month))
    except (ValueError, TypeError):
        year, month = tw_year, get_current_tw_year_month()[1]
    return year, month


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_tasks(request):
    """GET /api/entry/my-tasks?year=115&month=3"""
    user = request.user
    if not user.campus:
        return Response({"detail": "帳號未設定院區，請聯絡管理員"}, status=status.HTTP_400_BAD_REQUEST)

    year, month = _parse_year_month(request)
    data = get_my_tasks(user, year, month)
    if "error" in data:
        return Response({"detail": data["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entry_form(request):
    """GET /api/entry/form?campus=zhubei&year=115&month=3&category=HA03"""
    user = request.user
    campus = user.campus
    if not campus:
        return Response({"detail": "帳號未設定院區"}, status=status.HTTP_400_BAD_REQUEST)

    year, month = _parse_year_month(request)
    category_code = request.query_params.get("category", "")
    if not category_code:
        return Response({"detail": "缺少 category 參數"}, status=status.HTTP_400_BAD_REQUEST)

    data = get_category_form(user, campus, year, month, category_code)
    if "error" in data:
        return Response({"detail": data["error"]}, status=status.HTTP_404_NOT_FOUND)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def entry_save_draft(request):
    """
    POST /api/entry/save-draft
    body: { year, month, category, entries: [{indicator_code, numerator, denominator, note, sub_entries?}] }
    """
    user = request.user
    campus = user.campus
    if not campus:
        return Response({"detail": "帳號未設定院區"}, status=status.HTTP_400_BAD_REQUEST)

    data = request.data
    year = data.get("year")
    month = data.get("month")
    category_code = data.get("category", "")
    entries = data.get("entries", [])

    if not all([year, month, category_code]):
        return Response({"detail": "缺少必要參數：year, month, category"}, status=status.HTTP_400_BAD_REQUEST)

    result = save_draft(user, campus, int(year), int(month), category_code, entries)
    if not result["ok"]:
        return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def entry_submit(request):
    """
    POST /api/entry/submit
    body: { year, month, category }
    """
    user = request.user
    campus = user.campus
    if not campus:
        return Response({"detail": "帳號未設定院區"}, status=status.HTTP_400_BAD_REQUEST)

    data = request.data
    year = data.get("year")
    month = data.get("month")
    category_code = data.get("category", "")

    if not all([year, month, category_code]):
        return Response({"detail": "缺少必要參數：year, month, category"}, status=status.HTTP_400_BAD_REQUEST)

    result = submit_category(user, campus, int(year), int(month), category_code)
    if not result["ok"]:
        return Response({"detail": result["error"], **result}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)
