"""
載入填報系統基礎資料：院區（Campus）、面向（ReportCategory）、排除理由（ExclusionReason）

Usage:
    python manage.py seed_entry_base
    python manage.py seed_entry_base --clear  # 清除後重建
"""
from django.core.management.base import BaseCommand

from apps.entry.models import Campus, ExclusionReason, ReportCategory

CAMPUSES = [
    {"code": "hsinchu",  "name": "新竹", "benchmark_level": "medical_center"},
    {"code": "zhubei",   "name": "竹北", "benchmark_level": "regional"},
    {"code": "zhudong",  "name": "竹東", "benchmark_level": "district"},
]

# 面向代碼對應現有指標 code 前綴（HA01-xx → HA01）
# 顏色沿用 constants.py CATEGORY_COLORS
CATEGORIES = [
    {"code": "HA01", "name": "整體住院照護", "sort_order": 1,  "color": "#3B82F6"},
    {"code": "HA02", "name": "加護照護",     "sort_order": 2,  "color": "#EF4444"},
    {"code": "HA03", "name": "手術照護",     "sort_order": 3,  "color": "#F97316"},
    {"code": "HA04", "name": "產科照護",     "sort_order": 4,  "color": "#EC4899"},
    {"code": "HA05", "name": "急診照護",     "sort_order": 5,  "color": "#8B5CF6"},
    {"code": "HA06", "name": "重點照護",     "sort_order": 6,  "color": "#06B6D4"},
    {"code": "HA07", "name": "感染管制",     "sort_order": 7,  "color": "#10B981"},
    {"code": "HA08", "name": "用藥安全",     "sort_order": 8,  "color": "#F59E0B"},
    {"code": "HA09", "name": "呼吸照護",     "sort_order": 9,  "color": "#6366F1"},
    {"code": "HA10", "name": "經營管理",     "sort_order": 10, "color": "#6B7280"},
]

EXCLUSION_REASONS = [
    {"code": "NOT_ELIGIBLE", "name": "不符收案定義",  "description": "個案不符合該指標的收案條件",       "sort_order": 1},
    {"code": "DATA_ERROR",   "name": "資料錯誤",      "description": "HIS 資料有誤（如轉歸代碼錯誤）",   "sort_order": 2},
    {"code": "DUPLICATE",    "name": "重複個案",      "description": "同一病人重複出現",                 "sort_order": 3},
    {"code": "TRANSFER",     "name": "轉院/轉床",     "description": "轉出非本院照護範圍",               "sort_order": 4},
    {"code": "OTHER",        "name": "其他",          "description": "需在補充說明欄填寫具體原因",        "sort_order": 5},
]


class Command(BaseCommand):
    help = "載入填報系統基礎資料（院區、面向、排除理由）"

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="清除後重建")

    def handle(self, *args, **options):
        if options["clear"]:
            Campus.objects.all().delete()
            ReportCategory.objects.all().delete()
            ExclusionReason.objects.all().delete()
            self.stdout.write("已清除舊資料")

        # 院區
        for data in CAMPUSES:
            Campus.objects.update_or_create(code=data["code"], defaults=data)
        self.stdout.write(self.style.SUCCESS(f"✓ 院區：{len(CAMPUSES)} 筆"))

        # 面向
        for data in CATEGORIES:
            ReportCategory.objects.update_or_create(code=data["code"], defaults=data)
        self.stdout.write(self.style.SUCCESS(f"✓ 面向：{len(CATEGORIES)} 筆"))

        # 排除理由
        for data in EXCLUSION_REASONS:
            ExclusionReason.objects.update_or_create(code=data["code"], defaults=data)
        self.stdout.write(self.style.SUCCESS(f"✓ 排除理由：{len(EXCLUSION_REASONS)} 筆"))

        self.stdout.write(self.style.SUCCESS("填報系統基礎資料載入完成"))
