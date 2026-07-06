"""
達文西手術品質 — API views（前綴 /api/davinci/，與 QIP API 平行、互不影響）

端點：
    POST /api/davinci/import/          上傳 xlsx → 解析 → 回傳匯入報告（不寫入）
    POST /api/davinci/import/confirm/  確認寫入（重讀已存檔案 → upsert）
    GET  /api/davinci/import/logs/     匯入紀錄
    GET  /api/davinci/indicators/      各期別七指標聚合值 + 評級（月/季）
    GET  /api/davinci/indicators/{code}/series/  SPC 序列（管制限 + WER）
    GET  /api/davinci/drilldown/       科別/醫師/術式 分組聚合
    GET  /api/davinci/cases/           個案明細（遮罩後）
    GET  /api/davinci/export/          匯出 xlsx（與儀表板同一計算路徑）
    GET  /api/davinci/meta/            指標定義 + 代碼表（前端初始化）
"""
from __future__ import annotations

import io
import json
from urllib.parse import quote

from django.core.files.base import ContentFile
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from openpyxl import Workbook

from .constants import (
    ADVERSE_EVENT_CODES,
    DAVINCI_CAMPUSES,
    DAVINCI_CATEGORY,
    DAVINCI_INDICATORS,
    P_CHART_MIN_N,
    SEVERE_COMP_CODES,
)
from .models import DavinciCase, DavinciImportLog, ImportStatus
from .services.aggregation import (
    aggregate_cases_by_period,
    aggregate_group,
    build_series,
    periods_in_quarter,
)
from .services.cleaner import period_to_roc_label
from .services.importer import parse_davinci_workbook
from .services.persistence import persist_result
from .services.spc import RATING_LABELS, compute_spc, rating_at

CASES_PAGE_LIMIT = 500   # 個案明細單次回傳上限（回應附 truncated 供前端提示）


def _err(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=status)


def _get_campus(request: HttpRequest) -> tuple[str | None, JsonResponse | None]:
    """campus 參數驗證（五個端點共用）。回傳 (campus, error_response)。"""
    campus = request.GET.get("campus")
    if campus not in DAVINCI_CAMPUSES:
        return None, _err("BAD_REQUEST", f"campus 必須為 {DAVINCI_CAMPUSES}", 400)
    return campus, None


def _get_mode(request: HttpRequest) -> tuple[str | None, JsonResponse | None]:
    mode = request.GET.get("mode", "monthly")
    if mode not in ("monthly", "quarterly"):
        return None, _err("BAD_REQUEST", "mode 必須為 monthly 或 quarterly", 400)
    return mode, None


# ── 匯入 ──

@csrf_exempt
def import_upload(request: HttpRequest) -> JsonResponse:
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
def import_confirm(request: HttpRequest) -> JsonResponse:
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

    # 檔案可能在 preview 與 confirm 之間被移除/損毀 → 回 JSON 錯誤而非 HTML 500
    try:
        with log.uploaded_file.open("rb") as f:
            file_bytes = f.read()
        result = parse_davinci_workbook(file_bytes, log.file_name)
    except Exception as exc:  # noqa: BLE001
        return _err("CONFLICT", f"重新讀取上傳檔失敗，請重新上傳：{exc}", 409)

    stats = persist_result(result, log)

    log.status = ImportStatus.CONFIRMED
    log.save(update_fields=["status", "updated_at"])

    return JsonResponse({"data": {"log_id": log.id, **stats}})


def import_logs(request: HttpRequest) -> JsonResponse:
    """GET /api/davinci/import/logs/ — 匯入紀錄（分頁格式依技術堆疊規範）"""
    page_size = 20
    try:
        page = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        page = 1
    qs = DavinciImportLog.objects.all()
    start = (page - 1) * page_size
    logs = qs[start:start + page_size].values(
        "id", "file_name", "file_size", "status", "periods", "campuses",
        "rows_raw", "cases_dedup", "created_at",
    )
    return JsonResponse({
        "data": list(logs),
        "total": qs.count(),
        "page": page,
        "page_size": page_size,
    })


# ── 指標查詢 ──

def indicator_values(request: HttpRequest) -> JsonResponse:
    """GET /api/davinci/indicators/?campus=竹北[&mode=monthly|quarterly][&period=]

    回傳該院區各期別的七指標聚合值（period 遞增）＋逐期評級與 WER 訊號。
    月/季皆從 DavinciCase 重算（單一計算路徑）。
    period 給定時只回該期別（SPC 評級仍以全序列計算）。
    """
    campus, err = _get_campus(request)
    if err:
        return err
    mode, err = _get_mode(request)
    if err:
        return err

    cases = list(DavinciCase.objects.filter(campus=campus))
    groups = aggregate_cases_by_period(cases, mode=mode)

    # 每指標跑一次 SPC → 逐期評級 + 整體摘要
    spc_summary: dict[str, dict] = {}
    for code, meta_row in DAVINCI_INDICATORS.items():
        series = build_series(groups, code)
        spc = compute_spc(series, meta_row["kind"], P_CHART_MIN_N)
        spc_summary[code] = {
            "rating": spc.rating,
            "rating_label": spc.rating_label,
            "insufficient": spc.insufficient,
            "baseline_warning": spc.baseline_warning,
            "baseline_n": spc.baseline_n,
        }
        for g in groups:
            row = next(r for r in g["indicators"] if r["code"] == code)
            r = rating_at(spc.signals, g["period"])
            row["rating"] = r
            row["rating_label"] = RATING_LABELS[r]
            row["signals"] = [
                {"rule": s.rule, "severity": s.severity, "message": s.message}
                for s in spc.signals if s.period == g["period"] and s.side == "high"
            ]

    period_filter = request.GET.get("period")
    if period_filter:
        groups = [g for g in groups if str(g["period"]) == period_filter]

    return JsonResponse({
        "data": groups,
        "spc": spc_summary,
        "campus": campus,
        "mode": mode,
        "total_periods": len(groups),
    })


def indicator_series(request: HttpRequest, code: str) -> JsonResponse:
    """GET /api/davinci/indicators/{code}/series?campus=竹北[&mode=monthly|quarterly]

    跨期序列 + I-MR 管制界限 + WER 訊號 +（比率型）P Chart 變動限。即時計算，不入庫。
    """
    code = code.upper()
    if code not in DAVINCI_INDICATORS:
        return _err("NOT_FOUND", f"指標 {code} 不存在", 404)
    campus, err = _get_campus(request)
    if err:
        return err
    mode, err = _get_mode(request)
    if err:
        return err

    meta_row = DAVINCI_INDICATORS[code]
    cases = list(DavinciCase.objects.filter(campus=campus))
    groups = aggregate_cases_by_period(cases, mode=mode)
    series = build_series(groups, code)
    spc = compute_spc(series, meta_row["kind"], P_CHART_MIN_N)

    return JsonResponse({
        "code": code,
        "name": meta_row["name"],
        "kind": meta_row["kind"],
        "unit": meta_row["unit"],
        "campus": campus,
        "mode": mode,
        "points": [
            {
                "period": p.period, "label": p.label, "value": p.value,
                "numerator": p.numerator, "denominator": p.denominator,
                "rating": rating_at(spc.signals, p.period),
            }
            for p in series
        ],
        "spc": {
            "has_chart": spc.has_chart,
            "insufficient": spc.insufficient,
            "baseline_warning": spc.baseline_warning,
            "baseline_n": spc.baseline_n,
            "cl": spc.cl, "sigma": spc.sigma,
            "ucl": spc.ucl, "lcl": spc.lcl,
            "ucl2": spc.ucl2, "lcl2": spc.lcl2,
            "p_cl": spc.p_cl,
            "p_limits": [
                {"period": pl.period, "ucl": pl.ucl, "lcl": pl.lcl,
                 "ucl2": pl.ucl2, "lcl2": pl.lcl2, "n": pl.n}
                for pl in spc.p_limits
            ],
            "rating": spc.rating,
            "rating_label": spc.rating_label,
            "signals": [
                {"rule": s.rule, "period": s.period, "label": s.label,
                 "value": s.value, "side": s.side, "severity": s.severity,
                 "message": s.message}
                for s in spc.signals
            ],
        },
    })


# ── 下鑽 ──

UNKNOWN_ORDER = "（未知術式）"


def _filter_cases_by_period(qs, period_raw: str):
    """period 支援月（202605）與季（2026Q2）。回傳 (queryset, error_response)。"""
    if "Q" in period_raw.upper():
        try:
            months = periods_in_quarter(period_raw.upper())
        except ValueError:
            return None, _err("BAD_REQUEST", f"period 格式錯誤：{period_raw}", 400)
        return qs.filter(period__in=months), None
    if not period_raw.isdigit():
        return None, _err("BAD_REQUEST", f"period 格式錯誤：{period_raw}", 400)
    return qs.filter(period=int(period_raw)), None


def _case_order_names(case: DavinciCase) -> list[str]:
    """個案的術式名稱清單；無醫令時回佔位鍵（與 drilldown 分組鍵一致）。"""
    names = [o.get("name") or o.get("code") or UNKNOWN_ORDER for o in case.order_codes]
    # 同帳號多列可能重複同一術式 → 去重，避免下鑽計數膨脹
    return list(dict.fromkeys(names)) or [UNKNOWN_ORDER]


def drilldown(request: HttpRequest) -> JsonResponse:
    """GET /api/davinci/drilldown?code=&campus=&period=&by=dept|surgeon|order[&dept=&surgeon=]

    下鑽分組聚合。每層皆回分子/分母（比率型）或 平均+n（連續型）。
    註：一台手術可含多個不同術式 → by=order 時同一人次會計入其每個術式
    （同術式重複醫令已去重）。
    """
    code = (request.GET.get("code") or "").upper()
    if code not in DAVINCI_INDICATORS:
        return _err("NOT_FOUND", f"指標 {code} 不存在", 404)
    campus, err = _get_campus(request)
    if err:
        return err
    period_raw = request.GET.get("period") or ""
    by = request.GET.get("by", "dept")
    if by not in ("dept", "surgeon", "order"):
        return _err("BAD_REQUEST", "by 必須為 dept / surgeon / order", 400)

    qs = DavinciCase.objects.filter(campus=campus)
    qs, err = _filter_cases_by_period(qs, period_raw)
    if err:
        return err
    if request.GET.get("dept"):
        qs = qs.filter(dept_name=request.GET["dept"])
    if request.GET.get("surgeon"):
        qs = qs.filter(surgeon=request.GET["surgeon"])

    groups: dict[str, list] = {}
    for c in qs:
        if by == "order":
            keys = _case_order_names(c)
        elif by == "surgeon":
            keys = [c.surgeon or "（未填醫師）"]
        else:
            keys = [c.dept_name or c.dept_code or "（未填科別）"]
        for k in keys:
            groups.setdefault(k, []).append(c)

    rows = []
    for key, grp in groups.items():
        # 走全模組唯一的 aggregate_group，確保與上層期別數字一致
        row = next(r for r in aggregate_group(grp) if r["code"] == code)
        rows.append({
            "key": key,
            "numerator": row["numerator"],
            "denominator": row["denominator"],
            "value": row["value"],
        })
    # 事件多者在前，其次人次
    rows.sort(key=lambda r: (-(r["numerator"] or 0), -r["denominator"], r["key"]))

    return JsonResponse({
        "code": code, "campus": campus, "period": period_raw, "by": by,
        "data": rows, "total": len(rows),
    })


def case_list(request: HttpRequest) -> JsonResponse:
    """GET /api/davinci/cases?campus=&period=[&dept=&surgeon=&order=&code=]

    個案明細（最底層）。病歷號/姓名皆為遮罩版；事件代碼附中文標籤。
    回傳含 truncated 旗標（超過 CASES_PAGE_LIMIT 時前端需提示）。
    """
    campus, err = _get_campus(request)
    if err:
        return err
    period_raw = request.GET.get("period") or ""
    qs = DavinciCase.objects.filter(campus=campus)
    qs, err = _filter_cases_by_period(qs, period_raw)
    if err:
        return err
    if request.GET.get("dept"):
        qs = qs.filter(dept_name=request.GET["dept"])
    if request.GET.get("surgeon"):
        qs = qs.filter(surgeon=request.GET["surgeon"])

    order_filter = request.GET.get("order")
    code = (request.GET.get("code") or "").upper()
    fieldname = DAVINCI_INDICATORS[code]["case_field"] if code in DAVINCI_INDICATORS else None
    is_rate = code in DAVINCI_INDICATORS and DAVINCI_INDICATORS[code]["kind"] == "rate"

    data = []
    for c in qs.order_by("period", "account"):
        # 佔位鍵（（未知術式））與 drilldown 分組鍵一致，點擊該列才有結果
        order_names = _case_order_names(c)
        if order_filter and order_filter not in order_names:
            continue
        data.append({
            "period": c.period,
            "period_label": period_to_roc_label(c.period),
            "account": c.account,
            "chart_no": c.chart_no_masked,
            "patient": c.patient_masked,
            "dept": c.dept_name,
            "surgeon": c.surgeon,
            "orders": [n for n in order_names if n != UNKNOWN_ORDER],
            "op_date": c.op_date.isoformat() if c.op_date else c.op_date_raw,
            "op_time_min": c.op_time_min,
            "blood_ml": c.blood_ml,
            "conversion": c.conversion,
            "adverse_14d": c.adverse_14d,
            "adverse": [
                {"code": k, "label": ADVERSE_EVENT_CODES.get(k, k)} for k in c.adverse_codes
            ],
            "adverse_free_text": c.adverse_free_text,
            "severe_comp_30d": c.severe_comp_30d,
            "severe": [
                {"code": k, "label": SEVERE_COMP_CODES.get(k, k)} for k in c.severe_comp_codes
            ],
            "infection_14d": c.infection_14d,
            "reoperation_14d": c.reoperation_14d,
            "flags": c.flags,
            "is_event": bool(getattr(c, fieldname)) if fieldname and is_rate else None,
        })

    total = len(data)
    return JsonResponse({
        "data": data[:CASES_PAGE_LIMIT],
        "total": total,
        "truncated": total > CASES_PAGE_LIMIT,
        "campus": campus,
    })


# ── 匯出 ──

def export_xlsx(request: HttpRequest) -> HttpResponse:
    """GET /api/davinci/export/?campus=竹北 — 匯出指標值 + 個案明細。

    指標值走 aggregate_cases_by_period（與儀表板同一計算路徑），
    確保匯出檔與畫面永不分歧。
    """
    campus, err = _get_campus(request)
    if err:
        return err

    all_cases = list(DavinciCase.objects.filter(campus=campus).order_by("period", "account"))

    wb = Workbook()
    ws = wb.active
    ws.title = "指標月值"
    ws.append(["期別", "指標代碼", "指標名稱", "分子", "分母", "值", "中位數", "人次", "排除台數"])
    for g in aggregate_cases_by_period(all_cases, mode="monthly"):
        for row in g["indicators"]:
            ws.append([
                g["period_label"], row["code"],
                DAVINCI_INDICATORS.get(row["code"], {}).get("name", ""),
                row["numerator"], row["denominator"], row["value"],
                row["median_value"], row["n_cases"], row["n_excluded"],
            ])

    ws2 = wb.create_sheet("個案明細")
    ws2.append([
        "期別", "帳號", "病歷號", "病患", "科別", "醫師", "術式",
        "手術時間(分)", "出血量(ml)", "轉換", "不良事件", "不良事件代碼",
        "嚴重併發症", "併發症代碼", "感染", "再手術", "清洗標記",
    ])
    for c in all_cases:
        ws2.append([
            period_to_roc_label(c.period), c.account, c.chart_no_masked, c.patient_masked,
            c.dept_name, c.surgeon,
            "、".join(o.get("name", "") for o in c.order_codes),
            c.op_time_min, c.blood_ml,
            "Y" if c.conversion else "N",
            "Y" if c.adverse_14d else "N", "|".join(c.adverse_codes),
            "Y" if c.severe_comp_30d else "N", "|".join(c.severe_comp_codes),
            "Y" if c.infection_14d else "N",
            "Y" if c.reoperation_14d else "N",
            "; ".join(c.flags),
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"達文西指標_{campus}.xlsx"
    resp = HttpResponse(
        buf.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    resp["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(filename)}"
    return resp


# ── Meta ──

def meta(request: HttpRequest) -> JsonResponse:
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
