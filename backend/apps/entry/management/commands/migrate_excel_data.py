"""
歷史 Excel 資料遷移（§4.3）

將現有 DataPoint（從 Excel 匯入存入 IndexedDB→PostgreSQL）
遷移到填報系統的 IndicatorEntry 結構，status = finalized。

Usage:
    python manage.py migrate_excel_data
    python manage.py migrate_excel_data --dry-run   # 不寫入，只顯示統計
    python manage.py migrate_excel_data --campus zhubei  # 指定院區
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.entry.models import (
    Campus,
    DataSource,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.indicators.models import Campus as CampusChoice, DataPoint, Indicator

# 舊院區中文名稱 → 新 Campus code
CAMPUS_MAPPING = {
    "竹北": "zhubei",
    "竹東": "zhudong",
    "新竹": "hsinchu",
}

# 舊分類名稱 → ReportCategory code（依指標代碼前綴推導）
def _indicator_to_category_code(indicator_code: str) -> str:
    return indicator_code.split("-")[0]


class Command(BaseCommand):
    help = "將歷史 DataPoint 遷移至填報系統 IndicatorEntry（status=finalized）"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="不寫入，只統計")
        parser.add_argument("--campus", type=str, help="只遷移特定院區（code）")
        parser.add_argument("--year-from", type=int, default=110, help="起始民國年")
        parser.add_argument("--year-to", type=int, default=114, help="結束民國年")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        campus_filter = options.get("campus")
        year_from = options["year_from"]
        year_to = options["year_to"]

        # 取得 ReportCategory 對應表
        categories = {c.code: c for c in ReportCategory.objects.all()}
        if not categories:
            self.stderr.write("❌ 尚無 ReportCategory 資料，請先執行 seed_entry_base")
            return

        # 取得 Campus 對應表
        campuses = {c.code: c for c in Campus.objects.all()}

        # 取得 DataPoint
        dp_qs = DataPoint.objects.filter(
            year__gte=year_from,
            year__lte=year_to,
        ).select_related("indicator")

        if campus_filter:
            # 舊的 campus 欄位是中文，需要反轉 CAMPUS_MAPPING
            old_name = {v: k for k, v in CAMPUS_MAPPING.items()}.get(campus_filter, campus_filter)
            dp_qs = dp_qs.filter(campus=old_name)

        total = dp_qs.count()
        self.stdout.write(f"找到 {total} 筆歷史 DataPoint")

        created = updated = skipped = 0

        with transaction.atomic():
            for dp in dp_qs.iterator(chunk_size=500):
                campus_code = CAMPUS_MAPPING.get(dp.campus)
                if not campus_code or campus_code not in campuses:
                    skipped += 1
                    continue

                campus_obj = campuses[campus_code]
                indicator_code = dp.indicator.code
                cat_code = _indicator_to_category_code(indicator_code)
                category = categories.get(cat_code)
                if not category:
                    skipped += 1
                    continue

                # 取得或建立 MonthlyReport（finalized）
                report, report_created = MonthlyReport.objects.get_or_create(
                    campus=campus_obj,
                    year=dp.year,
                    month=dp.month,
                    category=category,
                    defaults={
                        "status": ReportStatus.FINALIZED,
                        "finalized_at": timezone.now(),
                    },
                )

                # 確保 finalized
                if report.status != ReportStatus.FINALIZED and not dry_run:
                    report.status = ReportStatus.FINALIZED
                    report.save(update_fields=["status"])

                if dry_run:
                    created += 1
                    continue

                # 計算 value
                try:
                    ind = Indicator.objects.get(code=indicator_code)
                    unit = ind.unit
                    has_den = ind.has_denominator
                except Indicator.DoesNotExist:
                    unit, has_den = "percent", True

                num = Decimal(str(dp.numerator)) if dp.numerator is not None else None
                den = Decimal(str(dp.denominator)) if dp.denominator is not None else None
                value = Decimal(str(dp.value)) if dp.value is not None else None

                entry, was_created = IndicatorEntry.objects.update_or_create(
                    report=report,
                    indicator_code=indicator_code,
                    defaults={
                        "numerator": num,
                        "denominator": den,
                        "value": value,
                        "data_source": DataSource.EXCEL,
                    },
                )

                if was_created:
                    created += 1
                else:
                    updated += 1

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    f"[Dry Run] 預計建立 {created} 筆，跳過 {skipped} 筆（不寫入）"
                ))
                raise SystemExit(0)  # rollback

        self.stdout.write(self.style.SUCCESS(
            f"遷移完成：建立 {created} 筆，更新 {updated} 筆，跳過 {skipped} 筆"
        ))
        self.stdout.write("請執行數據驗證：比對原始 DataPoint 與新 IndicatorEntry 數值是否一致")
