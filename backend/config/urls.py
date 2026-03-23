from django.contrib import admin
from django.urls import include, path

from apps.indicators.views import dashboard_bulk, tcpi_benchmarks

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/indicators/", include("apps.indicators.urls")),
    path("api/v1/imports/", include("apps.imports.urls")),
    path("api/v1/dashboard/", dashboard_bulk, name="dashboard-bulk"),
    path("api/v1/tcpi/", tcpi_benchmarks, name="tcpi-benchmarks"),
]
