"""
要素清單匯出 — 仿照人工匯出格式

GET /api/v1/exports/element-list/?campus=竹北
回傳 .xlsx，每個院區一份。表頭欄位、列順序、列數完全與使用者提供的範本一致。

要素代碼格式 HA<XX>-<YY>-<ZZ>：
  -01 = QIP 指標的分子（或單值指標的 value）
  -02 = QIP 指標的分母
  -03..-13 = 子分類（HA08-01 / HA10-01 才有，dashboard 不存子分類 → 留白）
"""
from __future__ import annotations

import io
import json
from datetime import datetime
from pathlib import Path

from django.http import HttpResponse, JsonResponse
from openpyxl import Workbook

from .models import DataPoint, DataPointSubcategory


# 載入要素清單（由 user 提供的 3 份範本萃取，列順序、要素名稱完全一致）
_SCHEMA_PATH = Path(__file__).parent / "element_schema.json"
with _SCHEMA_PATH.open(encoding="utf-8") as _f:
    ELEMENT_SCHEMA: dict[str, list[list[str]]] = json.load(_f)


# 竹東來源系統用 HA09-11..14 表示慢性呼吸照護指標；dashboard 端統一存成 HA09-01..04。
# 匯出時將模板要素代碼裡的 HA09-11.. 映射回 dashboard 真實存在的代碼。
_HA09_REMAP_ZHUDONG = {
    "HA09-11": "HA09-01",  # 中心導管相關血流感染
    "HA09-12": "HA09-02",  # 呼吸器相關肺炎
    "HA09-13": "HA09-03",  # 留置導尿管相關尿路感染
    "HA09-14": "HA09-04",  # 呼吸器脫離成功率
}

# 單值（非分子/分母）指標：-01 對應 DataPoint.value
_VALUE_INDICATORS = {"HA06-31", "HA10-02", "HA10-03"}

# 子分類型指標（dashboard 只存總數，子分類由 DataPointSubcategory 表查）
_SUBCATEGORY_INDICATORS = {"HA08-01", "HA10-01"}

# 院區名稱 → 檔名前綴對照（仿照 user 範本檔名）
_CAMPUS_FILENAME_PREFIX = {
    "竹北": "生醫竹北",
    "竹東": "生醫竹東",
    "新竹": "新竹",
}


def _parse_element_code(code: str, campus: str) -> tuple[str, str] | None:
    """
    解析要素代碼 → (qip_code, role)
    role ∈ {'numerator', 'denominator', 'value', 'subcategory', None}
    None 表示真的無對應 dashboard 欄位。
    """
    # 格式 HA<XX>-<YY>-<ZZ>
    parts = code.split("-")
    if len(parts) != 3:
        return None
    base = f"{parts[0]}-{parts[1]}"
    suffix = parts[2]

    # 竹東 HA09 系列重映射
    if campus == "竹東" and base in _HA09_REMAP_ZHUDONG:
        base = _HA09_REMAP_ZHUDONG[base]

    if base in _SUBCATEGORY_INDICATORS:
        # HA08-01 / HA10-01 子分類 → 從 DataPointSubcategory 取值
        return (code, "subcategory")

    if suffix == "01":
        if base in _VALUE_INDICATORS:
            return (base, "value")
        return (base, "numerator")
    if suffix == "02":
        return (base, "denominator")
    return None


def _six_months_ending_at(year: int, month: int) -> list[tuple[int, int]]:
    """
    回傳以 (year, month) 為最新月、往回算 6 個月的 (西元年, 月) 清單，最新月在前。
    e.g. (2026, 4) → [(2026,4), (2026,3), (2026,2), (2026,1), (2025,12), (2025,11)]
    """
    y, m = year, month
    months = []
    for _ in range(6):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return months


def _latest_data_month(campus: str) -> tuple[int, int] | None:
    """
    找出該院區「最近一筆有實質數據的月份」(西元年, 月)。

    判定方式：DataPoint 中 **numerator > 0 或 denominator > 0** 的最新月份。

    為什麼這麼嚴格：
      - 純看 numerator/denominator 是否 NULL 不夠 — 因為 HA05-01 竹東這類
        指標，來源 Excel 公式為 SUM(子分類)，子分類沒填時公式輸出 `0`，
        parser 老老實實存 n=0 d=0，但這不是真的有資料。
      - 真實有效的測量月份至少會有 d > 0（rate 指標有母群）或 n > 0
        （新增事件），因此用 (n>0 OR d>0) 過濾掉「全 0」月份。
      - 純 value 計數型（HA06-31 安寧個案、HA10-02 暴力、HA10-03 職災）
        因為沒 n/d，本身就被排除在外，要靠那些指標時請另外處理。
    """
    from django.db.models import Q
    qs = (
        DataPoint.objects
        .filter(campus=campus)
        .filter(Q(numerator__gt=0) | Q(denominator__gt=0))
        .order_by("-year", "-month")
        .values("year", "month")
        .first()
    )
    if not qs:
        return None
    # DataPoint.year 是民國年 → 轉回西元
    return (qs["year"] + 1911, qs["month"])


def _gregorian_to_roc(year: int) -> int:
    """西元年 → 民國年（DataPoint.year 以民國年儲存）"""
    return year - 1911


def _fetch_value(
    campus: str,
    qip_code: str,
    role: str,
    roc_year: int,
    month: int,
) -> int | float | None:
    """從 DataPoint（主指標）或 DataPointSubcategory（子分類）取出對應值。"""
    if role == "subcategory":
        # qip_code 此時是子分類完整代碼，如 'HA10-01-05'
        try:
            sdp = DataPointSubcategory.objects.get(
                subcategory_code=qip_code,
                campus=campus,
                year=roc_year,
                month=month,
            )
            return sdp.value
        except DataPointSubcategory.DoesNotExist:
            return None

    try:
        dp = DataPoint.objects.get(
            indicator_id=qip_code,
            campus=campus,
            year=roc_year,
            month=month,
        )
    except DataPoint.DoesNotExist:
        return None

    if role == "numerator":
        return dp.numerator
    if role == "denominator":
        return dp.denominator
    if role == "value":
        return dp.value
    return None


def export_element_list(request):
    """GET /api/v1/exports/element-list/?campus=竹北 → 回傳 .xlsx 檔案下載。"""
    campus = request.GET.get("campus", "").strip()
    if campus not in ELEMENT_SCHEMA:
        return JsonResponse(
            {"error": {"code": "BAD_REQUEST", "message": f"campus 必須為竹北/竹東/新竹 之一，收到: {campus!r}"}},
            status=400,
        )

    rows = ELEMENT_SCHEMA[campus]

    # 月份窗：以該院區「最近有資料的月份」為錨點往回算 6 個月。
    # 例如 5/21 跑匯出但 DB 最新只到 4 月 → 4/3/2/1/12/11 月。
    # 若 DB 完全沒資料 → fallback 到今天的當月。
    anchor = _latest_data_month(campus)
    if anchor is None:
        now = datetime.now()
        anchor = (now.year, now.month)
    months = _six_months_ending_at(*anchor)

    # 建立 workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    # 表頭
    header = ["要素代碼", "要素名稱"] + [f"{y}/{m:02d}(月)" for y, m in months]
    ws.append(header)

    # 資料列
    for element_code, element_name in rows:
        parsed = _parse_element_code(element_code, campus)
        row = [element_code, element_name]
        if parsed is None:
            # 子分類 → 月份欄全留白
            row.extend([None] * len(months))
        else:
            qip_code, role = parsed
            for y, m in months:
                val = _fetch_value(campus, qip_code, role, _gregorian_to_roc(y), m)
                row.append(val)
        ws.append(row)

    # 寫入記憶體
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    # 檔名：{YYYYMMDDHHMMSS}_要素清單匯出-{prefix}.xlsx
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    prefix = _CAMPUS_FILENAME_PREFIX[campus]
    filename = f"{ts}_要素清單匯出-{prefix}.xlsx"

    resp = HttpResponse(
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    # RFC 6266: filename="<ASCII fallback>" 用 ASCII（不能 percent-encode，
    # 否則瀏覽器顯示 %E8%A6%81…），filename*=UTF-8'' 用 percent-encoded UTF-8
    # 給支援的瀏覽器解碼成中文。
    from urllib.parse import quote
    ascii_fallback = f"{ts}_element_list_{campus_ascii_slug(campus)}.xlsx"
    encoded = quote(filename, safe="")
    resp["Content-Disposition"] = (
        f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"
    )
    return resp


def campus_ascii_slug(campus: str) -> str:
    """ASCII slug used in the legacy filename= fallback. Modern browsers
    use filename*=UTF-8'' and see the Chinese version; this is just a safe
    name for old clients."""
    return {"竹北": "zhubei", "竹東": "zhudong", "新竹": "hsinchu"}.get(campus, "campus")
