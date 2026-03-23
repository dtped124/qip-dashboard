from django.contrib import admin
from .models import Indicator, DataPoint, YearlySummary, PeerValue, TCPIBenchmark, Alert


@admin.register(Indicator)
class IndicatorAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "category", "unit", "direction", "data_nature", "is_active", "is_quarterly"]
    list_filter = ["category", "unit", "direction", "data_nature", "is_active", "source"]
    search_fields = ["code", "name"]
    list_editable = ["is_active"]
    ordering = ["code"]


@admin.register(DataPoint)
class DataPointAdmin(admin.ModelAdmin):
    list_display = ["indicator", "campus", "year", "month", "value", "numerator", "denominator"]
    list_filter = ["campus", "year"]
    search_fields = ["indicator__code", "indicator__name"]
    ordering = ["-year", "-month"]


@admin.register(YearlySummary)
class YearlySummaryAdmin(admin.ModelAdmin):
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
class TCPIBenchmarkAdmin(admin.ModelAdmin):
    list_display = ["indicator", "tcpi_name", "year", "medical_center", "regional_hospital", "district_hospital"]
    list_filter = ["year"]
    search_fields = ["indicator__code", "tcpi_name"]
    ordering = ["-year"]


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ["indicator", "campus", "year", "month", "mechanism", "severity", "message", "acknowledged"]
    list_filter = ["severity", "mechanism", "acknowledged", "campus"]
    search_fields = ["indicator__code", "message"]
    list_editable = ["acknowledged"]
    ordering = ["-year", "-month"]
