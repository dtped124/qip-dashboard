"""
品管中心審核 API（§8.3）
GET  /api/review/overview
GET  /api/review/detail
POST /api/review/approve
POST /api/review/reject
PATCH /api/review/edit-entry
POST /api/review/finalize
POST /api/review/unlock   (系統管理員)
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin, IsReviewer
from apps.entry.models import Campus
from apps.entry.services.period import get_current_tw_year_month
from apps.entry.services.review_service import (
    approve_category,
    edit_entry,
    finalize_campus,
    get_review_detail,
    get_review_overview,
    reject_category,
    unlock_month,
)


def _parse_year_month(request):
    tw_year, month = get_current_tw_year_month()
    try:
        year = int(request.query_params.get("year", tw_year))
        month = int(request.query_params.get("month", month))
    except (ValueError, TypeError):
        year, month = tw_year, get_current_tw_year_month()[1]
    return year, month


def _get_campus(campus_code: str):
    try:
        return Campus.objects.get(code=campus_code)
    except Campus.DoesNotExist:
        return None


def _failure(result: dict) -> Response:
    """400 for a service result with ok=False: {"detail", "code"?} (code only when the service named one)."""
    body = {"detail": result["error"]}
    if result.get("code"):
        body["code"] = result["code"]
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([IsReviewer])
def review_overview(request):
    """GET /api/review/overview?year=115&month=3"""
    year, month = _parse_year_month(request)
    return Response(get_review_overview(year, month))


@api_view(["GET"])
@permission_classes([IsReviewer])
def review_detail(request):
    """GET /api/review/detail?campus=zhubei&year=115&month=3&category=HA03"""
    campus_code = request.query_params.get("campus", "")
    category_code = request.query_params.get("category", "")
    year, month = _parse_year_month(request)

    campus = _get_campus(campus_code)
    if not campus:
        return Response({"detail": f"找不到院區 {campus_code}"}, status=status.HTTP_404_NOT_FOUND)

    data = get_review_detail(campus, year, month, category_code)
    if "error" in data:
        return Response({"detail": data["error"]}, status=status.HTTP_404_NOT_FOUND)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsReviewer])
def review_approve(request):
    """POST /api/review/approve  body: {campus, year, month, category}"""
    d = request.data
    campus = _get_campus(d.get("campus", ""))
    if not campus:
        return Response({"detail": "找不到院區"}, status=status.HTTP_400_BAD_REQUEST)

    result = approve_category(request.user, campus, int(d["year"]), int(d["month"]), d["category"])
    if not result["ok"]:
        return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(["POST"])
@permission_classes([IsReviewer])
def review_reject(request):
    """POST /api/review/reject  body: {campus, year, month, category, reason}"""
    d = request.data
    campus = _get_campus(d.get("campus", ""))
    if not campus:
        return Response({"detail": "找不到院區"}, status=status.HTTP_400_BAD_REQUEST)

    result = reject_category(
        request.user, campus, int(d["year"]), int(d["month"]), d["category"],
        d.get("reason", "")
    )
    if not result["ok"]:
        return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(["PATCH"])
@permission_classes([IsReviewer])
def review_edit_entry(request):
    """PATCH /api/review/edit-entry  body: {entry_id, field, new_value, reason}"""
    d = request.data
    try:
        entry_id = int(d.get("entry_id", 0))
    except (TypeError, ValueError):
        entry_id = 0
    result = edit_entry(
        request.user,
        entry_id,
        d.get("field", ""),
        d.get("new_value", ""),
        d.get("reason", ""),
    )
    if not result["ok"]:
        return _failure(result)
    return Response(result)


@api_view(["POST"])
@permission_classes([IsReviewer])
def review_finalize(request):
    """POST /api/review/finalize  body: {campus, year, month}"""
    d = request.data
    campus = _get_campus(d.get("campus", ""))
    if not campus:
        return Response({"detail": "找不到院區"}, status=status.HTTP_400_BAD_REQUEST)

    result = finalize_campus(request.user, campus, int(d["year"]), int(d["month"]))
    if not result["ok"]:
        return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAdmin])
def review_unlock(request):
    """POST /api/review/unlock  body: {campus, year, month, reason}  管理員專用"""
    d = request.data
    campus = _get_campus(d.get("campus", ""))
    if not campus:
        return Response({"detail": "找不到院區"}, status=status.HTTP_400_BAD_REQUEST)

    result = unlock_month(request.user, campus, int(d["year"]), int(d["month"]), d.get("reason", ""))
    if not result["ok"]:
        return _failure(result)
    return Response(result)
