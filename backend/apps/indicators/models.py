"""
QIP 監測指標資料模型

資料表設計遵循品管中心資訊化技術堆疊規範：
- 表名：小寫英文 + 底線分隔，複數形式
- 主鍵：id (BigAutoField)
- 時間欄位：created_at, updated_at
- Schema：qip
"""
from django.db import models


class Campus(models.TextChoices):
    ZHUBEI = "竹北", "竹北（區域醫院）"
    ZHUDONG = "竹東", "竹東（地區醫院）"
    HSINCHU = "新竹", "新竹（醫學中心）"


class Category(models.TextChoices):
    OVERALL = "整體照護", "整體照護"
    ICU = "加護照護", "加護照護"
    SURGICAL = "手術照護", "手術照護"
    OBSTETRIC = "產科照護", "產科照護"
    EMERGENCY = "急診照護", "急診照護"
    SPECIALTY = "重點照護", "重點照護"
    INFECTION = "感染管制", "感染管制"
    MEDICATION = "用藥安全", "用藥安全"
    RESPIRATORY = "呼吸照護", "呼吸照護"
    OPERATIONS = "經營管理", "經營管理"


class IndicatorUnit(models.TextChoices):
    PERCENT = "percent", "百分比 (%)"
    PERMILLE = "permille", "千分比 (‰)"
    COUNT = "count", "件數"
    RATIO = "ratio", "比值"


class Direction(models.TextChoices):
    LOWER = "lower", "越低越好"
    HIGHER = "higher", "越高越好"
    MONITOR = "monitor", "監測"


class DataNature(models.TextChoices):
    CONTINUOUS = "continuous", "連續型（計數）"
    BINOMIAL_RATE = "binomial_rate", "二項比率"
    POISSON_RATE = "poisson_rate", "Poisson 密度"


class IndicatorStatus(models.TextChoices):
    EXCELLENT = "excellent", "卓越"
    GOOD = "good", "良好"
    WATCH = "watch", "留意"
    WARNING = "warning", "注意"
    ALERT = "alert", "警示"
    NEUTRAL = "neutral", "監測中"


class AnomalyMechanism(models.TextChoices):
    CONTROL_CHART = "control_chart", "管制圖"
    MONTHLY_CHANGE = "monthly_change", "月增減"
    PEER_COMPARISON = "peer_comparison", "同儕比較"


class Indicator(models.Model):
    """指標元資料"""
    code = models.CharField("指標代碼", max_length=20, unique=True, db_index=True)
    name = models.CharField("指標名稱", max_length=200)
    category = models.CharField("類別", max_length=20, choices=Category.choices)
    unit = models.CharField("單位", max_length=20, choices=IndicatorUnit.choices)
    direction = models.CharField("方向", max_length=10, choices=Direction.choices)
    data_nature = models.CharField("資料性質", max_length=20, choices=DataNature.choices, default="continuous")
    is_quarterly = models.BooleanField("季指標", default=False)
    is_active = models.BooleanField("啟用", default=True)
    source = models.CharField("來源", max_length=10, choices=[("preset", "預設"), ("custom", "自訂")], default="preset")
    aliases = models.JSONField("別名列表", default=list, blank=True)
    campuses = models.JSONField("適用院區", default=list)
    formula = models.TextField("計算公式", blank=True, default="")
    description = models.TextField("說明", blank=True, default="")
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "indicators"
        verbose_name = "指標"
        verbose_name_plural = "指標"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} {self.name}"


class DataPoint(models.Model):
    """月份資料點"""
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name="data_points", to_field="code",
                                  db_column="indicator_code")
    campus = models.CharField("院區", max_length=10, choices=Campus.choices)
    year = models.IntegerField("年度（民國年）")
    month = models.IntegerField("月份")
    value = models.FloatField("值", null=True, blank=True)
    numerator = models.IntegerField("分子", null=True, blank=True)
    denominator = models.IntegerField("分母", null=True, blank=True)
    import_log = models.ForeignKey("imports.ImportLog", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "data_points"
        verbose_name = "資料點"
        verbose_name_plural = "資料點"
        unique_together = [("indicator", "campus", "year", "month")]
        indexes = [
            models.Index(fields=["indicator", "campus", "year"]),
        ]

    def __str__(self):
        return f"{self.indicator_id} {self.campus} {self.year}/{self.month:02d}: {self.value}"


class YearlySummary(models.Model):
    """年度彙總"""
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name="yearly_summaries",
                                  to_field="code", db_column="indicator_code")
    campus = models.CharField("院區", max_length=10, choices=Campus.choices)
    year = models.IntegerField("年度（民國年）")
    average = models.FloatField("年平均值", null=True, blank=True)
    benchmark_regional = models.FloatField("區域醫院標竿", null=True, blank=True)
    benchmark_district = models.FloatField("地區醫院標竿", null=True, blank=True)
    import_log = models.ForeignKey("imports.ImportLog", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "yearly_summaries"
        verbose_name = "年度彙總"
        verbose_name_plural = "年度彙總"
        unique_together = [("indicator", "campus", "year")]

    def __str__(self):
        return f"{self.indicator_id} {self.campus} {self.year}年 avg={self.average}"


class PeerValue(models.Model):
    """同儕值"""
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name="peer_values",
                                  to_field="code", db_column="indicator_code")
    campus = models.CharField("院區", max_length=10, choices=Campus.choices)
    value = models.FloatField("同儕值")
    year = models.IntegerField("年度", null=True, blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "peer_values"
        verbose_name = "同儕值"
        verbose_name_plural = "同儕值"
        unique_together = [("indicator", "campus")]

    def __str__(self):
        return f"{self.indicator_id} {self.campus}: {self.value}"


class TCPIBenchmark(models.Model):
    """TCPI 標竿值"""
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name="tcpi_benchmarks",
                                  to_field="code", db_column="indicator_code")
    tcpi_name = models.CharField("TCPI 指標名稱", max_length=200)
    year = models.IntegerField("TCPI 年度（民國年）")
    medical_center = models.FloatField("醫學中心同儕值", null=True, blank=True)
    regional_hospital = models.FloatField("區域醫院同儕值", null=True, blank=True)
    district_hospital = models.FloatField("地區醫院同儕值", null=True, blank=True)
    imported_at = models.DateTimeField("匯入時間", auto_now_add=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "tcpi_benchmarks"
        verbose_name = "TCPI 標竿"
        verbose_name_plural = "TCPI 標竿"
        unique_together = [("indicator", "year")]
        indexes = [
            models.Index(fields=["indicator", "year"]),
        ]

    def __str__(self):
        return f"{self.indicator_id} {self.year}年 TCPI"


class Alert(models.Model):
    """異常偵測結果"""
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name="alerts",
                                  to_field="code", db_column="indicator_code")
    campus = models.CharField("院區", max_length=10, choices=Campus.choices)
    year = models.IntegerField("年度")
    month = models.IntegerField("月份")
    mechanism = models.CharField("偵測機制", max_length=20, choices=AnomalyMechanism.choices)
    rule = models.CharField("規則", max_length=50, blank=True, default="")
    severity = models.CharField("嚴重度", max_length=10, choices=IndicatorStatus.choices)
    message = models.CharField("訊息", max_length=500)
    acknowledged = models.BooleanField("已確認", default=False)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "alerts"
        verbose_name = "異常警示"
        verbose_name_plural = "異常警示"
        indexes = [
            models.Index(fields=["indicator", "campus", "year", "month"]),
            models.Index(fields=["severity"]),
            models.Index(fields=["acknowledged"]),
        ]

    def __str__(self):
        return f"{self.indicator_id} {self.campus} {self.year}/{self.month:02d} [{self.severity}]"
