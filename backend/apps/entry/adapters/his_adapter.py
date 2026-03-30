"""
HIS 串接轉接器骨架（§9.4 HISAdapter）

目前為空實作（回傳空列表），等 HIS 報表格式確定後實作。
架構上已就位：
- 三種串接模式（his_api / his_csv / his_db_view）
- HISFieldMapping 欄位對應
- 個案清單（CaseRecord）產生邏輯佔位

未來開發時需確認：
1. HIS 端提供什麼格式？
2. 每個指標的分子/分母在哪個系統、哪個欄位？
3. 匯入頻率？
4. 是否需要個案清單路徑？
"""
from apps.entry.adapters.base import DataSourceAdapter, IndicatorDataPoint


class HISAdapter(DataSourceAdapter):
    source_type = "his"

    def __init__(self, config):
        """
        config: DataSourceConfig model instance
        """
        self.config = config
        self.source_name = config.name

    def fetch_data(self, campus_code: str, year: int, month: int) -> list[IndicatorDataPoint]:
        """
        根據 config.source_type 決定取資料方式：
        - his_api:      呼叫 HIS REST API（待實作）
        - his_csv:      讀取約定路徑的 CSV 匯出檔（待實作）
        - his_db_view:  查詢 HIS 資料庫 View（待實作）

        目前回傳空列表，等 HIS 報表格式確定後實作。
        """
        # TODO: 依 self.config.source_type 實作各串接模式
        return []

    def validate(self, data: list[IndicatorDataPoint]) -> list[str]:
        """除基本檢查外，驗證 HISFieldMapping 所有指標都有資料"""
        # TODO: 實作 HIS 欄位對應驗證
        return []
