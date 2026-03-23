"""
五層名稱比對引擎

Layer 0: 記憶規則優先（歷史確認的配對）
Layer 1: NAME_TO_CODE + 標準化完全匹配
Layer 2: 別名匹配
Layer 3: 包含匹配（前綴/後綴重疊）
Layer 4: 模糊相似度（Levenshtein 40% + Dice 60%）
Layer 5: 無法識別
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from Levenshtein import ratio as levenshtein_ratio

from apps.indicators.constants import INDICATOR_META, NAME_TO_CODE

MatchConfidence = Literal["exact", "alias", "contains", "similar", "unrecognized"]

SIMILARITY_THRESHOLD = 0.6

# Stopwords for normalization
STOPWORDS = ["之", "的", "全", "總", "院", "區", "全院",
             "病人", "病患", "個案", "案件", "比率", "比例", "率",
             "百分比", "千分比", "件數", "人數", "數量"]

# Synonyms
SYNONYMS = [
    (re.compile(r"靜脈血栓溶解劑"), "IV-tPA"),
    (re.compile(r"經皮冠狀動脈介入術"), "PCI"),
    (re.compile(r"PCI治療"), "PCI"),
    (re.compile(r"tPA治療"), "tPA"),
]


@dataclass
class MatchResult:
    excel_name: str
    indicator_code: str | None
    indicator_name: str | None
    confidence: MatchConfidence
    score: float


def normalize(raw: str) -> str:
    """完整標準化：全形→半形、括號移除、贅詞移除、同義字替換"""
    s = raw.strip()
    s = _full_to_half(s)
    s = _apply_synonyms(s)
    s = _remove_brackets(s)
    s = _remove_whitespace(s)
    s = _remove_stopwords(s)
    return s.lower()


def _full_to_half(s: str) -> str:
    result = []
    for ch in s:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            result.append(chr(code - 0xFEE0))
        elif ch == "\u3000":
            result.append(" ")
        else:
            result.append(ch)
    return "".join(result)


def _remove_brackets(s: str) -> str:
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    s = re.sub(r"[【\[][^】\]]*[】\]]", "", s)
    return s


def _remove_whitespace(s: str) -> str:
    return re.sub(r"[\s\-_/\\·.。，,、；;：:！!？?]+", "", s)


def _remove_stopwords(s: str) -> str:
    for word in STOPWORDS:
        if s.endswith(word) and len(s) > len(word):
            s = s[:-len(word)]
    return s


def _apply_synonyms(s: str) -> str:
    for pattern, replacement in SYNONYMS:
        s = pattern.sub(replacement, s)
    return s


def _bigrams(s: str) -> set[str]:
    return {s[i:i+2] for i in range(len(s) - 1)}


def dice_similarity(a: str, b: str) -> float:
    if len(a) < 2 or len(b) < 2:
        return 1.0 if a == b else 0.0
    bg_a = _bigrams(a)
    bg_b = _bigrams(b)
    intersection = len(bg_a & bg_b)
    return (2 * intersection) / (len(bg_a) + len(bg_b))


def combined_similarity(a: str, b: str) -> float:
    lev = levenshtein_ratio(a, b)
    dice = dice_similarity(a, b)
    return lev * 0.4 + dice * 0.6


# Pre-computed candidates
_cached_candidates: list[dict] | None = None


def _get_candidates() -> list[dict]:
    global _cached_candidates
    if _cached_candidates is not None:
        return _cached_candidates

    _cached_candidates = []
    for code, meta in INDICATOR_META.items():
        _cached_candidates.append({
            "code": code,
            "meta": meta,
            "normalized_name": normalize(meta["name"]),
            "normalized_aliases": [normalize(a) for a in meta.get("aliases", [])],
        })
    return _cached_candidates


def match_indicator_name(
    excel_name: str,
    memory_rules: list[dict] | None = None,
) -> MatchResult:
    """對單個 Excel 名稱執行五層比對"""
    normalized_input = normalize(excel_name)
    candidates = _get_candidates()

    # Layer 0: Memory rules
    if memory_rules:
        for rule in memory_rules:
            if rule.get("normalized_name") == normalized_input:
                meta = INDICATOR_META.get(rule["indicator_code"], {})
                return MatchResult(
                    excel_name=excel_name,
                    indicator_code=rule["indicator_code"],
                    indicator_name=meta.get("name", rule["indicator_code"]),
                    confidence="exact",
                    score=1.0,
                )

    # Layer 1: Direct match
    direct_code = NAME_TO_CODE.get(excel_name)
    if direct_code and direct_code in INDICATOR_META:
        return MatchResult(
            excel_name=excel_name,
            indicator_code=direct_code,
            indicator_name=INDICATOR_META[direct_code]["name"],
            confidence="exact",
            score=1.0,
        )

    for c in candidates:
        if normalized_input == c["normalized_name"]:
            return MatchResult(
                excel_name=excel_name,
                indicator_code=c["code"],
                indicator_name=c["meta"]["name"],
                confidence="exact",
                score=1.0,
            )

    # Layer 2: Alias match
    for c in candidates:
        for alias in c["normalized_aliases"]:
            if normalized_input == alias:
                return MatchResult(
                    excel_name=excel_name,
                    indicator_code=c["code"],
                    indicator_name=c["meta"]["name"],
                    confidence="alias",
                    score=0.95,
                )

    # Layer 3: Contains match
    contains_matches = []
    for c in candidates:
        if normalized_input in c["normalized_name"] or c["normalized_name"] in normalized_input:
            ratio = min(len(normalized_input), len(c["normalized_name"])) / \
                    max(len(normalized_input), len(c["normalized_name"]))
            if ratio > 0.5:
                contains_matches.append((c["code"], c["meta"]["name"], ratio * 0.85))

    if contains_matches:
        contains_matches.sort(key=lambda x: x[2], reverse=True)
        best = contains_matches[0]
        return MatchResult(
            excel_name=excel_name,
            indicator_code=best[0],
            indicator_name=best[1],
            confidence="contains",
            score=best[2],
        )

    # Layer 4: Fuzzy similarity
    best_sim = 0.0
    best_candidate = None
    for c in candidates:
        sim = combined_similarity(normalized_input, c["normalized_name"])
        if sim > best_sim:
            best_sim = sim
            best_candidate = c
        for alias in c["normalized_aliases"]:
            alias_sim = combined_similarity(normalized_input, alias)
            if alias_sim > best_sim:
                best_sim = alias_sim
                best_candidate = c

    if best_candidate and best_sim >= SIMILARITY_THRESHOLD:
        return MatchResult(
            excel_name=excel_name,
            indicator_code=best_candidate["code"],
            indicator_name=best_candidate["meta"]["name"],
            confidence="similar",
            score=best_sim,
        )

    # Layer 5: Unrecognized
    return MatchResult(
        excel_name=excel_name,
        indicator_code=None,
        indicator_name=None,
        confidence="unrecognized",
        score=best_sim,
    )


def clear_matching_cache() -> None:
    global _cached_candidates
    _cached_candidates = None
