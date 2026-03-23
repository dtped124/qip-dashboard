from django.contrib import admin
from .models import ImportLog, MatchingRule


@admin.register(ImportLog)
class ImportLogAdmin(admin.ModelAdmin):
    list_display = ["file_name", "data_points_new", "data_points_updated", "data_points_unchanged", "created_at"]
    readonly_fields = ["file_name", "file_size", "sheets_processed", "data_points_new",
                       "data_points_updated", "data_points_unchanged", "errors", "created_at"]
    ordering = ["-created_at"]


@admin.register(MatchingRule)
class MatchingRuleAdmin(admin.ModelAdmin):
    list_display = ["excel_name", "indicator_code", "confirmed_at"]
    search_fields = ["excel_name", "indicator_code"]
