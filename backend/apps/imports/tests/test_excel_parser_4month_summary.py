"""Tests for parsing the 「4月總表-給主任」style files (竹北/竹東)

These workbooks introduced two new layouts:
1. 竹北 4月總表: sheet 「115年QIP指標(竹北)」 has no 代碼 column —
   indicator name lives in col C, months start at col D.
2. 竹東 4月總表: sheet 「115年竹東」 has 代碼 in col C, name in col D, months at E.

Both files express the numerator/denominator in *separate rows* (row+1 and row+2)
rather than as inline "n/d" fraction strings.
"""
from __future__ import annotations

import os

import pytest

from apps.imports.services.excel_parser import _detect_columns, parse_qip_excel


FILE_ZHUBEI = (
    r"C:\Users\akcho\Downloads"
    r"\115年醫院評鑑持續性監測指標-臨床指標_4月總表_給主任-竹北.xlsx"
)
FILE_ZHUDONG = (
    r"C:\Users\akcho\Downloads"
    r"\東115年醫院評鑑持續性監測指標-臨床指標_4月總表_給主任-竹東.xlsx"
)
FILE_ZHUDONG_JUN = (
    r"C:\Users\akcho\Downloads"
    r"\東115年醫院評鑑持續性監測指標-臨床指標_6月總表_給主任-竹東.xlsx"
)


class TestDetectColumns:
    def test_with_code_column(self):
        # 竹東 / 111+ 竹北 layout
        header = ["類別", "項次", "代碼", "指標名稱/指標定義\n(分子/分母)",
                  "1月", "2月", "3月"]
        assert _detect_columns(header, 115) == (2, 3, 4)

    def test_without_code_column(self):
        # 115 竹北 layout (no 代碼)
        header = ["類別", "項次", "指標名稱/指標定義\n(分子/分母)",
                  "1月", "2月", "3月"]
        assert _detect_columns(header, 115) == (-1, 2, 3)

    def test_year_prefixed_month_header(self):
        # 竹東 has "115.1月" in col E
        header = ["", "項次", "代碼", "指標名稱/指標定義\n(分子/分母)",
                  "115.1月", "2月"]
        assert _detect_columns(header, 115) == (2, 3, 4)

    def test_fallback_when_header_empty(self):
        # Falls back to year-based defaults
        assert _detect_columns(["", "", "", ""], 110) == (-1, 2, 3)
        assert _detect_columns(["", "", "", ""], 115) == (2, 3, 4)


@pytest.mark.skipif(
    not os.path.exists(FILE_ZHUBEI),
    reason="Source spreadsheet not present in this environment",
)
class TestZhubei4MonthSummary:
    """竹北 4月總表 — sheet 115年QIP指標(竹北), no 代碼 column."""

    @pytest.fixture(scope="class")
    def result(self):
        with open(FILE_ZHUBEI, "rb") as f:
            data = f.read()
        return parse_qip_excel(data, os.path.basename(FILE_ZHUBEI))

    def test_sheet_115_is_processed(self, result):
        assert "115年QIP指標(竹北)" in result.sheets_processed

    def test_dp_count_per_year(self, result):
        # 33 indicators × 12 months = 396 per year for years 110–115
        # (33 listed but some collapse — actual is 33; check year 115 specifically)
        by_year = {}
        for d in result.data_points:
            by_year[d.year] = by_year.get(d.year, 0) + 1
        assert by_year.get(115, 0) >= 300  # all 25+ rate-style indicators × 12

    def test_ha01_01_april_values(self, result):
        # 住院死亡率 4月: n=29, d=1133, value ≈ 2.5596%
        dp = next(
            d for d in result.data_points
            if d.indicator_code == "HA01-01" and d.campus == "竹北"
            and d.year == 115 and d.month == 4
        )
        assert dp.numerator == 29
        assert dp.denominator == 1133
        assert dp.value == pytest.approx(2.5596, abs=0.01)

    def test_ha02_01_april_values(self, result):
        # 48小時內加護病房重返率 4月: n=1, d=64
        dp = next(
            d for d in result.data_points
            if d.indicator_code == "HA02-01" and d.campus == "竹北"
            and d.year == 115 and d.month == 4
        )
        assert dp.numerator == 1
        assert dp.denominator == 64
        assert dp.value == pytest.approx(1.5625, abs=0.01)


@pytest.mark.skipif(
    not os.path.exists(FILE_ZHUDONG),
    reason="Source spreadsheet not present in this environment",
)
class TestZhudong4MonthSummary:
    """竹東 4月總表 — sheet 115年竹東, 代碼 in col C, name in col D."""

    @pytest.fixture(scope="class")
    def result(self):
        with open(FILE_ZHUDONG, "rb") as f:
            data = f.read()
        return parse_qip_excel(data, os.path.basename(FILE_ZHUDONG))

    def test_sheet_115_is_processed(self, result):
        assert "115年竹東" in result.sheets_processed

    def test_ha01_01_april_values(self, result):
        dp = next(
            d for d in result.data_points
            if d.indicator_code == "HA01-01" and d.campus == "竹東"
            and d.year == 115 and d.month == 4
        )
        assert dp.numerator == 11
        assert dp.denominator == 156
        assert dp.value == pytest.approx(7.0513, abs=0.01)

    def test_ha01_02_april_values(self, result):
        dp = next(
            d for d in result.data_points
            if d.indicator_code == "HA01-02" and d.campus == "竹東"
            and d.year == 115 and d.month == 4
        )
        assert dp.numerator == 1
        assert dp.denominator == 145
        assert dp.value == pytest.approx(0.6897, abs=0.01)

    def test_subcategory_extraction_ha08_and_ha10(self, result):
        """HA08-01 (4 子分類) 與 HA10-01 (13 子分類) 必須拆成獨立的
        subcategory_data_points，每個 (sub_code, year, month) 一筆。
        以 115/4 的 7 個指標個別比對 → 共 7 個值驗證對應正確。"""
        idx = {
            (s.subcategory_code, s.campus, s.year, s.month): s.value
            for s in result.subcategory_data_points
        }
        # 從 4 月總表竹東檔（R55~R85）抓的事實值
        expects = [
            ('HA08-01-01', 115, 4, 0),  # 藥品不良反應 4月
            ('HA08-01-02', 115, 4, 0),  # 醫療器材不良反應 4月
            ('HA08-01-03', 115, 4, 0),  # 藥品不良品 4月
            ('HA08-01-04', 115, 4, 2),  # 醫療器材不良品 4月
            ('HA10-01-01', 115, 4, 0),  # 藥物事件 4月
            ('HA10-01-02', 115, 4, 4),  # 跌倒 4月
            ('HA10-01-10', 115, 4, 1),  # 院內 CPR 4月
            ('HA10-01-13', 115, 4, 2),  # 其他事件 4月
        ]
        for code, y, m, expected in expects:
            key = (code, '竹東', y, m)
            actual = idx.get(key)
            assert actual == expected, f"{code} 115/{m}: actual={actual} expected={expected}"

    def test_ha05_01_marker_based_extraction(self, result):
        """HA05-01 竹東 uses 分子:/分母: markers on non-adjacent rows
        (intermediate sub-detail rows for 含/不含轉竹北住院). The parser
        must pick the *marked* rows, not the simple row+1/row+2."""
        # n is on row+1 (分子:), d is on row+4 (分母:), with 2 detail rows between
        cases = [
            (1, 156, 1051, 14.84),
            (2, 120, 1187, 10.11),
            (3, 162, 1153, 14.05),
            (4, 148, 1117, 13.25),
        ]
        for m, exp_n, exp_d, exp_v in cases:
            dp = next(
                d for d in result.data_points
                if d.indicator_code == "HA05-01" and d.campus == "竹東"
                and d.year == 115 and d.month == m
            )
            assert dp.numerator == exp_n, f"month {m}: n={dp.numerator}, expected {exp_n}"
            assert dp.denominator == exp_d, f"month {m}: d={dp.denominator}, expected {exp_d}"
            assert dp.value == pytest.approx(exp_v, abs=0.01)

    def test_nd_populated_for_115(self, result):
        # At least 80 data points for year 115 竹東 should have n/d filled
        # (4 months × ~22 rate-style indicators = ~88)
        count = sum(
            1 for d in result.data_points
            if d.year == 115 and d.campus == "竹東" and d.numerator is not None
        )
        assert count >= 80


@pytest.mark.skipif(
    not os.path.exists(FILE_ZHUDONG_JUN),
    reason="Source spreadsheet not present in this environment",
)
class TestZhudong6MonthSummary:
    """竹東 6月總表 — 115年竹東 分頁把 HA01-03 拆成 含/不含PAC：

    含PAC 主列被刪掉了項次號（Col B 空白）、且指標名與分子列名多了「(含PAC)」
    後綴。修正前這會讓 HA01-03 115 竹東 整筆匯不進來（項次空白 → 不被視為指標
    列；名稱嚴格比對也不符）。修正後：
      1. 代碼欄有值即視為指標列（放寬項次判斷）；
      2. schema 白名單納入「(含PAC)」變體名稱；
      3. 不含PAC 變體（排除PAC）仍被分子/分母嚴格比對擋下，不產生重複。
    """

    @pytest.fixture(scope="class")
    def result(self):
        with open(FILE_ZHUDONG_JUN, "rb") as f:
            data = f.read()
        return parse_qip_excel(data, os.path.basename(FILE_ZHUDONG_JUN))

    def test_ha01_03_all_six_months_present(self, result):
        # 含PAC 主列雖無項次，仍須解析出 1–6 月完整數值
        expects = {
            1: (5, 157, 3.1847),
            2: (7, 127, 5.5118),
            3: (7, 148, 4.7297),
            4: (7, 134, 5.2239),
            5: (2, 123, 1.6260),  # 修正前遺失
            6: (7, 142, 4.9296),  # 修正前遺失
        }
        for m, (exp_n, exp_d, exp_v) in expects.items():
            dp = next(
                (d for d in result.data_points
                 if d.indicator_code == "HA01-03" and d.campus == "竹東"
                 and d.year == 115 and d.month == m),
                None,
            )
            assert dp is not None, f"HA01-03 竹東 115/{m} 應存在"
            assert dp.numerator == exp_n, f"month {m}: n={dp.numerator}, expected {exp_n}"
            assert dp.denominator == exp_d, f"month {m}: d={dp.denominator}, expected {exp_d}"
            assert dp.value == pytest.approx(exp_v, abs=0.01)

    def test_ha01_03_no_duplicate_from_pac_variant(self, result):
        # 不含PAC 變體不得產生重複的 (year, month) 資料點
        keys = [
            (d.year, d.month) for d in result.data_points
            if d.indicator_code == "HA01-03" and d.campus == "竹東" and d.year == 115
        ]
        assert len(keys) == len(set(keys)), f"HA01-03 竹東 115 有重複月份: {keys}"

    # ── HA01-03-01（不含PAC，竹東專屬）──────────────────────────

    def _dp(self, result, code, year, month):
        return next(
            (d for d in result.data_points
             if d.indicator_code == code and d.campus == "竹東"
             and d.year == year and d.month == month),
            None,
        )

    def test_ha01_03_01_115_own_values(self, result):
        # 115 分頁第 98-100 列（代碼 HA01-03-01、項次空白）
        expects = {
            1: (3, 157, 1.9108), 2: (3, 127, 2.3622), 3: (2, 148, 1.3514),
            4: (3, 134, 2.2388), 5: (0, 123, 0.0), 6: (3, 142, 2.1127),
        }
        for m, (exp_n, exp_d, exp_v) in expects.items():
            dp = self._dp(result, "HA01-03-01", 115, m)
            assert dp is not None, f"HA01-03-01 竹東 115/{m} 應存在"
            assert dp.numerator == exp_n, f"115/{m}: n={dp.numerator}, expected {exp_n}"
            assert dp.denominator == exp_d, f"115/{m}: d={dp.denominator}, expected {exp_d}"
            assert dp.value == pytest.approx(exp_v, abs=0.01)

    def test_ha01_03_01_114_own_values(self, result):
        # 114 分頁第 101-103 列（代碼 HA01-03-01 的新區塊；
        # 第 95-97 列代碼仍為 HA01-03 的舊區塊須被略過）
        expects = {
            1: (2, 133, 1.5038), 2: (2, 164, 1.2195), 3: (2, 167, 1.1976),
            4: (1, 165, 0.6061), 5: (1, 157, 0.6369), 6: (0, 138, 0.0),
            7: (4, 142, 2.8169), 8: (0, 161, 0.0), 9: (3, 133, 2.2556),
            10: (3, 155, 1.9355), 11: (0, 145, 0.0), 12: (2, 168, 1.1905),
        }
        for m, (exp_n, exp_d, exp_v) in expects.items():
            dp = self._dp(result, "HA01-03-01", 114, m)
            assert dp is not None, f"HA01-03-01 竹東 114/{m} 應存在"
            assert dp.numerator == exp_n, f"114/{m}: n={dp.numerator}, expected {exp_n}"
            assert dp.denominator == exp_d, f"114/{m}: d={dp.denominator}, expected {exp_d}"
            assert dp.value == pytest.approx(exp_v, abs=0.01)

    def test_ha01_03_01_stitched_years_equal_source(self, result):
        # ≤113 年：HA01-03-01 的點集合必須與 HA01-03 竹東完全相等（逐值複製）
        src = {(d.year, d.month): (d.value, d.numerator, d.denominator)
               for d in result.data_points
               if d.indicator_code == "HA01-03" and d.campus == "竹東" and d.year <= 113}
        tgt = {(d.year, d.month): (d.value, d.numerator, d.denominator)
               for d in result.data_points
               if d.indicator_code == "HA01-03-01" and d.campus == "竹東" and d.year <= 113}
        assert src == tgt
        # 錨點抽查（季合併版型 → 只有 1/4/7/10 月有值）
        anchors = {
            (113, 1): (8, 408, 1.9608),
            (112, 4): (2, 455, 0.4396),   # n/d 勝過儲存格 43.956 的已知 typo
            (111, 1): (8, 414, 1.9324),   # 靠「111竹東」分頁名修正才存在
            (110, 7): (11, 216, 5.0926),
        }
        for (y, m), (exp_n, exp_d, exp_v) in anchors.items():
            dp = self._dp(result, "HA01-03-01", y, m)
            assert dp is not None, f"HA01-03-01 竹東 {y}/{m} 應存在（拼接）"
            assert dp.numerator == exp_n
            assert dp.denominator == exp_d
            assert dp.value == pytest.approx(exp_v, abs=0.01)

    def test_ha01_03_01_no_duplicates(self, result):
        keys = [(d.year, d.month) for d in result.data_points
                if d.indicator_code == "HA01-03-01" and d.campus == "竹東"]
        assert len(keys) == len(set(keys)), f"HA01-03-01 竹東 有重複月份: {sorted(keys)}"

    def test_ha01_03_01_yearly_summaries_stitched(self, result):
        ys = {s.year: s for s in result.yearly_summaries
              if s.indicator_code == "HA01-03-01" and s.campus == "竹東"}
        for y in (110, 111, 112, 113, 114, 115):
            assert y in ys, f"HA01-03-01 竹東 {y} 年度摘要應存在"
            assert ys[y].average is not None, f"{y} 年均應有值"
        # 拼接年度標竿一律 None（不含PAC 無官方標竿）
        for y in (110, 111, 112, 113):
            assert ys[y].benchmark_regional is None
            assert ys[y].benchmark_district is None

    def test_ha01_03_still_intact_after_stitch(self, result):
        # 拼接不得動到來源數列：HA01-03 竹東各年皆維持 12 筆 parser 輸出
        from collections import Counter
        per_year = Counter(d.year for d in result.data_points
                           if d.indicator_code == "HA01-03" and d.campus == "竹東")
        for y, cnt in per_year.items():
            assert cnt == 12, f"HA01-03 竹東 {y} 年應有 12 筆，實得 {cnt}"
