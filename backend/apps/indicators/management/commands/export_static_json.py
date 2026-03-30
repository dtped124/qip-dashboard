"""
將儀表板資料匯出為靜態 JSON 檔案，供 GitHub Pages 靜態部署使用。

用法：
    python manage.py export_static_json

輸出位置：
    ../../public/data/
        dashboard-竹北.json
        dashboard-竹東.json
        dashboard-新竹.json
        detail/{code}-{campus}.json   (每個指標 × 院區)
"""
import json
import os

from django.core.management.base import BaseCommand
from django.test import RequestFactory

from apps.indicators.models import Indicator
from apps.indicators.views import dashboard_bulk, indicator_data, indicator_summaries, indicator_analysis


class Command(BaseCommand):
    help = "匯出儀表板資料為靜態 JSON（供 GitHub Pages 使用）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--output-dir",
            default=os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "public", "data"),
            help="輸出目錄（預設 ../../public/data/）",
        )

    def handle(self, *args, **options):
        output_dir = os.path.abspath(options["output_dir"])
        detail_dir = os.path.join(output_dir, "detail")
        os.makedirs(detail_dir, exist_ok=True)

        factory = RequestFactory()
        campuses = ["竹北", "竹東", "新竹"]

        # Get all active indicator codes
        indicators = list(Indicator.objects.filter(is_active=True).order_by("code"))
        indicator_codes = [ind.code for ind in indicators]

        self.stdout.write(f"輸出目錄：{output_dir}")
        self.stdout.write(f"指標數量：{len(indicator_codes)}")

        for campus in campuses:
            # 1. Dashboard bulk data
            self.stdout.write(f"\n--- {campus} ---")
            request = factory.get(f"/api/v1/dashboard/?campus={campus}")
            response = dashboard_bulk(request)
            dashboard_path = os.path.join(output_dir, f"dashboard-{campus}.json")
            with open(dashboard_path, "w", encoding="utf-8") as f:
                json.dump(response.data, f, ensure_ascii=False, separators=(",", ":"))
            self.stdout.write(f"  [OK] {dashboard_path}")

            # 2. Per-indicator detail data
            count = 0
            campus_indicators = [ind for ind in indicators if campus in ind.campuses]
            for ind in campus_indicators:
                code = ind.code
                detail = {}

                # Monthly data
                try:
                    req = factory.get(f"/api/v1/indicators/{code}/data/?campus={campus}")
                    resp = indicator_data(req, code)
                    detail["data"] = resp.data
                except Exception as e:
                    self.stderr.write(f"  [ERR] {code} data: {e}")
                    detail["data"] = {"data": [], "total": 0}

                # Summaries
                try:
                    req = factory.get(f"/api/v1/indicators/{code}/summaries/?campus={campus}")
                    resp = indicator_summaries(req, code)
                    detail["summaries"] = resp.data
                except Exception as e:
                    self.stderr.write(f"  [ERR] {code} summaries: {e}")
                    detail["summaries"] = {"data": [], "tcpi": [], "total": 0}

                # Analysis (monthly)
                try:
                    req = factory.get(f"/api/v1/indicators/{code}/analysis/?campus={campus}")
                    resp = indicator_analysis(req, code)
                    detail["analysis"] = resp.data
                except Exception as e:
                    self.stderr.write(f"  [ERR] {code} analysis: {e}")
                    detail["analysis"] = {"status": "neutral", "anomalies": [], "control_chart": None, "peer_value": None}

                detail_path = os.path.join(detail_dir, f"{code}-{campus}.json")
                with open(detail_path, "w", encoding="utf-8") as f:
                    json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))
                count += 1

            self.stdout.write(f"  [OK] {count} indicators exported")

        self.stdout.write(self.style.SUCCESS(f"\nDone! Static JSON exported to {output_dir}"))
