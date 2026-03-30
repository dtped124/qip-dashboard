"""
認證 API：登入、登出、取得當前使用者資訊
帳號管理 API（系統管理員）
"""
from django.contrib.auth import login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import User, UserRole
from apps.accounts.serializers import (
    LoginSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)

DEFAULT_RESET_PASSWORD = "Qip@2026!"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_login(request):
    """POST /api/auth/login — 帳號 + 密碼登入（無需 CSRF）"""
    serializer = LoginSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]
    login(request, user)
    return Response(UserSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def auth_logout(request):
    """POST /api/auth/logout — 登出"""
    logout(request)
    return Response({"detail": "已登出"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    """GET /api/auth/me — 取得當前使用者資訊"""
    return Response(UserSerializer(request.user).data)


# ── 帳號管理（系統管理員）────────────────────────────────────────

def _require_admin(request):
    if not request.user.is_system_admin and not request.user.is_staff:
        return Response({"detail": "權限不足"}, status=status.HTTP_403_FORBIDDEN)
    return None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def user_list(request):
    """GET/POST /api/admin/users"""
    denied = _require_admin(request)
    if denied:
        return denied

    if request.method == "GET":
        qs = User.objects.select_related("campus").order_by("employee_id")
        return Response(UserSerializer(qs, many=True).data)

    serializer = UserCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def user_detail(request, pk):
    """GET/PATCH/DELETE /api/admin/users/:id"""
    denied = _require_admin(request)
    if denied:
        return denied

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
    serializer.save()
    return Response(UserSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reset_password(request, pk):
    """POST /api/admin/users/:id/reset-password — 管理員重設密碼"""
    denied = _require_admin(request)
    if denied:
        return denied

    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "找不到使用者"}, status=status.HTTP_404_NOT_FOUND)

    user.set_password(DEFAULT_RESET_PASSWORD)
    user.must_change_password = True
    user.save()
    return Response({"detail": f"密碼已重設，預設密碼為 {DEFAULT_RESET_PASSWORD}"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """POST /api/auth/change-password — 使用者修改自己的密碼"""
    new_password = request.data.get("new_password", "")
    if len(new_password) < 8:
        return Response({"detail": "新密碼至少需要 8 個字元"}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    user.set_password(new_password)
    user.must_change_password = False
    user.save()
    # 重新登入以維持 session
    login(request, user)
    return Response({"detail": "密碼已更新"})
