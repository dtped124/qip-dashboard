"""
認證 API：登入、登出、取得當前使用者資訊、變更密碼
帳號管理 API（系統管理員）
"""
import functools

from django.contrib.auth import login, logout, update_session_auth_hash
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts import password_throttle
from apps.accounts.lockout import unlock_account
from apps.accounts.models import User, UserRole
from apps.accounts.passwords import generate_temporary_password
from apps.accounts.permissions import IsAdmin
from apps.accounts.serializers import (
    ChangePasswordSerializer,
    CurrentUserSerializer,
    LoginSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)


def no_store(view):
    """Answer every request of ``view`` (refusals and errors too) with ``Cache-Control: no-store``.

    For endpoints that say who the caller is, list or change accounts, or hand out a one-time
    password: neither a browser nor a proxy may keep a copy. Put it directly above ``@api_view``.
    """

    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        response = view(request, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

    return wrapper


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_login(request):
    """POST /api/auth/login — 帳號 + 密碼登入（無需 CSRF）

    Too many failed attempts for an account answer 429 ``locked`` (django-axes);
    see LoginSerializer.validate. A user who must change the password still gets
    200 here, with ``must_change_password: true`` in the body.
    """
    serializer = LoginSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]
    # The same HttpRequest object django-axes tracked during authenticate().
    login(request._request, user)
    return Response(CurrentUserSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def auth_logout(request):
    """POST /api/auth/logout — 登出"""
    logout(request)
    return Response({"detail": "已登出"})


# Keep ensure_csrf_cookie outermost (above no_store and api_view): it sets the csrftoken
# cookie on this response, which the SPA reads to send X-CSRFToken on writes.
@ensure_csrf_cookie
@no_store
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    """GET /api/auth/me — 取得當前使用者資訊（never cached: it answers "who is signed in")

    ``roles`` are the effective ones: a Django superuser always includes ``admin`` (login answers alike).
    """
    return Response(CurrentUserSerializer(request.user).data)


# ── 帳號管理（系統管理員）────────────────────────────────────────

@no_store
@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def user_list(request):
    """GET/POST /api/admin/users

    POST without ``password`` (or with a blank one) creates the account with a random
    temporary password, returned once as ``temporary_password`` in the 201 body.
    """
    if request.method == "GET":
        qs = User.objects.select_related("campus").order_by("employee_id")
        return Response(UserSerializer(qs, many=True).data)

    serializer = UserCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    payload = dict(UserSerializer(user).data)
    if serializer.temporary_password:
        payload["temporary_password"] = serializer.temporary_password
    return Response(payload, status=status.HTTP_201_CREATED)


def _self_demotion_error(user: User, changes: dict) -> Response | None:
    """An administrator may not deactivate their own account or remove their own admin role.

    This has nothing to do with the login lockout. Returns the 400 response for such a change, else None.
    """
    if changes.get("is_active") is False:
        return Response(
            {"detail": "不可停用自己的帳號", "code": "cannot_deactivate_self"}, status=status.HTTP_400_BAD_REQUEST
        )
    if "roles" in changes and UserRole.ADMIN in user.role_set() and UserRole.ADMIN not in changes["roles"]:
        return Response(
            {"detail": "不可移除自己的系統管理員角色", "code": "cannot_remove_own_admin_role"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


@no_store
@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAdmin])
def user_detail(request, pk):
    """GET/PATCH/DELETE /api/admin/users/:id"""
    try:
        user = User.objects.select_related("campus").get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "找不到使用者"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(UserSerializer(user).data)

    if request.method == "DELETE":
        # 不可刪除自己
        if user.pk == request.user.pk:
            return Response({"detail": "不可刪除自己的帳號"}, status=status.HTTP_400_BAD_REQUEST)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = UserUpdateSerializer(user, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    if user.pk == request.user.pk:
        refused = _self_demotion_error(user, serializer.validated_data)
        if refused is not None:
            return refused
    serializer.save()
    return Response(UserSerializer(user).data)


@no_store
@api_view(["POST"])
@permission_classes([IsAdmin])
def reset_password(request, pk):
    """POST /api/admin/users/:id/reset-password — 管理員重設密碼

    Sets a random temporary password, flags the account ``must_change_password`` and lifts
    its login lockout and any change-password wait (the user has to change the password at their
    next sign-in, which a wait left over from earlier guesses must not block). The password is
    returned this once and is not logged or stored.
    Changing the password also ends every session the user has open.
    """
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "找不到使用者"}, status=status.HTTP_404_NOT_FOUND)

    temporary_password = generate_temporary_password(user)
    user.set_password(temporary_password)
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password"])
    unlock_account(user.employee_id)
    password_throttle.reset(user)
    return Response({"temporary_password": temporary_password})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """POST /api/auth/change-password — 使用者修改自己的密碼

    Body: ``current_password``, ``new_password``. Open to a user who must change the
    password (plain IsAuthenticated); a successful change lifts that obligation.

    Guess limit (password_throttle): after ``PASSWORD_CHANGE_FAILURE_LIMIT`` calls in a row that
    do not prove the current password, the next one answers 429 ``too_many_attempts`` - even with
    the right password - until ``PASSWORD_CHANGE_COOLOFF_MINUTES`` have passed.
    """
    user = request.user
    password_throttle.register_attempt(user)  # raises the 429 before the body is even read
    serializer = ChangePasswordSerializer(data=request.data, context={"user": user})
    try:
        serializer.is_valid(raise_exception=True)
    finally:
        # Knowing the current password ends the streak, also when the new password is then refused.
        if serializer.current_password_verified:
            password_throttle.reset(user)

    user.set_password(serializer.validated_data["new_password"])
    user.must_change_password = False
    user.save(update_fields=["password", "must_change_password"])
    # The session hash is derived from the password: refresh it so this session survives
    # (every other session of the user is signed out).
    update_session_auth_hash(request, user)
    return Response({"detail": "密碼已更新"})


# ── CSRF 失敗（settings.CSRF_FAILURE_VIEW）──────────────────────────

def csrf_failure(request, reason=""):
    """Django CSRF middleware rejection as JSON instead of the default HTML page.

    DRF views report CSRF problems through QipSessionAuthentication with the
    same body, so the SPA sees one shape everywhere.
    """
    return JsonResponse({"detail": "CSRF verification failed.", "code": "csrf_failed"}, status=403)
