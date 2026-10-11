from rest_framework import serializers

from apps.accounts.permissions import REPORTER, has_role
from apps.entry.models import AssignmentField, Campus, DeadlineSetting, IndicatorAssignment, ReportCategory
from apps.entry.services.assignments import FIELD_SET
from apps.indicators.models import Indicator


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
            "field",
            "effective_from",
            "effective_to",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["created_by", "created_at"]

    def validate(self, attrs):
        """
        Check the assignment as it will be stored: the incoming values on top of the existing row, so a
        partial update (PATCH) is held to the same rules as a create.

        - the indicator exists, and a denominator is only assigned for an indicator that has one
        - the assignee is an active reporter (an admin is fine too)
        - effective_from <= effective_to
        - no second current assignment (effective_to IS NULL) of the same indicator, campus and user
          that covers a field this one covers; ``both`` overlaps with everything
        """
        instance = self.instance

        def merged(name, default=None):
            if name in attrs:
                return attrs[name]
            return getattr(instance, name) if instance is not None else default

        code = merged("indicator_code")
        campus = merged("campus")
        user = merged("user")
        field = merged("field", AssignmentField.BOTH)
        effective_from = merged("effective_from")
        effective_to = merged("effective_to")

        indicator = Indicator.objects.filter(code=code).first()
        if indicator is None:
            raise serializers.ValidationError({"indicator_code": f"找不到指標 {code}"})
        if field == AssignmentField.DENOMINATOR and not indicator.has_denominator:
            raise serializers.ValidationError({"field": f"指標 {code} 沒有分母，不能只指派分母"})

        # An assignment that ended long ago is not re-checked against the assignee's current state
        # (closing the assignment of an account that has since been deactivated must stay possible).
        reopened = instance is not None and instance.effective_to is not None and effective_to is None
        if instance is None or "user" in attrs or reopened:
            if not user.is_active:
                raise serializers.ValidationError({"user": "此帳號已停用，不能被指派"})
            if not has_role(user, REPORTER):
                raise serializers.ValidationError({"user": "被指派者必須具有填報者（或管理員）角色"})

        if effective_from is not None and effective_to is not None and effective_from > effective_to:
            raise serializers.ValidationError({"effective_to": "失效日不得早於生效起始日"})

        if effective_to is None:
            covered = set(FIELD_SET) if field == AssignmentField.BOTH else {field}
            others = IndicatorAssignment.objects.filter(
                indicator_code=code, campus=campus, user=user, effective_to__isnull=True
            )
            if instance is not None:
                others = others.exclude(pk=instance.pk)
            clash = sorted(covered & {f for other in others for f in _covered(other.field)})
            if clash:
                labels = "、".join("分子" if f == "numerator" else "分母" for f in clash)
                raise serializers.ValidationError(
                    f"{user.full_name} 在此院區對 {code} 已有現行指派涵蓋{labels}，請先結束或修改原指派"
                )
        return attrs


def _covered(field: str) -> set[str]:
    return set(FIELD_SET) if field == AssignmentField.BOTH else {field}


class DeadlineSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeadlineSetting
        fields = ["id", "year", "month", "deadline_day", "note"]
