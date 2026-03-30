"""
QIP 填報系統核心 Models

架構：
  Campus          — 院區定義
  ReportCategory  — 面向（類別）定義
  IndicatorAssignment — 指標 × 院區 × 負責人對應
  MonthlyReport   — 月報表頭（面向 × 院區 × 月份的填報單元）
  IndicatorEntry  — 指標數據（每個指標每月一筆）
  HA10SubEntry    — 新竹 HA10 子類別明細
  CaseRecord      — 個案紀錄（個案清單路徑）
  ExclusionReason — 排除理由預設選項
  EntryAuditLog   — 修改紀錄
  DeadlineSetting — 填報截止日設定
  ImportBatch     — 資料匯入批次紀錄
  DataSourceConfig — 資料來源設定（HIS 串接預留）
  HISFieldMapping — HIS 欄位對應表
"""
from django.conf import settings
from django.db import models


# ── 1. 院區 ─────────────────────────────────────────────────────

class BenchmarkLevel(models.TextChoices):
    MEDICAL_CENTER = "medical_center", "醫學中心"
    REGIONAL = "regional", "區域醫院"
    DISTRICT = "district", "地區醫院"


class Campus(models.Model):
    code = models.CharField("院區代碼", max_length=20, unique=True)  # "hsinchu", "zhubei", "zhudong"
    name = models.CharField("院區名稱", max_length=50)               # "新竹", "竹北", "竹東"
    benchmark_level = models.CharField(
        "標竿層級", max_length=20, choices=BenchmarkLevel.choices
    )
    is_active = models.BooleanField("啟用", default=True)

    class Meta:
        db_table = "entry_campuses"
        verbose_name = "院區"
        verbose_name_plural = "院區"
        ordering = ["name"]

    def __str__(self):
        return self.name


# ── 2. 面向（類別）─────────────────────────────────────────────

class ReportCategory(models.Model):
    code = models.CharField("面向代碼", max_length=20, unique=True)  # "HA01", "HA02", ...
    name = models.CharField("面向名稱", max_length=100)              # "整體住院照護", "加護照護", ...
    sort_order = models.IntegerField("排序")
    color = models.CharField("代表色", max_length=7, default="#6B7280")  # hex

    class Meta:
        db_table = "entry_categories"
        verbose_name = "填報面向"
        verbose_name_plural = "填報面向"
        ordering = ["sort_order"]

    def __str__(self):
        return f"{self.code} {self.name}"


# ── 3. 指標負責人對應 ─────────────────────────────────────────

class AssignmentRole(models.TextChoices):
    PRIMARY = "primary", "正職負責人"
    DEPUTY = "deputy", "代理人"


class IndicatorAssignment(models.Model):
    indicator_code = models.CharField("指標代碼", max_length=20, db_index=True)
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE, verbose_name="院區")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        verbose_name="負責人",
        related_name="assignments",
    )
    role = models.CharField("職責", max_length=10, choices=AssignmentRole.choices, default=AssignmentRole.PRIMARY)
    effective_from = models.DateField("生效起始日")
    effective_to = models.DateField("失效日", null=True, blank=True)  # null = 現行有效
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name="指派者",
        related_name="created_assignments",
    )
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    class Meta:
        db_table = "entry_assignments"
        verbose_name = "指標負責人指派"
        verbose_name_plural = "指標負責人指派"
        indexes = [
            models.Index(fields=["indicator_code", "campus", "effective_to"]),
        ]

    def __str__(self):
        return f"{self.indicator_code} × {self.campus} → {self.user} ({self.role})"


# ── 4. 月報表頭 ──────────────────────────────────────────────

class ReportStatus(models.TextChoices):
    UNFILLED = "unfilled", "未填"
    DRAFT = "draft", "草稿"
    SUBMITTED = "submitted", "已送審"
    APPROVED = "approved", "已核准"
    FINALIZED = "finalized", "已送出"


class MonthlyReport(models.Model):
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE, verbose_name="院區")
    year = models.IntegerField("民國年")   # 如 115
    month = models.IntegerField("月份")   # 1-12
    category = models.ForeignKey(ReportCategory, on_delete=models.CASCADE, verbose_name="面向")
    status = models.CharField(
        "狀態", max_length=20, choices=ReportStatus.choices, default=ReportStatus.UNFILLED
    )

    submitted_at = models.DateTimeField("送審時間", null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submitted_reports", verbose_name="送審者"
    )
    reviewed_at = models.DateTimeField("審核時間", null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_reports", verbose_name="審核者"
    )
    approved_at = models.DateTimeField("核准時間", null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_reports", verbose_name="核准者"
    )
    finalized_at = models.DateTimeField("送出時間", null=True, blank=True)
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="finalized_reports", verbose_name="送出者"
    )
    rejection_reason = models.TextField("退回理由", blank=True)
    is_late = models.BooleanField("逾期繳交", default=False)

    class Meta:
        db_table = "entry_monthly_reports"
        verbose_name = "月報"
        verbose_name_plural = "月報"
        unique_together = [("campus", "year", "month", "category")]
        indexes = [
            models.Index(fields=["campus", "year", "month"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.campus} {self.year}年{self.month}月 {self.category} [{self.status}]"


# ── 5. 指標數據 ──────────────────────────────────────────────

class DataSource(models.TextChoices):
    MANUAL = "manual", "線上填報"
    EXCEL = "excel", "Excel 匯入"
    HIS = "his", "HIS 自動匯入"


class IndicatorEntry(models.Model):
    report = models.ForeignKey(
        MonthlyReport, on_delete=models.CASCADE, verbose_name="月報", related_name="entries"
    )
    indicator_code = models.CharField("指標代碼", max_length=20, db_index=True)
    numerator = models.DecimalField("分子", max_digits=12, decimal_places=2, null=True, blank=True)
    denominator = models.DecimalField("分母", max_digits=12, decimal_places=2, null=True, blank=True)
    value = models.DecimalField("計算值", max_digits=12, decimal_places=6, null=True, blank=True)

    # 個案清單路徑專用欄位
    raw_numerator = models.IntegerField("排除前分子", null=True, blank=True)
    raw_denominator = models.IntegerField("排除前分母", null=True, blank=True)
    exclusion_count = models.IntegerField("排除個案數", default=0)

    note = models.TextField("填報備註", blank=True)
    filled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="filled_entries", verbose_name="填報者"
    )
    filled_at = models.DateTimeField("填報時間", null=True, blank=True)
    data_source = models.CharField(
        "資料來源", max_length=20, choices=DataSource.choices, default=DataSource.MANUAL
    )
    import_batch = models.ForeignKey(
        "ImportBatch", on_delete=models.SET_NULL, null=True, blank=True, verbose_name="匯入批次"
    )

    class Meta:
        db_table = "entry_indicator_entries"
        verbose_name = "指標數據"
        verbose_name_plural = "指標數據"
        unique_together = [("report", "indicator_code")]

    def __str__(self):
        return f"{self.report} — {self.indicator_code}: {self.value}"


# ── 6. HA10 新竹子類別 ────────────────────────────────────────

class HA10SubEntry(models.Model):
    entry = models.ForeignKey(
        IndicatorEntry, on_delete=models.CASCADE, verbose_name="指標數據", related_name="sub_entries"
    )
    sub_code = models.CharField("子類別代碼", max_length=20)   # "HA10-10-01" ~ "HA10-10-13"
    sub_name = models.CharField("子類別名稱", max_length=100)
    value = models.DecimalField("數值", max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "entry_ha10_sub_entries"
        verbose_name = "HA10 子類別"
        verbose_name_plural = "HA10 子類別"
        unique_together = [("entry", "sub_code")]

    def __str__(self):
        return f"{self.sub_code} {self.sub_name}: {self.value}"


# ── 7. 排除理由（個案清單路徑）───────────────────────────────

class ExclusionReason(models.Model):
    code = models.CharField("代碼", max_length=20, unique=True)
    name = models.CharField("名稱", max_length=100)
    description = models.TextField("說明", blank=True)
    sort_order = models.IntegerField("排序", default=0)
    is_active = models.BooleanField("啟用", default=True)

    class Meta:
        db_table = "entry_exclusion_reasons"
        verbose_name = "排除理由"
        verbose_name_plural = "排除理由"
        ordering = ["sort_order"]

    def __str__(self):
        return f"{self.code} {self.name}"


# ── 8. 個案紀錄（個案清單路徑）──────────────────────────────

class CaseRecord(models.Model):
    entry = models.ForeignKey(
        IndicatorEntry, on_delete=models.CASCADE, verbose_name="指標數據", related_name="case_records"
    )
    case_role = models.CharField(
        "個案角色", max_length=20,
        choices=[("numerator", "分子群"), ("denominator", "分母群")]
    )
    his_raw_data = models.JSONField("HIS 原始資料", default=dict)
    # 典型欄位：chart_no, admission_date, discharge_date, outcome, dept, ward, icd_codes
    is_excluded = models.BooleanField("已排除", default=False)
    excluded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="excluded_cases", verbose_name="排除者"
    )
    excluded_at = models.DateTimeField("排除時間", null=True, blank=True)
    exclusion_reason = models.ForeignKey(
        ExclusionReason, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="排除理由"
    )
    exclusion_note = models.TextField("補充說明", blank=True)
    reviewer_approved = models.BooleanField("品管中心同意排除", null=True)
    reviewer_note = models.TextField("品管中心意見", blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    class Meta:
        db_table = "entry_case_records"
        verbose_name = "個案紀錄"
        verbose_name_plural = "個案紀錄"
        indexes = [
            models.Index(fields=["entry", "is_excluded"]),
        ]

    def __str__(self):
        chart_no = self.his_raw_data.get("chart_no", "?")
        return f"{self.entry} — {chart_no} ({'排除' if self.is_excluded else '保留'})"


# ── 9. 修改紀錄（Audit Log）─────────────────────────────────

class EntryAuditLog(models.Model):
    entry = models.ForeignKey(
        IndicatorEntry, on_delete=models.CASCADE, verbose_name="指標數據", related_name="audit_logs"
    )
    field_name = models.CharField("欄位名稱", max_length=50)   # "numerator", "denominator", "value"
    old_value = models.CharField("原始值", max_length=100)
    new_value = models.CharField("修改後值", max_length=100)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name="修改者"
    )
    changed_at = models.DateTimeField("修改時間", auto_now_add=True)
    reason = models.TextField("修改理由", blank=True)

    class Meta:
        db_table = "entry_audit_logs"
        verbose_name = "修改紀錄"
        verbose_name_plural = "修改紀錄"
        ordering = ["-changed_at"]

    def __str__(self):
        return f"{self.entry} — {self.field_name}: {self.old_value} → {self.new_value}"


# ── 10. 填報截止日設定 ───────────────────────────────────────

class DeadlineSetting(models.Model):
    year = models.IntegerField("民國年")
    month = models.IntegerField("月份")
    deadline_day = models.IntegerField("截止日", default=10)  # 每月幾號
    note = models.CharField("備註", max_length=200, blank=True)  # 如 "春節延長"

    class Meta:
        db_table = "entry_deadline_settings"
        verbose_name = "截止日設定"
        verbose_name_plural = "截止日設定"
        unique_together = [("year", "month")]

    def __str__(self):
        return f"{self.year}年{self.month}月 截止日：{self.deadline_day}日"


# ── 11. 資料匯入批次 ─────────────────────────────────────────

class ImportBatchStatus(models.TextChoices):
    PENDING = "pending", "待確認"
    PREVIEW = "preview", "預覽中"
    CONFIRMED = "confirmed", "已確認"
    FAILED = "failed", "失敗"


class ImportBatch(models.Model):
    source_type = models.CharField(
        "來源類型", max_length=20,
        choices=[("excel", "Excel 匯入"), ("his", "HIS 自動匯入")]
    )
    source_name = models.CharField("來源名稱", max_length=200)  # 檔名或 HIS 系統名稱
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE, verbose_name="院區")
    year = models.IntegerField("民國年")
    month = models.IntegerField("月份")
    status = models.CharField(
        "狀態", max_length=20, choices=ImportBatchStatus.choices, default=ImportBatchStatus.PENDING
    )
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name="匯入者"
    )
    imported_at = models.DateTimeField("匯入時間", auto_now_add=True)
    record_count = models.IntegerField("匯入筆數", default=0)
    error_log = models.TextField("錯誤訊息", blank=True)

    class Meta:
        db_table = "entry_import_batches"
        verbose_name = "匯入批次"
        verbose_name_plural = "匯入批次"
        ordering = ["-imported_at"]

    def __str__(self):
        return f"{self.source_name} ({self.campus} {self.year}年{self.month}月) [{self.status}]"


# ── 12. 資料來源設定（HIS 串接預留）─────────────────────────

class DataSourceConfig(models.Model):
    name = models.CharField("名稱", max_length=100, unique=True)  # "HIS-感控系統"
    source_type = models.CharField(
        "來源類型", max_length=20,
        choices=[
            ("his_api", "HIS REST API"),
            ("his_csv", "HIS CSV 匯出"),
            ("his_db_view", "HIS DB View"),
        ]
    )
    connection_config = models.JSONField("連線設定", default=dict)
    schedule = models.CharField("排程（cron）", max_length=50, blank=True)
    is_active = models.BooleanField("啟用", default=False)
    last_run_at = models.DateTimeField("最後執行時間", null=True, blank=True)
    last_run_status = models.CharField("最後執行狀態", max_length=20, blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    class Meta:
        db_table = "entry_data_source_configs"
        verbose_name = "資料來源設定"
        verbose_name_plural = "資料來源設定"

    def __str__(self):
        return self.name


# ── 13. HIS 欄位對應表 ───────────────────────────────────────

class HISFieldMapping(models.Model):
    data_source = models.ForeignKey(
        DataSourceConfig, on_delete=models.CASCADE, verbose_name="資料來源", related_name="mappings"
    )
    indicator_code = models.CharField("指標代碼", max_length=20)
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE, verbose_name="院區")
    his_numerator_field = models.CharField("HIS 分子欄位", max_length=200)
    his_denominator_field = models.CharField("HIS 分母欄位", max_length=200, blank=True)
    his_date_field = models.CharField("HIS 日期欄位", max_length=200)
    transform_formula = models.TextField("轉換公式", blank=True)
    is_active = models.BooleanField("啟用", default=True)
    note = models.TextField("說明", blank=True)

    class Meta:
        db_table = "entry_his_field_mappings"
        verbose_name = "HIS 欄位對應"
        verbose_name_plural = "HIS 欄位對應"
        unique_together = [("data_source", "indicator_code", "campus")]

    def __str__(self):
        return f"{self.data_source} — {self.indicator_code} × {self.campus}"
