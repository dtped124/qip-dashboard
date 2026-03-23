"""
新竹醫院 Excel 解析器

格式特徵：
- 單一 sheet，名稱含「新竹」
- 橫向時間軸：欄位 = 月份（110年01月 ~ 115年N月），每年含 Q1-Q4 欄
- 比率指標佔 2 行（分子/分母）
- 計數指標為 加總+總計 或 單一行（F='-'）

欄位配置：
A=面向, B=序號, C=代碼, D=指標名稱, E=報表名稱, F=計算公式, G=子代碼, H=子名稱
I 以後 = 數據欄（月份/季度）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import xlrd
from openpyxl import Workbook

from apps.indicators.constants import INDICATOR_META
from .excel_parser import ParseResult, ParsedDataPoint, ParsedYearlySummary


@dataclass
class TimeCol:
    col: int       # 0-based column index
    year: int      # 民國年
    month: int     # 1-12 (monthly) or 0 (quarterly)
    quarter: int   # 0 (monthly) or 1-4 (quarterly)


@dataclass
class IndicatorBlock:
    code: str
    name: str
    start_row: int
    formula_type: str  # 'ratio', 'count_total', 'count_single'
    numerator_row: int
    denominator_row: int | None = None
    total_row: int | None = None
    value_row: int | None = None


def _build_time_columns_xlrd(sheet: xlrd.sheet.Sheet) -> list[TimeCol]:
    """Parse header row to build time column mapping (xlrd)."""
    cols: list[TimeCol] = []
    for c in range(sheet.ncols):
        header = str(sheet.cell_value(0, c)).strip()
        if not header:
            continue

        # Format: "110年01月" / "113年1月"
        m = re.match(r"(\d{3})年(\d{1,2})月", header)
        if m:
            cols.append(TimeCol(col=c, year=int(m.group(1)), month=int(m.group(2)), quarter=0))
            continue

        # Format: "111年Q1" / "113Q2"
        m = re.match(r"(\d{3})年?Q(\d)", header)
        if m:
            cols.append(TimeCol(col=c, year=int(m.group(1)), month=0, quarter=int(m.group(2))))
            continue

        # Format: pure "Q1"
        m = re.match(r"^Q(\d)$", header)
        if m and cols:
            last_year = cols[-1].year
            cols.append(TimeCol(col=c, year=last_year, month=0, quarter=int(m.group(1))))

    return cols


def _build_time_columns_openpyxl(sheet) -> list[TimeCol]:
    """Parse header row to build time column mapping (openpyxl)."""
    cols: list[TimeCol] = []
    header_row = list(sheet.iter_rows(min_row=1, max_row=1, values_only=True))[0]
    for c, val in enumerate(header_row):
        if val is None:
            continue
        header = str(val).strip()

        m = re.match(r"(\d{3})年(\d{1,2})月", header)
        if m:
            cols.append(TimeCol(col=c, year=int(m.group(1)), month=int(m.group(2)), quarter=0))
            continue

        m = re.match(r"(\d{3})年?Q(\d)", header)
        if m:
            cols.append(TimeCol(col=c, year=int(m.group(1)), month=0, quarter=int(m.group(2))))
            continue

        m = re.match(r"^Q(\d)$", header)
        if m and cols:
            last_year = cols[-1].year
            cols.append(TimeCol(col=c, year=last_year, month=0, quarter=int(m.group(1))))

    return cols


def _identify_blocks(rows: list[list], ncols: int) -> list[IndicatorBlock]:
    """Scan rows to identify indicator blocks by code in column C."""
    blocks: list[IndicatorBlock] = []

    for i in range(1, len(rows)):
        row = rows[i]
        code = str(row[2] if len(row) > 2 else "").strip()
        if not re.match(r"^HA\d{2}-\d{2}$", code):
            continue

        name = str(row[3] if len(row) > 3 else "").replace("\n", " ").strip()
        formula = str(row[5] if len(row) > 5 else "").strip()

        if formula == "分子":
            # Ratio indicator: next row should be denominator
            denom_row = None
            for j in range(i + 1, len(rows)):
                next_code = str(rows[j][2] if len(rows[j]) > 2 else "").strip()
                if re.match(r"^HA\d{2}-\d{2}$", next_code):
                    break
                next_f = str(rows[j][5] if len(rows[j]) > 5 else "").strip()
                if next_f == "分母":
                    denom_row = j
                    break
            blocks.append(IndicatorBlock(
                code=code, name=name, start_row=i,
                formula_type="ratio",
                numerator_row=i, denominator_row=denom_row,
            ))
        elif formula == "加總":
            # Count indicator with subtotals
            total_row = None
            for j in range(i + 1, len(rows)):
                next_code = str(rows[j][2] if len(rows[j]) > 2 else "").strip()
                if re.match(r"^HA\d{2}-\d{2}$", next_code):
                    break
                next_f = re.sub(r"[\s\u3000]+", "", str(rows[j][5] if len(rows[j]) > 5 else ""))
                if next_f == "總計":
                    total_row = j
                    break
            blocks.append(IndicatorBlock(
                code=code, name=name, start_row=i,
                formula_type="count_total",
                numerator_row=i, total_row=total_row,
            ))
        elif formula == "-":
            # Single count value
            blocks.append(IndicatorBlock(
                code=code, name=name, start_row=i,
                formula_type="count_single",
                numerator_row=i, value_row=i,
            ))

    return blocks


def _read_numeric(row: list, col_idx: int) -> float | None:
    """Safely read a numeric value from a row."""
    if col_idx >= len(row):
        return None
    raw = row[col_idx]
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if s in ("NR", "NP", "N/A", "-", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _process_blocks(
    blocks: list[IndicatorBlock],
    rows: list[list],
    time_cols: list[TimeCol],
) -> ParseResult:
    """Process identified blocks and extract data points."""
    result = ParseResult()
    monthly_cols = [tc for tc in time_cols if tc.month > 0]
    quarterly_cols = [tc for tc in time_cols if tc.quarter > 0]
    all_years = sorted(set(tc.year for tc in monthly_cols))

    result.sheets_processed.append("新竹")

    for block in blocks:
        meta = INDICATOR_META.get(block.code)
        if not meta:
            result.errors.append(f"找不到指標元資料: {block.code} ({block.name})")
            continue

        is_quarterly = meta.get("is_quarterly", False)

        if block.formula_type == "ratio" and block.denominator_row is not None:
            num_row = rows[block.numerator_row]
            den_row = rows[block.denominator_row]
            target_cols = quarterly_cols if is_quarterly else monthly_cols

            for tc in target_cols:
                numerator = _read_numeric(num_row, tc.col)
                denominator = _read_numeric(den_row, tc.col)

                value: float | None = None
                if numerator is not None and denominator is not None and denominator > 0:
                    raw_ratio = numerator / denominator
                    if meta["unit"] == "percent":
                        value = raw_ratio * 100
                    elif meta["unit"] == "permille":
                        value = raw_ratio * 1000
                    else:
                        value = raw_ratio
                elif numerator is not None and (denominator is None or denominator == 0):
                    if numerator == 0:
                        value = 0

                month = tc.month if not is_quarterly else [0, 1, 4, 7, 10][tc.quarter]

                result.data_points.append(ParsedDataPoint(
                    indicator_code=block.code,
                    campus="新竹",
                    year=tc.year,
                    month=month,
                    value=value,
                    numerator=int(numerator) if numerator is not None else None,
                    denominator=int(denominator) if denominator is not None else None,
                ))

        elif block.formula_type == "count_total" and block.total_row is not None:
            total_row = rows[block.total_row]
            for tc in monthly_cols:
                value = _read_numeric(total_row, tc.col)
                result.data_points.append(ParsedDataPoint(
                    indicator_code=block.code,
                    campus="新竹",
                    year=tc.year,
                    month=tc.month,
                    value=value,
                ))

        elif block.formula_type == "count_single" and block.value_row is not None:
            val_row = rows[block.value_row]
            for tc in monthly_cols:
                value = _read_numeric(val_row, tc.col)
                result.data_points.append(ParsedDataPoint(
                    indicator_code=block.code,
                    campus="新竹",
                    year=tc.year,
                    month=tc.month,
                    value=value,
                ))
        else:
            if block.formula_type == "ratio":
                result.errors.append(f"{block.code}: 找不到分母行")
            else:
                result.errors.append(f"{block.code}: 找不到總計行")
            continue

        # Build yearly summaries
        for year in all_years:
            year_values = [
                dp.value for dp in result.data_points
                if dp.indicator_code == block.code
                and dp.year == year
                and dp.value is not None
            ]
            avg = sum(year_values) / len(year_values) if year_values else None
            result.yearly_summaries.append(ParsedYearlySummary(
                indicator_code=block.code,
                campus="新竹",
                year=year,
                average=avg,
            ))

    return result


# ── Entry points ──

def parse_hsinchu_xlrd(book: xlrd.Book) -> ParseResult:
    """Parse Hsinchu format from xlrd workbook."""
    sheet_name = next((n for n in book.sheet_names() if "新竹" in n), None)
    if not sheet_name:
        return ParseResult(errors=["找不到新竹醫院的工作表"])

    sheet = book.sheet_by_name(sheet_name)
    if sheet.nrows < 2:
        return ParseResult(errors=["工作表無資料列"])

    time_cols = _build_time_columns_xlrd(sheet)
    if not time_cols:
        return ParseResult(errors=["無法解析時間欄位（表頭）"])

    # Convert to list of lists
    rows: list[list] = []
    for r in range(sheet.nrows):
        row = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
        rows.append(row)

    blocks = _identify_blocks(rows, sheet.ncols)
    return _process_blocks(blocks, rows, time_cols)


def parse_hsinchu_openpyxl(wb: Workbook) -> ParseResult:
    """Parse Hsinchu format from openpyxl workbook."""
    sheet_name = next((n for n in wb.sheetnames if "新竹" in n), None)
    if not sheet_name:
        return ParseResult(errors=["找不到新竹醫院的工作表"])

    sheet = wb[sheet_name]
    rows: list[list] = []
    for row in sheet.iter_rows(values_only=True):
        rows.append([v if v is not None else "" for v in row])

    if len(rows) < 2:
        return ParseResult(errors=["工作表無資料列"])

    time_cols = _build_time_columns_openpyxl(sheet)
    if not time_cols:
        return ParseResult(errors=["無法解析時間欄位（表頭）"])

    blocks = _identify_blocks(rows, len(rows[0]) if rows else 0)
    return _process_blocks(blocks, rows, time_cols)
