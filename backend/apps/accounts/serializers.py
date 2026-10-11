from django.contrib.auth import authenticate
from rest_framework import serializers

from apps.accounts.lockout import AccountLocked, is_locked_out
from apps.accounts.models import User, UserRole
from apps.accounts.passwords import generate_temporary_password, password_problems


class LoginSerializer(serializers.Serializer):
    # Same limit as User.employee_id: a longer name cannot belong to an account, and it
    # must never reach django-axes, which stores the name in a 255-character column.
    employee_id = serializers.CharField(label="帳號", max_length=20)
    # Passwords are compared verbatim; DRF's default would strip surrounding spaces.
    password = serializers.CharField(
        label="密碼", write_only=True, trim_whitespace=False, style={"input_type": "password"}
    )

    def validate(self, data):
        # django-axes records attempts on (and AxesMiddleware reads) the Django HttpRequest,
        # not DRF's wrapper around it.
        request = self.context["request"]
        http_request = getattr(request, "_request", request)
        employee_id = data["employee_id"]

        # Already locked: refuse without looking at the password, and without recording another
        # failure (which would push the end of the lockout further out).
        if is_locked_out(http_request, employee_id):
            raise AccountLocked()
        user = authenticate(request=http_request, employee_id=employee_id, password=data["password"])
        if not user:
            # authenticate() swallows every PermissionDenied a backend raises (axes' backend raises one for
            # a locked-out account) and just returns None, so the lock is read from the request flag axes
            # sets - also when this very failure was the one that reached the limit.
            if getattr(http_request, "axes_locked_out", False):
                raise AccountLocked()
            raise serializers.ValidationError("帳號或密碼錯誤")
        if not user.is_active:
            raise serializers.ValidationError("帳號已停用")
        data["user"] = user
        return data


class ChangePasswordSerializer(serializers.Serializer):
    """Own-password change; ``context["user"]`` is the signed-in user."""

    current_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})

    def validate(self, data):
        user = self.context["user"]
        if not user.check_password(data["current_password"]):
            raise serializers.ValidationError({"current_password": ["目前密碼不正確"]})
        if data["new_password"] == data["current_password"]:
            raise serializers.ValidationError({"new_password": ["新密碼不得與目前密碼相同"]})
        problems = password_problems(data["new_password"], user)
        if problems:
            raise serializers.ValidationError({"new_password": problems})
        return data


def validate_role_list(value):
    """A list of known ``UserRole`` values, without duplicates (order kept)."""
    if not isinstance(value, list):
        raise serializers.ValidationError("角色必須是清單")
    unknown = [role for role in value if not isinstance(role, str) or role not in UserRole.values]
    if unknown:
        raise serializers.ValidationError(
            f"未知的角色：{', '.join(map(str, unknown))}（可用：{', '.join(UserRole.values)}）"
        )
    return list(dict.fromkeys(value))


class UserSerializer(serializers.ModelSerializer):
    campus_code = serializers.CharField(source="campus.code", read_only=True, allow_null=True)
    campus_name = serializers.CharField(source="campus.name", read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = [
            "id",
            "employee_id",
            "full_name",
            "email",
            "campus_code",
            "campus_name",
            "roles",
            "is_active",
            "must_change_password",
        ]
        read_only_fields = fields


class UserCreateSerializer(serializers.ModelSerializer):
    # Optional. Left out or blank: the server generates a temporary password (see create()).
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False, style={"input_type": "password"}
    )

    # Set by create() when the server chose the password; the view returns it once.
    temporary_password: str | None = None

    class Meta:
        model = User
        fields = [
            "employee_id",
            "full_name",
            "email",
            "campus",
            "roles",
            "password",
        ]

    def validate_roles(self, value):
        return validate_role_list(value)

    def validate(self, attrs):
        password = attrs.get("password")
        if password:
            # Unsaved instance: just enough for the similarity validator.
            candidate = User(
                employee_id=attrs.get("employee_id", ""),
                full_name=attrs.get("full_name", ""),
                email=attrs.get("email", ""),
            )
            problems = password_problems(password, candidate)
            if problems:
                raise serializers.ValidationError({"password": problems})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password", "")
        user = User(**validated_data)
        if not password:
            password = generate_temporary_password(user)
            self.temporary_password = password
        user.must_change_password = True
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["full_name", "email", "campus", "roles", "is_active"]

    def validate_roles(self, value):
        return validate_role_list(value)
