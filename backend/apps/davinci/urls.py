from django.urls import path

from . import views

urlpatterns = [
    path("import/", views.import_upload, name="davinci-import"),
    path("import/confirm/", views.import_confirm, name="davinci-import-confirm"),
    path("import/logs/", views.import_logs, name="davinci-import-logs"),
    path("indicators/", views.indicator_values, name="davinci-indicators"),
    path("meta/", views.meta, name="davinci-meta"),
]
