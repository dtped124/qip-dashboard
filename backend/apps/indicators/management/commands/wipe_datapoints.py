"""
清空 QIP 指標資料表，準備重新匯入。

用法：
  python manage.py wipe_datapoints                    # 互動確認後清空
  python manage.py wipe_datapoints --yes              # 跳過確認
  python manage.py wipe_datapoints --keep-alerts      # 保留 Alert（只清原始資料）
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.indicators.models import (
    Alert,
    DataPoint,
    DataPointSubcategory,
    YearlySummary,
)
from apps.imports.models import ImportLog


class Command(BaseCommand):
    help = "清空 DataPoint / DataPointSubcategory / YearlySummary / Alert / ImportLog"

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="跳過互動確認")
        parser.add_argument("--keep-alerts", action="store_true", help="保留 Alert 表")
        parser.add_argument("--keep-logs", action="store_true", help="保留 ImportLog 表")

    def handle(self, *args, **options):
        counts = {
            "DataPoint": DataPoint.objects.count(),
            "DataPointSubcategory": DataPointSubcategory.objects.count(),
            "YearlySummary": YearlySummary.objects.count(),
            "Alert": Alert.objects.count(),
            "ImportLog": ImportLog.objects.count(),
        }
        self.stdout.write("目前資料筆數：")
        for k, v in counts.items():
            self.stdout.write(f"  {k}: {v}")

        if not options["yes"]:
            confirm = input("\n要清空以上所有資料？輸入 yes 確認：")
            if confirm.strip().lower() != "yes":
                self.stdout.write(self.style.WARNING("已取消，未做任何變更。"))
                return

        with transaction.atomic():
            DataPoint.objects.all().delete()
            DataPointSubcategory.objects.all().delete()
            YearlySummary.objects.all().delete()
            if not options["keep_alerts"]:
                Alert.objects.all().delete()
            if not options["keep_logs"]:
                ImportLog.objects.all().delete()

        self.stdout.write(self.style.SUCCESS("[OK] 已清空。請到 /import 重新匯入資料。"))
