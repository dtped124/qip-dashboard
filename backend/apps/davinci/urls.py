from django.urls import path

from . import views

urlpatterns = [
    path("import/", views.import_upload, name="davinci-import"),
    path("import/confirm/", views.import_confirm, name="davinci-import-confirm"),
    path("import/logs/", views.import_logs, name="davinci-import-logs"),
    path("indicators/", views.indicator_values, name="davinci-indicators"),
    path("indicators/<str:code>/series/", views.indicator_series, name="davinci-series"),
    path("drilldown/", views.drilldown, name="davinci-drilldown"),
    path("cases/", views.case_list, name="davinci-cases"),
    path("export/", views.export_xlsx, name="davinci-export"),
    path("meta/", views.meta, name="davinci-meta"),
]
