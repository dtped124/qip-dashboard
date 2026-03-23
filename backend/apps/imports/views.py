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
