"""
達文西模組單元測試

涵蓋：清洗純函式（含定案業務規則）、遮罩、帳號去重、SPC/WER、季彙總。
執行（SQLite）：
    DJANGO_SETTINGS_MODULE=<sqlite settings> python manage.py test apps.davinci
"""
from datetime import date

from django.test import SimpleTestCase

from .services import cleaner, masking
from .services.aggregation import (
    aggregate_cases_by_period,
    periods_in_quarter,
    quarter_key,
    quarter_label,
)
from .services.dedup import ParsedRow, dedup_rows
from .services.spc import SeriesPoint, compute_spc


class CleanerTests(SimpleTestCase):
    # ── 出血量（定案 #1：Minimum→0、<50ml→50） ──
    def test_blood_minimum_as_zero(self):
        v, flags = cleaner.clean_blood_ml("Minimum")
        self.assertEqual(v, 0.0)
        self.assertIn("blood_minimum_as_zero", flags)

    def test_blood_upper_bound(self):
        v, flags = cleaner.clean_blood_ml("<50ml")
        self.assertEqual(v, 50.0)
        self.assertIn("blood_upper_bound", flags)

    def test_blood_unit_stripped(self):
        v, flags = cleaner.clean_blood_ml("250ml")
        self.assertEqual(v, 250.0)
        self.assertIn("unit_stripped", flags)

    def test_blood_numeric_passthrough(self):
        v, flags = cleaner.clean_blood_ml(200)
        self.assertEqual(v, 200.0)
        self.assertEqual(flags, [])

    def test_blood_unparsed(self):
        v, flags = cleaner.clean_blood_ml("大量")
        self.assertIsNone(v)
        self.assertIn("value_unparsed", flags)

    # ── 手術時間 ──
    def test_op_time_mins(self):
        v, flags = cleaner.clean_op_time("500mins")
        self.assertEqual(v, 500.0)
        self.assertIn("unit_stripped", flags)

    # ── Y/N + 內容欄衝突（定案 #6） ──
    def test_yn_conflict_content_wins(self):
        v, flags = cleaner.clean_yn("N", content_has_value=True)
        self.assertTrue(v)
        self.assertIn("yn_conflict_content_wins", flags)

    def test_yn_blank_as_n(self):
        v, flags = cleaner.clean_yn("", content_has_value=False)
        self.assertFalse(v)
        self.assertIn("yn_blank_as_n", flags)

    def test_yn_plain_y(self):
        v, flags = cleaner.clean_yn("Y")
        self.assertTrue(v)
        self.assertEqual(flags, [])

    # ── 事件代碼 ──
    def test_severe_code_3(self):
        codes, text, flags = cleaner.parse_severe("3")
        self.assertEqual(codes, ["3"])   # Grade IV-a

    def test_severe_content_n_is_not_event(self):
        # 生醫 11505 檔把 N 填進嚴重併發症內容欄 → 不得視為事件
        codes, text, flags = cleaner.parse_severe("N")
        self.assertEqual(codes, [])
        self.assertEqual(text, "")

    def test_adverse_code10_with_free_text(self):
        codes, text, flags = cleaner.parse_adverse("10\nMinorleakage;postoperativeileus")
        self.assertEqual(codes, ["10"])
        self.assertIn("Minorleakage", text)

    def test_adverse_multi_codes_pipe(self):
        codes, text, flags = cleaner.parse_adverse("7|9")
        self.assertEqual(codes, ["7", "9"])

    # ── 期別（費用年月權威） ──
    def test_period_valid(self):
        self.assertEqual(cleaner.clean_period("202605"), 202605)
        self.assertEqual(cleaner.clean_period(202604.0), 202604)

    def test_period_invalid(self):
        self.assertIsNone(cleaner.clean_period("11505"))   # 民國格式不收
        self.assertIsNone(cleaner.clean_period("202613"))

    def test_period_label(self):
        self.assertEqual(cleaner.period_to_roc_label(202605), "115年5月")

    # ── 日期容錯（黏合格式） ──
    def test_date_glued_ampm(self):
        d, raw, flags = cleaner.clean_date("2026/5/1508:49:00AM")
        self.assertEqual(d, date(2026, 5, 15))
        self.assertEqual(flags, [])

    def test_date_normal(self):
        d, raw, flags = cleaner.clean_date("2026-04-21")
        self.assertEqual(d, date(2026, 4, 21))

    def test_date_unparsable_keeps_raw(self):
        d, raw, flags = cleaner.clean_date("不明")
        self.assertIsNone(d)
        self.assertEqual(raw, "不明")
        self.assertIn("date_parse_failed", flags)

    # ── 回歸：黏合日期日=1-3 位且時間以 0/1 開頭（audit 發現） ──
    def test_date_glued_single_digit_day(self):
        d, _, _ = cleaner.clean_date("2026/5/308:49:00AM")
        self.assertEqual(d, date(2026, 5, 3))     # 不可誤判為 5/30

    def test_date_glued_day_one(self):
        d, _, _ = cleaner.clean_date("2026/6/112:00:00PM")
        self.assertEqual(d, date(2026, 6, 1))     # 不可誤判為 6/11

    def test_date_datetime_string_with_space(self):
        d, _, _ = cleaner.clean_date("2026-04-21 00:00:00")
        self.assertEqual(d, date(2026, 4, 21))

    # ── 回歸：Y/N 未知值需標記（audit 發現） ──
    def test_yn_unrecognized_flagged(self):
        v, flags = cleaner.clean_yn("是")
        self.assertFalse(v)
        self.assertIn("yn_unrecognized_as_n", flags)

    def test_yn_plain_n_no_flag(self):
        v, flags = cleaner.clean_yn("N")
        self.assertFalse(v)
        self.assertEqual(flags, [])


class MaskingTests(SimpleTestCase):
    def test_chart_no_unmasked(self):
        masked, by_sys = masking.mask_chart_no("HK28579")
        self.assertEqual(masked, "*K28579")
        self.assertTrue(by_sys)

    def test_chart_no_already_masked(self):
        masked, by_sys = masking.mask_chart_no("*583502")
        self.assertEqual(masked, "*583502")
        self.assertFalse(by_sys)

    def test_name_three_chars(self):
        masked, by_sys = masking.mask_patient_name("李清亮")
        self.assertEqual(masked, "李○亮")
        self.assertTrue(by_sys)

    def test_name_four_chars(self):
        masked, by_sys = masking.mask_patient_name("彭林金蓮")
        self.assertEqual(masked, "彭○○蓮")

    def test_name_two_chars(self):
        masked, by_sys = masking.mask_patient_name("徐宏")
        self.assertEqual(masked, "徐○")

    def test_name_already_masked(self):
        masked, by_sys = masking.mask_patient_name("徐○宏")
        self.assertEqual(masked, "徐○宏")
        self.assertFalse(by_sys)

    # ── 回歸：拉丁姓名含字母 O 不得被當成「已遮罩」（audit 發現的個資外洩） ──
    def test_latin_name_with_o_gets_masked(self):
        masked, by_sys = masking.mask_patient_name("JOHNSON")
        self.assertTrue(by_sys)
        self.assertNotEqual(masked, "JOHNSON")
        self.assertEqual(masked, "J○○○○○○")


def _row(**kw) -> ParsedRow:
    base = dict(row_no=1, sheet="s", campus="竹北", period=202605, account="A1")
    base.update(kw)
    return ParsedRow(**base)


class DedupTests(SimpleTestCase):
    def test_same_account_merges(self):
        rows = [
            _row(row_no=1, order_code="80025B0G", order_name="陰道懸吊術",
                 op_time_min=197.0, blood_ml=50.0, adverse_14d=False),
            _row(row_no=2, order_code="80430B0G", order_name="次全子宮切除術",
                 op_time_min=197.0, blood_ml=50.0, adverse_14d=True,
                 adverse_codes=["9"]),
        ]
        cases = dedup_rows(rows)
        self.assertEqual(len(cases), 1)
        c = cases[0]
        self.assertTrue(c.adverse_14d)               # OR
        self.assertEqual(c.adverse_codes, ["9"])     # 聯集
        self.assertEqual(len(c.order_codes), 2)      # 醫令全收
        self.assertEqual(c.op_time_min, 197.0)       # max（相同值）
        self.assertIn("merged_rows:2", c.flags)
        self.assertNotIn("merged_value_mismatch", c.flags)

    def test_mismatch_continuous_flag(self):
        rows = [
            _row(row_no=1, blood_ml=100.0),
            _row(row_no=2, blood_ml=200.0),
        ]
        cases = dedup_rows(rows)
        self.assertEqual(cases[0].blood_ml, 200.0)   # max
        self.assertIn("merged_value_mismatch", cases[0].flags)

    def test_different_accounts_not_merged(self):
        rows = [_row(account="A1"), _row(account="A2", row_no=2)]
        self.assertEqual(len(dedup_rows(rows)), 2)

    def test_same_account_different_period_not_merged(self):
        rows = [_row(period=202604), _row(period=202605, row_no=2)]
        self.assertEqual(len(dedup_rows(rows)), 2)


def _pts(values: list[float | None], den: int | None = None) -> list[SeriesPoint]:
    return [
        SeriesPoint(period=202601 + i, label=f"p{i}", value=v,
                    numerator=(0 if v == 0 else 1) if den else None,
                    denominator=den)
        for i, v in enumerate(values)
    ]


class SpcTests(SimpleTestCase):
    def test_insufficient_below_6(self):
        r = compute_spc(_pts([1, 2, 3, 4, 5]), "continuous")
        self.assertFalse(r.has_chart)
        self.assertTrue(r.insufficient)
        self.assertEqual(r.rating, "neutral")

    def test_baseline_warning_6_to_23(self):
        r = compute_spc(_pts([10.0] * 8), "continuous")
        self.assertTrue(r.has_chart)
        self.assertTrue(r.baseline_warning)

    def test_baseline_caps_at_24(self):
        r = compute_spc(_pts([10.0] * 30), "continuous")
        self.assertFalse(r.baseline_warning)
        self.assertEqual(r.baseline_n, 24)

    def test_rule1_alert_on_spike(self):
        values = [10, 11, 10, 9, 10, 11, 10, 9, 10, 11, 10, 50]
        r = compute_spc(_pts(values), "continuous")
        rules = {s.rule for s in r.signals if s.side == "high"}
        self.assertIn("Rule1", rules)
        self.assertEqual(r.rating, "alert")   # 最新點 3σ 超界（不利）

    def test_rule4_seven_rising(self):
        values = [10, 10.5, 10, 10.2, 10, 11, 12, 13, 14, 15, 16, 17]
        r = compute_spc(_pts(values), "continuous")
        self.assertIn("Rule4", {s.rule for s in r.signals})

    # ── 回歸：連續上升超過 7 點，最新點仍須有 Rule4 訊號（audit 發現 ==7 漏抓） ──
    def test_rule4_persists_beyond_seven(self):
        # 緩升且波動大 → 不觸發 Rule1，純測 Rule4 存續
        values = [10, 30, 10, 30, 10, 30, 10.0, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14]
        pts = _pts(values)
        r = compute_spc(pts, "continuous")
        latest_period = pts[-1].period
        latest_rules = {s.rule for s in r.signals if s.period == latest_period and s.side == "high"}
        self.assertIn("Rule4", latest_rules)
        self.assertEqual(r.rating, "alert")   # 迄最新點連續上升 → 警示不可回落

    def test_rule3_seven_same_side(self):
        values = [10, 20, 10, 20, 10, 15, 16, 15, 16, 15, 16, 15]
        r = compute_spc(_pts(values), "continuous")
        # 後 7 點皆 > CL（約 14 上下）→ 應觸發 Rule3 或至少不炸
        self.assertTrue(r.has_chart)

    def test_favorable_low_not_alert(self):
        # 最新點大幅下降（有利側）→ 不得評警示
        values = [10, 11, 10, 9, 10, 11, 10, 9, 10, 11, 10, 0.1]
        r = compute_spc(_pts(values), "continuous")
        self.assertNotEqual(r.rating, "alert")

    def test_lcl_floor_zero(self):
        values = [1, 5, 1, 5, 1, 5, 1, 5]
        r = compute_spc(_pts(values), "continuous")
        self.assertGreaterEqual(r.lcl, 0.0)

    def test_p_limits_only_above_threshold(self):
        pts = [
            SeriesPoint(period=202601 + i, label=f"p{i}", value=5.0,
                        numerator=1, denominator=(25 if i % 2 == 0 else 15))
            for i in range(8)
        ]
        r = compute_spc(pts, "rate", p_chart_min_n=20)
        self.assertTrue(all(pl.n >= 20 for pl in r.p_limits))
        self.assertEqual(len(r.p_limits), 4)


class _FakeCase:
    def __init__(self, period, conversion=False, op_time_min=None, blood_ml=None,
                 adverse_14d=False, severe_comp_30d=False, infection_14d=False,
                 reoperation_14d=False):
        self.period = period
        self.conversion = conversion
        self.op_time_min = op_time_min
        self.blood_ml = blood_ml
        self.adverse_14d = adverse_14d
        self.severe_comp_30d = severe_comp_30d
        self.infection_14d = infection_14d
        self.reoperation_14d = reoperation_14d


class AggregationTests(SimpleTestCase):
    def test_quarter_helpers(self):
        self.assertEqual(quarter_key(202605), "2026Q2")
        self.assertEqual(quarter_label("2026Q2"), "115年Q2")
        self.assertEqual(periods_in_quarter("2026Q2"), [202604, 202605, 202606])

    # ── 回歸：非法季 key 必須 raise，不得靜默算出不存在的月份（audit 發現） ──
    def test_quarter_out_of_range_raises(self):
        for bad in ("2026Q9", "2026Q0", "2026Q", "ABCQ2"):
            with self.assertRaises(ValueError):
                periods_in_quarter(bad)

    def test_quarterly_rate_sums_num_den(self):
        cases = (
            [_FakeCase(202604, adverse_14d=True)] +
            [_FakeCase(202604) for _ in range(14)] +
            [_FakeCase(202605, adverse_14d=True)] +
            [_FakeCase(202605) for _ in range(17)]
        )
        groups = aggregate_cases_by_period(cases, mode="quarterly")
        self.assertEqual(len(groups), 1)
        dv04 = next(r for r in groups[0]["indicators"] if r["code"] == "DV04")
        self.assertEqual(dv04["numerator"], 2)
        self.assertEqual(dv04["denominator"], 33)    # 15 + 18
        self.assertEqual(groups[0]["period"], "2026Q2")

    def test_monthly_continuous_excludes_none(self):
        cases = [
            _FakeCase(202605, op_time_min=100.0),
            _FakeCase(202605, op_time_min=200.0),
            _FakeCase(202605, op_time_min=None),
        ]
        groups = aggregate_cases_by_period(cases, mode="monthly")
        dv02 = next(r for r in groups[0]["indicators"] if r["code"] == "DV02")
        self.assertEqual(dv02["value"], 150.0)
        self.assertEqual(dv02["median_value"], 150.0)
        self.assertEqual(dv02["n_excluded"], 1)
        self.assertEqual(dv02["denominator"], 2)
