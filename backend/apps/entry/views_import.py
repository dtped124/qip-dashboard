"""
資料匯入 API（§8.5）
POST /api/import/excel
POST /api/import/confirm
GET  /api/import/batches
POST /api/import/his-trigger    (501 預留)
POST /api/import/his-webhook    (501 預留)
"""
import tempfile
import os

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.entry.models import Campus, ImportBatch
from apps.entry.services.import_service import confirm_import_batch, write_preview_entries


def _require_reviewer_or_admin(request):
    u = request.user
    if not (u.is_reviewer or u.is_system_admin or u.is_staff):
        return Response({"detail": "需要審核者或管理員權限"}, status=status.HTTP_403_FORBIDDEN)
    return None


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def import_excel(request):
    """
    POST /api/import/excel
    multipart: file + campus + year + month
    → 解析後建立 ImportBatch (status=preview)，回傳預覽資料
    """
    denied = _require_reviewer_or_admin(request)
    if denied:
        return denied

    file_obj = request.FILES.get("file")
    campus_code = request.data.get("campus", "")
    year = request.data.get("year")
    month = request.data.get("month")

    if not all([file_obj, campus_code, year, month]):
        return Response({"detail": "缺少必要欄位：file, campus, year, month"},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        campus = Campus.objects.get(code=campus_code)
    except Campus.DoesNotExist:
        return Response({"detail": f"找不到院區 {campus_code}"}, status=status.HTTP_400_BAD_REQUEST)

    # 暫存上傳檔案
    suffix = os.path.splitext(file_obj.name)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        for chunk in file_obj.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        from apps.entry.adapters.excel_adapter import ExcelAdapter
        adapter = ExcelAdapter(tmp_path)
        result = adapter.import_data(campus_code, int(year), int(month), request.user)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if result["status"] == "failed":
        return Response({"detail": "解析失敗", "errors": result["errors"]},
                        status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    # 儲存預覽資料到 IndicatorEntry（batch 關聯）
    if result.get("preview"):
        batch = ImportBatch.objects.get(pk=result["batch_id"])
        from apps.entry.adapters.base import IndicatorDataPoint
        from decimal import Decimal
        data_points = []
        for item in result["preview"]:
            data_points.append(IndicatorDataPoint(
                indicator_code=item["indicator_code"],
                campus_code=campus_code,
                year=int(year),
                month=int(month),
                numerator=Decimal(str(item["numerator"])) if item["numerator"] is not None else None,
                denominator=Decimal(str(item["denominator"])) if item["denominator"] is not None else None,
                note=item.get("note", ""),
            ))
        write_preview_entries(batch, data_points, request.user)

    return Response(result)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def import_confirm(request):
    """POST /api/import/confirm  body: {batch_id}"""
    denied = _require_reviewer_or_admin(request)
    if denied:
        return denied

    batch_id = request.data.get("batch_id")
    if not batch_id:
        return Response({"detail": "缺少 batch_id"}, status=status.HTTP_400_BAD_REQUEST)

    result = confirm_import_batch(int(batch_id), request.user)
    if not result["ok"]:
        return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def import_batches(request):
    """GET /api/import/batches?campus=zhubei&year=115"""
    campus_code = request.query_params.get("campus")
    year = request.query_params.get("year")

    qs = ImportBatch.objects.select_related("campus", "imported_by").order_by("-imported_at")
    if campus_code:
        qs = qs.filter(campus__code=campus_code)
    if year:
        qs = qs.filter(year=year)

    data = [
        {
            "id": b.id,
            "source_type": b.source_type,
            "source_name": b.source_name,
            "campus": b.campus.name,
            "year": b.year,
            "month": b.month,
            "status": b.status,
            "record_count": b.record_count,
            "imported_by": b.imported_by.full_name,
            "imported_at": b.imported_at.isoformat(),
            "has_errors": bool(b.error_log),
        }
        for b in qs[:100]
    ]
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def his_trigger(request):
    """POST /api/import/his-trigger  —  HIS 手動觸發（未實作）"""
    return Response({"detail": "HIS 串接尚未實作，等 HIS 報表格式確定後開發"},
                    status=status.HTTP_501_NOT_IMPLEMENTED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def his_webhook(request):
    """POST /api/import/his-webhook  —  HIS 主動推送（未實作）"""
    return Response({"detail": "HIS webhook 尚未實作"},
                    status=status.HTTP_501_NOT_IMPLEMENTED)
