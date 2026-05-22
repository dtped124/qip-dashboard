from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("indicators", "0003_indicator_target_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="DataPointSubcategory",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("parent_code", models.CharField(max_length=10, verbose_name="主指標代碼")),
                ("subcategory_code", models.CharField(max_length=15, verbose_name="子分類代碼")),
                ("campus", models.CharField(choices=[("竹北", "竹北"), ("竹東", "竹東"), ("新竹", "新竹")], max_length=10, verbose_name="院區")),
                ("year", models.IntegerField(verbose_name="年度（民國年）")),
                ("month", models.IntegerField(verbose_name="月份")),
                ("value", models.IntegerField(blank=True, null=True, verbose_name="計數")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="建立時間")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新時間")),
            ],
            options={
                "verbose_name": "子分類資料點",
                "verbose_name_plural": "子分類資料點",
                "db_table": "data_point_subcategories",
                "unique_together": {("subcategory_code", "campus", "year", "month")},
                "indexes": [
                    models.Index(fields=["parent_code", "campus", "year", "month"], name="data_point__parent__52d5e3_idx"),
                ],
            },
        ),
    ]
