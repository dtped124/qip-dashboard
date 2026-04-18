import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import ImportLog


@csrf_exempt
def upload_excel(request):
    """POST /api/v1/imports/upload/ — 上傳 Excel 檔案"""
    if request.method != "POST":
        return JsonResponse({"error": {"code": "METHOD_NOT_ALLOWED", "message": "Only POST"}}, status=405)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": {"code": "BAD_REQUEST", "message": "No file provided"}}, status=400)

    from .services.excel_parser import parse_qip_excel
    from .services.persistence import save_import_results

    file_bytes = uploaded.read()
    parse_result = parse_qip_excel(file_bytes, uploaded.name)
    log = save_import_results(parse_result, uploaded.name, len(file_bytes))

    return JsonResponse({
        "data": {
            "id": log.id,
            "new": log.data_points_new,
            "updated": log.data_points_updated,
            "unchanged": log.data_points_unchanged,
            "sheets": log.sheets_processed,
            "errors": log.errors,
        }
    })


def import_logs(request):
    """GET /api/v1/imports/logs/ — 取得匯入紀錄"""
    logs = ImportLog.objects.all()[:20].values(
        "id", "file_name", "file_size", "sheets_processed",
        "data_points_new", "data_points_updated", "data_points_unchanged",
        "errors", "created_at",
    )
    return JsonResponse({"data": list(logs), "total": ImportLog.objects.count()})


@csrf_exempt
def correct_datapoint(request):
    """POST /api/v1/imports/correct-datapoint/ — 修正警告資料點並移除對應錯誤訊息"""
    if request.method != "POST":
        return JsonResponse({"error": "METHOD_NOT_ALLOWED"}, status=405)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "BAD_REQUEST"}, status=400)

    indicator_code = body.get("indicator_code")
    campus = body.get("campus")
    year = body.get("year")
    month = body.get("month")
    new_value = body.get("new_value")  # None = 不改值，僅移除警告
    log_id = body.get("log_id")
    error_text = body.get("error_text")

    if not all([indicator_code, campus, year, month, log_id]):
        return JsonResponse({"error": "MISSING_FIELDS"}, status=400)

    if new_value is not None:
        from apps.indicators.models import DataPoint
        try:
            dp = DataPoint.objects.get(
                indicator_id=indicator_code,
                campus=campus,
                year=int(year),
                month=int(month),
            )
            dp.value = float(new_value)
            dp.save(update_fields=["value", "updated_at"])
        except DataPoint.DoesNotExist:
            return JsonResponse({"error": "DATAPOINT_NOT_FOUND"}, status=404)

    if error_text:
        try:
            log = ImportLog.objects.get(id=log_id)
            log.errors = [e for e in (log.errors or []) if e != error_text]
            log.save(update_fields=["errors", "updated_at"])
        except ImportLog.DoesNotExist:
            pass

    return JsonResponse({"status": "ok"})
