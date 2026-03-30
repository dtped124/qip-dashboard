import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        # accounts.User 必須先存在（0001_initial，不含 campus FK）
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── Campus ──────────────────────────────────────────────
        migrations.CreateModel(
            name="Campus",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=20, unique=True, verbose_name="院區代碼")),
                ("name", models.CharField(max_length=50, verbose_name="院區名稱")),
                ("benchmark_level", models.CharField(
                    choices=[("medical_center", "醫學中心"), ("regional", "區域醫院"), ("district", "地區醫院")],
                    max_length=20, verbose_name="標竿層級",
                )),
                ("is_active", models.BooleanField(default=True, verbose_name="啟用")),
            ],
            options={"db_table": "entry_campuses", "verbose_name": "院區", "ordering": ["name"]},
        ),

        # ── ReportCategory ──────────────────────────────────────
        migrations.CreateModel(
            name="ReportCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=20, unique=True, verbose_name="面向代碼")),
                ("name", models.CharField(max_length=100, verbose_name="面向名稱")),
                ("sort_order", models.IntegerField(verbose_name="排序")),
                ("color", models.CharField(default="#6B7280", max_length=7, verbose_name="代表色")),
            ],
            options={"db_table": "entry_categories", "verbose_name": "填報面向", "ordering": ["sort_order"]},
        ),

        # ── ExclusionReason ─────────────────────────────────────
        migrations.CreateModel(
            name="ExclusionReason",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=20, unique=True, verbose_name="代碼")),
                ("name", models.CharField(max_length=100, verbose_name="名稱")),
                ("description", models.TextField(blank=True, verbose_name="說明")),
                ("sort_order", models.IntegerField(default=0, verbose_name="排序")),
                ("is_active", models.BooleanField(default=True, verbose_name="啟用")),
            ],
            options={"db_table": "entry_exclusion_reasons", "verbose_name": "排除理由", "ordering": ["sort_order"]},
        ),

        # ── DataSourceConfig ────────────────────────────────────
        migrations.CreateModel(
            name="DataSourceConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True, verbose_name="名稱")),
                ("source_type", models.CharField(
                    choices=[("his_api", "HIS REST API"), ("his_csv", "HIS CSV 匯出"), ("his_db_view", "HIS DB View")],
                    max_length=20, verbose_name="來源類型",
                )),
                ("connection_config", models.JSONField(default=dict, verbose_name="連線設定")),
                ("schedule", models.CharField(blank=True, max_length=50, verbose_name="排程（cron）")),
                ("is_active", models.BooleanField(default=False, verbose_name="啟用")),
                ("last_run_at", models.DateTimeField(blank=True, null=True, verbose_name="最後執行時間")),
                ("last_run_status", models.CharField(blank=True, max_length=20, verbose_name="最後執行狀態")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="建立時間")),
            ],
            options={"db_table": "entry_data_source_configs", "verbose_name": "資料來源設定"},
        ),

        # ── DeadlineSetting ─────────────────────────────────────
        migrations.CreateModel(
            name="DeadlineSetting",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.IntegerField(verbose_name="民國年")),
                ("month", models.IntegerField(verbose_name="月份")),
                ("deadline_day", models.IntegerField(default=10, verbose_name="截止日")),
                ("note", models.CharField(blank=True, max_length=200, verbose_name="備註")),
            ],
            options={"db_table": "entry_deadline_settings", "verbose_name": "截止日設定"},
        ),
        migrations.AlterUniqueTogether(
            name="deadlinesetting",
            unique_together={("year", "month")},
        ),

        # ── IndicatorAssignment ─────────────────────────────────
        migrations.CreateModel(
            name="IndicatorAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("indicator_code", models.CharField(db_index=True, max_length=20, verbose_name="指標代碼")),
                ("role", models.CharField(
                    choices=[("primary", "正職負責人"), ("deputy", "代理人")],
                    default="primary", max_length=10, verbose_name="職責",
                )),
                ("effective_from", models.DateField(verbose_name="生效起始日")),
                ("effective_to", models.DateField(blank=True, null=True, verbose_name="失效日")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="建立時間")),
                ("campus", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="entry.campus", verbose_name="院區")),
                ("created_by", models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="created_assignments",
                    to=settings.AUTH_USER_MODEL,
                    verbose_name="指派者",
                )),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="assignments",
                    to=settings.AUTH_USER_MODEL,
                    verbose_name="負責人",
                )),
            ],
            options={"db_table": "entry_assignments", "verbose_name": "指標負責人指派"},
        ),
        migrations.AddIndex(
            model_name="indicatorassignment",
            index=models.Index(fields=["indicator_code", "campus", "effective_to"], name="entry_assig_indicat_idx"),
        ),

        # ── ImportBatch ─────────────────────────────────────────
        migrations.CreateModel(
            name="ImportBatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_type", models.CharField(
                    choices=[("excel", "Excel 匯入"), ("his", "HIS 自動匯入")],
                    max_length=20, verbose_name="來源類型",
                )),
                ("source_name", models.CharField(max_length=200, verbose_name="來源名稱")),
                ("year", models.IntegerField(verbose_name="民國年")),
                ("month", models.IntegerField(verbose_name="月份")),
                ("status", models.CharField(
                    choices=[("pending", "待確認"), ("preview", "預覽中"), ("confirmed", "已確認"), ("failed", "失敗")],
                    default="pending", max_length=20, verbose_name="狀態",
                )),
                ("imported_at", models.DateTimeField(auto_now_add=True, verbose_name="匯入時間")),
                ("record_count", models.IntegerField(default=0, verbose_name="匯入筆數")),
                ("error_log", models.TextField(blank=True, verbose_name="錯誤訊息")),
                ("campus", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="entry.campus", verbose_name="院區")),
                ("imported_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    to=settings.AUTH_USER_MODEL,
                    verbose_name="匯入者",
                )),
            ],
            options={"db_table": "entry_import_batches", "verbose_name": "匯入批次", "ordering": ["-imported_at"]},
        ),

        # ── MonthlyReport ───────────────────────────────────────
        migrations.CreateModel(
            name="MonthlyReport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.IntegerField(verbose_name="民國年")),
                ("month", models.IntegerField(verbose_name="月份")),
                ("status", models.CharField(
                    choices=[("unfilled", "未填"), ("draft", "草稿"), ("submitted", "已送審"),
                             ("approved", "已核准"), ("finalized", "已送出")],
                    default="unfilled", max_length=20, verbose_name="狀態",
                )),
                ("submitted_at", models.DateTimeField(blank=True, null=True, verbose_name="送審時間")),
                ("reviewed_at", models.DateTimeField(blank=True, null=True, verbose_name="審核時間")),
                ("approved_at", models.DateTimeField(blank=True, null=True, verbose_name="核准時間")),
                ("finalized_at", models.DateTimeField(blank=True, null=True, verbose_name="送出時間")),
                ("rejection_reason", models.TextField(blank=True, verbose_name="退回理由")),
                ("is_late", models.BooleanField(default=False, verbose_name="逾期繳交")),
                ("campus", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="entry.campus", verbose_name="院區")),
                ("category", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="entry.reportcategory", verbose_name="面向")),
                ("submitted_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="submitted_reports",
                    to=settings.AUTH_USER_MODEL, verbose_name="送審者",
                )),
                ("reviewed_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="reviewed_reports",
                    to=settings.AUTH_USER_MODEL, verbose_name="審核者",
                )),
                ("approved_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="approved_reports",
                    to=settings.AUTH_USER_MODEL, verbose_name="核准者",
                )),
                ("finalized_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="finalized_reports",
                    to=settings.AUTH_USER_MODEL, verbose_name="送出者",
                )),
            ],
            options={"db_table": "entry_monthly_reports", "verbose_name": "月報"},
        ),
        migrations.AlterUniqueTogether(
            name="monthlyreport",
            unique_together={("campus", "year", "month", "category")},
        ),
        migrations.AddIndex(
            model_name="monthlyreport",
            index=models.Index(fields=["campus", "year", "month"], name="entry_month_campus_idx"),
        ),
        migrations.AddIndex(
            model_name="monthlyreport",
            index=models.Index(fields=["status"], name="entry_month_status_idx"),
        ),

        # ── IndicatorEntry ──────────────────────────────────────
        migrations.CreateModel(
            name="IndicatorEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("indicator_code", models.CharField(db_index=True, max_length=20, verbose_name="指標代碼")),
                ("numerator", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True, verbose_name="分子")),
                ("denominator", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True, verbose_name="分母")),
                ("value", models.DecimalField(blank=True, decimal_places=6, max_digits=12, null=True, verbose_name="計算值")),
                ("raw_numerator", models.IntegerField(blank=True, null=True, verbose_name="排除前分子")),
                ("raw_denominator", models.IntegerField(blank=True, null=True, verbose_name="排除前分母")),
                ("exclusion_count", models.IntegerField(default=0, verbose_name="排除個案數")),
                ("note", models.TextField(blank=True, verbose_name="填報備註")),
                ("filled_at", models.DateTimeField(blank=True, null=True, verbose_name="填報時間")),
                ("data_source", models.CharField(
                    choices=[("manual", "線上填報"), ("excel", "Excel 匯入"), ("his", "HIS 自動匯入")],
                    default="manual", max_length=20, verbose_name="資料來源",
                )),
                ("report", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="entries",
                    to="entry.monthlyreport", verbose_name="月報",
                )),
                ("filled_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="filled_entries",
                    to=settings.AUTH_USER_MODEL, verbose_name="填報者",
                )),
                ("import_batch", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to="entry.importbatch", verbose_name="匯入批次",
                )),
            ],
            options={"db_table": "entry_indicator_entries", "verbose_name": "指標數據"},
        ),
        migrations.AlterUniqueTogether(
            name="indicatorentry",
            unique_together={("report", "indicator_code")},
        ),

        # ── HA10SubEntry ────────────────────────────────────────
        migrations.CreateModel(
            name="HA10SubEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sub_code", models.CharField(max_length=20, verbose_name="子類別代碼")),
                ("sub_name", models.CharField(max_length=100, verbose_name="子類別名稱")),
                ("value", models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, verbose_name="數值")),
                ("entry", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="sub_entries",
                    to="entry.indicatorentry", verbose_name="指標數據",
                )),
            ],
            options={"db_table": "entry_ha10_sub_entries", "verbose_name": "HA10 子類別"},
        ),
        migrations.AlterUniqueTogether(
            name="ha10subentry",
            unique_together={("entry", "sub_code")},
        ),

        # ── CaseRecord ──────────────────────────────────────────
        migrations.CreateModel(
            name="CaseRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("case_role", models.CharField(
                    choices=[("numerator", "分子群"), ("denominator", "分母群")],
                    max_length=20, verbose_name="個案角色",
                )),
                ("his_raw_data", models.JSONField(default=dict, verbose_name="HIS 原始資料")),
                ("is_excluded", models.BooleanField(default=False, verbose_name="已排除")),
                ("excluded_at", models.DateTimeField(blank=True, null=True, verbose_name="排除時間")),
                ("exclusion_note", models.TextField(blank=True, verbose_name="補充說明")),
                ("reviewer_approved", models.BooleanField(null=True, verbose_name="品管中心同意排除")),
                ("reviewer_note", models.TextField(blank=True, verbose_name="品管中心意見")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="建立時間")),
                ("entry", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="case_records",
                    to="entry.indicatorentry", verbose_name="指標數據",
                )),
                ("excluded_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="excluded_cases",
                    to=settings.AUTH_USER_MODEL, verbose_name="排除者",
                )),
                ("exclusion_reason", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to="entry.exclusionreason", verbose_name="排除理由",
                )),
            ],
            options={"db_table": "entry_case_records", "verbose_name": "個案紀錄"},
        ),
        migrations.AddIndex(
            model_name="caserecord",
            index=models.Index(fields=["entry", "is_excluded"], name="entry_case_entry_idx"),
        ),

        # ── EntryAuditLog ───────────────────────────────────────
        migrations.CreateModel(
            name="EntryAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("field_name", models.CharField(max_length=50, verbose_name="欄位名稱")),
                ("old_value", models.CharField(max_length=100, verbose_name="原始值")),
                ("new_value", models.CharField(max_length=100, verbose_name="修改後值")),
                ("changed_at", models.DateTimeField(auto_now_add=True, verbose_name="修改時間")),
                ("reason", models.TextField(blank=True, verbose_name="修改理由")),
                ("changed_by", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    to=settings.AUTH_USER_MODEL, verbose_name="修改者",
                )),
                ("entry", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="audit_logs",
                    to="entry.indicatorentry", verbose_name="指標數據",
                )),
            ],
            options={"db_table": "entry_audit_logs", "verbose_name": "修改紀錄", "ordering": ["-changed_at"]},
        ),

        # ── HISFieldMapping ─────────────────────────────────────
        migrations.CreateModel(
            name="HISFieldMapping",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("indicator_code", models.CharField(max_length=20, verbose_name="指標代碼")),
                ("his_numerator_field", models.CharField(max_length=200, verbose_name="HIS 分子欄位")),
                ("his_denominator_field", models.CharField(blank=True, max_length=200, verbose_name="HIS 分母欄位")),
                ("his_date_field", models.CharField(max_length=200, verbose_name="HIS 日期欄位")),
                ("transform_formula", models.TextField(blank=True, verbose_name="轉換公式")),
                ("is_active", models.BooleanField(default=True, verbose_name="啟用")),
                ("note", models.TextField(blank=True, verbose_name="說明")),
                ("campus", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="entry.campus", verbose_name="院區")),
                ("data_source", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="mappings",
                    to="entry.datasourceconfig", verbose_name="資料來源",
                )),
            ],
            options={"db_table": "entry_his_field_mappings", "verbose_name": "HIS 欄位對應"},
        ),
        migrations.AlterUniqueTogether(
            name="hisfieldmapping",
            unique_together={("data_source", "indicator_code", "campus")},
        ),
    ]
