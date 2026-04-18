from django.urls import path
from . import views

urlpatterns = [
    path("upload/", views.upload_excel, name="import-upload"),
    path("logs/", views.import_logs, name="import-logs"),
    path("correct-datapoint/", views.correct_datapoint, name="import-correct-datapoint"),
]
