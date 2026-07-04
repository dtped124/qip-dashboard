"""
達文西手術品質 — API views（前綴 /api/davinci/，與 QIP API 平行、互不影響）

Phase 1 端點：
    POST /api/davinci/import/          上傳 xlsx → 解析 → 回傳匯入報告（不寫入）
    POST /api/davinci/import/confirm/  確認寫入（重讀已存檔案 → upsert）
    GET  /api/davinci/import/logs/     匯入紀錄
    GET  /api/davinci/indicators/      指定院區的指標聚合值（依 period 分組）
    GET  /api/davinci/meta/            指標定義 + 代碼表 + 院區清單（前端初始化用）
"""
from __future__ import annotations

import json

from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .constants import (
    ADVERSE_EVENT_CODES,
    DAVINCI_CAMPUSES,
    DAVINCI_CATEGORY,
    DAVINCI_INDICATORS,
    P_CHART_MIN_N,
    SEVERE_COMP_CODES,
)
from .models import DavinciImportLog, DavinciIndicatorValue, ImportStatus
from .services.cleaner import period_to_roc_label
from .services.importer import parse_davinci_workbook
from .services.persistence import persist_result


def _err(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=status)


@csrf_exempt
def import_upload(request):
    """POST /api/davinci/import/ — 上傳 → 解析 → 預覽報告（status=preview，不寫入）"""
    if request.method != "POST":
        return _err("METHOD_NOT_ALLOWED", "Only POST", 405)
    uploaded = request.FILES.get("file")
    if not uploaded:
        return _err("BAD_REQUEST", "No file provided", 400)

    file_bytes = uploaded.read()
    try:
        result = parse_davinci_workbook(file_bytes, uploaded.name)
    except Exception as exc:  # noqa: BLE001 — 解析失敗一律回報給使用者
        return _err("BAD_REQUEST", f"檔案解析失敗：{exc}", 400)

    if not result.cases:
        return _err("BAD_REQUEST", "檔案內找不到可匯入的達文西資料列", 400)

    log = DavinciImportLog(
        file_name=uploaded.name,
        file_size=len(file_bytes),
        status=ImportStatus.PREVIEW,
        periods=sorted({c.period for c in result.cases}),
        campuses=sorted({c.campus for c in result.cases}),
        rows_raw=result.rows_raw,
        cases_dedup=len(result.cases),
        report_json=result.report,
    )
    log.uploaded_file.save(uploaded.name, ContentFile(file_bytes), save=False)
    log.save()

    return JsonResponse({
        "data": {
            "log_id": log.id,
            "file_name": log.file_name,
            "rows_raw": log.rows_raw,
            "cases_dedup": log.cases_dedup,
            "periods": log.periods,
            "period_labels": [period_to_roc_label(p) for p in log.periods],
            "campuses": log.campuses,
            "report": log.report_json,
        }
    })


@csrf_exempt
def import_confirm(request):
    """POST /api/davinci/import/confirm/ — {log_id} 重讀檔案 → 寫入（upsert 覆蓋同期別）"""
    if request.method != "POST":
        return _err("METHOD_NOT_ALLOWED", "Only POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("BAD_REQUEST", "Invalid JSON", 400)

    log_id = body.get("log_id")
    log = DavinciImportLog.objects.filter(id=log_id).first()
    if log is None:
        return _err("NOT_FOUND", f"匯入紀錄 {log_id} 不存在", 404)
    if log.status == ImportStatus.CONFIRMED:
        return _err("CONFLICT", "此批次已確認寫入，請勿重複確認", 409)
    if not log.uploaded_file:
        return _err("CONFLICT", "找不到已上傳的檔案，請重新上傳", 409)

    with log.uploaded_file.open("rb") as f:
        file_bytes = f.read()
    result = parse_davinci_workbook(file_bytes, log.file_name)
    stats = persist_result(result, log)

    log.status = ImportStatus.CONFIRMED
    log.save(update_fields=["status", "updated_at"])

    return JsonResponse({"data": {"log_id": log.id, **stats}})


def import_logs(request):
    """GET /api/davinci/import/logs/ — 最近 20 筆匯入紀錄"""
    logs = DavinciImportLog.objects.all()[:20].values(
        "id", "file_name", "file_size", "status", "periods", "campuses",
        "rows_raw", "cases_dedup", "created_at",
    )
    return JsonResponse({
        "data": list(logs),
        "total": DavinciImportLog.objects.count(),
    })


def indicator_values(request):
    """GET /api/davinci/indicators/?campus=竹北[&period=202605]

    回傳該院區各期別的七指標聚合值（period 遞增排序）。
    """
    campus = request.GET.get("campus")
    if campus not in DAVINCI_CAMPUSES:
        return _err("BAD_REQUEST", f"campus 必須為 {DAVINCI_CAMPUSES}", 400)

    qs = DavinciIndicatorValue.objects.filter(campus=campus)
    period = request.GET.get("period")
    if period:
        if not period.isdigit():
            return _err("BAD_REQUEST", "period 需為 yyyymm 整數", 400)
        qs = qs.filter(period=int(period))

    rows = list(qs.order_by("period", "indicator_code").values(
        "period", "indicator_code", "numerator", "denominator",
        "value", "median_value", "n_cases", "n_excluded",
    ))
    periods = sorted({r["period"] for r in rows})
    by_period = [
        {
            "period": p,
            "period_label": period_to_roc_label(p),
            "indicators": [r for r in rows if r["period"] == p],
        }
        for p in periods
    ]
    return JsonResponse({
        "data": by_period,
        "campus": campus,
        "total_periods": len(periods),
    })


def meta(request):
    """GET /api/davinci/meta/ — 指標定義、代碼表、院區清單（前端初始化）"""
    return JsonResponse({
        "category": DAVINCI_CATEGORY,
        "indicators": [
            {"code": code, **{k: v for k, v in m.items() if k != "case_field"}}
            for code, m in DAVINCI_INDICATORS.items()
        ],
        "campuses": DAVINCI_CAMPUSES,
        "adverse_event_codes": ADVERSE_EVENT_CODES,
        "severe_comp_codes": SEVERE_COMP_CODES,
        "p_chart_min_n": P_CHART_MIN_N,
    })
