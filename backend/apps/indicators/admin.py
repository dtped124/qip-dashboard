from django.contrib import admin
from django.db import transaction

from .cache import bump_dashboard_cache
from .models import Indicator, DataPoint, YearlySummary, PeerValue, TCPIBenchmark, Alert


class DashboardModelAdmin(admin.ModelAdmin):
    """Edits in the Django admin change what GET /api/v1/dashboard/ shows: invalidate its cache.

    The admin saves and deletes inside a transaction, so the bump waits for the commit (on_commit runs at once when
    no transaction is open, e.g. the bulk "delete selected" action).
    """

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        transaction.on_commit(bump_dashboard_cache)

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        transaction.on_commit(bump_dashboard_cache)

    def delete_queryset(self, request, queryset):
        super().delete_queryset(request, queryset)
        transaction.on_commit(bump_dashboard_cache)


@admin.register(Indicator)
class IndicatorAdmin(DashboardModelAdmin):
    list_display = ["code", "name", "category", "unit", "direction", "data_nature", "is_active", "is_quarterly"]
    list_filter = ["category", "unit", "direction", "data_nature", "is_active", "source"]
    search_fields = ["code", "name"]
    list_editable = ["is_active"]
    ordering = ["code"]


@admin.register(DataPoint)
class DataPointAdmin(DashboardModelAdmin):
    list_display = ["indicator", "campus", "year", "month", "value", "numerator", "denominator"]
    list_filter = ["campus", "year"]
    search_fields = ["indicator__code", "indicator__name"]
    ordering = ["-year", "-month"]


@admin.register(YearlySummary)
class YearlySummaryAdmin(DashboardModelAdmin):
    list_display = ["indicator", "campus", "year", "average", "benchmark_regional", "benchmark_district"]
    list_filter = ["campus", "year"]
    search_fields = ["indicator__code"]
    ordering = ["-year"]


@admin.register(PeerValue)
class PeerValueAdmin(admin.ModelAdmin):
    list_display = ["indicator", "campus", "value", "year"]
    list_filter = ["campus"]
    search_fields = ["indicator__code"]


@admin.register(TCPIBenchmark)
class TCPIBenchmarkAdmin(DashboardModelAdmin):
    list_display = ["indicator", "tcpi_name", "year", "medical_center", "regional_hospital", "district_hospital"]
    list_filter = ["year"]
    search_fields = ["indicator__code", "tcpi_name"]
    ordering = ["-year"]


@admin.register(Alert)
class AlertAdmin(DashboardModelAdmin):
    list_display = ["indicator", "campus", "year", "month", "mechanism", "severity", "message", "acknowledged"]
    list_filter = ["severity", "mechanism", "acknowledged", "campus"]
    search_fields = ["indicator__code", "message"]
    list_editable = ["acknowledged"]
    ordering = ["-year", "-month"]
