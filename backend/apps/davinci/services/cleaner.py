"""
達文西匯入 — 欄位清洗純函式

原則（開發計畫 4.3）：寧可標記待補，不可臆造；所有清洗/近似/矛盾都回傳 flag，
由 importer 彙整進匯入報告供人工覆核。

flag 字典：
    blood_minimum_as_zero     出血量 Minimum → 0（定案 #1）
    blood_upper_bound         <50ml → 取上限 50，近似值
    unit_stripped             去除 ml / mins 等單位
    value_unparsed            數值無法解析 → None
    yn_blank_as_n             Y/N 欄空白視為 N
    yn_conflict_content_wins  旗標 N 但內容欄有合法值 → 視為 Y（定案 #6）
    unknown_event_code        事件代碼超出代碼表範圍
    date_parse_failed         日期無法解析，保留原字串
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from ..constants import ADVERSE_EVENT_CODES, SEVERE_COMP_CODES


def _norm(raw: Any) -> str:
    """統一轉字串、去頭尾空白（含全形空白）。None → 空字串。"""
    if raw is None:
        return ""
    return str(raw).replace("　", " ").strip()


# ── 數值清洗（出血量 / 手術時間） ──

def clean_blood_ml(raw: Any) -> tuple[float | None, list[str]]:
    """出血量：數值直用；'250ml' 去單位；'<50ml' → 50 近似；'Minimum' → 0。"""
    s = _norm(raw)
    if s == "":
        return None, []
    if isinstance(raw, (int, float)):
        return float(raw), []
    if s.lower() in ("minimum", "min."):
        return 0.0, ["blood_minimum_as_zero"]
    flags: list[str] = []
    upper_bound = False
    if s.startswith("<"):
        upper_bound = True
        s = s[1:].strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(ml|cc)?$", s, re.IGNORECASE)
    if not m:
        return None, ["value_unparsed"]
    if m.group(2):
        flags.append("unit_stripped")
    if upper_bound:
        flags.append("blood_upper_bound")
    return float(m.group(1)), flags


def clean_op_time(raw: Any) -> tuple[float | None, list[str]]:
    """手術時間（分）：數值直用；'500mins' / '368min' 去單位。"""
    s = _norm(raw)
    if s == "":
        return None, []
    if isinstance(raw, (int, float)):
        return float(raw), []
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(mins?|分鐘|分)?$", s, re.IGNORECASE)
    if not m:
        return None, ["value_unparsed"]
    flags = ["unit_stripped"] if m.group(2) else []
    return float(m.group(1)), flags


# ── 事件代碼解析 ──

def parse_event_codes(raw: Any, code_table: dict[str, str]) -> tuple[list[str], str, list[str]]:
    """從內容欄抽事件代碼。

    回傳 (codes, free_text, flags)。
    - 以 | ; 、換行、空白切分，每段抽前導數字為代碼
    - 非代碼段（如 'Minorleakage;postoperativeileus'）併入 free_text
    - 'N' / '-' / 空白等非代碼值 → 全空（不視為有事件）
    """
    s = _norm(raw)
    if s == "" or s.upper() in ("N", "NA", "-", "—", "無"):
        return [], "", []
    codes: list[str] = []
    texts: list[str] = []
    flags: list[str] = []
    for part in re.split(r"[|;、\n\s]+", s):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d{1,2})(?:\.|$)(.*)$", part)
        if m:
            code = m.group(1)
            if code in code_table:
                if code not in codes:
                    codes.append(code)
            else:
                flags.append("unknown_event_code")
                texts.append(part)
            rest = m.group(2).strip()
            if rest:
                texts.append(rest)
        else:
            texts.append(part)
    return codes, " ".join(texts), flags


def parse_adverse(raw: Any) -> tuple[list[str], str, list[str]]:
    return parse_event_codes(raw, ADVERSE_EVENT_CODES)


def parse_severe(raw: Any) -> tuple[list[str], str, list[str]]:
    return parse_event_codes(raw, SEVERE_COMP_CODES)


# ── Y/N 旗標 ──

def clean_yn(
    flag_raw: Any,
    content_has_value: bool = False,
) -> tuple[bool, list[str]]:
    """Y/N 欄：Y→True、N/空白→False（空白加 flag）。

    內容欄有合法值 → 強制 True（定案 #6：寧誤報不漏報），
    若原旗標非 Y 則加矛盾 flag。
    """
    s = _norm(flag_raw).upper()
    flags: list[str] = []
    if s == "":
        flags.append("yn_blank_as_n")
        value = False
    elif s == "Y":
        value = True
    else:
        value = False
    if content_has_value and not value:
        value = True
        flags.append("yn_conflict_content_wins")
    return value, flags


# ── 日期容錯解析 ──

_DATE_PATTERNS = [
    r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})",   # 2026-04-21 / 2026/5/15（含黏合時間）
    r"^(\d{4})(\d{2})(\d{2})$",              # 20260615
]


def clean_date(raw: Any) -> tuple[date | None, str, list[str]]:
    """日期：datetime 直用；字串容錯（含黏合格式 '2026/5/1508:49:00AM' 抽日期部）。

    回傳 (date, raw_str, flags)。解析失敗 → (None, 原字串, [date_parse_failed])。

    黏合格式注意：'2026/5/1508:49:00AM' 的日應為 15，但 regex 貪婪抓 1508 的前兩碼
    會誤判 → 以「日的合法範圍 1-31 且其後接時間」回溯修正。
    """
    if isinstance(raw, datetime):
        return raw.date(), "", []
    if isinstance(raw, date):
        return raw, "", []
    s = _norm(raw)
    if s == "":
        return None, "", []
    for pat in _DATE_PATTERNS:
        m = re.match(pat, s)
        if not m:
            continue
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # 黏合格式：日抓到 4 碼（如 1508）→ 回退為前 1-2 碼
        if d > 31:
            d_str = m.group(3)
            for cut in (2, 1):
                cand = int(d_str[:cut])
                if 1 <= cand <= 31:
                    d = cand
                    break
        try:
            return date(y, mo, d), "", []
        except ValueError:
            break
    return None, s, ["date_parse_failed"]


# ── 期別（費用年月，權威） ──

def clean_period(raw: Any) -> int | None:
    """費用年月 → 西元 yyyymm 整數。非 6 碼合法年月 → None。"""
    s = _norm(raw)
    if isinstance(raw, (int, float)):
        s = str(int(raw))
    if not re.match(r"^\d{6}$", s):
        return None
    year, month = int(s[:4]), int(s[4:])
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        return None
    return int(s)


def period_to_roc_label(period: int) -> str:
    """202605 → '115年5月'。"""
    year, month = period // 100, period % 100
    return f"{year - 1911}年{month}月"
