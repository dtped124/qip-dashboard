from django.conf import settings
from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.accounts.backends import is_local_account, session_auth_method
from apps.accounts.ldap import LdapUnavailable
from apps.accounts.lockout import AccountLocked, is_locked_out
from apps.accounts.models import User, UserRole
from apps.accounts.passwords import generate_temporary_password, password_problems

# Shared with the Django admin form (admin.py): employee_id is unique case-sensitively in the database only.
DUPLICATE_EMPLOYEE_ID_MESSAGE = "此帳號已存在（帳號不分大小寫）"

# AD-related answers. Defined here and not in exceptions.py: that module imports rest_framework.views, which imports
# the default permission class (see the note on PasswordChangeRequired in permissions.py). Same body shape as
# lockout.AccountLocked: {"detail": ..., "code": ...} (the exception handler adds the code).


class LdapServiceUnavailable(APIException):
    status_code = 503
    default_code = "ldap_unavailable"
    default_detail = "目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室"


class AccountNotProvisioned(APIException):
    status_code = 403
    default_code = "account_not_provisioned"
    default_detail = "AD 驗證成功，但系統尚未開通此帳號，請洽品管中心"


class LdapManagedPassword(APIException):
    """A signed-in AD user asked to change the password here: AD owns it."""

    status_code = 403
    default_code = "ldap_managed"
    default_detail = "您的密碼由院內 AD 管理，如需變更請洽資訊室"


class LdapManagedAccount(APIException):
    """An administrator asked for a password (or a reset) on an account that signs in with AD."""

    status_code = 400
    default_code = "ldap_managed"
    default_detail = "此帳號以 AD 登入，不需重設密碼；密碼問題請洽資訊室"


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
        # Tells LdapBackend that this caller can answer "AD is unreachable" with a 503 (see backends.py).
        http_request.ldap_api_login = True
        try:
            user = authenticate(request=http_request, employee_id=employee_id, password=data["password"])
        except LdapUnavailable:
            # Not a failed login: Django sent no user_login_failed, so axes did not count it.
            raise LdapServiceUnavailable() from None
        if not user:
            # authenticate() swallows every PermissionDenied a backend raises (axes' backend raises one for
            # a locked-out account) and just returns None, so the lock is read from the request flag axes
            # sets - also when this very failure was the one that reached the limit.
            if getattr(http_request, "axes_locked_out", False):
                raise AccountLocked()
            if getattr(http_request, "ldap_status", None) == "no_account":
                raise AccountNotProvisioned()
            raise serializers.ValidationError("帳號或密碼錯誤")
        if not user.is_active:
            raise serializers.ValidationError("帳號已停用")
        data["user"] = user
        return data


class ChangePasswordSerializer(serializers.Serializer):
    """Own-password change; ``context["user"]`` is the signed-in user."""

    current_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})

    # Set by validate(): the caller knew the current password (even if the new one is then refused).
    # The view reads it to forget the attempt count (password_throttle.reset).
    current_password_verified = False

    def validate(self, data):
        user = self.context["user"]
        if not user.check_password(data["current_password"]):
            raise serializers.ValidationError({"current_password": ["目前密碼不正確"]})
        self.current_password_verified = True
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
    # Not a database field: which password this account signs in with, given today's settings.
    auth_source = serializers.SerializerMethodField()

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
            "auth_source",
        ]
        read_only_fields = fields

    def get_auth_source(self, obj) -> str:
        return "local" if is_local_account(obj.employee_id) else "ldap"


class CurrentUserSerializer(UserSerializer):
    """The signed-in user as the SPA sees them (login and /api/auth/me): ``roles`` are the *effective* ones.

    A Django superuser passes every backend role check (``permissions.is_admin``) even when ``roles`` is
    empty, so the SPA has to be told ``admin`` - otherwise it would treat such an account as having no role
    and sign it out. Only the output changes; the stored list is left alone, and the account administration
    endpoints keep showing it exactly as stored.

    ``auth_method`` is how *this session* signed in (``ldap`` / ``local``; None without a request in the context).
    """

    auth_method = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = [*UserSerializer.Meta.fields, "auth_method"]
        read_only_fields = fields

    def get_auth_method(self, obj) -> str | None:
        return session_auth_method(self.context.get("request"))

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Always a clean list: a malformed stored value (e.g. a bare string written through the
        # Django admin) must not make the SPA grant or deny menus by accident.
        roles = sorted(instance.role_set())
        if instance.is_superuser and UserRole.ADMIN.value not in roles:
            roles.append(UserRole.ADMIN.value)
        data["roles"] = roles
        return data


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

    def validate_employee_id(self, value):
        # The unique constraint is case sensitive, AD (and the login) are not: "abc" and "ABC" would be two
        # accounts for one person.
        if User.objects.filter(employee_id__iexact=value).exists():
            raise serializers.ValidationError(DUPLICATE_EMPLOYEE_ID_MESSAGE)
        return value

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
        if settings.LDAP["ENABLED"] and not is_local_account(user.employee_id):
            # An AD account signs in with the AD password: there is no local password to hand out or to set.
            if password:
                raise LdapManagedAccount(detail="AD 帳號不需要設定密碼，登入時使用 AD 密碼")
            user.must_change_password = False
            user.set_unusable_password()
            user.save()
            return user
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
