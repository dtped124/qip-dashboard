"""
載入預設指標元資料至資料庫

Usage:
    python manage.py seed_indicators
    python manage.py seed_indicators --clear  # 清除後重新載入
"""
from django.core.management.base import BaseCommand

from apps.indicators.constants import INDICATOR_META
from apps.indicators.models import Indicator


class Command(BaseCommand):
    help = "載入 55 筆預設 QIP 指標元資料至資料庫"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="清除所有預設指標後重新載入",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            deleted, _ = Indicator.objects.filter(source="preset").delete()
            self.stdout.write(f"已清除 {deleted} 筆預設指標")

        created = 0
        updated = 0

        for code, meta in INDICATOR_META.items():
            # 純計數型（data_nature="continuous"）無分母，直接填數值
            has_denominator = meta["data_nature"] != "continuous"

            obj, was_created = Indicator.objects.update_or_create(
                code=code,
                defaults={
                    "name": meta["name"],
                    "category": meta["category"],
                    "unit": meta["unit"],
                    "direction": meta["direction"],
                    "data_nature": meta["data_nature"],
                    "is_quarterly": meta["is_quarterly"],
                    "is_active": True,
                    "source": "preset",
                    "aliases": meta.get("aliases", []),
                    "campuses": meta.get("campuses", []),
                    "has_denominator": has_denominator,
                    "entry_mode": meta.get("entry_mode", "manual"),
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"完成：新增 {created} 筆，更新 {updated} 筆，共 {created + updated} 筆預設指標"
        ))
