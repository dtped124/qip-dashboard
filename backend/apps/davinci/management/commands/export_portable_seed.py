"""匯出達文西烘焙資料，供 qip-portable 的 public/data/davinci-export.json 使用。

Portable 版無後端，首次啟動時由 lib/seed.ts 讀這份 JSON 灌進 IndexedDB。
欄位名稱與形狀必須與 DavinciCaseRecord / DavinciIndicatorValueRecord 對齊，
否則 portable 端會靜默載入不完整的資料。

用法（容器內）：
    python manage.py export_portable_seed --out /tmp/davinci-export.json
"""
from __future__ import annotations

import json
from datetime import date

from django.core.management.base import BaseCommand

from apps.davinci.constants import (
    ADVERSE_EVENT_CODES,
    DAVINCI_CAMPUSES,
    DAVINCI_CATEGORY,
    DAVINCI_INDICATORS,
    P_CHART_MIN_N,
    SEVERE_COMP_CODES,
)
from apps.davinci.models import DavinciCase, DavinciIndicatorValue

# seed.ts 會依此版號決定是否重新灌入既有 IndexedDB（見 DAVINCI_SEED_VERSION）
SEED_VERSION = 2

CASE_FIELDS = (
    "campus", "period", "account", "chart_no_masked", "patient_masked",
    "davinci_type", "dept_code", "dept_name", "surgeon", "order_codes",
    "op_date", "op_date_raw", "admission_date", "discharge_date",
    "op_time_min", "blood_ml", "conversion", "conversion_reason",
    "adverse_14d", "adverse_codes", "adverse_free_text",
    "severe_comp_30d", "severe_comp_codes", "infection_14d",
    "reoperation_14d", "flags",
)

VALUE_FIELDS = (
    "campus", "period", "indicator_code", "numerator", "denominator",
    "value", "median_value", "n_cases", "n_excluded",
)


def _plain(v):
    return v.isoformat() if isinstance(v, date) else v


class Command(BaseCommand):
    help = "匯出達文西個案與指標值為 portable 用的 JSON"

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="輸出檔路徑")

    def handle(self, *args, **opts):
        cases = [
            {f: _plain(getattr(c, f)) for f in CASE_FIELDS}
            for c in DavinciCase.objects.order_by("campus", "period", "account")
        ]
        values = [
            {f: _plain(getattr(v, f)) for f in VALUE_FIELDS}
            for v in DavinciIndicatorValue.objects.order_by(
                "campus", "period", "indicator_code"
            )
        ]

        payload = {
            "version": SEED_VERSION,
            "category": DAVINCI_CATEGORY,
            "indicators": [
                {"code": code, "name": m["name"], "kind": m["kind"],
                 "unit": m["unit"], "case_field": m["case_field"]}
                for code, m in DAVINCI_INDICATORS.items()
            ],
            "adverse_event_codes": ADVERSE_EVENT_CODES,
            "severe_comp_codes": SEVERE_COMP_CODES,
            "campuses": list(DAVINCI_CAMPUSES),
            "p_chart_min_n": P_CHART_MIN_N,
            "cases": cases,
            "indicatorValues": values,
        }

        with open(opts["out"], "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)

        periods = sorted({c["period"] for c in cases})
        campuses = sorted({c["campus"] for c in cases})
        self.stdout.write(
            f"cases={len(cases)} values={len(values)} "
            f"campuses={campuses} periods={len(periods)} "
            f"range={periods[0] if periods else '-'}~{periods[-1] if periods else '-'} "
            f"version={SEED_VERSION}"
        )
