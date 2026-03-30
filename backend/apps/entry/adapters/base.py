"""
資料來源轉接器抽象介面（§9.4）

所有外部資料來源都透過統一介面寫入核心資料表。
不論手動填報、Excel 匯入、或未來 HIS 串接，最終都轉換成同一格式。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


@dataclass
class IndicatorDataPoint:
    """所有資料來源的統一輸出格式"""
    indicator_code: str
    campus_code: str
    year: int          # 民國年
    month: int
    numerator: Optional[Decimal]
    denominator: Optional[Decimal]
    note: str = ""
    raw_data: dict = field(default_factory=dict)  # 來源原始資料（供追溯）


class DataSourceAdapter(ABC):
    """所有資料來源轉接器的基底類別"""

    source_type: str = ""   # "excel" | "his"
    source_name: str = ""

    @abstractmethod
    def fetch_data(self, campus_code: str, year: int, month: int) -> list[IndicatorDataPoint]:
        """從來源取得資料，轉換為標準格式"""
        pass

    @abstractmethod
    def validate(self, data: list[IndicatorDataPoint]) -> list[str]:
        """驗證資料，回傳錯誤訊息列表（空列表 = 通過）"""
        pass

    def import_data(self, campus_code: str, year: int, month: int, imported_by) -> dict:
        """
        統一的匯入流程：取得 → 驗證 → 預覽（建立 ImportBatch，status=preview）
        確認寫入由獨立的 confirm_import() 執行。
        """
        from apps.entry.models import Campus, ImportBatch

        try:
            campus = Campus.objects.get(code=campus_code)
        except Campus.DoesNotExist:
            return {"status": "failed", "errors": [f"找不到院區 {campus_code}"]}

        data = self.fetch_data(campus_code, year, month)
        errors = self.validate(data)

        batch = ImportBatch.objects.create(
            source_type=self.source_type,
            source_name=self.source_name,
            campus=campus,
            year=year,
            month=month,
            imported_by=imported_by,
            status="preview" if not errors else "failed",
            record_count=len(data),
            error_log="\n".join(errors) if errors else "",
        )

        if errors:
            return {"status": "failed", "batch_id": batch.id, "errors": errors}

        # 序列化預覽資料
        preview = [
            {
                "indicator_code": d.indicator_code,
                "numerator": float(d.numerator) if d.numerator is not None else None,
                "denominator": float(d.denominator) if d.denominator is not None else None,
                "note": d.note,
            }
            for d in data
        ]
        return {"status": "preview", "batch_id": batch.id, "preview": preview, "errors": []}
