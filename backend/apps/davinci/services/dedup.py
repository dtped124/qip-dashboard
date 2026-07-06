"""
達文西匯入 — 帳號去重與人次聚合（開發計畫 4.2：算錯全盤皆錯）

同一台手術可能拆成多列醫令（實證：11504 帳號 26T71870257 有 2 列）。
去重鍵：(campus, period, account)。一帳號 = 一台手術 = 一人次。

聚合規則：
- 事件布林（不良/併發/感染/轉換/再手術）：任一列 True → True（OR）
- 事件代碼清單：聯集（保序）
- 連續值（手術時間/出血量）：取 max（同帳號各列理應相同；不同時加 flag）
- 醫令：全部收進 order_codes
- 其餘欄位：取首列
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class ParsedRow:
    """importer 逐列清洗後的中間結構（一列 = 一筆醫令）。"""
    row_no: int                    # 來源列號（1-based，供報告定位）
    sheet: str
    campus: str
    period: int
    account: str
    chart_no_masked: str = ""
    patient_masked: str = ""
    davinci_type: str = ""
    dept_code: str = ""
    dept_name: str = ""
    surgeon: str = ""
    order_code: str = ""
    order_name: str = ""
    admission_date: date | None = None
    discharge_date: date | None = None
    op_date: date | None = None
    op_date_raw: str = ""
    op_time_min: float | None = None
    blood_ml: float | None = None
    conversion: bool = False
    conversion_reason: str = ""
    adverse_14d: bool = False
    adverse_codes: list[str] = field(default_factory=list)
    adverse_free_text: str = ""
    severe_comp_30d: bool = False
    severe_comp_codes: list[str] = field(default_factory=list)
    infection_14d: bool = False
    reoperation_14d: bool = False
    flags: list[str] = field(default_factory=list)


@dataclass
class DedupCase:
    """去重後人次（對應 DavinciCase 一筆）。"""
    campus: str
    period: int
    account: str
    chart_no_masked: str
    patient_masked: str
    davinci_type: str
    dept_code: str
    dept_name: str
    surgeon: str
    order_codes: list[dict]        # [{"code": ..., "name": ...}]
    admission_date: date | None
    discharge_date: date | None
    op_date: date | None
    op_date_raw: str
    op_time_min: float | None
    blood_ml: float | None
    conversion: bool
    conversion_reason: str
    adverse_14d: bool
    adverse_codes: list[str]
    adverse_free_text: str
    severe_comp_30d: bool
    severe_comp_codes: list[str]
    infection_14d: bool
    reoperation_14d: bool
    flags: list[str]
    source_rows: list[int]         # 來源列號（供報告）


def _merge_max(values: list[float | None], flags: list[str], flag_name: str) -> float | None:
    """連續值合併：取 max；非 null 值彼此不同時加 flag。"""
    present = [v for v in values if v is not None]
    if not present:
        return None
    if len(set(present)) > 1:
        flags.append(flag_name)
    return max(present)


def _union(lists: list[list[str]]) -> list[str]:
    out: list[str] = []
    for lst in lists:
        for item in lst:
            if item not in out:
                out.append(item)
    return out


def _first_nonempty(values: list, default=""):
    for v in values:
        if v not in (None, ""):
            return v
    return default


def dedup_rows(rows: list[ParsedRow]) -> list[DedupCase]:
    """依 (campus, period, account) 分組聚合為人次。保持首次出現順序。"""
    groups: dict[tuple[str, int, str], list[ParsedRow]] = {}
    order: list[tuple[str, int, str]] = []
    for row in rows:
        key = (row.campus, row.period, row.account)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    cases: list[DedupCase] = []
    for key in order:
        grp = groups[key]
        flags = _union([r.flags for r in grp])
        if len(grp) > 1:
            flags.append(f"merged_rows:{len(grp)}")
        op_time = _merge_max([r.op_time_min for r in grp], flags, "merged_value_mismatch")
        blood = _merge_max([r.blood_ml for r in grp], flags, "merged_value_mismatch")
        cases.append(DedupCase(
            campus=key[0],
            period=key[1],
            account=key[2],
            chart_no_masked=_first_nonempty([r.chart_no_masked for r in grp]),
            patient_masked=_first_nonempty([r.patient_masked for r in grp]),
            davinci_type=_first_nonempty([r.davinci_type for r in grp]),
            dept_code=_first_nonempty([r.dept_code for r in grp]),
            dept_name=_first_nonempty([r.dept_name for r in grp]),
            surgeon=_first_nonempty([r.surgeon for r in grp]),
            order_codes=[
                {"code": r.order_code, "name": r.order_name}
                for r in grp if r.order_code or r.order_name
            ],
            admission_date=_first_nonempty([r.admission_date for r in grp], None),
            discharge_date=_first_nonempty([r.discharge_date for r in grp], None),
            op_date=_first_nonempty([r.op_date for r in grp], None),
            op_date_raw=_first_nonempty([r.op_date_raw for r in grp]),
            op_time_min=op_time,
            blood_ml=blood,
            conversion=any(r.conversion for r in grp),
            conversion_reason=_first_nonempty([r.conversion_reason for r in grp]),
            adverse_14d=any(r.adverse_14d for r in grp),
            adverse_codes=_union([r.adverse_codes for r in grp]),
            adverse_free_text=_first_nonempty([r.adverse_free_text for r in grp]),
            severe_comp_30d=any(r.severe_comp_30d for r in grp),
            severe_comp_codes=_union([r.severe_comp_codes for r in grp]),
            infection_14d=any(r.infection_14d for r in grp),
            reoperation_14d=any(r.reoperation_14d for r in grp),
            flags=flags,
            source_rows=[r.row_no for r in grp],
        ))
    return cases
