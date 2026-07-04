from django.contrib import admin
from django.urls import include, path

from apps.accounts.urls import admin_urlpatterns
from apps.entry.urls import (
    case_list_urlpatterns,
    dashboard_entry_urlpatterns,
    entry_urlpatterns,
    import_urlpatterns,
    review_urlpatterns,
)
from apps.indicators.views import dashboard_bulk, tcpi_benchmarks

urlpatterns = [
    path("admin/", admin.site.urls),

    # 認證
    path("api/auth/", include("apps.accounts.urls")),

    # 指標資料（現有儀表板，向後相容）
    path("api/v1/indicators/", include("apps.indicators.urls")),
    path("api/v1/imports/", include("apps.imports.urls")),
    path("api/v1/dashboard/", dashboard_bulk, name="dashboard-bulk"),
    path("api/v1/tcpi/", tcpi_benchmarks, name="tcpi-benchmarks"),

    # 填報系統管理 API（帳號 + 指派 + 截止日）
    path("api/admin/", include((admin_urlpatterns, "admin_accounts"))),
    path("api/admin/", include("apps.entry.urls")),

    # 填報 API
    path("api/entry/", include((entry_urlpatterns, "entry"))),

    # 審核 API
    path("api/review/", include((review_urlpatterns, "review"))),

    # 匯入 API
    path("api/import/", include((import_urlpatterns, "import"))),

    # 個案清單 API
    path("api/case-list/", include((case_list_urlpatterns, "case_list"))),

    # 儀表板資料 API（填報系統版）
    path("api/dashboard/", include((dashboard_entry_urlpatterns, "dashboard_entry"))),

    # 達文西手術品質（獨立模組，與 QIP 平行）
    path("api/davinci/", include("apps.davinci.urls")),
]
