from django.urls import path

from apps.entry.views import (
    assignment_detail,
    assignment_list,
    campus_list,
    category_list,
    deadline_list,
)
from apps.entry.views_entry import (
    entry_form,
    entry_save_draft,
    entry_submit,
    my_tasks,
)
from apps.entry.views_review import (
    review_approve,
    review_detail,
    review_edit_entry,
    review_finalize,
    review_overview,
    review_reject,
    review_unlock,
)
from apps.entry.views_import import (
    his_trigger,
    his_webhook,
    import_batches,
    import_confirm,
    import_excel,
)
from apps.entry.views_case_list import (
    case_list,
    case_list_exclude,
    case_list_restore,
    exclusion_reasons,
    review_exclusion,
)
from apps.entry.views_dashboard import entry_indicators, entry_benchmarks

# ── 管理 API（掛在 /api/admin/）────────────────────────────────
urlpatterns = [
    path("campuses", campus_list, name="admin-campus-list"),
    path("categories", category_list, name="admin-category-list"),
    path("assignments", assignment_list, name="admin-assignment-list"),
    path("assignments/<int:pk>", assignment_detail, name="admin-assignment-detail"),
    path("deadlines", deadline_list, name="admin-deadline-list"),
]

# ── 填報 API（掛在 /api/entry/）────────────────────────────────
entry_urlpatterns = [
    path("my-tasks", my_tasks, name="entry-my-tasks"),
    path("form", entry_form, name="entry-form"),
    path("save-draft", entry_save_draft, name="entry-save-draft"),
    path("submit", entry_submit, name="entry-submit"),
]

# ── 審核 API（掛在 /api/review/）───────────────────────────────
review_urlpatterns = [
    path("overview", review_overview, name="review-overview"),
    path("detail", review_detail, name="review-detail"),
    path("approve", review_approve, name="review-approve"),
    path("reject", review_reject, name="review-reject"),
    path("edit-entry", review_edit_entry, name="review-edit-entry"),
    path("finalize", review_finalize, name="review-finalize"),
    path("unlock", review_unlock, name="review-unlock"),
]

# ── 匯入 API（掛在 /api/import/）───────────────────────────────
import_urlpatterns = [
    path("excel", import_excel, name="import-excel"),
    path("confirm", import_confirm, name="import-confirm"),
    path("batches", import_batches, name="import-batches"),
    path("his-trigger", his_trigger, name="import-his-trigger"),
    path("his-webhook", his_webhook, name="import-his-webhook"),
]

# ── 個案清單 API（掛在 /api/case-list/）────────────────────────
case_list_urlpatterns = [
    path("", case_list, name="case-list"),
    path("exclude", case_list_exclude, name="case-list-exclude"),
    path("restore", case_list_restore, name="case-list-restore"),
    path("exclusion-reasons", exclusion_reasons, name="exclusion-reasons"),
    path("review-exclusion", review_exclusion, name="review-exclusion"),
]

# ── 儀表板資料 API（掛在 /api/dashboard/）──────────────────────
dashboard_entry_urlpatterns = [
    path("entry-data", entry_indicators, name="dashboard-entry-data"),
    path("entry-benchmarks", entry_benchmarks, name="dashboard-entry-benchmarks"),
]
