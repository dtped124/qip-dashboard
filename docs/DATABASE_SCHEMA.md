# 資料庫結構說明

## 📊 資料庫概述

- **生產環境**：PostgreSQL（schema = `qip`，由 `init-db.sql` 建立）
- **開發環境**：SQLite（`backend/db.sqlite3`）
- **ORM**：Django ORM（Django 5 + DRF）
- **命名規範**（依《品管中心資訊化技術堆疊規範》）：
  - 表名：小寫英文 + 底線分隔，複數形式
  - 主鍵：`id`（BigAutoField）
  - 時間欄位：`created_at`, `updated_at`
  - Schema：`qip`（所有 App 共用）

---

## 📋 資料表一覽

### 指標核心（apps.indicators）

| 資料表 | 說明 | 主要關聯 |
|-------|------|---------|
| `indicators` | 指標元資料（55+ 項） | → data_points, yearly_summaries, alerts |
| `data_points` | 月份資料點 | → indicators（by code） |
| `yearly_summaries` | 年度彙總 + 標竿 | → indicators（by code） |
| `peer_values` | 同儕值 | → indicators |
| `tcpi_benchmarks` | TCPI 標竿 | → indicators |
| `alerts` | 異常警示 | → indicators |

### 匯入（apps.imports）

| 資料表 | 說明 |
|-------|------|
| `import_logs` | 匯入紀錄 |
| `matching_rules` | Excel 名稱 → 指標代碼比對記憶 |

### 帳號（apps.accounts）

| 資料表 | 說明 |
|-------|------|
| `auth_users` | 使用者（含角色陣列） |

### 填報系統（apps.entry）

| 資料表 | 說明 | 主要關聯 |
|-------|------|---------|
| `entry_campuses` | 院區（新竹 / 竹北 / 竹東） | → users, assignments, reports |
| `entry_categories` | 填報面向（HA01-HA10） | → reports |
| `entry_assignments` | 指標負責人指派 | → users, campuses |
| `entry_monthly_reports` | 月報表頭 | → campuses, categories, entries |
| `entry_indicator_entries` | 指標數據 | → monthly_reports |
| `entry_ha10_sub_entries` | HA10 子類別 | → indicator_entries |
| `entry_exclusion_reasons` | 排除理由預設選項 | → case_records |
| `entry_case_records` | 個案紀錄（個案清單路徑） | → indicator_entries, exclusion_reasons |
| `entry_audit_logs` | 欄位級修改紀錄 | → indicator_entries |
| `entry_deadline_settings` | 填報截止日 | - |
| `entry_import_batches` | 填報系統匯入批次 | → campuses |
| `entry_data_source_configs` | HIS 資料來源設定 | - |
| `entry_his_field_mappings` | HIS 欄位對應 | → data_source_configs |

---

## 🎯 指標資料性質（data_nature）

對應 SPC 管制圖的自動選型：

| 資料性質 | 說明 | 典型單位 | 管制圖 |
|---------|------|---------|--------|
| `binomial_rate` | 二項比率 | % | P 圖 |
| `poisson_rate` | Poisson 密度 | ‰（千人日） | U 圖 |
| `continuous` | 連續型 / 計數 | 件、日、比值 | I-MR 圖 |

### 方向性（direction）

| 值 | 說明 |
|----|------|
| `lower` | 越低越好（大多數不良事件率） |
| `higher` | 越高越好（手部衛生、抗生素及時給予） |
| `monitor` | 僅監測，無絕對好壞（如平均住院日） |

### 狀態燈號（IndicatorStatus）

| 狀態 | 中文 | 顏色 |
|------|------|------|
| `excellent` | 卓越 | 藍 `#2563EB` |
| `good` | 良好 | 綠 `#16A34A` |
| `watch` | 留意 | 黃 `#CA8A04` |
| `warning` | 注意 | 橘 `#EA580C` |
| `alert` | 警示 | 紅 `#DC2626` |
| `neutral` | 監測中 | 灰 `#9CA3AF` |

### 異常機制（AnomalyMechanism）

| 機制 | 說明 |
|------|------|
| `control_chart` | SPC 管制圖規則（Nelson Rule） |
| `monthly_change` | 月增減變動 |
| `peer_comparison` | 同儕 / 標竿比較 |

---

## 🗃️ 詳細表格結構

### indicators（指標元資料）⭐ 核心表

```python
class Indicator(models.Model):
    code          = CharField(max_length=20, unique=True)       # "HA01-01"
    name          = CharField(max_length=200)
    category      = CharField(max_length=20, choices=Category)  # "整體照護"
    unit          = CharField(choices=IndicatorUnit)            # percent/permille/count/ratio
    direction     = CharField(choices=Direction)                # lower/higher/monitor
    data_nature   = CharField(choices=DataNature,
                              default="continuous")             # binomial_rate/poisson_rate/continuous
    is_quarterly  = BooleanField(default=False)                 # 本身就是季指標
    is_active     = BooleanField(default=True)
    source        = CharField(choices=[("preset","預設"),("custom","自訂")])
    aliases       = JSONField(default=list)                     # Excel 別名清單（模糊比對用）
    campuses      = JSONField(default=list)                     # 適用院區清單
    formula       = TextField(blank=True)                       # 計算公式說明
    description   = TextField(blank=True)
    has_denominator = BooleanField(default=True)
    entry_mode    = CharField(choices=[("manual","手動"),
                                       ("case_list","個案清單審查")])
    # 挑戰平均值模式（吳文祥教授 SPC 範本同名功能）
    target_mode   = BooleanField(default=False)
    target_value  = FloatField(null=True, blank=True)
    created_at    = DateTimeField(auto_now_add=True)
    updated_at    = DateTimeField(auto_now=True)

    class Meta:
        db_table = "indicators"
        ordering = ["code"]
```

> **挑戰平均值模式**：啟用後，以 `target_value` 取代統計算出的 p̄/ū/X̄ 作為 CL，UCL/LCL 隨之以目標值重新計算。

---

### data_points（月份資料點）⭐ 核心表

```python
class DataPoint(models.Model):
    indicator     = FK(Indicator, to_field="code",
                       db_column="indicator_code")
    campus        = CharField(choices=Campus)      # 竹北/竹東/新竹
    year          = IntegerField()                 # 民國年
    month         = IntegerField()                 # 1-12
    value         = FloatField(null=True)
    numerator     = IntegerField(null=True)
    denominator   = IntegerField(null=True)
    import_log    = FK("imports.ImportLog", on_delete=SET_NULL, null=True)
    created_at    = DateTimeField(auto_now_add=True)
    updated_at    = DateTimeField(auto_now=True)

    class Meta:
        db_table = "data_points"
        unique_together = [("indicator", "campus", "year", "month")]
        indexes = [Index(fields=["indicator", "campus", "year"])]
```

---

### yearly_summaries（年度彙總）

```python
class YearlySummary(models.Model):
    indicator              = FK(Indicator, to_field="code")
    campus                 = CharField(choices=Campus)
    year                   = IntegerField()                # 民國年
    average                = FloatField(null=True)        # 年平均值（分母加權）
    benchmark_regional     = FloatField(null=True)        # 區域醫院標竿
    benchmark_district     = FloatField(null=True)        # 地區醫院標竿
    import_log             = FK("imports.ImportLog", null=True)
    created_at, updated_at
    
    class Meta:
        db_table = "yearly_summaries"
        unique_together = [("indicator", "campus", "year")]
```

---

### tcpi_benchmarks（TCPI 標竿）

```python
class TCPIBenchmark(models.Model):
    indicator          = FK(Indicator, to_field="code")
    tcpi_name          = CharField(max_length=200)          # TCPI 原始名稱
    year               = IntegerField()                     # 民國年
    medical_center     = FloatField(null=True)             # 醫學中心同儕值 → 新竹用
    regional_hospital  = FloatField(null=True)             # 區域醫院同儕值 → 竹北用
    district_hospital  = FloatField(null=True)             # 地區醫院同儕值 → 竹東用
    imported_at        = DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = "tcpi_benchmarks"
        unique_together = [("indicator", "year")]
```

> **院區對應**：`新竹 → medical_center`、`竹北 → regional_hospital`、`竹東 → district_hospital`（`竹東` 若無地區值則 fallback 區域值）。

---

### alerts（異常警示）

```python
class Alert(models.Model):
    indicator     = FK(Indicator, to_field="code")
    campus        = CharField(choices=Campus)
    year          = IntegerField()
    month         = IntegerField()
    mechanism     = CharField(choices=AnomalyMechanism)   # control_chart/monthly_change/peer_comparison
    rule          = CharField(max_length=50, blank=True)  # Nelson Rule 編號等
    severity      = CharField(choices=IndicatorStatus)
    message       = CharField(max_length=500)
    acknowledged  = BooleanField(default=False)
    created_at, updated_at
    
    class Meta:
        db_table = "alerts"
        indexes = [
            Index(fields=["indicator", "campus", "year", "month"]),
            Index(fields=["severity"]),
            Index(fields=["acknowledged"]),
        ]
```

> ⚠️ 更新 `Indicator.target_mode` / `target_value` 時需呼叫 `_refresh_indicator_alerts()`，該指標所有院區的 alerts 會先 DELETE 再重算。

---

### import_logs（匯入紀錄）

```python
class ImportLog(models.Model):
    file_name              = CharField(max_length=255)
    file_size              = IntegerField()
    sheets_processed       = JSONField(default=list)      # ["115年竹北", ...]
    data_points_new        = IntegerField(default=0)
    data_points_updated    = IntegerField(default=0)
    data_points_unchanged  = IntegerField(default=0)
    revisions_detected     = IntegerField(default=0)
    errors                 = JSONField(default=list)      # 警告 / 錯誤訊息陣列
    uploaded_file          = FileField(upload_to="imports/%Y/%m/", blank=True)
    created_at, updated_at
    
    class Meta:
        db_table = "import_logs"
        ordering = ["-created_at"]
```

---

### matching_rules（名稱比對記憶）

```python
class MatchingRule(models.Model):
    excel_name        = CharField(max_length=200)          # 使用者 Excel 原文
    normalized_name   = CharField(max_length=200, db_index=True)
    indicator_code    = CharField(max_length=20, db_index=True)
    confirmed_at      = DateTimeField(auto_now_add=True)
    created_at, updated_at

    class Meta:
        db_table = "matching_rules"
```

> 使用者在匯入精靈中確認的「Excel 名稱 → 指標代碼」對應，下次匯入自動套用。

---

### auth_users（使用者）

```python
class User(AbstractUser):
    username              = CharField(blank=True)          # 保留但非必填
    employee_id           = CharField(max_length=20, unique=True)  # 登入識別
    full_name             = CharField(max_length=50)
    campus                = FK("entry.Campus", null=True)  # 所屬院區
    roles                 = JSONField(default=list)       # ["reporter","reviewer"]
    must_change_password  = BooleanField(default=True)

    USERNAME_FIELD = "employee_id"
    REQUIRED_FIELDS = ["full_name", "email"]
    
    class Meta:
        db_table = "auth_users"
```

**角色清單**（`UserRole`）：

| 值 | 說明 |
|----|------|
| `reporter` | 指標填報者 |
| `reviewer` | 品管中心審核者 |
| `admin` | 系統管理員 |

---

### entry_campuses（院區）

```python
class Campus(models.Model):
    code              = CharField(max_length=20, unique=True)   # "hsinchu"/"zhubei"/"zhudong"
    name              = CharField(max_length=50)                # "新竹"/"竹北"/"竹東"
    benchmark_level   = CharField(choices=BenchmarkLevel)       # medical_center/regional/district
    is_active         = BooleanField(default=True)
    
    class Meta:
        db_table = "entry_campuses"
        ordering = ["name"]
```

---

### entry_categories（填報面向）

```python
class ReportCategory(models.Model):
    code         = CharField(max_length=20, unique=True)    # "HA01"
    name         = CharField(max_length=100)                # "整體住院照護"
    sort_order   = IntegerField()
    color        = CharField(max_length=7, default="#6B7280")

    class Meta:
        db_table = "entry_categories"
        ordering = ["sort_order"]
```

---

### entry_assignments（指標負責人指派）

```python
class IndicatorAssignment(models.Model):
    indicator_code   = CharField(max_length=20, db_index=True)
    campus           = FK(Campus)
    user             = FK(User, related_name="assignments")
    role             = CharField(choices=AssignmentRole,
                                 default=PRIMARY)          # primary/deputy
    effective_from   = DateField()
    effective_to     = DateField(null=True)                # null = 現行有效
    created_by       = FK(User, null=True,
                          related_name="created_assignments")
    created_at
    
    class Meta:
        db_table = "entry_assignments"
        indexes = [Index(fields=["indicator_code", "campus", "effective_to"])]
```

> **生效邏輯**：查詢現行負責人時 filter `effective_from <= today AND (effective_to IS NULL OR effective_to > today)`。

---

### entry_monthly_reports（月報表頭）

```python
class MonthlyReport(models.Model):
    campus            = FK(Campus)
    year              = IntegerField()                         # 民國年
    month             = IntegerField()                         # 1-12
    category          = FK(ReportCategory)
    status            = CharField(choices=ReportStatus,
                                  default=UNFILLED)
    submitted_at, submitted_by
    reviewed_at, reviewed_by
    approved_at, approved_by
    finalized_at, finalized_by
    rejection_reason  = TextField(blank=True)
    is_late           = BooleanField(default=False)
    
    class Meta:
        db_table = "entry_monthly_reports"
        unique_together = [("campus", "year", "month", "category")]
```

**狀態流**（`ReportStatus`）：
```
unfilled → draft → submitted → approved → finalized
                      ↑            ↓
                      └── rejected ┘（退回重填）
```

| 狀態 | 說明 |
|------|------|
| `unfilled` | 未填 |
| `draft` | 草稿 |
| `submitted` | 已送審 |
| `approved` | 已核准 |
| `finalized` | 已送出（鎖定，需 unlock 才能改） |

---

### entry_indicator_entries（指標數據）

```python
class IndicatorEntry(models.Model):
    report             = FK(MonthlyReport, related_name="entries")
    indicator_code     = CharField(max_length=20, db_index=True)
    numerator          = DecimalField(max_digits=12, decimal_places=2, null=True)
    denominator        = DecimalField(max_digits=12, decimal_places=2, null=True)
    value              = DecimalField(max_digits=12, decimal_places=6, null=True)
    # 個案清單路徑專用
    raw_numerator      = IntegerField(null=True)              # 排除前分子
    raw_denominator    = IntegerField(null=True)              # 排除前分母
    exclusion_count    = IntegerField(default=0)
    note               = TextField(blank=True)
    filled_by          = FK(User, null=True,
                            related_name="filled_entries")
    filled_at          = DateTimeField(null=True)
    data_source        = CharField(choices=DataSource,
                                   default=MANUAL)            # manual/excel/his
    import_batch       = FK("ImportBatch", null=True)
    
    class Meta:
        db_table = "entry_indicator_entries"
        unique_together = [("report", "indicator_code")]
```

---

### entry_ha10_sub_entries（HA10 子類別）

```python
class HA10SubEntry(models.Model):
    entry       = FK(IndicatorEntry, related_name="sub_entries")
    sub_code    = CharField(max_length=20)                # "HA10-10-01" ~ "HA10-10-13"
    sub_name    = CharField(max_length=100)
    value       = DecimalField(max_digits=10, decimal_places=2, null=True)
    
    class Meta:
        db_table = "entry_ha10_sub_entries"
        unique_together = [("entry", "sub_code")]
```

---

### entry_case_records（個案紀錄）⭐ 個案清單路徑

```python
class CaseRecord(models.Model):
    entry                = FK(IndicatorEntry, related_name="case_records")
    case_role            = CharField(choices=[("numerator","分子群"),
                                              ("denominator","分母群")])
    his_raw_data         = JSONField(default=dict)
    # 典型欄位：chart_no, admission_date, discharge_date, outcome, dept, ward, icd_codes
    is_excluded          = BooleanField(default=False)
    excluded_by          = FK(User, null=True,
                              related_name="excluded_cases")
    excluded_at          = DateTimeField(null=True)
    exclusion_reason     = FK(ExclusionReason, null=True)
    exclusion_note       = TextField(blank=True)
    reviewer_approved    = BooleanField(null=True)         # null=未審核 / True=同意 / False=駁回
    reviewer_note        = TextField(blank=True)
    created_at
    
    class Meta:
        db_table = "entry_case_records"
        indexes = [Index(fields=["entry", "is_excluded"])]
```

---

### entry_exclusion_reasons（排除理由）

```python
class ExclusionReason(models.Model):
    code          = CharField(max_length=20, unique=True)
    name          = CharField(max_length=100)
    description   = TextField(blank=True)
    sort_order    = IntegerField(default=0)
    is_active     = BooleanField(default=True)

    class Meta:
        db_table = "entry_exclusion_reasons"
        ordering = ["sort_order"]
```

---

### entry_audit_logs（欄位級修改紀錄）

```python
class EntryAuditLog(models.Model):
    entry         = FK(IndicatorEntry, related_name="audit_logs")
    field_name    = CharField(max_length=50)       # "numerator"/"denominator"/"value"
    old_value     = CharField(max_length=100)
    new_value     = CharField(max_length=100)
    changed_by    = FK(User)
    changed_at    = DateTimeField(auto_now_add=True)
    reason        = TextField(blank=True)
    
    class Meta:
        db_table = "entry_audit_logs"
        ordering = ["-changed_at"]
```

---

### entry_deadline_settings（填報截止日）

```python
class DeadlineSetting(models.Model):
    year           = IntegerField()
    month          = IntegerField()
    deadline_day   = IntegerField(default=10)        # 每月幾號
    note           = CharField(max_length=200, blank=True)   # "春節延長" 等

    class Meta:
        db_table = "entry_deadline_settings"
        unique_together = [("year", "month")]
```

---

### entry_import_batches（填報系統匯入批次）

```python
class ImportBatch(models.Model):
    source_type    = CharField(choices=[("excel","Excel 匯入"),
                                        ("his","HIS 自動匯入")])
    source_name    = CharField(max_length=200)             # 檔名或 HIS 系統名稱
    campus         = FK(Campus)
    year, month
    status         = CharField(choices=ImportBatchStatus,
                               default=PENDING)            # pending/preview/confirmed/failed
    imported_by    = FK(User)
    imported_at    = DateTimeField(auto_now_add=True)
    record_count   = IntegerField(default=0)
    error_log      = TextField(blank=True)
    
    class Meta:
        db_table = "entry_import_batches"
        ordering = ["-imported_at"]
```

---

### entry_data_source_configs / entry_his_field_mappings（HIS 串接預留）

```python
class DataSourceConfig(models.Model):
    name               = CharField(max_length=100, unique=True)   # "HIS-感控系統"
    source_type        = CharField(choices=[
                             ("his_api","HIS REST API"),
                             ("his_csv","HIS CSV 匯出"),
                             ("his_db_view","HIS DB View"),
                         ])
    connection_config  = JSONField(default=dict)
    schedule           = CharField(max_length=50, blank=True)      # cron expression
    is_active          = BooleanField(default=False)
    last_run_at, last_run_status
    created_at
    
    class Meta:
        db_table = "entry_data_source_configs"


class HISFieldMapping(models.Model):
    data_source            = FK(DataSourceConfig, related_name="mappings")
    indicator_code         = CharField(max_length=20)
    campus                 = FK(Campus)
    his_numerator_field    = CharField(max_length=200)
    his_denominator_field  = CharField(max_length=200, blank=True)
    his_date_field         = CharField(max_length=200)
    transform_formula      = TextField(blank=True)
    is_active              = BooleanField(default=True)
    note                   = TextField(blank=True)
    
    class Meta:
        db_table = "entry_his_field_mappings"
        unique_together = [("data_source", "indicator_code", "campus")]
```

---

## 🔍 重要查詢邏輯

### 1. 同儕值 / 標竿值解析（依院區自動選用）

```python
def _get_peer_value(code: str, campus: str) -> float | None:
    # 優先 YearlySummary 的區域 / 地區標竿
    ys = YearlySummary.objects.filter(
        indicator_id=code, campus=campus,
    ).order_by("-year").first()
    if ys:
        if campus == "竹北" and ys.benchmark_regional is not None:
            return ys.benchmark_regional
        if campus == "竹東":
            return ys.benchmark_district or ys.benchmark_regional
    # 回退 TCPI
    tcpi = TCPIBenchmark.objects.filter(indicator_id=code).order_by("-year").first()
    if tcpi:
        if campus == "新竹":     return tcpi.medical_center
        if campus == "竹北":     return tcpi.regional_hospital
        if campus == "竹東":     return tcpi.district_hospital
    return None
```

### 2. 年均值（分母加權平均）

```python
# ❌ 錯誤：直接平均各月的 value
year_avg = sum(values) / len(values)

# ✅ 正確：以分母為權重做加權平均
with_den = [dp for dp in year_dps if dp.get("denominator") and dp["denominator"] > 0]
if with_den:
    den_sum = sum(dp["denominator"] for dp in with_den)
    year_avg = sum(dp["value"] * dp["denominator"] for dp in with_den) / den_sum
else:
    year_avg = sum(dp["value"] for dp in year_dps) / len(year_dps)
```

> 這對 `binomial_rate` / `poisson_rate` 指標尤其重要，簡單平均會在分母差距大時偏誤。

### 3. 異常 Alerts 重算（target_mode 變更時）

```python
def _refresh_indicator_alerts(ind: Indicator) -> None:
    campuses = DataPoint.objects.filter(indicator_id=ind.code).values_list("campus", flat=True).distinct()
    target = ind.target_value if ind.target_mode and ind.target_value is not None else None
    skip_cc = ind.code in SKIP_SPC_INDICATORS
    for campus in campuses:
        # ... 重跑 analyze_indicator()，DELETE 舊 alerts → INSERT 新 alerts
```

### 4. 現行有效指派查詢

```python
from django.utils import timezone
today = timezone.now().date()
IndicatorAssignment.objects.filter(
    indicator_code=code,
    campus=campus_obj,
    effective_from__lte=today,
).filter(
    Q(effective_to__isnull=True) | Q(effective_to__gt=today),
)
```

### 5. 季度彙總

```python
# 依資料性質選擇彙總方式
# binomial_rate / poisson_rate：分子/分母加總後重算比率
# continuous（加總型，如件數）：月值加總
# continuous（平均型，如平均住院日）：加權平均
from apps.analysis.services.aggregation import aggregate_to_quarterly
quarterly = aggregate_to_quarterly(monthly_data, ind.data_nature, ind.unit)
```

---

## 📊 資料統計（典型規模）

| 項目 | 數量 |
|------|------|
| 指標總數 | 55+ |
| 院區 | 3（新竹、竹北、竹東） |
| 每院區每年資料點 | ~55 指標 × 12 月 ≈ 660 筆 |
| 五年歷史資料 | ~9,900 筆 DataPoint |
| 分類面向 | 10（HA01-HA10） |
| TCPI 標竿 | 每指標每年一筆 |
