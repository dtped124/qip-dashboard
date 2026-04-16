"""
QIP Excel 解析引擎

支援兩種格式：
1. 竹北/竹東格式：每個工作表 = 一個年度×一個院區，縱向列出指標
   - 110年格式：類別(0) NO(1) 名稱(2) 月份(3-14) 標竿(15-16)
   - 111-115年格式：類別(0) NO(1) 代碼(2) 名稱(3) 月份(4-15) 年均+標竿(16+)
2. 新竹格式：單一工作表，橫向時間軸 → 委派 hsinchu_parser

從 Next.js excel-parser.ts 完整翻譯，保留所有邏輯路徑。
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import Any

import xlrd
from openpyxl import load_workbook

from apps.indicators.constants import INDICATOR_META, NAME_TO_CODE
from .data_cleaner import clean_value, clean_value_raw, normalize_monthly_value, normalize_benchmark
from .matching import match_indicator_name


@dataclass
class ParsedDataPoint:
    indicator_code: str
    campus: str
    year: int
    month: int
    value: float | None
    numerator: int | None = None
    denominator: int | None = None


@dataclass
class ParsedYearlySummary:
    indicator_code: str
    campus: str
    year: int
    average: float | None = None
    benchmark_regional: float | None = None
    benchmark_district: float | None = None


@dataclass
class ParseResult:
    data_points: list[ParsedDataPoint] = field(default_factory=list)
    yearly_summaries: list[ParsedYearlySummary] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    sheets_processed: list[str] = field(default_factory=list)


# ── Sheet name parsing ──

def _parse_sheet_name(name: str) -> tuple[int, str | None]:
    """Extract ROC year and campus from sheet name. Returns (year, campus)."""
    year_match = re.search(r"(\d{3})年", name)
    year = int(year_match.group(1)) if year_match else 0

    if "竹北" in name and "竹東" in name:
        return year, None  # Combined sheet, skip
    if "竹北" in name:
        return year, "竹北"
    if "竹東" in name:
        return year, "竹東"
    return year, None


# ── Code resolution ──

CATEGORY_MAPPING = {
    "整體照護": "整體照護", "加護照護": "加護照護", "手術照護": "手術照護",
    "產科照護": "產科照護", "急診照護": "急診照護", "重點照護": "重點照護",
    "感染管制": "感染管制", "用藥安全": "用藥安全", "呼吸照護": "呼吸照護",
    "經營管理": "經營管理",
}


def _resolve_code(raw_code: str, raw_name: str) -> str:
    """Resolve indicator code from raw code and/or name."""
    if raw_code and re.match(r"^HA\d{2}-\d{2}$", raw_code):
        return raw_code

    clean_name = raw_name.strip()

    # Layer 1: Direct NAME_TO_CODE lookup
    if clean_name in NAME_TO_CODE:
        return NAME_TO_CODE[clean_name]

    # Layer 2: Partial match (name may be truncated)
    for key, code in NAME_TO_CODE.items():
        if clean_name.startswith(key) or key.startswith(clean_name):
            return code

    # Layer 3: Fuzzy matching engine
    result = match_indicator_name(clean_name)
    if result.indicator_code and result.confidence != "unrecognized":
        return result.indicator_code

    return ""


# ── Unified cell reader for xlrd/openpyxl ──

class _XlrdSheetAdapter:
    """Adapter for xlrd sheet to provide uniform interface."""

    def __init__(self, book: xlrd.Book, sheet: xlrd.sheet.Sheet):
        self._book = book
        self._sheet = sheet

    @property
    def nrows(self) -> int:
        return self._sheet.nrows

    @property
    def ncols(self) -> int:
        return self._sheet.ncols

    def cell_value(self, row: int, col: int) -> Any:
        if col >= self._sheet.ncols or row >= self._sheet.nrows:
            return ""
        return self._sheet.cell_value(row, col)

    def cell_for_clean(self, row: int, col: int) -> Any:
        """Get cell value suitable for clean_value_raw, handling % format."""
        if col >= self._sheet.ncols or row >= self._sheet.nrows:
            return ""
        cell = self._sheet.cell(row, col)
        if cell.ctype == xlrd.XL_CELL_NUMBER:
            # Check if formatted as % or ‰
            try:
                xf_index = self._sheet.cell_xf_index(row, col)
                fmt = self._book.format_map.get(xf_index)
                if fmt and fmt.format_str:
                    fmt_str = fmt.format_str
                    if "%" in fmt_str or "‰" in fmt_str:
                        # Return the formatted text instead of raw number
                        # xlrd raw % value is 0.0327 for 3.27%
                        val = cell.value
                        if "%" in fmt_str:
                            return f"{val * 100}%"
                        elif "‰" in fmt_str:
                            return f"{val * 1000}‰"
            except Exception:
                pass
        return cell.value

    def header_value(self, col: int) -> str:
        if col >= self._sheet.ncols:
            return ""
        return str(self._sheet.cell_value(0, col)).strip()

    def header_row(self) -> list[str]:
        return [self.header_value(c) for c in range(self._sheet.ncols)]


class _OpenpyxlSheetAdapter:
    """Adapter for openpyxl sheet."""

    def __init__(self, sheet):
        self._sheet = sheet
        self._rows: list[list] | None = None

    def _ensure_rows(self):
        if self._rows is None:
            self._rows = []
            for row in self._sheet.iter_rows(values_only=False):
                self._rows.append(list(row))

    @property
    def nrows(self) -> int:
        self._ensure_rows()
        return len(self._rows)

    @property
    def ncols(self) -> int:
        return self._sheet.max_column or 0

    def cell_value(self, row: int, col: int) -> Any:
        self._ensure_rows()
        if row >= len(self._rows) or col >= len(self._rows[row]):
            return ""
        cell = self._rows[row][col]
        return cell.value if cell.value is not None else ""

    def cell_for_clean(self, row: int, col: int) -> Any:
        """Get cell value handling % format."""
        self._ensure_rows()
        if row >= len(self._rows) or col >= len(self._rows[row]):
            return ""
        cell = self._rows[row][col]
        if cell.value is None:
            return ""
        if isinstance(cell.value, (int, float)) and cell.number_format:
            fmt = str(cell.number_format)
            if "%" in fmt:
                return f"{cell.value * 100}%"
            if "‰" in fmt:
                return f"{cell.value * 1000}‰"
        return cell.value

    def header_value(self, col: int) -> str:
        return str(self.cell_value(0, col)).strip()

    def header_row(self) -> list[str]:
        return [self.header_value(c) for c in range(self.ncols)]


# ── Main parser ──

def parse_qip_excel(file_bytes: bytes, file_name: str) -> ParseResult:
    """
    主入口：解析 QIP 指標 Excel 檔案。

    支援 .xls (xlrd) 和 .xlsx (openpyxl) 格式。
    自動偵測新竹格式並委派專用解析器。
    """
    result = ParseResult()
    ext = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""

    # Open workbook
    sheets: list[tuple[str, Any]] = []  # (sheet_name, adapter)

    if ext == "xls":
        book = xlrd.open_workbook(file_contents=file_bytes, formatting_info=True)
        sheet_names = book.sheet_names()

        # Check for Hsinchu format
        if any("新竹" in name for name in sheet_names):
            from .hsinchu_parser import parse_hsinchu_xlrd
            return parse_hsinchu_xlrd(book)

        for sn in sheet_names:
            sheets.append((sn, _XlrdSheetAdapter(book, book.sheet_by_name(sn))))

    elif ext == "xlsx":
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet_names = wb.sheetnames

        if any("新竹" in name for name in sheet_names):
            from .hsinchu_parser import parse_hsinchu_openpyxl
            return parse_hsinchu_openpyxl(wb)

        for sn in sheet_names:
            sheets.append((sn, _OpenpyxlSheetAdapter(wb[sn])))
    else:
        result.errors.append(f"不支援的檔案格式: .{ext}")
        return result

    nd_computed_keys: set[str] = set()

    # Process each sheet
    for sheet_name, adapter in sheets:
        year, campus = _parse_sheet_name(sheet_name)

        if not campus:
            continue
        if year == 0:
            result.errors.append(f"無法解析工作表年度: {sheet_name}")
            continue

        result.sheets_processed.append(sheet_name)

        if adapter.nrows < 2:
            continue

        # Determine column layout
        is_110 = year == 110
        code_col = -1 if is_110 else 2
        name_col = 2 if is_110 else 3
        month_start = 3 if is_110 else 4
        month_end = month_start + 12

        header_row = adapter.header_row()
        current_category = ""

        for i in range(1, adapter.nrows):
            # Update category
            cat_raw = str(adapter.cell_value(i, 0)).strip()
            if cat_raw:
                resolved_cat = CATEGORY_MAPPING.get(cat_raw)
                if resolved_cat:
                    current_category = resolved_cat

            # Check if indicator row: Col B (NO) is positive integer
            no_val = adapter.cell_value(i, 1)
            if not isinstance(no_val, (int, float)):
                continue
            if no_val != int(no_val) or no_val <= 0:
                continue

            # Extract code and name
            raw_code = "" if is_110 else str(adapter.cell_value(i, code_col)).strip()
            raw_name = str(adapter.cell_value(i, name_col)).strip()
            code = _resolve_code(raw_code, raw_name)

            if not code:
                result.errors.append(
                    f"無法解析指標代碼: year={year} campus={campus} NO={int(no_val)} name={raw_name}"
                )
                continue

            # Step A: Extract adjacent-row n/d (111+ format)
            adjacent_nd: list[dict | None] = [None] * 12
            if not is_110 and i + 1 < adapter.nrows:
                next_no = adapter.cell_value(i + 1, 1)
                is_nd_row = (
                    next_no == "" or next_no is None or
                    (isinstance(next_no, str) and next_no.strip() == "")
                )
                if is_nd_row:
                    for m in range(12):
                        col_idx = month_start + m
                        nd_str = str(adapter.cell_value(i + 1, col_idx)).strip()
                        frac_match = re.search(r"\(?(\d+)\s*/\s*(\d+)\)?", nd_str)
                        if frac_match:
                            adjacent_nd[m] = {
                                "numerator": int(frac_match.group(1)),
                                "denominator": int(frac_match.group(2)),
                            }

            # Step B: Check if rate indicator
            meta = INDICATOR_META.get(code)
            is_rate = meta is not None and meta.get("data_nature") in ("binomial_rate", "poisson_rate")

            # Step C: Extract monthly values
            for m in range(12):
                col_idx = month_start + m
                # Only use cell_for_clean (% format handling) for rate indicators
                # Count/continuous indicators: read raw value to avoid ×100 on counts
                raw = adapter.cell_for_clean(i, col_idx) if is_rate else adapter.cell_value(i, col_idx)

                cr = clean_value_raw(raw)

                # Merge n/d sources
                numerator = cr.numerator
                denominator = cr.denominator
                if adjacent_nd[m]:
                    numerator = adjacent_nd[m]["numerator"]
                    denominator = adjacent_nd[m]["denominator"]

                # Compute value
                value: float | None = None
                computed_from_nd = False

                if is_rate and numerator is not None and denominator is not None and denominator > 0:
                    raw_ratio = numerator / denominator
                    if meta["unit"] == "percent":
                        value = raw_ratio * 100
                    elif meta["unit"] == "permille":
                        value = raw_ratio * 1000
                    else:
                        value = raw_ratio
                    computed_from_nd = True

                    # Sanity check: 比對主儲存格顯示值與 n/d 計算值，差異 >3 倍時
                    # 寫一筆警告供人工檢視。實務上兩側都可能出錯：
                    #   - n/d 偏大 → 分母漏一位數 typo（如 d=23 應為 526）
                    #   - 主儲存格偏大 → 儲存格單位/格式問題
                    # 沒有可靠的通用規則能自動判別哪邊才對，且自動翻轉會傷到
                    # 其他正規化邏輯產出的合理 n/d 值，所以這裡僅警告、不覆蓋。
                    # 確認後的單筆錯誤請以資料庫更新處理。
                    main_cell_value = normalize_monthly_value(
                        cr.value, code, year, campus, cr.had_symbol
                    )
                    if (
                        main_cell_value is not None
                        and main_cell_value > 0
                        and value is not None
                        and value > 0
                    ):
                        ratio = max(value, main_cell_value) / min(value, main_cell_value)
                        if ratio > 3:
                            direction = "n/d 偏大 (疑似分母 typo)" if value > main_cell_value else "儲存格偏大 (疑似格式錯誤)"
                            result.errors.append(
                                f"[警告] {code} {campus} {year}年{m + 1}月: "
                                f"n/d 計算值 {value:.4f} 與儲存格顯示值 {main_cell_value:.4f} "
                                f"差異 {ratio:.1f} 倍 (n={numerator}, d={denominator}) — {direction}；"
                                f"請人工確認後以資料庫更新修正。"
                            )
                elif is_rate and numerator is not None and numerator == 0:
                    value = 0
                    computed_from_nd = True
                else:
                    value = normalize_monthly_value(cr.value, code, year, campus, cr.had_symbol)

                if computed_from_nd:
                    nd_computed_keys.add(f"{code}_{campus}_{year}_{m + 1}")

                result.data_points.append(ParsedDataPoint(
                    indicator_code=code,
                    campus=campus,
                    year=year,
                    month=m + 1,
                    value=value,
                    numerator=numerator,
                    denominator=denominator,
                ))

            # Extract year average and benchmarks
            benchmark_regional: float | None = None
            benchmark_district: float | None = None

            if is_110:
                benchmark_regional = clean_value(adapter.cell_value(i, 15))
                benchmark_district = clean_value(adapter.cell_value(i, 16))
            else:
                after_months = month_end
                # Search headers for benchmark columns
                for c in range(after_months + 1, len(header_row)):
                    h = header_row[c].replace("\n", "")
                    if "區域醫院" in h and benchmark_regional is None:
                        benchmark_regional = clean_value(adapter.cell_value(i, c))
                    elif "地區醫院" in h and benchmark_district is None:
                        benchmark_district = clean_value(adapter.cell_value(i, c))

                # Fallback: try fixed positions
                if benchmark_regional is None and len(header_row) > after_months + 3:
                    last_col = len(header_row) - 1
                    second_last = last_col - 1
                    h_last = header_row[last_col].replace("\n", "")
                    h_second = header_row[second_last].replace("\n", "")
                    if "區域" in h_second or "標竿" in h_second:
                        benchmark_regional = clean_value(adapter.cell_value(i, second_last))
                    if "地區" in h_last or "標竿" in h_last:
                        benchmark_district = clean_value(adapter.cell_value(i, last_col))

            # Normalize benchmarks
            benchmark_regional = normalize_benchmark(benchmark_regional, code, year, campus)
            benchmark_district = normalize_benchmark(benchmark_district, code, year, campus)

            result.yearly_summaries.append(ParsedYearlySummary(
                indicator_code=code,
                campus=campus,
                year=year,
                average=None,  # Recalculate after outlier validation
                benchmark_regional=benchmark_regional,
                benchmark_district=benchmark_district,
            ))

    # Outlier validation
    _validate_outliers(result, nd_computed_keys)

    # Recalculate year averages from corrected monthly data
    _recalculate_year_averages(result)

    return result


def _validate_outliers(result: ParseResult, nd_computed_keys: set[str]) -> None:
    """Detect and auto-correct outliers (translated from validateOutliers in TS)."""
    OUTLIER_THRESHOLD = 20
    CORRECTION_TOLERANCE = 5

    # Group data points by (code, campus)
    groups: dict[str, list[ParsedDataPoint]] = {}
    for dp in result.data_points:
        key = f"{dp.indicator_code}_{dp.campus}"
        groups.setdefault(key, []).append(dp)

    for key, dps in groups.items():
        code = dps[0].indicator_code
        meta = INDICATOR_META.get(code)
        if not meta or meta.get("unit") not in ("percent", "permille"):
            continue

        values = [dp.value for dp in dps if dp.value is not None and dp.value > 0]
        if len(values) < 3:
            continue

        sorted_vals = sorted(values)
        median = sorted_vals[len(sorted_vals) // 2]
        if median == 0:
            continue

        for dp in dps:
            if dp.value is None or dp.value == 0:
                continue

            nd_key = f"{dp.indicator_code}_{dp.campus}_{dp.year}_{dp.month}"
            was_nd = nd_key in nd_computed_keys
            ratio = dp.value / median

            if ratio > OUTLIER_THRESHOLD:
                if was_nd:
                    result.errors.append(
                        f"⚠ 異常值（n/d 計算）: {code} {dp.campus} {dp.year}年{dp.month}月 "
                        f"值={dp.value} (中位數={median:.4f}，為中位數的{ratio:.1f}倍)"
                    )
                else:
                    corrected = dp.value / 100
                    corrected_ratio = corrected / median
                    if 1 / CORRECTION_TOLERANCE <= corrected_ratio <= CORRECTION_TOLERANCE:
                        original = dp.value
                        dp.value = corrected
                        result.errors.append(
                            f"✅ 自動修正: {code} {dp.campus} {dp.year}年{dp.month}月 "
                            f"{original} → {corrected} (÷100)"
                        )
                    else:
                        result.errors.append(
                            f"⚠ 異常值: {code} {dp.campus} {dp.year}年{dp.month}月 "
                            f"值={dp.value} (中位數={median:.4f}，為中位數的{ratio:.1f}倍)"
                        )
            elif ratio < 1 / OUTLIER_THRESHOLD:
                src = "（n/d 計算）" if was_nd else ""
                result.errors.append(
                    f"⚠ 異常值{src}: {code} {dp.campus} {dp.year}年{dp.month}月 "
                    f"值={dp.value} (僅為中位數的{ratio * 100:.2f}%)"
                )


def _recalculate_year_averages(result: ParseResult) -> None:
    """Recalculate year averages from monthly data (after outlier correction)."""
    for summary in result.yearly_summaries:
        year_points = [
            dp.value for dp in result.data_points
            if dp.indicator_code == summary.indicator_code
            and dp.campus == summary.campus
            and dp.year == summary.year
            and dp.value is not None
        ]
        if year_points:
            summary.average = sum(year_points) / len(year_points)
