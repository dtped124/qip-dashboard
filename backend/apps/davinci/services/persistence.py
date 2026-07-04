"""
達文西匯入 — 確認寫入

Upsert 語意（開發計畫 5 / 驗收項）：
- 檔案涵蓋的每個 (campus, period) → 先 delete 該期別舊 Case，再 bulk_create
- DavinciIndicatorValue 以 (campus, period, indicator_code) update_or_create
- 重複匯入同月份為覆蓋，不重複累計
"""
from __future__ import annotations

from django.db import transaction

from ..models import DavinciCase, DavinciImportLog, DavinciIndicatorValue
from .importer import DavinciParseResult


@transaction.atomic
def persist_result(result: DavinciParseResult, log: DavinciImportLog) -> dict:
    """把解析結果寫入資料庫，回傳統計。"""
    touched = sorted({(c.campus, c.period) for c in result.cases})

    deleted_cases = 0
    for campus, period in touched:
        n, _ = DavinciCase.objects.filter(campus=campus, period=period).delete()
        deleted_cases += n

    DavinciCase.objects.bulk_create([
        DavinciCase(
            campus=c.campus,
            period=c.period,
            account=c.account,
            chart_no_masked=c.chart_no_masked,
            patient_masked=c.patient_masked,
            davinci_type=c.davinci_type,
            dept_code=c.dept_code,
            dept_name=c.dept_name,
            surgeon=c.surgeon,
            order_codes=c.order_codes,
            admission_date=c.admission_date,
            discharge_date=c.discharge_date,
            op_date=c.op_date,
            op_date_raw=c.op_date_raw,
            op_time_min=c.op_time_min,
            blood_ml=c.blood_ml,
            conversion=c.conversion,
            conversion_reason=c.conversion_reason,
            adverse_14d=c.adverse_14d,
            adverse_codes=c.adverse_codes,
            adverse_free_text=c.adverse_free_text,
            severe_comp_30d=c.severe_comp_30d,
            severe_comp_codes=c.severe_comp_codes,
            infection_14d=c.infection_14d,
            reoperation_14d=c.reoperation_14d,
            flags=c.flags,
            import_log=log,
        )
        for c in result.cases
    ])

    created, updated = 0, 0
    for v in result.values:
        _, was_created = DavinciIndicatorValue.objects.update_or_create(
            campus=v.campus,
            period=v.period,
            indicator_code=v.indicator_code,
            defaults={
                "numerator": v.numerator,
                "denominator": v.denominator,
                "value": v.value,
                "median_value": v.median_value,
                "n_cases": v.n_cases,
                "n_excluded": v.n_excluded,
                "import_log": log,
            },
        )
        if was_created:
            created += 1
        else:
            updated += 1

    return {
        "periods": sorted({p for _, p in touched}),
        "campuses": sorted({c for c, _ in touched}),
        "cases_written": len(result.cases),
        "cases_replaced": deleted_cases,
        "values_created": created,
        "values_updated": updated,
    }
