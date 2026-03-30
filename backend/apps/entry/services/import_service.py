"""
匯入批次確認服務（§9.2）

confirm_import_batch：ImportBatch status=preview → confirmed，
將 IndicatorDataPoint 寫入 IndicatorEntry。
處理資料來源衝突（§9.3）。
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.entry.models import (
    Campus,
    DataSource,
    ImportBatch,
    ImportBatchStatus,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
    ReportStatus,
)
from apps.indicators.models import Indicator


def _category_code_from_indicator(indicator_code: str) -> str:
    return indicator_code.split("-")[0]


def _calc_value(numerator, denominator, unit: str, has_denominator: bool):
    if not has_denominator:
        return numerator
    if numerator is None or denominator is None or denominator == 0:
        return None
    val = numerator / denominator
    if unit == "percent":
        val *= 100
    elif unit == "permille":
        val *= 1000
    return round(val, 6)


@transaction.atomic
def confirm_import_batch(batch_id: int, confirmed_by) -> dict:
    """
    確認匯入批次（§8.5 POST /api/import/confirm）

    衝突規則（§9.3）：
    - 若某指標已有 draft/submitted 的線上填報資料 → 跳過，回傳衝突列表
    - 若尚無資料 → 直接寫入，data_source = "excel" / "his"
    """
    try:
        batch = ImportBatch.objects.select_related("campus").get(pk=batch_id)
    except ImportBatch.DoesNotExist:
        return {"ok": False, "error": "找不到匯入批次"}

    if batch.status != ImportBatchStatus.PREVIEW:
        return {"ok": False, "error": f"批次狀態不是 preview（目前：{batch.status}）"}

    campus = batch.campus
    year, month = batch.year, batch.month
    data_source = DataSource.HIS if batch.source_type == "his" else DataSource.EXCEL

    # 找出此批次對應的預覽資料（從 IndicatorEntry 中找到尚未確認的）
    # 實務上需要從 batch 的 preview 資料中重新取得，
    # 這裡透過重新執行 adapter 取得（Excel 重新解析）
    # 或從 ImportBatch 關聯的 IndicatorEntry 取（更好的方式）
    # 目前先從 batch 相關 entries 取，若無則直接從批次 error_log 解析

    # 簡化實作：找出 IndicatorEntry 中 import_batch=batch 的記錄
    existing_entries = IndicatorEntry.objects.filter(import_batch=batch)

    conflicts = []
    written = 0

    for entry in existing_entries:
        indicator_code = entry.indicator_code
        cat_code = _category_code_from_indicator(indicator_code)

        # 找對應 ReportCategory
        try:
            category = ReportCategory.objects.get(code=cat_code)
        except ReportCategory.DoesNotExist:
            continue

        report, _ = MonthlyReport.objects.get_or_create(
            campus=campus, year=year, month=month, category=category,
            defaults={"status": ReportStatus.UNFILLED},
        )

        # 衝突檢查：已有線上填報資料
        conflict_entry = IndicatorEntry.objects.filter(
            report=report,
            indicator_code=indicator_code,
            data_source=DataSource.MANUAL,
        ).exclude(numerator=None, value=None).first()

        if conflict_entry:
            conflicts.append({
                "indicator_code": indicator_code,
                "existing_source": "manual",
                "existing_value": float(conflict_entry.value or 0),
            })
            continue

        # 寫入 / 更新
        entry.data_source = data_source
        entry.import_batch = batch
        entry.save()
        written += 1

    # 更新批次狀態
    batch.status = ImportBatchStatus.CONFIRMED
    batch.save(update_fields=["status"])

    return {
        "ok": True,
        "batch_id": batch.id,
        "written": written,
        "conflicts": conflicts,
    }


@transaction.atomic
def write_preview_entries(batch: ImportBatch, data_points: list, confirmed_by) -> None:
    """
    將 adapter 回傳的 IndicatorDataPoint 寫入 IndicatorEntry（status=preview）。
    只建立記錄，不改變 MonthlyReport 狀態。
    """
    campus = batch.campus
    year, month = batch.year, batch.month

    for dp in data_points:
        cat_code = _category_code_from_indicator(dp.indicator_code)
        try:
            category = ReportCategory.objects.get(code=cat_code)
        except ReportCategory.DoesNotExist:
            continue

        report, _ = MonthlyReport.objects.get_or_create(
            campus=campus, year=year, month=month, category=category,
            defaults={"status": ReportStatus.UNFILLED},
        )

        try:
            ind = Indicator.objects.get(code=dp.indicator_code)
            unit = ind.unit
            has_den = ind.has_denominator
        except Indicator.DoesNotExist:
            unit, has_den = "percent", True

        value = _calc_value(dp.numerator, dp.denominator, unit, has_den)

        IndicatorEntry.objects.update_or_create(
            report=report,
            indicator_code=dp.indicator_code,
            defaults={
                "numerator": dp.numerator,
                "denominator": dp.denominator,
                "value": value,
                "note": dp.note,
                "data_source": DataSource.HIS if batch.source_type == "his" else DataSource.EXCEL,
                "import_batch": batch,
                "filled_by": confirmed_by,
                "filled_at": timezone.now(),
            },
        )
