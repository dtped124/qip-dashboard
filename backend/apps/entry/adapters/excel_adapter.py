"""
Excel 匯入轉接器（§9.2 來源 2）

沿用現有 apps/imports/services/excel_parser.py 的解析邏輯，
將結果轉換成標準 IndicatorDataPoint 格式。
"""
import os
from decimal import Decimal, InvalidOperation

from apps.entry.adapters.base import DataSourceAdapter, IndicatorDataPoint
from apps.indicators.models import Indicator


class ExcelAdapter(DataSourceAdapter):
    source_type = "excel"

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.source_name = os.path.basename(file_path)

    def fetch_data(self, campus_code: str, year: int, month: int) -> list[IndicatorDataPoint]:
        """
        解析 Excel 檔案，轉換成 IndicatorDataPoint 列表。
        沿用現有的 excel_parser 和 matching 邏輯。
        """
        from apps.imports.services.excel_parser import ExcelParser
        from apps.imports.services.matching import IndicatorMatcher

        # 院區代碼 → 中文名稱（對應現有 parser）
        campus_name_map = {"hsinchu": "新竹", "zhubei": "竹北", "zhudong": "竹東"}
        campus_name = campus_name_map.get(campus_code, campus_code)

        parser = ExcelParser(self.file_path)
        raw_sheets = parser.parse()  # 回傳各工作表資料

        matcher = IndicatorMatcher()
        result = []

        for sheet in raw_sheets:
            # 只處理對應院區的工作表
            if campus_name not in sheet.get("campus", ""):
                continue

            for row in sheet.get("rows", []):
                indicator_name = row.get("name", "")
                matched_code = matcher.match(indicator_name)
                if not matched_code:
                    continue

                try:
                    num_raw = row.get("numerator")
                    den_raw = row.get("denominator")
                    num = Decimal(str(num_raw)) if num_raw not in (None, "", "NP", "NR") else None
                    den = Decimal(str(den_raw)) if den_raw not in (None, "", "NP", "NR") else None
                except (InvalidOperation, ValueError):
                    num = den = None

                result.append(IndicatorDataPoint(
                    indicator_code=matched_code,
                    campus_code=campus_code,
                    year=year,
                    month=month,
                    numerator=num,
                    denominator=den,
                    note="",
                    raw_data=row,
                ))

        return result

    def validate(self, data: list[IndicatorDataPoint]) -> list[str]:
        errors = []
        valid_codes = set(Indicator.objects.values_list("code", flat=True))

        for dp in data:
            if dp.indicator_code not in valid_codes:
                errors.append(f"未知指標代碼：{dp.indicator_code}")
                continue
            if dp.numerator is not None and dp.numerator < 0:
                errors.append(f"{dp.indicator_code}：分子不可為負數（{dp.numerator}）")
            if dp.denominator is not None and dp.denominator < 0:
                errors.append(f"{dp.indicator_code}：分母不可為負數（{dp.denominator}）")
            if (dp.numerator is not None and dp.denominator is not None
                    and dp.denominator > 0 and dp.numerator > dp.denominator):
                errors.append(f"{dp.indicator_code}：分子（{dp.numerator}）> 分母（{dp.denominator}）")

        return errors
