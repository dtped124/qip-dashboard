from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.views import (
    auth_login, auth_logout, auth_me, change_password,
    user_detail, user_list, reset_password,
)

urlpatterns = [
    # 認證（login 豁免 CSRF，因首次 POST 尚無 csrftoken cookie）
    path("login", csrf_exempt(auth_login), name="auth-login"),
    path("logout", auth_logout, name="auth-logout"),
    path("me", auth_me, name="auth-me"),
    path("change-password", change_password, name="auth-change-password"),
]

# 帳號管理路由（供 admin urls 引入）
admin_urlpatterns = [
    path("users", user_list, name="admin-user-list"),
    path("users/<int:pk>", user_detail, name="admin-user-detail"),
    path("users/<int:pk>/reset-password", reset_password, name="admin-reset-password"),
]
