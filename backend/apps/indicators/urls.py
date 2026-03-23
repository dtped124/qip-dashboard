from django.urls import path
from . import views

urlpatterns = [
    path("", views.indicator_list, name="indicator-list"),
    path("<str:code>/", views.indicator_detail, name="indicator-detail"),
    path("<str:code>/data/", views.indicator_data, name="indicator-data"),
    path("<str:code>/alerts/", views.indicator_alerts, name="indicator-alerts"),
    path("<str:code>/summaries/", views.indicator_summaries, name="indicator-summaries"),
    path("<str:code>/analysis/", views.indicator_analysis, name="indicator-analysis"),
]
