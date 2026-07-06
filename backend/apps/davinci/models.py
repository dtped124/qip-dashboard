"""
達文西手術品質 — 資料模型

與 QIP 模組完全獨立（開發計畫 0.1：QIP 既有程式碼 diff 必須為零）。
資料表設計遵循品管中心資訊化技術堆疊規範：
- 表名：小寫英文 + 底線分隔，複數形式
- 主鍵：id (BigAutoField)
- 時間欄位：created_at, updated_at

三張表：
- davinci_import_logs      匯入紀錄（兩段式：preview → confirmed）
- davinci_cases            去重後人次層級個案明細（供下鑽）
- davinci_indicator_values 月聚合指標值（SPC/評級即時計算，不入庫）
"""
from django.db import models


class DavinciCampus(models.TextChoices):
    ZHUBEI = "竹北", "竹北（生醫醫院）"
    HSINCHU = "新竹", "新竹醫院"


class ImportStatus(models.TextChoices):
    PREVIEW = "preview", "預覽中"
    CONFIRMED = "confirmed", "已確認寫入"
    DISCARDED = "discarded", "已捨棄"


class DavinciImportLog(models.Model):
    """匯入紀錄。上傳即建立（status=preview），確認寫入後轉 confirmed。"""

    file_name = models.CharField(max_length=255)
    file_size = models.IntegerField(default=0)
    uploaded_file = models.FileField(upload_to="davinci_imports/%Y/%m/", blank=True)
    status = models.CharField(
        max_length=20, choices=ImportStatus.choices, default=ImportStatus.PREVIEW
    )
    periods = models.JSONField(default=list)    # [202604, 202605]
    campuses = models.JSONField(default=list)   # ["竹北", "新竹"]
    rows_raw = models.IntegerField(default=0)       # 原始醫令列數
    cases_dedup = models.IntegerField(default=0)    # 去重後人次
    report_json = models.JSONField(default=dict)    # 完整匯入報告（清洗/矛盾/待確認）
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "davinci_import_logs"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.file_name} ({self.status})"


class DavinciCase(models.Model):
    """去重後人次層級個案（一帳號 = 一台手術 = 一人次）。

    period 存費用年月原值（西元 yyyymm，權威期別），民國標籤由 API 換算。
    病歷號/姓名一律存遮罩版（新竹源檔未遮罩者由系統遮罩）。
    """

    campus = models.CharField(max_length=10, choices=DavinciCampus.choices)
    period = models.IntegerField()                       # 西元 yyyymm，如 202605
    account = models.CharField(max_length=20)            # 帳號（去重鍵）
    chart_no_masked = models.CharField(max_length=20, blank=True)
    patient_masked = models.CharField(max_length=20, blank=True)
    davinci_type = models.CharField(max_length=10, blank=True)   # 健保/自費
    dept_code = models.CharField(max_length=10, blank=True)
    dept_name = models.CharField(max_length=50, blank=True)
    surgeon = models.CharField(max_length=50, blank=True)
    # 同帳號多列醫令合併：[{"code": "80025B0G", "name": "腹腔鏡陰道懸吊術"}, ...]
    order_codes = models.JSONField(default=list)
    admission_date = models.DateField(null=True, blank=True)
    discharge_date = models.DateField(null=True, blank=True)
    op_date = models.DateField(null=True, blank=True)    # 執行起日（容錯解析）
    op_date_raw = models.CharField(max_length=40, blank=True)  # 解析失敗時保留原字串
    # 清洗後連續值（同帳號多列取 max）
    op_time_min = models.FloatField(null=True, blank=True)
    blood_ml = models.FloatField(null=True, blank=True)
    # 事件旗標（同帳號多列 OR；內容欄有合法值 → 強制 True）
    conversion = models.BooleanField(default=False)
    conversion_reason = models.CharField(max_length=200, blank=True)
    adverse_14d = models.BooleanField(default=False)
    adverse_codes = models.JSONField(default=list)       # ["9"] 等，對照 ADVERSE_EVENT_CODES
    adverse_free_text = models.CharField(max_length=200, blank=True)  # 代碼 10 的附註
    severe_comp_30d = models.BooleanField(default=False)
    severe_comp_codes = models.JSONField(default=list)   # Clavien-Dindo 代碼
    infection_14d = models.BooleanField(default=False)
    reoperation_14d = models.BooleanField(default=False)
    # 清洗 / 近似 / 矛盾標記（見 services/cleaner.py flag 字典）
    flags = models.JSONField(default=list)
    import_log = models.ForeignKey(
        DavinciImportLog, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cases",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "davinci_cases"
        unique_together = [("campus", "period", "account")]
        indexes = [
            models.Index(fields=["campus", "period"]),
            models.Index(fields=["campus", "period", "dept_code"]),
            models.Index(fields=["campus", "period", "surgeon"]),
        ]
        ordering = ["campus", "period", "account"]

    def __str__(self) -> str:
        return f"{self.campus} {self.period} {self.account}"


class DavinciIndicatorValue(models.Model):
    """月聚合指標值（院區 × 費用年月 × 指標）。

    重複匯入同期別以 upsert 覆蓋（unique_together），不重複累計。
    SPC 管制界限與評級為計算輸出，不入庫（與 QIP 同原則）。
    """

    campus = models.CharField(max_length=10, choices=DavinciCampus.choices)
    period = models.IntegerField()                       # 西元 yyyymm
    indicator_code = models.CharField(max_length=10)     # DV01–DV07
    numerator = models.IntegerField(null=True, blank=True)    # 比率型：事件人次
    denominator = models.IntegerField(null=True, blank=True)  # 比率型：總人次；連續型：納入平均台數
    value = models.FloatField(null=True, blank=True)          # 比率(%) 或 月平均
    median_value = models.FloatField(null=True, blank=True)   # 連續型月中位數（定案 #2）
    n_cases = models.IntegerField(default=0)             # 該月去重人次
    n_excluded = models.IntegerField(default=0)          # 排除於平均的台數（清洗失敗 null）
    computed_at = models.DateTimeField(auto_now=True)
    import_log = models.ForeignKey(
        DavinciImportLog, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="indicator_values",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "davinci_indicator_values"
        unique_together = [("campus", "period", "indicator_code")]
        indexes = [
            models.Index(fields=["campus", "indicator_code", "period"]),
        ]
        ordering = ["campus", "period", "indicator_code"]

    def __str__(self) -> str:
        return f"{self.campus} {self.period} {self.indicator_code}"
