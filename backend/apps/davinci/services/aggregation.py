"""
達文西 — 期別序列組裝與聚合（單一計算路徑）

七指標的分子/分母/平均/中位數計算集中在 aggregate_group()：
- 匯入入庫（services/indicators.py）
- 儀表板/序列 API（views.indicator_values / indicator_series）
- 下鑽（views.drilldown）
- 匯出（views.export_xlsx）
全部走同一個函式，避免多份實作漂移導致「匯出跟畫面對不上」。

月/季模式皆從個案（DavinciCase 或同欄位物件）即時重算：
- 比率型：期內分子/分母加總重算比率
- 連續型：期內全部台數重算平均/中位數（不是拿月值做平均，
  避免小分母月份權重失真——與 QIP 季彙總同原則，於 davinci 內自有實作）
DavinciIndicatorValue 僅作為匯入時的入庫快照，非讀取路徑的資料源。
"""
from __future__ import annotations

from statistics import median
from typing import Iterable

from ..constants import DAVINCI_INDICATORS
from .cleaner import period_to_roc_label
from .spc import SeriesPoint


def quarter_key(period: int) -> str:
    """202605 → '2026Q2'"""
    year, month = period // 100, period % 100
    return f"{year}Q{(month - 1) // 3 + 1}"


def quarter_label(qkey: str) -> str:
    """'2026Q2' → '115年Q2'"""
    year, q = qkey.split("Q")
    return f"{int(year) - 1911}年Q{q}"


def periods_in_quarter(qkey: str) -> list[int]:
    """'2026Q2' → [202604, 202605, 202606]。格式或範圍不合法 → ValueError。"""
    parts = qkey.split("Q")
    if len(parts) != 2:
        raise ValueError(f"quarter key 格式錯誤: {qkey}")
    year, q = int(parts[0]), int(parts[1])
    if not (2000 <= year <= 2100 and 1 <= q <= 4):
        raise ValueError(f"quarter key 超出範圍: {qkey}")
    start = (q - 1) * 3 + 1
    return [year * 100 + m for m in range(start, start + 3)]


def period_label(period: int | str) -> str:
    """月（int yyyymm）→ '115年5月'；季（'2026Q2'）→ '115年Q2'"""
    if isinstance(period, str):
        return quarter_label(period)
    return period_to_roc_label(period)


def aggregate_group(grp: list) -> list[dict]:
    """對一組個案算七指標。⭐ 全模組唯一的指標數學實作。

    grp 元素需具備 DAVINCI_INDICATORS 各 case_field 同名屬性
    （DavinciCase model instance 或 dedup.DedupCase 皆可）。
    """
    n = len(grp)
    rows: list[dict] = []
    for code, meta in DAVINCI_INDICATORS.items():
        fieldname = meta["case_field"]
        if meta["kind"] == "rate":
            num = sum(1 for c in grp if getattr(c, fieldname))
            rows.append({
                "code": code,
                "numerator": num,
                "denominator": n,
                "value": round(num / n * 100, 2) if n > 0 else None,
                "median_value": None,
                "n_cases": n,
                "n_excluded": 0,
            })
        else:
            present = [getattr(c, fieldname) for c in grp if getattr(c, fieldname) is not None]
            rows.append({
                "code": code,
                "numerator": None,
                "denominator": len(present),
                "value": round(sum(present) / len(present), 1) if present else None,
                "median_value": round(median(present), 1) if present else None,
                "n_cases": n,
                "n_excluded": n - len(present),
            })
    return rows


def aggregate_cases_by_period(
    cases: Iterable,                 # DavinciCase model instances（或同欄位物件）
    mode: str = "monthly",           # monthly / quarterly
) -> list[dict]:
    """對個案依期別聚合七指標。回傳依 period 遞增的 dict 列表，
    每筆 = {period, period_label, indicators: [aggregate_group 輸出]}
    """
    groups: dict[int | str, list] = {}
    for c in cases:
        key: int | str = quarter_key(c.period) if mode == "quarterly" else c.period
        groups.setdefault(key, []).append(c)

    def sort_key(k: int | str):
        # 季 key '2026Q2' → 以該季末月的 yyyymm 量級排序；月 int 原樣。
        # 前提：同一次呼叫內只會有單一 granularity（mode 參數保證）。
        if isinstance(k, str):
            y, q = k.split("Q")
            return int(y) * 100 + int(q) * 3
        return k

    return [
        {
            "period": key,
            "period_label": period_label(key),
            "indicators": aggregate_group(groups[key]),
        }
        for key in sorted(groups.keys(), key=sort_key)
    ]


def build_series(period_groups: list[dict], code: str) -> list[SeriesPoint]:
    """從 aggregate_cases_by_period 輸出中抽單一指標的 SPC 序列。"""
    points: list[SeriesPoint] = []
    for g in period_groups:
        row = next((r for r in g["indicators"] if r["code"] == code), None)
        if row is None:
            continue
        points.append(SeriesPoint(
            period=g["period"],
            label=g["period_label"],
            value=row["value"],
            numerator=row["numerator"],
            denominator=row["denominator"],
        ))
    return points
