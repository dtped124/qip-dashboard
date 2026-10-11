"""
填報系統管理 API
§8.4 管理 API（指標負責人、截止日）
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.entry.models import AssignmentField, Campus, DeadlineSetting, IndicatorAssignment, ReportCategory
from apps.entry.serializers import (
    CampusSerializer,
    DeadlineSettingSerializer,
    IndicatorAssignmentSerializer,
    ReportCategorySerializer,
)
from apps.entry.services.errors import rejected

# ── 院區 ────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAdmin])
def campus_list(request):
    """GET /api/admin/campuses"""
    campuses = Campus.objects.filter(is_active=True)
    return Response(CampusSerializer(campuses, many=True).data)


# ── 面向 ────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAdmin])
def category_list(request):
    """GET /api/admin/categories"""
    categories = ReportCategory.objects.all()
    return Response(ReportCategorySerializer(categories, many=True).data)


# ── 指標負責人指派 ───────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def assignment_list(request):
    """GET/POST /api/admin/assignments?campus=zhubei&indicator=HA01-01&field=numerator"""
    if request.method == "GET":
        qs = IndicatorAssignment.objects.select_related("campus", "user").filter(
            effective_to__isnull=True  # 僅顯示現行有效指派
        ).order_by("indicator_code", "campus_id", "id")
        campus_code = request.query_params.get("campus")
        if campus_code:
            qs = qs.filter(campus__code=campus_code)
        indicator_code = request.query_params.get("indicator")
        if indicator_code:
            qs = qs.filter(indicator_code=indicator_code)
        field = request.query_params.get("field")
        if field:
            # the stored value: ?field=numerator lists the numerator-only rows, not the "both" rows
            if field not in AssignmentField.values:
                raise rejected(f"field 必須是 {'、'.join(AssignmentField.values)} 之一", "invalid_field")
            qs = qs.filter(field=field)
        return Response(IndicatorAssignmentSerializer(qs, many=True).data)

    serializer = IndicatorAssignmentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    assignment = serializer.save(created_by=request.user)
    return Response(IndicatorAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAdmin])
def assignment_detail(request, pk):
    """GET/PATCH/DELETE /api/admin/assignments/:id"""
    try:
        assignment = IndicatorAssignment.objects.select_related("campus", "user").get(pk=pk)
    except IndicatorAssignment.DoesNotExist:
        return Response({"detail": "找不到指派紀錄"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(IndicatorAssignmentSerializer(assignment).data)

    if request.method == "PATCH":
        # 修改指派：設定 effective_to，建立新紀錄（保留歷史）
        serializer = IndicatorAssignmentSerializer(assignment, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(IndicatorAssignmentSerializer(assignment).data)

    # DELETE：硬刪除（立即移除指派）
    assignment.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── 截止日管理 ───────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def deadline_list(request):
    """GET/POST /api/admin/deadlines?year=115"""
    if request.method == "GET":
        qs = DeadlineSetting.objects.all()
        year = request.query_params.get("year")
        if year:
            qs = qs.filter(year=year)
        return Response(DeadlineSettingSerializer(qs, many=True).data)

    serializer = DeadlineSettingSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj, _ = DeadlineSetting.objects.update_or_create(
        year=serializer.validated_data["year"],
        month=serializer.validated_data["month"],
        defaults=serializer.validated_data,
    )
    return Response(DeadlineSettingSerializer(obj).data, status=status.HTTP_201_CREATED)
