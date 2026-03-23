from django.db import models


class ImportLog(models.Model):
    """匯入紀錄"""
    file_name = models.CharField("檔案名稱", max_length=255)
    file_size = models.IntegerField("檔案大小 (bytes)")
    sheets_processed = models.JSONField("處理的工作表", default=list)
    data_points_new = models.IntegerField("新增資料點", default=0)
    data_points_updated = models.IntegerField("更新資料點", default=0)
    data_points_unchanged = models.IntegerField("未變更資料點", default=0)
    revisions_detected = models.IntegerField("偵測到的修訂", default=0)
    errors = models.JSONField("錯誤訊息", default=list)
    uploaded_file = models.FileField("上傳檔案", upload_to="imports/%Y/%m/", blank=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "import_logs"
        verbose_name = "匯入紀錄"
        verbose_name_plural = "匯入紀錄"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.file_name} ({self.created_at:%Y-%m-%d %H:%M})"


class MatchingRule(models.Model):
    """名稱比對記憶"""
    excel_name = models.CharField("Excel 名稱", max_length=200)
    normalized_name = models.CharField("標準化名稱", max_length=200, db_index=True)
    indicator_code = models.CharField("指標代碼", max_length=20, db_index=True)
    confirmed_at = models.DateTimeField("確認時間", auto_now_add=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "matching_rules"
        verbose_name = "比對規則"
        verbose_name_plural = "比對規則"

    def __str__(self):
        return f"{self.excel_name} → {self.indicator_code}"
