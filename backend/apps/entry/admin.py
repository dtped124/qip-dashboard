from django.contrib import admin

from apps.entry.models import (
    Campus,
    CaseRecord,
    DataSourceConfig,
    DeadlineSetting,
    EntryAuditLog,
    ExclusionReason,
    HA10SubEntry,
    HISFieldMapping,
    ImportBatch,
    IndicatorAssignment,
    IndicatorEntry,
    MonthlyReport,
    ReportCategory,
)


@admin.register(Campus)
class CampusAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "benchmark_level", "is_active")
    list_filter = ("benchmark_level", "is_active")


@admin.register(ReportCategory)
class ReportCategoryAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "sort_order", "color")
    ordering = ("sort_order",)


@admin.register(IndicatorAssignment)
class IndicatorAssignmentAdmin(admin.ModelAdmin):
    list_display = ("indicator_code", "campus", "user", "role", "effective_from", "effective_to")
    list_filter = ("campus", "role")
    search_fields = ("indicator_code", "user__employee_id", "user__full_name")
    ordering = ("indicator_code", "campus")


@admin.register(MonthlyReport)
class MonthlyReportAdmin(admin.ModelAdmin):
    list_display = ("campus", "year", "month", "category", "status", "is_late", "submitted_at")
    list_filter = ("campus", "status", "is_late")
    search_fields = ("campus__name",)
    ordering = ("-year", "-month", "campus")


@admin.register(IndicatorEntry)
class IndicatorEntryAdmin(admin.ModelAdmin):
    list_display = ("report", "indicator_code", "numerator", "denominator", "value", "data_source")
    list_filter = ("data_source",)
    search_fields = ("indicator_code",)


@admin.register(ExclusionReason)
class ExclusionReasonAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "sort_order", "is_active")
    ordering = ("sort_order",)


@admin.register(DeadlineSetting)
class DeadlineSettingAdmin(admin.ModelAdmin):
    list_display = ("year", "month", "deadline_day", "note")
    ordering = ("-year", "-month")


@admin.register(ImportBatch)
class ImportBatchAdmin(admin.ModelAdmin):
    list_display = ("source_name", "campus", "year", "month", "status", "record_count", "imported_by", "imported_at")
    list_filter = ("source_type", "status", "campus")
    ordering = ("-imported_at",)


@admin.register(DataSourceConfig)
class DataSourceConfigAdmin(admin.ModelAdmin):
    list_display = ("name", "source_type", "is_active", "last_run_at", "last_run_status")
    list_filter = ("source_type", "is_active")


@admin.register(HISFieldMapping)
class HISFieldMappingAdmin(admin.ModelAdmin):
    list_display = ("data_source", "indicator_code", "campus", "is_active")
    list_filter = ("data_source", "campus", "is_active")


@admin.register(EntryAuditLog)
class EntryAuditLogAdmin(admin.ModelAdmin):
    list_display = ("entry", "field_name", "old_value", "new_value", "changed_by", "changed_at")
    readonly_fields = ("entry", "field_name", "old_value", "new_value", "changed_by", "changed_at")
    ordering = ("-changed_at",)


admin.site.register(HA10SubEntry)
admin.site.register(CaseRecord)
