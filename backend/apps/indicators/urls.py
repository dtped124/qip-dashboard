from django.urls import path
from . import views, views_export

urlpatterns = [
    path("", views.indicator_list, name="indicator-list"),
    path("export/", views.export_all_data, name="indicator-export"),
    path("export/element-list/", views_export.export_element_list, name="indicator-element-list-export"),
    path("<str:code>/", views.indicator_detail, name="indicator-detail"),
    path("<str:code>/data/", views.indicator_data, name="indicator-data"),
    path("<str:code>/alerts/", views.indicator_alerts, name="indicator-alerts"),
    path("<str:code>/summaries/", views.indicator_summaries, name="indicator-summaries"),
    path("<str:code>/analysis/", views.indicator_analysis, name="indicator-analysis"),
]
