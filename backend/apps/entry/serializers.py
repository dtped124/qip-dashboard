from rest_framework import serializers

from apps.entry.models import Campus, DeadlineSetting, IndicatorAssignment, ReportCategory


class CampusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Campus
        fields = ["id", "code", "name", "benchmark_level", "is_active"]


class ReportCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportCategory
        fields = ["id", "code", "name", "sort_order", "color"]


class IndicatorAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_employee_id = serializers.CharField(source="user.employee_id", read_only=True)
    campus_name = serializers.CharField(source="campus.name", read_only=True)

    class Meta:
        model = IndicatorAssignment
        fields = [
            "id",
            "indicator_code",
            "campus",
            "campus_name",
            "user",
            "user_name",
            "user_employee_id",
            "role",
            "effective_from",
            "effective_to",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["created_by", "created_at"]


class DeadlineSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeadlineSetting
        fields = ["id", "year", "month", "deadline_day", "note"]
