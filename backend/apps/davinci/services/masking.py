"""
達文西匯入 — 個資遮罩（定案 #7：匯入時系統自動遮罩，入庫只存遮罩版）

生醫源檔已遮罩（病歷號 '*583502'、姓名 '徐○宏'）→ 原樣保留。
新竹源檔未遮罩（'HK28579'、'李清亮'）→ 比照生醫格式遮罩。
"""
from __future__ import annotations

import re


def mask_chart_no(raw: str) -> tuple[str, bool]:
    """病歷號遮罩：保留末 6 碼、前面一律以單一 '*' 取代。

    已含 '*' 視為已遮罩，原樣保留。
    回傳 (masked, was_masked_by_system)。
    """
    s = (raw or "").strip()
    if s == "" or "*" in s:
        return s, False
    if len(s) <= 6:
        # 過短無法保留 6 碼 → 首碼遮罩
        return "*" + s[1:], True
    return "*" + s[-6:], True


_MASK_CHARS = ("○", "O", "〇", "*")


def mask_patient_name(raw: str) -> tuple[str, bool]:
    """姓名遮罩：比照生醫格式。

    - 2 字：遮第 2 字（'徐宏' → '徐○'）
    - 3 字以上：保留首尾、中間全遮（'李清亮' → '李○亮'、'彭林金蓮' → '彭○○蓮'）
    - 已含遮罩字元（○ 等）原樣保留
    回傳 (masked, was_masked_by_system)。
    """
    s = (raw or "").strip()
    if s == "" or any(c in s for c in _MASK_CHARS):
        return s, False
    if not re.search(r"[一-鿿]", s):
        # 非中文姓名（外籍等）：保留首字其餘遮罩
        return s[0] + "○" * (len(s) - 1), True
    if len(s) == 1:
        return s, False
    if len(s) == 2:
        return s[0] + "○", True
    return s[0] + "○" * (len(s) - 2) + s[-1], True
